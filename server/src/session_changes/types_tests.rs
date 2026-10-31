use super::types::*;
use serde_json::Value;

const FIXTURE_JSON: &str = include_str!("../../tests/fixtures/session-changes-wire.json");

#[test]
fn test_fixture_parses() {
    let parsed: Value = serde_json::from_str(FIXTURE_JSON).expect("fixture should be valid JSON");
    assert!(parsed.get("valid").is_some());
    assert!(parsed.get("invalid").is_some());
}

#[test]
fn test_valid_prepare_request() {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();
    let val = &fixture["valid"]["prepareRequest"];
    let req: PrepareRequest = serde_json::from_value(val.clone()).unwrap();
    assert_eq!(req.version, 1);
    assert_eq!(req.registration_id, "reg-123");
    assert_eq!(req.mode, PrepareMode::Capture);
    assert_eq!(req.lifecycle, PrepareLifecycle::InitialFresh);
}

#[test]
fn test_valid_prepared_receipt() {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();
    let val = &fixture["valid"]["preparedReceipt"];
    let receipt: PreparedReceipt = serde_json::from_value(val.clone()).unwrap();
    assert_eq!(receipt.kind, "prepared");
    assert_eq!(receipt.baseline_coverage.state, CoverageState::Complete);
}

#[test]
fn test_valid_lookup_result_discriminated() {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();

    let val_active = &fixture["valid"]["lookupResultActive"];
    let active: LookupResult = serde_json::from_value(val_active.clone()).unwrap();
    match active {
        LookupResult::Active { status, .. } => {
            assert_eq!(status.state, StatusState::Ready);
        }
        _ => panic!("Expected LookupResult::Active"),
    }

    let val_missing = &fixture["valid"]["lookupResultMissing"];
    let missing: LookupResult = serde_json::from_value(val_missing.clone()).unwrap();
    match missing {
        LookupResult::Missing { reason, .. } => {
            assert_eq!(reason, ErrorCode::BaselineMissing);
        }
        _ => panic!("Expected LookupResult::Missing"),
    }

    let val_unavail = &fixture["valid"]["lookupResultUnavailable"];
    let unavail: LookupResult = serde_json::from_value(val_unavail.clone()).unwrap();
    match unavail {
        LookupResult::Unavailable { reason, .. } => {
            assert_eq!(reason, ErrorCode::TargetUnavailable);
        }
        _ => panic!("Expected LookupResult::Unavailable"),
    }
}

#[test]
fn test_valid_status_invariants() {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();
    let valid_obj = fixture["valid"].as_object().unwrap();

    let status_keys = [
        "statusSessionStartInitializing",
        "statusSessionStartReady",
        "statusSessionStartIncomplete",
        "statusSessionStartUnavailablePending",
        "statusSessionStartUnavailableReceived",
        "statusFromNowInitializing",
        "statusFromNowReady",
        "statusFromNowIncomplete",
        "statusFromNowUnavailable",
        "statusNullOriginMissing",
        "statusNullOriginUnavailable",
    ];

    for key in status_keys {
        let val = valid_obj.get(key).unwrap_or_else(|| panic!("missing key {key}"));
        let status: Status = serde_json::from_value(val.clone())
            .unwrap_or_else(|e| panic!("failed to deserialize {key}: {e}"));
        status
            .validate_invariants()
            .unwrap_or_else(|e| panic!("invariant failed for valid {key}: {e}"));
    }
}

#[test]
fn test_invalid_status_invariants() {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();
    let invalid_obj = fixture["invalid"].as_object().unwrap();

    for (key, val) in invalid_obj {
        // Either deserialization fails or validate_invariants fails
        if let Ok(status) = serde_json::from_value::<Status>(val.clone()) {
            assert!(
                status.validate_invariants().is_err(),
                "Expected validation to fail for invalid key: {key}"
            );
        }
    }
}

#[test]
fn contract_round_trip_smoke() {
    // Round trip all valid objects through serialize -> deserialize
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).unwrap();
    let valid_obj = fixture["valid"].as_object().unwrap();

    // PrepareRequest
    let prep_req: PrepareRequest = serde_json::from_value(valid_obj["prepareRequest"].clone()).unwrap();
    let reserialized = serde_json::to_value(&prep_req).unwrap();
    assert_eq!(prep_req, serde_json::from_value(reserialized).unwrap());

    // Status ready
    let status: Status = serde_json::from_value(valid_obj["statusSessionStartReady"].clone()).unwrap();
    let status_json = serde_json::to_value(&status).unwrap();
    let status_back: Status = serde_json::from_value(status_json).unwrap();
    assert_eq!(status, status_back);
    assert!(status_back.validate_invariants().is_ok());

    // FilePage
    let page: FilePage = serde_json::from_value(valid_obj["filePage"].clone()).unwrap();
    let page_json = serde_json::to_value(&page).unwrap();
    let page_back: FilePage = serde_json::from_value(page_json).unwrap();
    assert_eq!(page, page_back);

    // FileDetail
    let detail: FileDetail = serde_json::from_value(valid_obj["fileDetail"].clone()).unwrap();
    let detail_json = serde_json::to_value(&detail).unwrap();
    let detail_back: FileDetail = serde_json::from_value(detail_json).unwrap();
    assert_eq!(detail, detail_back);

    // SettledRequest / SettledResponse
    let settled: SettledRequest = serde_json::from_value(valid_obj["settledRequest"].clone()).unwrap();
    let settled_json = serde_json::to_value(&settled).unwrap();
    let settled_back: SettledRequest = serde_json::from_value(settled_json).unwrap();
    assert_eq!(settled, settled_back);
}
