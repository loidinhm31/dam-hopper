use std::{collections::HashMap, sync::Mutex};

use super::super::model::UtcTimestamp;
use super::{
    decode_record, encode_record, Clock, CredentialRecord, CredentialStatus, CredentialVault,
    SweepResult, VaultError, VaultRead, VaultTarget,
};

pub(crate) struct FakeClock {
    now: Mutex<UtcTimestamp>,
}

impl FakeClock {
    pub(crate) fn new(now: UtcTimestamp) -> Self {
        Self {
            now: Mutex::new(now),
        }
    }

    pub(crate) fn set(&self, now: UtcTimestamp) {
        *self.now.lock().expect("fake clock mutex poisoned") = now;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> UtcTimestamp {
        *self.now.lock().expect("fake clock mutex poisoned")
    }
}

pub(crate) struct FakeCredentialVault {
    records: Mutex<HashMap<String, Vec<u8>>>,
    fail_reads: Mutex<bool>,
    fail_writes: Mutex<bool>,
    fail_deletes: Mutex<bool>,
}

impl FakeCredentialVault {
    pub(crate) fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            fail_reads: Mutex::new(false),
            fail_writes: Mutex::new(false),
            fail_deletes: Mutex::new(false),
        }
    }

    pub(crate) fn set_failures(&self, reads: bool, writes: bool, deletes: bool) {
        *self.fail_reads.lock().expect("fake vault mutex poisoned") = reads;
        *self.fail_writes.lock().expect("fake vault mutex poisoned") = writes;
        *self.fail_deletes.lock().expect("fake vault mutex poisoned") = deletes;
    }

    pub(crate) fn contains(&self, target: &VaultTarget) -> bool {
        self.records
            .lock()
            .expect("fake vault mutex poisoned")
            .contains_key(target.target())
    }
}

impl CredentialVault for FakeCredentialVault {
    fn save(&self, target: &VaultTarget, record: &CredentialRecord) -> Result<(), VaultError> {
        if *self.fail_writes.lock().expect("fake vault mutex poisoned") {
            return Err(VaultError::WriteFailed);
        }
        let bytes = encode_record(record)?;
        self.records
            .lock()
            .expect("fake vault mutex poisoned")
            .insert(target.target().into(), bytes);
        Ok(())
    }

    fn load(&self, target: &VaultTarget, now: UtcTimestamp) -> Result<VaultRead, VaultError> {
        if *self.fail_reads.lock().expect("fake vault mutex poisoned") {
            return Err(VaultError::Unavailable);
        }
        let Some(bytes) = self
            .records
            .lock()
            .expect("fake vault mutex poisoned")
            .get(target.target())
            .cloned()
        else {
            return Ok(VaultRead {
                status: CredentialStatus::None,
                credential: None,
                expires_at: None,
                cleanup_warning: false,
            });
        };
        let record = decode_record(&bytes, target, now)?;
        if record.is_expired(now) {
            let deleted = self.forget(target).is_ok();
            return Ok(VaultRead {
                status: CredentialStatus::Expired,
                credential: None,
                expires_at: Some(record.expires_at),
                cleanup_warning: !deleted,
            });
        }
        let status = if record.is_rejected() {
            CredentialStatus::Rejected
        } else {
            CredentialStatus::Saved
        };
        Ok(VaultRead {
            status,
            expires_at: Some(record.expires_at),
            credential: (!record.is_rejected()).then_some(record),
            cleanup_warning: false,
        })
    }

    fn mark_rejected(&self, target: &VaultTarget, now: UtcTimestamp) -> Result<(), VaultError> {
        if *self.fail_writes.lock().expect("fake vault mutex poisoned") {
            return Err(VaultError::WriteFailed);
        }
        let bytes = self
            .records
            .lock()
            .expect("fake vault mutex poisoned")
            .get(target.target())
            .cloned()
            .ok_or(VaultError::Unavailable)?;
        let mut record = decode_record(&bytes, target, now)?;
        record.mark_rejected(now);
        self.records
            .lock()
            .expect("fake vault mutex poisoned")
            .insert(target.target().into(), encode_record(&record)?);
        Ok(())
    }

    fn forget(&self, target: &VaultTarget) -> Result<(), VaultError> {
        if *self.fail_deletes.lock().expect("fake vault mutex poisoned") {
            return Err(VaultError::DeleteFailed);
        }
        self.records
            .lock()
            .expect("fake vault mutex poisoned")
            .remove(target.target());
        Ok(())
    }

    fn forget_scope(&self, scope_prefix: &str) -> Result<(), VaultError> {
        if *self.fail_deletes.lock().expect("fake vault mutex poisoned") {
            return Err(VaultError::DeleteFailed);
        }
        self.records
            .lock()
            .expect("fake vault mutex poisoned")
            .retain(|target, _| !target.starts_with(scope_prefix));
        Ok(())
    }

    fn sweep_expired(&self, now: UtcTimestamp) -> Result<SweepResult, VaultError> {
        let keys = self
            .records
            .lock()
            .expect("fake vault mutex poisoned")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut result = SweepResult {
            expired: 0,
            cleanup_failures: 0,
        };
        for key in keys {
            let Some(bytes) = self
                .records
                .lock()
                .expect("fake vault mutex poisoned")
                .get(&key)
                .cloned()
            else {
                continue;
            };
            let (scope_prefix, identity_digest) =
                key.rsplit_once(".credential.").unwrap_or_default();
            let target = VaultTarget {
                target: key.clone(),
                scope_prefix: scope_prefix.into(),
                identity_digest: identity_digest.into(),
            };
            let Ok(record) = decode_record(&bytes, &target, now) else {
                continue;
            };
            if record.is_expired(now) {
                result.expired = result.expired.saturating_add(1);
                if self.forget(&target).is_err() {
                    result.cleanup_failures = result.cleanup_failures.saturating_add(1);
                }
            }
        }
        Ok(result)
    }
}
