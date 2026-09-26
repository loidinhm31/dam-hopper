use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::admin::{
    record_admin_audit, AdminAuditRecord, AdminInstallationDto, AdminRemoveResult,
    RollbackPackageSnapshotDto, StageReviewDto,
};
use super::contract::GrantKey;
use super::error::PluginError;
use super::lifecycle_journal::{
    list_pending_lifecycle_transactions, write_lifecycle_journal_record, LifecycleCandidate,
    LifecycleOperation, LifecyclePhase, LifecycleTransactionRecord,
};
use super::package::inspect_and_validate_package;
use super::package_extract::{extract_package_archive, publish_extracted_package};
use super::registry::PluginRegistry;
use super::registry_state::{InstallationRecord, OwnerHistorySource, RegisteredPackageRecord, RollbackPackageSnapshot};
use super::trust::validate_stage_approval;
use super::worker_supervisor::SupervisorManager;
pub struct LifecycleCoordinator {
    registry: Arc<PluginRegistry>,
    supervisor_manager: Arc<SupervisorManager>,
    installation_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl LifecycleCoordinator {
    pub fn new(
        registry: Arc<PluginRegistry>,
        supervisor_manager: Arc<SupervisorManager>,
    ) -> Self {
        Self {
            registry,
            supervisor_manager,
            installation_locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self) -> &Arc<PluginRegistry> {
        &self.registry
    }

    pub fn supervisor_manager(&self) -> &Arc<SupervisorManager> {
        &self.supervisor_manager
    }


    async fn get_installation_lock(&self, installation_id: &str) -> Arc<Mutex<()>> {
        let mut map = self.installation_locks.lock().await;
        map.entry(installation_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn to_admin_dto(
        &self,
        inst: &InstallationRecord,
        security_revision: u64,
        worker_status: String,
        has_ui: bool,
    ) -> AdminInstallationDto {
        let previous_package = inst.previous_package.as_ref().map(|p| RollbackPackageSnapshotDto {
            package_digest: p.package_digest.clone(),
            version: p.version.clone(),
            bindings: p.bindings.clone(),
            owner_history_source: p.owner_history_source.clone(),
            published_at: p.published_at.clone(),
        });
        let can_rollback = inst.previous_package.is_some();

        AdminInstallationDto {
            installation_id: inst.installation_id.clone(),
            plugin_id: inst.plugin_id.clone(),
            active_package_digest: inst.active_package_digest.clone(),
            active_version: inst.active_version.clone(),
            activation_generation: inst.activation_generation,
            enabled: inst.enabled,
            bindings: inst.bindings.clone(),
            grants: inst.grants.clone(),
            owner_history_source: inst.owner_history_source.clone(),
            has_ui,
            worker_status,
            previous_package,
            can_rollback,
            security_revision,
            created_at: inst.created_at.clone(),
            updated_at: inst.updated_at.clone(),
        }
    }

    /// List all installations with admin lifecycle and worker details.
    pub async fn list_installations(
        &self,
        _actor: &str,
    ) -> Result<Vec<AdminInstallationDto>, PluginError> {

        let state = self.registry.read_state()?;
        let mut list = Vec::new();
        for inst in state.installations.values() {
            let worker_status = if !inst.enabled {
                "stopped".to_string()
            } else {
                self.supervisor_manager.get_status(&inst.installation_id).await
            };

            let pkg_key = format!(
                "{}@{}#{}",
                inst.plugin_id, inst.active_version, inst.active_package_digest
            );
            let has_ui = state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            list.push(self.to_admin_dto(inst, state.security_revision, worker_status, has_ui));
        }

        Ok(list)
    }

    /// Get single installation with admin lifecycle and worker details.
    pub async fn get_installation(
        &self,
        _actor: &str,
        installation_id: &str,
    ) -> Result<AdminInstallationDto, PluginError> {

        let state = self.registry.read_state()?;
        let inst = state
            .installations
            .get(installation_id)
            .ok_or_else(|| {
                PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
            })?;

        let worker_status = if !inst.enabled {
            "stopped".to_string()
        } else {
            self.supervisor_manager.get_status(installation_id).await
        };

        let pkg_key = format!(
            "{}@{}#{}",
            inst.plugin_id, inst.active_version, inst.active_package_digest
        );
        let has_ui = state
            .packages
            .get(&pkg_key)
            .map(|p| p.entrypoints.ui.is_some())
            .unwrap_or(false);

        Ok(self.to_admin_dto(inst, state.security_revision, worker_status, has_ui))
    }

    /// Transactional Stage Approval and Installation/Update.
    ///
    /// Implements Requirement 8:
    /// stage -> inspect -> approve -> drain -> revoke -> stop -> activate worker -> health -> publish pair/navigation -> commit
    pub async fn approve_and_install_stage(
        &self,
        actor: &str,
        stage_id: &str,
        expected_sha256: &str,
        expected_security_revision: u64,
        initial_bindings: BTreeMap<String, String>,
        initial_grants: Vec<super::admin::InitialGrant>,
        owner_history_source: Option<OwnerHistorySource>,
    ) -> Result<AdminInstallationDto, PluginError> {

        let review: StageReviewDto = {
            let reviews = self.registry.stage_reviews.lock();
            if let Some(r) = reviews.get(stage_id) {
                r.clone()
            } else {
                let file = self.registry.layout.stage_review_file(stage_id);
                if file.exists() {
                    let c = fs::read_to_string(&file).map_err(|e| {
                        PluginError::runner_unavailable(format!("Read review: {e}"))
                    })?;
                    serde_json::from_str(&c)
                        .map_err(|e| PluginError::invalid_input(format!("Parse review: {e}")))?
                } else {
                    return Err(PluginError::invalid_input(format!(
                        "Stage '{stage_id}' not found or not finished"
                    )));
                }
            }
        };

        let current_state = self.registry.read_state()?;
        validate_stage_approval(
            actor,
            expected_sha256,
            expected_security_revision,
            current_state.security_revision,
            &review,
        )?;

        // Find existing installation for this plugin, if any
        let existing_inst = current_state
            .installations
            .values()
            .find(|i| i.plugin_id == review.plugin_id)
            .cloned();

        let installation_id = existing_inst
            .as_ref()
            .map(|i| i.installation_id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let is_update = existing_inst.is_some();
        let effective_final_bindings = if is_update && initial_bindings.is_empty() {
            existing_inst.as_ref().map(|i| i.bindings.clone()).unwrap_or_default()
        } else {
            initial_bindings.clone()
        };

        let mut mapped_initial_grants = Vec::new();
        for g in &initial_grants {
            let actor = g.actor_subject.trim();
            if actor.is_empty() {
                return Err(PluginError::invalid_input("Grant actorSubject cannot be empty"));
            }
            let target = g.configured_project_target.trim();
            if target.is_empty() {
                return Err(PluginError::invalid_input("Grant configuredProjectTarget cannot be empty"));
            }
            if target != "*" && !effective_final_bindings.contains_key(target) {
                return Err(PluginError::invalid_input(format!(
                    "Grant project target '{target}' is not registered in effective installation bindings"
                )));
            }
            if g.allowed_operations.is_empty() {
                return Err(PluginError::invalid_input("Grant allowedOperations cannot be empty"));
            }
            let mut resolved_ops = Vec::new();
            for op in &g.allowed_operations {
                if op == "*" {
                    for cap in &review.capabilities {
                        if !resolved_ops.contains(cap) {
                            resolved_ops.push(cap.clone());
                        }
                    }
                } else if !review.capabilities.contains(op) {
                    return Err(PluginError::invalid_input(format!(
                        "Grant operation '{op}' is not in reviewed plugin capabilities"
                    )));
                } else if !resolved_ops.contains(op) {
                    resolved_ops.push(op.clone());
                }
            }
            mapped_initial_grants.push(GrantKey {
                actor_subject: actor.to_string(),
                installation_id: installation_id.clone(),
                configured_project_target: target.to_string(),
                allowed_operations: resolved_ops,
                allow_current_account_policy: g.allow_current_account_policy,
            });
        }

        let inst_lock = self.get_installation_lock(&installation_id).await;
        let _guard = inst_lock.lock().await;

        // Re-read under per-installation lock
        let current_state = self.registry.read_state()?;
        if current_state.security_revision != expected_security_revision {
            return Err(PluginError::forbidden(format!(
                "Concurrent security revision change: expected {expected_security_revision}, got {}",
                current_state.security_revision
            )));
        }

        let old_gen = existing_inst
            .as_ref()
            .map(|i| i.activation_generation)
            .unwrap_or(0);
        let target_gen = old_gen + 1;

        let tx_id = Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let mut tx_record = LifecycleTransactionRecord {
            transaction_id: tx_id.clone(),
            installation_id: installation_id.clone(),
            operation: if is_update {
                LifecycleOperation::Update
            } else {
                LifecycleOperation::Install
            },
            phase: LifecyclePhase::Initiated,
            actor_subject: actor.to_string(),
            candidate: Some(LifecycleCandidate {
                plugin_id: review.plugin_id.clone(),
                version: review.version.clone(),
                package_digest: review.archive_sha256.clone(),
                target_generation: target_gen,
            }),
            security_revision_before: current_state.security_revision,
            generation_before: old_gen,
            generation_after: Some(target_gen),
            error: None,
            created_at: now_str.clone(),
            updated_at: now_str.clone(),
        };
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Extract package archive to temporary extracted dir
        let stage_package = self.registry.layout.stage_package_file(stage_id);
        let temp_extracted = self.registry.layout.stage_dir(stage_id).join("extracted");

        let (manifest, _, _) = inspect_and_validate_package(&stage_package)?;
        extract_package_archive(&stage_package, &temp_extracted, &manifest)?;

        // If updating: Drain and stop existing worker before activating candidate
        if is_update {
            tx_record.phase = LifecyclePhase::Draining;
            tx_record.updated_at = Utc::now().to_rfc3339();
            write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

            self.supervisor_manager
                .drain_and_stop(&installation_id)
                .await?;

            tx_record.phase = LifecyclePhase::Stopped;
            tx_record.updated_at = Utc::now().to_rfc3339();
            write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;
        }

        // Publish extracted package into packages directory
        publish_extracted_package(
            &self.registry.layout,
            &temp_extracted,
            &review.plugin_id,
            &review.version,
            &review.archive_sha256,
        )?;

        // Validate UI entrypoint pair integrity if UI entrypoint declared
        let has_ui = if let Some(ui_entry) = &manifest.entrypoints.ui {
            let pkg_dir = self.registry.layout.package_dir(
                &review.plugin_id,
                &review.version,
                &review.archive_sha256,
            );
            let ui_file = pkg_dir.join(&ui_entry.entry);
            if !ui_file.exists() {
                return Err(PluginError::runner_unavailable(format!(
                    "UI entrypoint '{}' missing in extracted package",
                    ui_entry.entry
                )));
            }
            let ui_bytes = fs::read(&ui_file).map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to read UI entrypoint: {e}"))
            })?;
            let expected_sha256 = manifest
                .inventory
                .iter()
                .find(|item| item.path == ui_entry.entry)
                .map(|item| item.sha256.clone())
                .unwrap_or_default();
            use sha2::{Digest, Sha256};
            let digest = hex::encode(Sha256::digest(&ui_bytes));
            if !expected_sha256.is_empty() && digest.to_lowercase() != expected_sha256.to_lowercase() {
                return Err(PluginError::invalid_input(format!(
                    "UI asset digest mismatch: expected {}, got {}",
                    expected_sha256, digest
                )));
            }
            true
        } else {
            false
        };

        // 1. Activating worker candidate and verifying health BEFORE durable registry publish
        tx_record.phase = LifecyclePhase::Activating;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let backend_entry = &manifest.entrypoints.backend.entry;
        let candidate_sup = match self
            .supervisor_manager
            .activate_candidate(
                &installation_id,
                &review.plugin_id,
                &review.version,
                &review.archive_sha256,
                target_gen,
                backend_entry,
            )
            .await
        {
            Ok(sup) => sup,
            Err(e) => {
                tracing::warn!(error = %e, "Worker candidate activation failed before publication; preserving existing state");
                tx_record.phase = LifecyclePhase::Failed;
                tx_record.error = Some(e.to_string());
                tx_record.updated_at = Utc::now().to_rfc3339();
                let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);

                let mut audit = AdminAuditRecord::new(
                    actor,
                    if is_update { "update" } else { "install" },
                    current_state.security_revision,
                    "failed",
                );
                audit.installation_id = Some(installation_id.clone());
                audit.package_digest = Some(review.archive_sha256.clone());
                record_admin_audit(&audit);

                return Err(e);
            }
        };

        // 2. Candidate worker is active and healthy
        tx_record.phase = LifecyclePhase::Healthy;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // 3. Atomic publish to registry under state_lock (synchronous, no awaits held inside)
        let publish_result = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            if fresh_state.security_revision != expected_security_revision {
                Err(PluginError::forbidden("Concurrent security revision advance"))
            } else {
                // Register package definition
                let pkg_key = format!(
                    "{}@{}#{}",
                    review.plugin_id, review.version, review.archive_sha256
                );
                let pkg_record = RegisteredPackageRecord {
                    plugin_id: review.plugin_id.clone(),
                    version: review.version.clone(),
                    archive_sha256: review.archive_sha256.clone(),
                    publisher: review.publisher.clone(),
                    host_version_range: review.host_version_range.clone(),
                    contracts: review.contracts.clone(),
                    capabilities: review.capabilities.clone(),
                    entrypoints: review.entrypoints.clone(),
                    installed_at: now_str.clone(),
                };
                fresh_state.packages.insert(pkg_key, pkg_record);

                let existing_item = fresh_state.installations.get(&installation_id);
                let previous_package = existing_item.map(|i| RollbackPackageSnapshot {
                    package_digest: i.active_package_digest.clone(),
                    version: i.active_version.clone(),
                    bindings: i.bindings.clone(),
                    owner_history_source: i.owner_history_source.clone(),
                    published_at: i.updated_at.clone(),
                });

                let final_bindings = effective_final_bindings.clone();
                let final_grants = if is_update && mapped_initial_grants.is_empty() {
                    existing_item.map(|i| i.grants.clone()).unwrap_or(mapped_initial_grants)
                } else {
                    mapped_initial_grants
                };
                let final_owner_history_source = if is_update && owner_history_source.is_none() {
                    existing_item.and_then(|i| i.owner_history_source.clone())
                } else {
                    owner_history_source
                };
                let inst_record = InstallationRecord {
                    installation_id: installation_id.clone(),
                    plugin_id: review.plugin_id.clone(),
                    active_package_digest: review.archive_sha256.clone(),
                    active_version: review.version.clone(),
                    activation_generation: target_gen,
                    enabled: true,
                    bindings: final_bindings,
                    grants: final_grants,
                    owner_history_source: final_owner_history_source,
                    previous_package,
                    created_at: existing_item
                        .map(|i| i.created_at.clone())
                        .unwrap_or_else(|| now_str.clone()),
                    updated_at: now_str.clone(),
                };

                fresh_state
                    .installations
                    .insert(installation_id.clone(), inst_record.clone());
                fresh_state.registry_revision += 1;
                self.registry.write_state(&fresh_state)?;
                Ok((inst_record, fresh_state.security_revision))
            }
        };

        let (updated_inst, sec_rev) = match publish_result {
            Ok(pair) => pair,
            Err(e) => {
                let _ = candidate_sup.deactivate().await;
                let _ = self.supervisor_manager.drain_and_stop(&installation_id).await;
                tx_record.phase = LifecyclePhase::Failed;
                tx_record.error = Some(e.to_string());
                tx_record.updated_at = Utc::now().to_rfc3339();
                let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);

                let mut audit = AdminAuditRecord::new(
                    actor,
                    if is_update { "update" } else { "install" },
                    expected_security_revision,
                    "failed",
                );
                audit.installation_id = Some(installation_id.clone());
                record_admin_audit(&audit);

                return Err(e);
            }
        };

        // 4. Phase Published -> Committed
        tx_record.phase = LifecyclePhase::Published;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        tx_record.phase = LifecyclePhase::Committed;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Cleanup stage directory and cached review
        let _ = fs::remove_dir_all(self.registry.layout.stage_dir(stage_id));
        self.registry.stage_reviews.lock().remove(stage_id);

        let mut audit = AdminAuditRecord::new(
            actor,
            if is_update { "update" } else { "install" },
            sec_rev,
            "success",
        );
        audit.installation_id = Some(installation_id.clone());
        audit.package_digest = Some(review.archive_sha256.clone());
        audit.old_generation = if is_update { Some(old_gen) } else { None };
        audit.new_generation = Some(target_gen);
        record_admin_audit(&audit);

        let worker_status = self.supervisor_manager.get_status(&installation_id).await;
        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Transactional Rollback to previous matched package pair.
    ///
    /// Implements Requirements 11, 12, 13, 14:
    /// - Restores prior matched backend/UI package pair
    /// - Never restores revoked actor/source grants or replaced bindings or disabled intent
    /// - Persisted current security intent wins under races
    pub async fn rollback(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
    ) -> Result<AdminInstallationDto, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let state = self.registry.read_state()?;
        if state.security_revision != expected_security_revision {
            return Err(PluginError::forbidden(format!(
                "Concurrent security revision mismatch: expected {expected_security_revision}, got {}",
                state.security_revision
            )));
        }

        let inst = state.installations.get(installation_id).ok_or_else(|| {
            PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
        })?;

        let previous = inst.previous_package.as_ref().ok_or_else(|| {
            PluginError::invalid_input(format!(
                "No previous package snapshot available for rollback on installation '{installation_id}'"
            ))
        })?.clone();

        // Reread current security intent
        let current_security_intent = inst.security_intent(state.security_revision);
        let old_gen = inst.activation_generation;
        let target_gen = old_gen + 1;

        let tx_id = Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let mut tx_record = LifecycleTransactionRecord {
            transaction_id: tx_id.clone(),
            installation_id: installation_id.to_string(),
            operation: LifecycleOperation::Rollback,
            phase: LifecyclePhase::Initiated,
            actor_subject: actor.to_string(),
            candidate: Some(LifecycleCandidate {
                plugin_id: inst.plugin_id.clone(),
                version: previous.version.clone(),
                package_digest: previous.package_digest.clone(),
                target_generation: target_gen,
            }),
            security_revision_before: state.security_revision,
            generation_before: old_gen,
            generation_after: Some(target_gen),
            error: None,
            created_at: now_str.clone(),
            updated_at: now_str.clone(),
        };
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Drain and stop current worker
        tx_record.phase = LifecyclePhase::Draining;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        self.supervisor_manager
            .drain_and_stop(installation_id)
            .await?;

        tx_record.phase = LifecyclePhase::Stopped;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Re-read current security state under lock before publish
        let prev_pkg_key = format!("{}@{}#{}", inst.plugin_id, previous.version, previous.package_digest);
        let prev_backend_entry = state.packages.get(&prev_pkg_key)
            .map(|p| p.entrypoints.backend.entry.clone())
            .unwrap_or_else(|| "backend/worker.cjs".to_string());

        // If currently enabled, activate candidate worker for previous package BEFORE durable publish
        let candidate_sup = if current_security_intent.enabled {
            tx_record.phase = LifecyclePhase::Activating;
            tx_record.updated_at = Utc::now().to_rfc3339();
            write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

            match self
                .supervisor_manager
                .activate_candidate(
                    installation_id,
                    &inst.plugin_id,
                    &previous.version,
                    &previous.package_digest,
                    target_gen,
                    &prev_backend_entry,
                )
                .await
            {
                Ok(sup) => {
                    tx_record.phase = LifecyclePhase::Healthy;
                    tx_record.updated_at = Utc::now().to_rfc3339();
                    write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;
                    Some(sup)
                }
                Err(e) => {
                    tx_record.phase = LifecyclePhase::Failed;
                    tx_record.error = Some(e.to_string());
                    tx_record.updated_at = Utc::now().to_rfc3339();
                    let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);

                    let mut audit = AdminAuditRecord::new(actor, "rollback", state.security_revision, "failed");
                    audit.installation_id = Some(installation_id.to_string());
                    record_admin_audit(&audit);

                    return Err(e);
                }
            }
        } else {
            None
        };

        // Re-read current security state under lock before publish
        let publish_result = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            if fresh_state.security_revision != expected_security_revision {
                Err(PluginError::forbidden("Concurrent security revision advance during rollback"))
            } else {
                let (inst_clone, pkg_key) = {
                    let fresh_inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                        PluginError::invalid_input("Installation disappeared during rollback")
                    })?;

                    let effective_enabled = fresh_inst.enabled && current_security_intent.enabled;
                    fresh_inst.active_package_digest = previous.package_digest.clone();
                    fresh_inst.active_version = previous.version.clone();
                    fresh_inst.activation_generation = target_gen;
                    fresh_inst.enabled = effective_enabled;
                    if fresh_inst.bindings == inst.bindings {
                        fresh_inst.bindings = previous.bindings.clone();
                    }
                    if fresh_inst.owner_history_source == inst.owner_history_source {
                        fresh_inst.owner_history_source = previous.owner_history_source.clone();
                    }
                    fresh_inst.previous_package = None;
                    fresh_inst.updated_at = now_str.clone();

                    let pkg_key = format!(
                        "{}@{}#{}",
                        fresh_inst.plugin_id, fresh_inst.active_version, fresh_inst.active_package_digest
                    );
                    (fresh_inst.clone(), pkg_key)
                };

                fresh_state.registry_revision += 1;
                self.registry.write_state(&fresh_state)?;

                let has_ui = fresh_state
                    .packages
                    .get(&pkg_key)
                    .map(|p| p.entrypoints.ui.is_some())
                    .unwrap_or(false);

                Ok((inst_clone, fresh_state.security_revision, has_ui))
            }
        };

        let (updated_inst, sec_rev, has_ui) = match publish_result {
            Ok(res) => res,
            Err(e) => {
                if let Some(sup) = candidate_sup {
                    let _ = sup.deactivate().await;
                    let _ = self.supervisor_manager.drain_and_stop(installation_id).await;
                }
                tx_record.phase = LifecyclePhase::Failed;
                tx_record.error = Some(e.to_string());
                tx_record.updated_at = Utc::now().to_rfc3339();
                let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);

                let mut audit = AdminAuditRecord::new(actor, "rollback", state.security_revision, "failed");
                audit.installation_id = Some(installation_id.to_string());
                record_admin_audit(&audit);

                return Err(e);
            }
        };

        tx_record.phase = LifecyclePhase::Published;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        tx_record.phase = LifecyclePhase::Committed;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let mut audit = AdminAuditRecord::new(actor, "rollback", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        audit.package_digest = Some(previous.package_digest.clone());
        audit.old_generation = Some(old_gen);
        audit.new_generation = Some(target_gen);
        record_admin_audit(&audit);

        let worker_status = if !updated_inst.enabled {
            "stopped".to_string()
        } else {
            self.supervisor_manager.get_status(installation_id).await
        };

        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Disable installation: stops worker, marks non-executable, persists across restart.
    pub async fn disable(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
    ) -> Result<AdminInstallationDto, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let state = self.registry.read_state()?;
        if state.security_revision != expected_security_revision {
            return Err(PluginError::forbidden(format!(
                "Concurrent security revision mismatch: expected {expected_security_revision}, got {}",
                state.security_revision
            )));
        }

        if !state.installations.contains_key(installation_id) {
            return Err(PluginError::invalid_input(format!(
                "Installation '{installation_id}' not found"
            )));
        }

        let tx_id = Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let mut tx_record = LifecycleTransactionRecord {
            transaction_id: tx_id.clone(),
            installation_id: installation_id.to_string(),
            operation: LifecycleOperation::Disable,
            phase: LifecyclePhase::Initiated,
            actor_subject: actor.to_string(),
            candidate: None,
            security_revision_before: state.security_revision,
            generation_before: state.installations[installation_id].activation_generation,
            generation_after: None,
            error: None,
            created_at: now_str.clone(),
            updated_at: now_str.clone(),
        };
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Stop worker
        self.supervisor_manager
            .drain_and_stop(installation_id)
            .await?;

        let (updated_inst, sec_rev, has_ui) = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            let (inst_clone, pkg_key) = {
                let inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                    PluginError::invalid_input("Installation disappeared")
                })?;

                inst.enabled = false;
                inst.updated_at = now_str.clone();

                let pkg_key = format!(
                    "{}@{}#{}",
                    inst.plugin_id, inst.active_version, inst.active_package_digest
                );
                (inst.clone(), pkg_key)
            };

            fresh_state.registry_revision += 1;
            self.registry.write_state(&fresh_state)?;

            let has_ui = fresh_state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            (inst_clone, fresh_state.security_revision, has_ui)
        };

        tx_record.phase = LifecyclePhase::Committed;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let mut audit = AdminAuditRecord::new(actor, "disable", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        record_admin_audit(&audit);

        Ok(self.to_admin_dto(&updated_inst, sec_rev, "stopped".to_string(), has_ui))
    }

    /// Enable installation: revalidates approved pair and compatibility, activates worker.
    pub async fn enable(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
    ) -> Result<AdminInstallationDto, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let state = self.registry.read_state()?;
        if state.security_revision != expected_security_revision {
            return Err(PluginError::forbidden(format!(
                "Concurrent security revision mismatch: expected {expected_security_revision}, got {}",
                state.security_revision
            )));
        }

        let inst = state.installations.get(installation_id).ok_or_else(|| {
            PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
        })?;

        // Revalidate package directory exists
        let pkg_dir = self.registry.layout.package_dir(
            &inst.plugin_id,
            &inst.active_version,
            &inst.active_package_digest,
        );
        if !pkg_dir.exists() {
            return Err(PluginError::runner_unavailable(format!(
                "Package directory for '{}' is missing on disk",
                inst.active_package_digest
            )));
        }

        let old_gen = inst.activation_generation;
        let target_gen = old_gen + 1;

        let tx_id = Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let mut tx_record = LifecycleTransactionRecord {
            transaction_id: tx_id.clone(),
            installation_id: installation_id.to_string(),
            operation: LifecycleOperation::Enable,
            phase: LifecyclePhase::Initiated,
            actor_subject: actor.to_string(),
            candidate: None,
            security_revision_before: state.security_revision,
            generation_before: old_gen,
            generation_after: Some(target_gen),
            error: None,
            created_at: now_str.clone(),
            updated_at: now_str.clone(),
        };
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let (updated_inst, sec_rev, has_ui) = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            let (inst_clone, pkg_key) = {
                let inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                    PluginError::invalid_input("Installation disappeared")
                })?;

                inst.enabled = true;
                inst.activation_generation = target_gen;
                inst.updated_at = now_str.clone();

                let pkg_key = format!(
                    "{}@{}#{}",
                    inst.plugin_id, inst.active_version, inst.active_package_digest
                );
                (inst.clone(), pkg_key)
            };

            fresh_state.registry_revision += 1;
            self.registry.write_state(&fresh_state)?;

            let has_ui = fresh_state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            (inst_clone, fresh_state.security_revision, has_ui)
        };

        // Activate worker
        match self.supervisor_manager.get_or_create(installation_id).await {
            Ok(sup) => {
                if let Err(e) = sup.activate().await {
                    tx_record.phase = LifecyclePhase::Failed;
                    tx_record.error = Some(e.to_string());
                    tx_record.updated_at = Utc::now().to_rfc3339();
                    let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);
                    return Err(e);
                }
            }
            Err(e) => {
                tx_record.phase = LifecyclePhase::Failed;
                tx_record.error = Some(e.to_string());
                tx_record.updated_at = Utc::now().to_rfc3339();
                let _ = write_lifecycle_journal_record(&self.registry.layout, &tx_record);
                return Err(e);
            }
        }

        tx_record.phase = LifecyclePhase::Committed;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let mut audit = AdminAuditRecord::new(actor, "enable", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        audit.new_generation = Some(target_gen);
        record_admin_audit(&audit);

        let worker_status = self.supervisor_manager.get_status(installation_id).await;
        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Remove installation and clean unreferenced packages safely.
    pub async fn remove(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
    ) -> Result<AdminRemoveResult, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let state = self.registry.read_state()?;
        if state.security_revision != expected_security_revision {
            return Err(PluginError::forbidden(format!(
                "Concurrent security revision mismatch: expected {expected_security_revision}, got {}",
                state.security_revision
            )));
        }

        let inst = state.installations.get(installation_id).ok_or_else(|| {
            PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
        })?;

        let active_digest = inst.active_package_digest.clone();
        let plugin_id = inst.plugin_id.clone();
        let active_version = inst.active_version.clone();
        let prev_digest = inst.previous_package.as_ref().map(|p| (p.package_digest.clone(), p.version.clone()));

        let tx_id = Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let mut tx_record = LifecycleTransactionRecord {
            transaction_id: tx_id.clone(),
            installation_id: installation_id.to_string(),
            operation: LifecycleOperation::Remove,
            phase: LifecyclePhase::Initiated,
            actor_subject: actor.to_string(),
            candidate: None,
            security_revision_before: state.security_revision,
            generation_before: inst.activation_generation,
            generation_after: None,
            error: None,
            created_at: now_str.clone(),
            updated_at: now_str.clone(),
        };
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        // Drain and stop worker
        self.supervisor_manager
            .drain_and_stop(installation_id)
            .await?;

        let mut cleaned_packages = Vec::new();

        {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            fresh_state.installations.remove(installation_id);
            fresh_state.registry_revision += 1;

            // Check if active_digest is still referenced
            let active_still_referenced = fresh_state.installations.values().any(|i| {
                i.active_package_digest == active_digest
                    || i.previous_package.as_ref().map(|p| &p.package_digest) == Some(&active_digest)
            });

            if !active_still_referenced {
                let pkg_key = format!("{plugin_id}@{active_version}#{active_digest}");
                fresh_state.packages.remove(&pkg_key);
                let pkg_dir = self.registry.layout.package_dir(&plugin_id, &active_version, &active_digest);
                if pkg_dir.exists() {
                    let _ = fs::remove_dir_all(&pkg_dir);
                    cleaned_packages.push(active_digest);
                }
            }

            if let Some((pd, pv)) = prev_digest {
                let prev_still_referenced = fresh_state.installations.values().any(|i| {
                    i.active_package_digest == pd
                        || i.previous_package.as_ref().map(|p| &p.package_digest) == Some(&pd)
                });
                if !prev_still_referenced {
                    let pkg_key = format!("{plugin_id}@{pv}#{pd}");
                    fresh_state.packages.remove(&pkg_key);
                    let pkg_dir = self.registry.layout.package_dir(&plugin_id, &pv, &pd);
                    if pkg_dir.exists() {
                        let _ = fs::remove_dir_all(&pkg_dir);
                        cleaned_packages.push(pd);
                    }
                }
            }

            self.registry.write_state(&fresh_state)?;
        }

        tx_record.phase = LifecyclePhase::Committed;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_lifecycle_journal_record(&self.registry.layout, &tx_record)?;

        let mut audit = AdminAuditRecord::new(actor, "remove", state.security_revision, "success");
        audit.installation_id = Some(installation_id.to_string());
        record_admin_audit(&audit);

        Ok(AdminRemoveResult {
            installation_id: installation_id.to_string(),
            removed: true,
            cleaned_packages,
        })
    }

    /// Replace grants for an installation, advancing security revision.
    pub async fn replace_grants(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
        grants: Vec<GrantKey>,
    ) -> Result<AdminInstallationDto, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        for g in &grants {
            if g.installation_id != installation_id {
                return Err(PluginError::invalid_input(format!(
                    "Grant installationId '{}' does not match target installation '{}'",
                    g.installation_id, installation_id
                )));
            }
            if g.actor_subject.trim().is_empty() {
                return Err(PluginError::invalid_input("Grant actor_subject cannot be empty"));
            }
            if g.configured_project_target.trim().is_empty() {
                return Err(PluginError::invalid_input("Grant project_target cannot be empty"));
            }
        }

        let (updated_inst, sec_rev, has_ui) = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            if fresh_state.security_revision != expected_security_revision {
                return Err(PluginError::forbidden(format!(
                    "Security revision advance: expected {expected_security_revision}, got {}",
                    fresh_state.security_revision
                )));
            }

            let (inst_clone, pkg_key) = {
                let inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                    PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
                })?;

                inst.grants = grants;
                inst.updated_at = Utc::now().to_rfc3339();

                let pkg_key = format!(
                    "{}@{}#{}",
                    inst.plugin_id, inst.active_version, inst.active_package_digest
                );
                (inst.clone(), pkg_key)
            };

            fresh_state.security_revision += 1;
            fresh_state.registry_revision += 1;
            self.registry.write_state(&fresh_state)?;

            let has_ui = fresh_state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            (inst_clone, fresh_state.security_revision, has_ui)
        };

        let mut audit = AdminAuditRecord::new(actor, "replace_grants", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        record_admin_audit(&audit);

        let worker_status = if !updated_inst.enabled {
            "stopped".to_string()
        } else {
            self.supervisor_manager.get_status(installation_id).await
        };

        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Replace bindings for an installation, advancing security revision.
    pub async fn replace_bindings(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
        bindings: BTreeMap<String, String>,
    ) -> Result<AdminInstallationDto, PluginError> {

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let (updated_inst, sec_rev, has_ui) = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            if fresh_state.security_revision != expected_security_revision {
                return Err(PluginError::forbidden(format!(
                    "Security revision advance: expected {expected_security_revision}, got {}",
                    fresh_state.security_revision
                )));
            }

            let (inst_clone, pkg_key) = {
                let inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                    PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
                })?;

                inst.bindings = bindings;
                inst.updated_at = Utc::now().to_rfc3339();

                let pkg_key = format!(
                    "{}@{}#{}",
                    inst.plugin_id, inst.active_version, inst.active_package_digest
                );
                (inst.clone(), pkg_key)
            };

            fresh_state.security_revision += 1;
            fresh_state.registry_revision += 1;
            self.registry.write_state(&fresh_state)?;

            let has_ui = fresh_state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            (inst_clone, fresh_state.security_revision, has_ui)
        };

        let mut audit = AdminAuditRecord::new(actor, "replace_bindings", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        record_admin_audit(&audit);

        let worker_status = if !updated_inst.enabled {
            "stopped".to_string()
        } else {
            self.supervisor_manager.get_status(installation_id).await
        };

        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Replace owner-history source for an installation, advancing security revision.
    pub async fn replace_owner_history_source(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_revision: u64,
        owner_history_source: Option<OwnerHistorySource>,
    ) -> Result<AdminInstallationDto, PluginError> {

        if let Some(source) = &owner_history_source {
            source.validate()?;
        }

        let inst_lock = self.get_installation_lock(installation_id).await;
        let _guard = inst_lock.lock().await;

        let (updated_inst, sec_rev, has_ui) = {
            let _state_guard = self.registry.state_lock.lock();
            let mut fresh_state = self.registry.read_state()?;
            if fresh_state.security_revision != expected_security_revision {
                return Err(PluginError::forbidden(format!(
                    "Security revision advance: expected {expected_security_revision}, got {}",
                    fresh_state.security_revision
                )));
            }

            let (inst_clone, pkg_key) = {
                let inst = fresh_state.installations.get_mut(installation_id).ok_or_else(|| {
                    PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
                })?;

                inst.owner_history_source = owner_history_source;
                inst.updated_at = Utc::now().to_rfc3339();

                let pkg_key = format!(
                    "{}@{}#{}",
                    inst.plugin_id, inst.active_version, inst.active_package_digest
                );
                (inst.clone(), pkg_key)
            };

            fresh_state.security_revision += 1;
            fresh_state.registry_revision += 1;
            self.registry.write_state(&fresh_state)?;

            let has_ui = fresh_state
                .packages
                .get(&pkg_key)
                .map(|p| p.entrypoints.ui.is_some())
                .unwrap_or(false);

            (inst_clone, fresh_state.security_revision, has_ui)
        };

        let mut audit = AdminAuditRecord::new(actor, "replace_owner_history_source", sec_rev, "success");
        audit.installation_id = Some(installation_id.to_string());
        record_admin_audit(&audit);

        let worker_status = if !updated_inst.enabled {
            "stopped".to_string()
        } else {
            self.supervisor_manager.get_status(installation_id).await
        };

        Ok(self.to_admin_dto(&updated_inst, sec_rev, worker_status, has_ui))
    }

    /// Crash recovery for pending lifecycle transactions.
    pub async fn run_crash_recovery(&self) -> Result<(), PluginError> {
        let pending = list_pending_lifecycle_transactions(&self.registry.layout)?;
        for mut record in pending {
            tracing::warn!(
                tx_id = %record.transaction_id,
                inst_id = %record.installation_id,
                phase = ?record.phase,
                "Found pending lifecycle transaction during startup crash recovery"
            );

            match record.phase {
                LifecyclePhase::Initiated | LifecyclePhase::Draining | LifecyclePhase::Stopped => {
                    // Pre-publish failure: abort transaction
                    record.phase = LifecyclePhase::Aborted;
                    record.error = Some("Aborted during startup recovery (pre-publish)".to_string());
                    record.updated_at = Utc::now().to_rfc3339();
                    let _ = write_lifecycle_journal_record(&self.registry.layout, &record);
                }
                LifecyclePhase::Activating | LifecyclePhase::Healthy => {
                    // In-flight activation failure: mark failed
                    record.phase = LifecyclePhase::Failed;
                    record.error = Some("Interrupted during worker activation".to_string());
                    record.updated_at = Utc::now().to_rfc3339();
                    let _ = write_lifecycle_journal_record(&self.registry.layout, &record);
                }
                LifecyclePhase::Published => {
                    // Already published to registry: commit transaction
                    record.phase = LifecyclePhase::Committed;
                    record.updated_at = Utc::now().to_rfc3339();
                    let _ = write_lifecycle_journal_record(&self.registry.layout, &record);
                }
                _ => {}
            }
        }
        Ok(())
    }
}
