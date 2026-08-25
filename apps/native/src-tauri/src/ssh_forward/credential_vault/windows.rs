use std::ptr;

use zeroize::Zeroizing;

use windows::{
    core::{PCWSTR, PWSTR},
    Win32::Security::Credentials::{
        CredDeleteW, CredEnumerateW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    },
};

use super::super::model::UtcTimestamp;
use super::{
    decode_record, encode_record, CredentialRecord, CredentialStatus, CredentialVault, SweepResult,
    VaultError, VaultRead, VaultTarget,
};

const MAX_SCOPE_ENTRIES: u32 = 256;
const ACCOUNT: &str = "DamHopper";
const ERROR_NOT_FOUND: i32 = 1168;
const ERROR_NOT_FOUND_HRESULT: i32 = -2_147_023_728;

fn credential_store_empty(code: i32) -> bool {
    // `windows::core::Error::code()` is an HRESULT for Win32 failures. Accept
    // only the raw Win32 value or the exact HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
    // value; unrelated HRESULTs must remain vault-unavailable.
    matches!(code, ERROR_NOT_FOUND | ERROR_NOT_FOUND_HRESULT)
}

pub(crate) struct WindowsCredentialVault;

impl WindowsCredentialVault {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl CredentialVault for WindowsCredentialVault {
    fn save(&self, target: &VaultTarget, record: &CredentialRecord) -> Result<(), VaultError> {
        let bytes = Zeroizing::new(encode_record(record)?);
        let mut target_w = wide(target.target());
        let mut account_w = wide(ACCOUNT);
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target_w.as_mut_ptr()),
            CredentialBlobSize: bytes
                .len()
                .try_into()
                .map_err(|_| VaultError::InvalidRecord)?,
            CredentialBlob: bytes.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(account_w.as_mut_ptr()),
            ..Default::default()
        };
        unsafe { CredWriteW(&credential, 0).map_err(|_| VaultError::WriteFailed) }
    }

    fn load(&self, target: &VaultTarget, now: UtcTimestamp) -> Result<VaultRead, VaultError> {
        let Some(bytes) = read_blob(target)? else {
            return Ok(VaultRead {
                status: CredentialStatus::None,
                credential: None,
                expires_at: None,
                cleanup_warning: false,
            });
        };
        let record = decode_record(&bytes, target, now)?;
        if record.is_expired(now) {
            let cleanup_warning = self.forget(target).is_err();
            return Ok(VaultRead {
                status: CredentialStatus::Expired,
                credential: None,
                expires_at: Some(record.expires_at),
                cleanup_warning,
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
        let bytes = read_blob(target)?.ok_or(VaultError::Unavailable)?;
        let mut record = decode_record(&bytes, target, now)?;
        record.mark_rejected(now);
        self.save(target, &record)
    }

    fn forget(&self, target: &VaultTarget) -> Result<(), VaultError> {
        let target_w = wide(target.target());
        let result = unsafe { CredDeleteW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None) };
        match result {
            Ok(()) => Ok(()),
            Err(error) if credential_store_empty(error.code().0) => Ok(()),
            Err(_) => Err(VaultError::DeleteFailed),
        }
    }

    fn forget_scope(&self, scope_prefix: &str) -> Result<(), VaultError> {
        let names = enumerate_scope_targets(scope_prefix)?;
        let mut delete_failed = false;
        for name in names {
            let name_w = wide(&name);
            let result = unsafe { CredDeleteW(PCWSTR(name_w.as_ptr()), CRED_TYPE_GENERIC, None) };
            if let Err(error) = result {
                if !credential_store_empty(error.code().0) {
                    delete_failed = true;
                }
            }
        }
        if delete_failed {
            return Err(VaultError::DeleteFailed);
        }
        if enumerate_scope_targets(scope_prefix)?.is_empty() {
            Ok(())
        } else {
            Err(VaultError::DeleteFailed)
        }
    }

    fn sweep_expired(&self, now: UtcTimestamp) -> Result<SweepResult, VaultError> {
        // The scope prefix is deliberately opaque; enumerate only the fixed
        // DamHopper namespace and validate every blob before deletion.
        let filter = wide("DamHopper.SshForward.v1.scope.*");
        let mut count = 0;
        let mut raw = ptr::null_mut();
        if let Err(error) =
            unsafe { CredEnumerateW(PCWSTR(filter.as_ptr()), None, &mut count, &mut raw) }
        {
            if credential_store_empty(error.code().0) {
                return Ok(SweepResult {
                    expired: 0,
                    cleanup_failures: 0,
                });
            }
            return Err(VaultError::Unavailable);
        }
        let _guard = CredentialArray(raw);
        if count == 0 {
            return Ok(SweepResult {
                expired: 0,
                cleanup_failures: 0,
            });
        }
        if count > MAX_SCOPE_ENTRIES || raw.is_null() {
            return Err(VaultError::Corrupt);
        }
        let mut result = SweepResult {
            expired: 0,
            cleanup_failures: 0,
        };
        for index in 0..count {
            let credential = unsafe { *raw.add(index as usize) };
            let Some(target) = (unsafe { read_wide((*credential).TargetName, 256) }) else {
                result.cleanup_failures = result.cleanup_failures.saturating_add(1);
                continue;
            };
            let Some(target) = target_for_raw(&target) else {
                continue;
            };
            let Ok(bytes) = read_blob(&target) else {
                continue;
            };
            let Some(bytes) = bytes else { continue };
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

fn enumerate_scope_targets(scope_prefix: &str) -> Result<Vec<String>, VaultError> {
    let filter = wide(&format!("{scope_prefix}*"));
    let mut count = 0;
    let mut raw = ptr::null_mut();
    if let Err(error) =
        unsafe { CredEnumerateW(PCWSTR(filter.as_ptr()), None, &mut count, &mut raw) }
    {
        if credential_store_empty(error.code().0) {
            return Ok(Vec::new());
        }
        return Err(VaultError::Unavailable);
    }
    let _guard = CredentialArray(raw);
    if count == 0 {
        return Ok(Vec::new());
    }
    if count > MAX_SCOPE_ENTRIES || raw.is_null() {
        return Err(VaultError::Corrupt);
    }
    let mut names = Vec::with_capacity(count as usize);
    for index in 0..count {
        let credential = unsafe { *raw.add(index as usize) };
        let Some(name) = (unsafe { read_wide((*credential).TargetName, 256) }) else {
            return Err(VaultError::Corrupt);
        };
        if name.starts_with(scope_prefix) {
            names.push(name);
        }
    }
    Ok(names)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn read_wide(value: PWSTR, max: usize) -> Option<String> {
    if value.0.is_null() {
        return None;
    }
    let mut values = Vec::new();
    for index in 0..max {
        // Credential Manager owns a valid, null-terminated UTF-16 buffer for
        // the lifetime of the enclosing CREDENTIALW allocation. Read one
        // element at a time so a malformed buffer cannot create an oversized
        // slice before the explicit bound is enforced.
        let character = std::ptr::read(value.0.add(index));
        if character == 0 {
            return String::from_utf16(&values).ok();
        }
        values.push(character);
    }
    None
}

fn target_for_raw(target: &str) -> Option<VaultTarget> {
    let (scope_prefix, identity_digest) = target.rsplit_once(".credential.")?;
    if identity_digest.len() != 64 || !identity_digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(VaultTarget {
        target: target.into(),
        scope_prefix: scope_prefix.into(),
        identity_digest: identity_digest.into(),
    })
}

fn read_blob(target: &VaultTarget) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
    let target_w = wide(target.target());
    let mut raw = ptr::null_mut();
    let result = unsafe { CredReadW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None, &mut raw) };
    if let Err(error) = result {
        return if credential_store_empty(error.code().0) {
            Ok(None)
        } else {
            Err(VaultError::Unavailable)
        };
    }
    let guard = CredentialBuffer(raw);
    if raw.is_null() {
        return Err(VaultError::Corrupt);
    }
    let credential = unsafe { &*raw };
    if credential.Type != CRED_TYPE_GENERIC
        || credential.Persist != CRED_PERSIST_LOCAL_MACHINE
        || credential.CredentialBlobSize == 0
        || credential.CredentialBlobSize as usize > super::MAX_BLOB_BYTES
        || credential.CredentialBlob.is_null()
        || unsafe { read_wide(credential.UserName, 64).as_deref() } != Some(ACCOUNT)
    {
        drop(guard);
        return Err(VaultError::Corrupt);
    }
    let bytes = Zeroizing::new(unsafe {
        std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        )
        .to_vec()
    });
    drop(guard);
    Ok(Some(bytes))
}

struct CredentialBuffer(*mut CREDENTIALW);

impl Drop for CredentialBuffer {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CredFree(self.0.cast()) };
        }
    }
}

struct CredentialArray(*mut *mut CREDENTIALW);

impl Drop for CredentialArray {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CredFree(self.0.cast()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{credential_store_empty, ERROR_NOT_FOUND, ERROR_NOT_FOUND_HRESULT};

    #[test]
    fn only_not_found_is_an_empty_store() {
        assert!(credential_store_empty(ERROR_NOT_FOUND));
        assert!(credential_store_empty(ERROR_NOT_FOUND_HRESULT));
        assert!(!credential_store_empty(1312));
        assert!(!credential_store_empty(0x4007_0490));
    }
}
