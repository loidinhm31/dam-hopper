//! Pure scope quarantine decisions; file mutations stay in the contained store.

use super::{model::UtcTimestamp, profile::validate_uuid_v4};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

const ORPHAN_RETENTION_DAYS: i64 = 30;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum KnownScopesInput {
    Available { ids: Vec<String> },
    Unavailable,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
enum KnownScopesInputWire {
    Available { ids: Vec<String> },
    Unavailable,
}

impl<'de> Deserialize<'de> for KnownScopesInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = match KnownScopesInputWire::deserialize(deserializer)? {
            KnownScopesInputWire::Available { ids } => Self::Available { ids },
            KnownScopesInputWire::Unavailable => Self::Unavailable,
        };
        validate_known_scopes(&value).map_err(|_| D::Error::custom("invalid_known_scopes"))?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ScopeMeta {
    pub(crate) scope_id: String,
    pub(crate) last_seen_at: UtcTimestamp,
    pub(crate) orphaned_at: Option<UtcTimestamp>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Reconciliation {
    Refreshed,
    Quarantined,
    Unchanged,
}

pub(crate) fn reconcile(
    meta: &mut ScopeMeta,
    known_scopes: &KnownScopesInput,
    now: UtcTimestamp,
) -> Result<Reconciliation, ScopeRetentionError> {
    validate_scope_id(&meta.scope_id)?;
    validate_known_scopes(known_scopes)?;
    let KnownScopesInput::Available { ids } = known_scopes else {
        return Ok(Reconciliation::Unchanged);
    };
    if ids.iter().any(|scope| scope == &meta.scope_id) {
        if now > meta.last_seen_at {
            meta.last_seen_at = now;
        }
        meta.orphaned_at = None;
        Ok(Reconciliation::Refreshed)
    } else if meta.orphaned_at.is_none() {
        meta.orphaned_at = Some(std::cmp::max(now, meta.last_seen_at));
        Ok(Reconciliation::Quarantined)
    } else {
        Ok(Reconciliation::Unchanged)
    }
}

pub(crate) fn validate_known_scopes(
    known_scopes: &KnownScopesInput,
) -> Result<(), ScopeRetentionError> {
    let KnownScopesInput::Available { ids } = known_scopes else {
        return Ok(());
    };
    if ids.len() > 256 || ids.iter().any(|scope| validate_scope_id(scope).is_err()) {
        Err(ScopeRetentionError::InvalidKnownScopes)
    } else {
        Ok(())
    }
}

pub(crate) fn is_purge_eligible(
    meta: &ScopeMeta,
    now: UtcTimestamp,
) -> Result<bool, ScopeRetentionError> {
    validate_scope_id(&meta.scope_id)?;
    let Some(orphaned_at) = meta.orphaned_at else {
        return Ok(false);
    };
    let expiry = orphaned_at
        .checked_add_days(ORPHAN_RETENTION_DAYS)
        .map_err(|_| ScopeRetentionError::InvalidTimestamp)?;
    Ok(now >= expiry)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum ScopeRetentionError {
    InvalidScopeId,
    InvalidKnownScopes,
    InvalidTimestamp,
}

pub(crate) fn validate_scope_id(scope_id: &str) -> Result<(), ScopeRetentionError> {
    validate_uuid_v4(scope_id).map_err(|_| ScopeRetentionError::InvalidScopeId)
}

#[cfg(test)]
mod tests {
    use super::{is_purge_eligible, reconcile, KnownScopesInput, Reconciliation, ScopeMeta};
    use crate::ssh_forward::model::UtcTimestamp;

    const SHARED_FIXTURES: &str =
        include_str!("../../../../../packages/shared/src/ssh-forward-contract-fixtures.json");

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";

    fn timestamp(value: &str) -> UtcTimestamp {
        UtcTimestamp::parse(value).unwrap()
    }

    fn meta() -> ScopeMeta {
        ScopeMeta {
            scope_id: SCOPE.into(),
            last_seen_at: timestamp("2026-01-01T00:00:00.000Z"),
            orphaned_at: None,
        }
    }

    #[test]
    fn unavailable_known_scopes_do_not_age_orphans() {
        let mut meta = meta();
        assert_eq!(
            reconcile(
                &mut meta,
                &KnownScopesInput::Unavailable,
                timestamp("2026-02-01T00:00:00.000Z")
            ),
            Ok(Reconciliation::Unchanged)
        );
        assert_eq!(meta.orphaned_at, None);
    }

    #[test]
    fn known_scopes_wire_contract_is_tagged_and_rejects_unknown_fields() {
        let input = KnownScopesInput::Available {
            ids: vec![SCOPE.into()],
        };
        assert_eq!(
            serde_json::to_string(&input).unwrap(),
            format!(r#"{{"status":"available","ids":["{SCOPE}"]}}"#)
        );
        assert!(serde_json::from_str::<KnownScopesInput>(
            r#"{"status":"available","ids":[],"extra":true}"#
        )
        .is_err());
        let ids = std::iter::repeat(format!("\"{SCOPE}\""))
            .take(257)
            .collect::<Vec<_>>()
            .join(",");
        assert!(serde_json::from_str::<KnownScopesInput>(&format!(
            r#"{{"status":"available","ids":[{ids}]}}"#
        ))
        .is_err());
    }

    #[test]
    fn known_scopes_fixture_roundtrips_without_field_drift() {
        let fixtures: serde_json::Value = serde_json::from_str(SHARED_FIXTURES).unwrap();
        let value: KnownScopesInput =
            serde_json::from_value(fixtures["knownScopes"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            fixtures["knownScopes"]
        );
        let unavailable: KnownScopesInput =
            serde_json::from_value(fixtures["knownScopesUnavailable"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(unavailable).unwrap(),
            fixtures["knownScopesUnavailable"]
        );
    }

    #[test]
    fn absent_scope_quarantines_then_present_scope_recovers() {
        let mut meta = meta();
        assert_eq!(
            reconcile(
                &mut meta,
                &KnownScopesInput::Available { ids: vec![] },
                timestamp("2026-01-02T00:00:00.000Z")
            ),
            Ok(Reconciliation::Quarantined)
        );
        assert_eq!(
            reconcile(
                &mut meta,
                &KnownScopesInput::Available {
                    ids: vec![SCOPE.into()]
                },
                timestamp("2026-01-03T00:00:00.000Z")
            ),
            Ok(Reconciliation::Refreshed)
        );
        assert_eq!(meta.orphaned_at, None);
    }

    #[test]
    fn backward_clock_does_not_break_retention_order() {
        let mut meta = meta();
        assert_eq!(
            reconcile(
                &mut meta,
                &KnownScopesInput::Available { ids: vec![] },
                timestamp("2025-12-31T00:00:00.000Z")
            ),
            Ok(Reconciliation::Quarantined)
        );
        assert_eq!(meta.orphaned_at, Some(meta.last_seen_at));

        assert_eq!(
            reconcile(
                &mut meta,
                &KnownScopesInput::Available {
                    ids: vec![SCOPE.into()]
                },
                timestamp("2025-12-31T00:00:00.000Z")
            ),
            Ok(Reconciliation::Refreshed)
        );
        assert_eq!(meta.orphaned_at, None);
        assert_eq!(meta.last_seen_at, timestamp("2026-01-01T00:00:00.000Z"));
    }

    #[test]
    fn purge_respects_exact_30_day_boundary_and_active_scopes() {
        let mut meta = meta();
        reconcile(
            &mut meta,
            &KnownScopesInput::Available { ids: vec![] },
            timestamp("2026-01-01T00:00:00.000Z"),
        )
        .unwrap();
        assert!(!is_purge_eligible(&meta, timestamp("2026-01-30T23:59:59.999Z")).unwrap());
        assert!(is_purge_eligible(&meta, timestamp("2026-01-31T00:00:00.000Z")).unwrap());
    }
}
