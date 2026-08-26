use std::{fmt, time::Duration};

use axum::http::{header::COOKIE, HeaderMap, HeaderValue};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub(crate) const MEDIA_SESSION_COOKIE: &str = "damhopper-media-session";
pub(crate) const MEDIA_SESSION_PATH: &str = "/api/fs";
pub(crate) const MEDIA_SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
pub(crate) const MEDIA_SESSION_ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 60 * 60);

/// Opaque, cookie-only media session token. It deliberately has no Debug implementation.
#[derive(Clone)]
pub(crate) struct MediaSessionToken(String);

impl MediaSessionToken {
    pub(crate) fn new() -> Self {
        let mut bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut bytes);
        Self(URL_SAFE_NO_PAD.encode(bytes))
    }

    pub(crate) fn from_cookie_value(value: &str) -> Option<Self> {
        let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
        (bytes.len() == 32).then(|| Self(value.to_owned()))
    }

    pub(crate) fn digest(&self) -> MediaSessionDigest {
        MediaSessionDigest(Sha256::digest(self.0.as_bytes()).into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub(crate) struct MediaSessionDigest([u8; 32]);

impl MediaSessionDigest {
    pub(crate) fn matches(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl fmt::Debug for MediaSessionDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MediaSessionDigest([redacted])")
    }
}

/// Server-side ticket binding. Its digest is intentionally redacted in Debug output.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct MediaSessionBinding {
    pub(crate) actor_subject: String,
    pub(crate) session_digest: MediaSessionDigest,
}

impl fmt::Debug for MediaSessionBinding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MediaSessionBinding")
            .field("actor_subject", &self.actor_subject)
            .field("session_digest", &self.session_digest)
            .finish()
    }
}

/// Cookie-bearing lease. Do not log or serialize it.
#[derive(Clone)]
pub(crate) struct MediaSessionLease {
    pub(crate) token: MediaSessionToken,
    pub(crate) binding: MediaSessionBinding,
}

pub(crate) fn media_session_cookie(lease: &MediaSessionLease) -> HeaderValue {
    cookie_header(lease.token.as_str(), MEDIA_SESSION_ABSOLUTE_TTL.as_secs())
}

pub(crate) fn clear_media_session_cookie() -> HeaderValue {
    cookie_header("", 0)
}

pub(crate) fn media_session_from_headers(headers: &HeaderMap) -> Option<MediaSessionToken> {
    let raw_cookie = headers.get(COOKIE)?.to_str().ok()?;
    let mut values = raw_cookie.split(';').filter_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == MEDIA_SESSION_COOKIE).then_some(value)
    });
    let value = values.next()?;
    values.next().is_none().then_some(())?;
    MediaSessionToken::from_cookie_value(value)
}

fn cookie_header(value: &str, max_age: u64) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{MEDIA_SESSION_COOKIE}={value}; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age={max_age}"
    ))
    .expect("generated media session cookie must be valid")
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::*;

    #[test]
    fn token_is_random_digest_only_and_cookie_attributes_are_exact() {
        let first = MediaSessionToken::new();
        let second = MediaSessionToken::new();
        assert_ne!(first.as_str(), second.as_str());
        assert_eq!(first.as_str().len(), 43);
        assert_ne!(first.digest(), second.digest());

        let lease = MediaSessionLease {
            binding: MediaSessionBinding {
                actor_subject: "actor".into(),
                session_digest: first.digest(),
            },
            token: first,
        };
        assert!(!format!("{:?}", lease.binding).contains(lease.token.as_str()));
        assert_eq!(
            media_session_cookie(&lease),
            format!(
                "{MEDIA_SESSION_COOKIE}={}; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age=28800",
                lease.token.as_str()
            )
        );
        assert_eq!(
            clear_media_session_cookie(),
            format!(
                "{MEDIA_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age=0"
            )
        );
    }

    #[test]
    fn cookie_parser_rejects_invalid_or_ambiguous_values() {
        let token = MediaSessionToken::new();
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            format!("{MEDIA_SESSION_COOKIE}={}", token.as_str())
                .parse()
                .unwrap(),
        );
        assert_eq!(
            media_session_from_headers(&headers).unwrap().digest(),
            token.digest()
        );

        headers.insert(COOKIE, "damhopper-media-session=short".parse().unwrap());
        assert!(media_session_from_headers(&headers).is_none());
        headers.insert(
            COOKIE,
            format!(
                "{MEDIA_SESSION_COOKIE}={}; {MEDIA_SESSION_COOKIE}={}",
                token.as_str(),
                token.as_str()
            )
            .parse()
            .unwrap(),
        );
        assert!(media_session_from_headers(&headers).is_none());
    }
}
