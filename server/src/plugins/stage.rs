use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::error::PluginError;
use super::limits::{MAX_PACKAGE_COMPRESSED_BYTES, MAX_STAGE_CHUNK_BYTES, STAGE_IDLE_TIMEOUT};
use super::registry_journal::{write_journal_record, TransactionPhase, TransactionRecord};
use super::registry_layout::PluginRegistryLayout;

/// An active in-progress staged upload session.
pub struct ActiveStageUpload {
    pub stage_id: String,
    pub transaction_id: String,
    pub actor_subject: String,
    pub expected_sha256: String,
    pub total_bytes: u64,
    pub received_bytes: u64,
    pub expected_sequence: u64,
    pub security_revision: u64,
    pub package_file_path: PathBuf,
    pub file: File,
    pub hasher: Sha256,
    pub last_activity: Instant,
}

impl ActiveStageUpload {
    pub fn new(
        layout: &PluginRegistryLayout,
        actor_subject: &str,
        expected_sha256: &str,
        total_bytes: u64,
        security_revision: u64,
    ) -> Result<Self, PluginError> {
        let expected_sha256_lower = expected_sha256.to_lowercase();
        if expected_sha256_lower.len() != 64 || !expected_sha256_lower.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(PluginError::invalid_input(format!("expected_sha256 must be 64-char hex, got: '{expected_sha256}'")));
        }
        if total_bytes == 0 || total_bytes > MAX_PACKAGE_COMPRESSED_BYTES {
            return Err(PluginError::invalid_input(format!("total_bytes ({total_bytes}) invalid or exceeds limit ({MAX_PACKAGE_COMPRESSED_BYTES})")));
        }

        let stage_id = Uuid::new_v4().to_string();
        let transaction_id = Uuid::new_v4().to_string();
        let stage_dir = layout.stage_dir(&stage_id);

        fs::create_dir_all(&stage_dir).map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to create staging dir '{}': {e}", stage_dir.display()))
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&stage_dir, fs::Permissions::from_mode(0o700));
        }

        let package_file_path = layout.stage_package_file(&stage_id);
        let mut open_opts = OpenOptions::new();
        open_opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_opts.mode(0o600);
        }

        let file = open_opts.open(&package_file_path).map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to create staging file '{}': {e}", package_file_path.display()))
        })?;

        let now = Utc::now().to_rfc3339();
        let record = TransactionRecord {
            transaction_id: transaction_id.clone(),
            stage_id: stage_id.clone(),
            phase: TransactionPhase::Receiving,
            actor_subject: actor_subject.to_string(),
            plugin_id: None,
            plugin_version: None,
            expected_sha256: expected_sha256_lower.clone(),
            actual_sha256: None,
            total_bytes,
            security_revision,
            installation_id: None,
            created_at: now.clone(),
            updated_at: now,
            error: None,
        };
        write_journal_record(layout, &record)?;

        Ok(Self {
            stage_id,
            transaction_id,
            actor_subject: actor_subject.to_string(),
            expected_sha256: expected_sha256_lower,
            total_bytes,
            received_bytes: 0,
            expected_sequence: 0,
            security_revision,
            package_file_path,
            file,
            hasher: Sha256::new(),
            last_activity: Instant::now(),
        })
    }

    pub fn append_chunk(&mut self, sequence: u64, chunk: &[u8]) -> Result<u64, PluginError> {
        if self.last_activity.elapsed() > STAGE_IDLE_TIMEOUT {
            return Err(PluginError::deadline_exceeded(format!("Stage '{}' timed out", self.stage_id)));
        }
        if sequence != self.expected_sequence {
            return Err(PluginError::invalid_input(format!("Invalid sequence: expected {}, got {sequence}", self.expected_sequence)));
        }
        if chunk.len() > MAX_STAGE_CHUNK_BYTES {
            return Err(PluginError::invalid_input(format!("Chunk size ({}) exceeds limit ({MAX_STAGE_CHUNK_BYTES})", chunk.len())));
        }
        if self.received_bytes + chunk.len() as u64 > self.total_bytes {
            return Err(PluginError::invalid_input(format!("Received bytes overflow total ({})", self.total_bytes)));
        }

        self.file.write_all(chunk).map_err(|e| PluginError::runner_unavailable(format!("Failed to write chunk: {e}")))?;
        self.hasher.update(chunk);
        self.received_bytes += chunk.len() as u64;
        self.expected_sequence += 1;
        self.last_activity = Instant::now();
        Ok(self.received_bytes)
    }

    pub fn finish(mut self, layout: &PluginRegistryLayout) -> Result<String, PluginError> {
        if self.received_bytes != self.total_bytes {
            return Err(PluginError::invalid_input(format!("Incomplete upload: expected {}, received {}", self.total_bytes, self.received_bytes)));
        }
        self.file.flush().map_err(|e| PluginError::runner_unavailable(format!("Flush failed: {e}")))?;
        self.file.sync_all().map_err(|e| PluginError::runner_unavailable(format!("Sync failed: {e}")))?;

        let actual_digest = hex::encode(self.hasher.finalize());
        if actual_digest != self.expected_sha256 {
            let _ = fs::remove_dir_all(layout.stage_dir(&self.stage_id));
            let now = Utc::now().to_rfc3339();
            let record = TransactionRecord {
                transaction_id: self.transaction_id.clone(),
                stage_id: self.stage_id.clone(),
                phase: TransactionPhase::Failed,
                actor_subject: self.actor_subject.clone(),
                plugin_id: None,
                plugin_version: None,
                expected_sha256: self.expected_sha256.clone(),
                actual_sha256: Some(actual_digest.clone()),
                total_bytes: self.total_bytes,
                security_revision: self.security_revision,
                installation_id: None,
                created_at: now.clone(),
                updated_at: now,
                error: Some(format!("Digest mismatch: expected {}, got {actual_digest}", self.expected_sha256)),
            };
            let _ = write_journal_record(layout, &record);
            return Err(PluginError::invalid_input(format!("Digest mismatch: expected {}, got {actual_digest}", self.expected_sha256)));
        }
        Ok(actual_digest)
    }
}
