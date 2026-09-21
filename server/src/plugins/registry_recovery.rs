use std::fs;

use chrono::{DateTime, Utc};

use super::error::PluginError;
use super::registry_journal::{
    list_journal_records, write_journal_record, TransactionPhase,
};
use super::registry_layout::PluginRegistryLayout;

/// Performs crash recovery on runner startup by inspecting transaction records.
/// Removes incomplete staging from same-identity transactions without guessing approval or activation.
pub fn run_crash_recovery(layout: &PluginRegistryLayout) -> Result<usize, PluginError> {
    let records = list_journal_records(layout)?;
    let mut recovered_count = 0;

    for mut record in records {
        let stage_dir = layout.stage_dir(&record.stage_id);

        match record.phase {
            TransactionPhase::Receiving | TransactionPhase::Failed => {
                if stage_dir.exists() {
                    let _ = fs::remove_dir_all(&stage_dir);
                    recovered_count += 1;
                }
            }
            TransactionPhase::Inspected => {
                let stage_review_file = layout.stage_review_file(&record.stage_id);
                let should_clean = if stage_review_file.exists() {
                    if let Ok(content) = fs::read_to_string(&stage_review_file) {
                        if let Ok(review) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(exp_str) = review.get("stageExpiresAt").and_then(|v| v.as_str()) {
                                DateTime::parse_from_rfc3339(exp_str)
                                    .map(|exp| Utc::now() > exp.with_timezone(&Utc))
                                    .unwrap_or(true)
                            } else {
                                true
                            }
                        } else {
                            true
                        }
                    } else {
                        true
                    }
                } else {
                    true
                };

                if should_clean && stage_dir.exists() {
                    let _ = fs::remove_dir_all(&stage_dir);
                    recovered_count += 1;
                }
            }
            TransactionPhase::Approved | TransactionPhase::Extracted => {
                // Interrupted before atomic registry commit.
                // Recovery never guesses approval or activation! Mark failed and clean up.
                if stage_dir.exists() {
                    let _ = fs::remove_dir_all(&stage_dir);
                }
                record.phase = TransactionPhase::Failed;
                record.error = Some("Transaction interrupted before registry registration".to_string());
                record.updated_at = Utc::now().to_rfc3339();
                write_journal_record(layout, &record)?;
                recovered_count += 1;
            }
            TransactionPhase::Registered | TransactionPhase::Activated => {
                // Already durably registered in registry-v1.json.
                // Clean up leftover staging bytes if any remain.
                if stage_dir.exists() {
                    let _ = fs::remove_dir_all(&stage_dir);
                    recovered_count += 1;
                }
            }
        }
    }

    Ok(recovered_count)
}
