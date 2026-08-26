use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/telemetry/codex_app_server/fixtures/codex-cli-0.146.0-thread-list-contract.json"
);
const PROVENANCE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/telemetry/codex_app_server/fixtures/provenance.txt"
);
const REPORT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../plans/260801-1455-session-model-delegation-audit/reports/phase-01-compatibility-gate.md"
);
const PHASE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../plans/260801-1455-session-model-delegation-audit/phase-01-codex-app-server-compatibility-gate.md"
);
const SCHEMA_HASHES: [&str; 3] = [
    "ccc09fa6d5d89fa76afd474f6d7ef8cf14edbe0e037d8a52aebf5bd14f435c5b",
    "0c12f87cf3ab2c5fed95152a1e36873e6e56dadae39f46096267371ad65d1321",
    "db97080f82facc3259dbb9404e9f0df81e360619f4cd73983a9d99d25f5089ee",
];

fn schema_path(root: &Path, name: &str) -> PathBuf {
    root.join("v2").join(name)
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn assert_retained_artifacts_are_sanitized() {
    let mut retained = [FIXTURE, PROVENANCE, REPORT, PHASE]
        .map(|path| fs::read_to_string(path).unwrap())
        .join("\n");
    for forbidden in [
        "/home/",
        ".codex/sessions",
        "rollout-",
        "OTEL_RESOURCE_ATTRIBUTES=",
    ] {
        assert!(
            !retained.contains(forbidden),
            "forbidden retained artifact value"
        );
    }
    let raw_id =
        regex::Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
            .unwrap();
    assert!(
        !raw_id.is_match(&retained),
        "raw provider-like identifier retained"
    );
    for hash in SCHEMA_HASHES {
        retained = retained.replace(hash, "PINNED_SCHEMA_HASH");
    }
    let opaque_id = regex::Regex::new(r"\b[0-9a-fA-F]{32,}\b").unwrap();
    assert!(
        !opaque_id.is_match(&retained),
        "raw hex provider identifier or terminal marker retained"
    );
    let base64url_like = retained.split(|character: char| {
        !(character.is_ascii_alphanumeric() || character == '_' || character == '-')
    });
    assert!(
        !base64url_like
            .filter(|token| token.len() >= 43)
            .any(|token| {
                token.bytes().any(|byte| byte.is_ascii_lowercase())
                    && token.bytes().any(|byte| byte.is_ascii_uppercase())
                    && token.bytes().any(|byte| byte.is_ascii_digit())
            }),
        "raw base64url-like terminal marker retained"
    );
}

#[test]
fn pinned_contract_records_content_projection_failure_without_raw_content() {
    let fixture: Value = serde_json::from_str(&fs::read_to_string(FIXTURE).unwrap()).unwrap();
    assert_eq!(fixture["cliVersion"], "0.146.0");
    assert_eq!(fixture["gate"], "fail");
    assert!(fixture["request"]["contentProjectionParameter"].is_null());

    assert_retained_artifacts_are_sanitized();
}

/// Manual compatibility probe. It generates schemas into a disposable directory
/// and never reads Codex rollout files or writes a response body to test output.
#[test]
#[ignore = "requires the pinned local Codex 0.146.0 binary"]
fn codex_0146_schema_proves_thread_list_cannot_exclude_content() {
    let codex = env::var_os("CODEX_BIN").unwrap_or_else(|| "codex".into());
    let version = Command::new(&codex).arg("--version").output().unwrap();
    assert!(version.status.success());
    assert_eq!(
        String::from_utf8(version.stdout).unwrap().trim(),
        "codex-cli 0.146.0"
    );

    let directory = tempfile::tempdir().unwrap();
    let generated = Command::new(&codex)
        .args([
            "app-server",
            "generate-json-schema",
            "--experimental",
            "--out",
        ])
        .arg(directory.path())
        .output()
        .unwrap();
    assert!(generated.status.success());

    let params_bytes = fs::read(schema_path(directory.path(), "ThreadListParams.json")).unwrap();
    let response_bytes =
        fs::read(schema_path(directory.path(), "ThreadListResponse.json")).unwrap();
    let read_bytes = fs::read(schema_path(directory.path(), "ThreadReadParams.json")).unwrap();
    assert_eq!(sha256(&params_bytes), SCHEMA_HASHES[0]);
    assert_eq!(sha256(&response_bytes), SCHEMA_HASHES[1]);
    assert_eq!(sha256(&read_bytes), SCHEMA_HASHES[2]);
    let params: Value = serde_json::from_slice(&params_bytes).unwrap();
    let response: Value = serde_json::from_slice(&response_bytes).unwrap();

    assert!(params["properties"].get("includeTurns").is_none());
    assert!(params["properties"].get("fields").is_none());
    let thread = &response["definitions"]["Thread"];
    assert!(thread["properties"].get("preview").is_some());
    let required = thread["required"].as_array().unwrap();
    for field in ["cwd", "preview", "turns"] {
        assert!(required.iter().any(|value| value == field));
    }
    assert!(thread["properties"].get("path").is_some());
}
