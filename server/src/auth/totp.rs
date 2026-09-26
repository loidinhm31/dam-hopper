use rand::RngCore;
use subtle::ConstantTimeEq;
use thiserror::Error;
use totp_rs::{Algorithm, Builder, Secret, Totp};
use zeroize::Zeroizing;

pub const TOTP_SECRET_BYTE_LEN: usize = 20; // 160 bits
pub const TOTP_DIGITS: u8 = 6;
pub const TOTP_STEP_SECS: u64 = 30;
pub const TOTP_SKEW_STEPS: i64 = 1;
pub const TOTP_ISSUER: &str = "DamHopper";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TotpError {
    #[error("Invalid TOTP code format: must be exactly 6 decimal digits")]
    InvalidFormat,
    #[error("Invalid or expired TOTP code")]
    InvalidCode,
    #[error("TOTP code was already used or superseded (replay detected)")]
    ReplayedCode,
    #[error("Failed to parse Base32 secret: {0}")]
    Base32Decode(String),
    #[error("Failed to initialize TOTP generator: {0}")]
    InitFailed(String),
}

/// Service managing TOTP generation, encoding, and replay-fenced verification.
#[derive(Debug, Clone, Copy, Default)]
pub struct TotpEngine;

impl TotpEngine {
    /// Generate a fresh CSPRNG-backed 20-byte (160-bit) secret.
    pub fn generate_secret() -> Zeroizing<Vec<u8>> {
        let mut bytes = vec![0u8; TOTP_SECRET_BYTE_LEN];
        rand::thread_rng().fill_bytes(&mut bytes);
        Zeroizing::new(bytes)
    }

    /// Convert raw secret bytes to RFC 4648 Base32 string (without padding, uppercase).
    pub fn secret_to_base32(secret: &[u8]) -> String {
        let s = Secret::from(secret.to_vec());
        s.to_base32().to_uppercase()
    }

    /// Decode Base32 string to raw secret bytes.
    pub fn base32_to_secret(base32_str: &str) -> Result<Zeroizing<Vec<u8>>, TotpError> {
        let cleaned = base32_str.replace([' ', '-'], "").to_uppercase();
        let s = Secret::try_from_base32(cleaned)
            .map_err(|e| TotpError::Base32Decode(format!("{e:?}")))?;
        Ok(Zeroizing::new(s.as_bytes().to_vec()))
    }

    /// Build a configured `Totp` instance from raw secret and parameters.
    pub fn build_totp(
        secret: &[u8],
        account_name: &str,
        issuer: &str,
    ) -> Result<Totp, TotpError> {
        let s = Secret::from(secret.to_vec());
        Builder::new()
            .with_algorithm(Algorithm::SHA1)
            .with_digits(TOTP_DIGITS)
            .with_step_duration(TOTP_STEP_SECS)
            .with_skew(TOTP_SKEW_STEPS as u16)
            .with_secret(s)
            .with_issuer(Some(issuer))
            .with_account_name(account_name)
            .build()
            .map_err(|e| TotpError::InitFailed(e.to_string()))
    }

    /// Generate standard `otpauth://totp/...` provisioning URI.
    pub fn generate_otpauth_uri(
        secret: &[u8],
        account_name: &str,
        issuer: &str,
    ) -> Result<String, TotpError> {
        let totp = Self::build_totp(secret, account_name, issuer)?;
        totp.to_url()
            .map_err(|e| TotpError::InitFailed(e.to_string()))
    }

    /// Verify a submitted 6-digit code against candidate steps `[t+1, t, t-1]`.
    ///
    /// - Checks inputs using constant-time string comparison.
    /// - Discovers greatest matching timestep if multiple match.
    /// - Enforces strict replay fencing: `matched_step > last_accepted_step`.
    /// - Returns the matched step on success.
    pub fn verify_code(
        secret: &[u8],
        code: &str,
        now_unix: u64,
        last_accepted_step: Option<i64>,
    ) -> Result<i64, TotpError> {
        let trimmed = code.trim();
        if trimmed.len() != (TOTP_DIGITS as usize) || !trimmed.chars().all(|c| c.is_ascii_digit()) {
            return Err(TotpError::InvalidFormat);
        }

        let totp = Self::build_totp(secret, "user", TOTP_ISSUER)?;

        let current_step = (now_unix / TOTP_STEP_SECS) as i64;
        let candidate_steps = [
            current_step + TOTP_SKEW_STEPS,
            current_step,
            current_step - TOTP_SKEW_STEPS,
        ];

        let mut matched_step: Option<i64> = None;

        for step in candidate_steps {
            if step < 0 {
                continue;
            }
            let step_time = (step as u64) * TOTP_STEP_SECS;
            let expected_token = totp.generate(step_time);
            let expected_str = expected_token.to_string();
            // Constant-time comparison between submitted code and expected candidate
            let matches: bool = expected_str.as_bytes().ct_eq(trimmed.as_bytes()).into();
            if matches {
                // Because candidate_steps is sorted descending [t+1, t, t-1],
                // the first match is guaranteed to be the greatest matching step.
                matched_step = Some(step);
                break;
            }
        }

        let Some(step) = matched_step else {
            return Err(TotpError::InvalidCode);
        };

        // Enforce replay fence: step must be strictly greater than last_accepted_step
        if let Some(last) = last_accepted_step {
            if step <= last {
                return Err(TotpError::ReplayedCode);
            }
        }

        Ok(step)
    }

    /// Generate TOTP code at a specific unix timestamp (useful for testing and issuance).
    pub fn generate_code_at(secret: &[u8], timestamp: u64) -> Result<String, TotpError> {
        let totp = Self::build_totp(secret, "user", TOTP_ISSUER)?;
        let token = totp.generate(timestamp);
        Ok(token.to_string())
    }
}
