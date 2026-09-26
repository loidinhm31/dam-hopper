use std::fs;

use chrono::Utc;

use super::error::PluginError;
use super::limits::{MAX_STAGE_CHUNK_BYTES, STAGE_EXPIRATION_SECONDS};
use super::package::inspect_and_validate_package;
use super::registry::PluginRegistry;
use super::registry_journal::{write_journal_record, TransactionPhase, TransactionRecord};
use super::stage::ActiveStageUpload;
use super::trust::StageReviewDto;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageBeginResult {
    pub stage_id: String,
    pub transaction_id: String,
    pub max_chunk_size: usize,
    pub security_revision: u64,
}

impl PluginRegistry {
    pub fn stage_begin(
        &self,
        actor: &str,
        expected_sha256: &str,
        total_bytes: u64,
    ) -> Result<StageBeginResult, PluginError> {

        let state = self.read_state()?;
        let session = ActiveStageUpload::new(
            &self.layout,
            actor,
            expected_sha256,
            total_bytes,
            state.security_revision,
        )?;

        let stage_id = session.stage_id.clone();
        let transaction_id = session.transaction_id.clone();
        let security_revision = session.security_revision;

        self.active_stages.lock().insert(stage_id.clone(), session);

        Ok(StageBeginResult {
            stage_id,
            transaction_id,
            max_chunk_size: MAX_STAGE_CHUNK_BYTES,
            security_revision,
        })
    }

    pub fn stage_chunk(
        &self,
        actor: &str,
        stage_id: &str,
        sequence: u64,
        chunk: &[u8],
    ) -> Result<u64, PluginError> {
        let mut stages = self.active_stages.lock();
        let session = stages.get_mut(stage_id).ok_or_else(|| {
            PluginError::invalid_input(format!(
                "No active stage upload session with ID '{stage_id}'"
            ))
        })?;

        if session.actor_subject != actor {
            return Err(PluginError::unauthorized(format!(
                "Actor '{actor}' cannot write to stage '{stage_id}'"
            )));
        }

        session.append_chunk(sequence, chunk)
    }

    pub fn stage_finish(&self, actor: &str, stage_id: &str) -> Result<StageReviewDto, PluginError> {
        let session = self.active_stages.lock().remove(stage_id).ok_or_else(|| {
            PluginError::invalid_input(format!("No active stage session '{stage_id}'"))
        })?;

        if session.actor_subject != actor {
            return Err(PluginError::unauthorized(format!(
                "Actor '{actor}' not authorized for stage '{stage_id}'"
            )));
        }

        let transaction_id = session.transaction_id.clone();
        let security_revision = session.security_revision;
        let package_path = session.package_file_path.clone();

        let archive_digest = session.finish(&self.layout)?;
        let (manifest, uncompressed_bytes, _) = inspect_and_validate_package(&package_path)?;

        let expires_at = Utc::now() + chrono::Duration::seconds(STAGE_EXPIRATION_SECONDS);
        let review = StageReviewDto::from_manifest(
            stage_id,
            &transaction_id,
            &manifest,
            &archive_digest,
            uncompressed_bytes,
            security_revision,
            expires_at,
        );

        let review_path = self.layout.stage_review_file(stage_id);
        if let Ok(rev_bytes) = serde_json::to_vec_pretty(&review) {
            let _ = fs::write(&review_path, &rev_bytes);
        }

        let now = Utc::now().to_rfc3339();
        let record = TransactionRecord {
            transaction_id: transaction_id.clone(),
            stage_id: stage_id.to_string(),
            phase: TransactionPhase::Inspected,
            actor_subject: actor.to_string(),
            plugin_id: Some(manifest.id.clone()),
            plugin_version: Some(manifest.version.clone()),
            expected_sha256: archive_digest.clone(),
            actual_sha256: Some(archive_digest.clone()),
            total_bytes: uncompressed_bytes,
            security_revision,
            installation_id: None,
            created_at: now.clone(),
            updated_at: now,
            error: None,
        };
        write_journal_record(&self.layout, &record)?;

        self.stage_reviews
            .lock()
            .insert(stage_id.to_string(), review.clone());
        Ok(review)
    }
}
