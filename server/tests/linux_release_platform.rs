//! Tests for platform profile checks, origin validation, and host configuration persistence.

use dam_hopper_server::linux_release::*;
use tempfile::tempdir;

#[test]
fn test_os_release_parsing_and_validation() {
    let fedora44 = r#"
NAME="Fedora Linux"
VERSION="44 (Container Image)"
ID=fedora
VERSION_ID=44
PLATFORM_ID="platform:f44"
PRETTY_NAME="Fedora Linux 44 (Container Image)"
"#;
    let parsed = parse_os_release(fedora44);
    assert_eq!(parsed.id, "fedora");
    assert_eq!(parsed.version_id, "44");
    assert!(verify_os_release(&parsed).is_ok());

    let ubuntu = r#"
NAME="Ubuntu"
ID=ubuntu
VERSION_ID="24.04"
"#;
    let parsed = parse_os_release(ubuntu);
    assert!(matches!(
        verify_os_release(&parsed),
        Err(ReleaseError::UnsupportedOs { ref expected, ref got }) if expected == "fedora" && got == "ubuntu"
    ));

    let fedora43 = r#"
ID="fedora"
VERSION_ID="43"
"#;
    let parsed = parse_os_release(fedora43);
    assert!(matches!(
        verify_os_release(&parsed),
        Err(ReleaseError::UnsupportedOsVersion { ref expected, ref got }) if expected == "44" && got == "43"
    ));
}

#[test]
fn test_architecture_validation() {
    assert!(verify_arch("x86_64").is_ok());
    assert!(matches!(
        verify_arch("aarch64"),
        Err(ReleaseError::UnsupportedArch { .. })
    ));
    assert!(matches!(
        verify_arch("armv7l"),
        Err(ReleaseError::UnsupportedArch { .. })
    ));
}

#[test]
fn test_glibc_version_validation() {
    assert!(verify_glibc_version("2.43").is_ok());
    assert!(verify_glibc_version("2.44").is_ok());
    assert!(verify_glibc_version("2.50").is_ok());
    assert!(matches!(
        verify_glibc_version("2.42"),
        Err(ReleaseError::GlibcVersionTooLow { .. })
    ));
    assert!(matches!(
        verify_glibc_version("2.34"),
        Err(ReleaseError::GlibcVersionTooLow { .. })
    ));
    assert!(matches!(
        verify_glibc_version("invalid"),
        Err(ReleaseError::GlibcVersionTooLow { .. })
    ));
}

#[test]
fn test_systemd_version_validation() {
    let output = "systemd 259 (259.1-1.fc44)\n+PAM +AUDIT +SELINUX";
    let ver = parse_systemd_version(output).expect("parsed systemd version");
    assert_eq!(ver, 259);
    assert!(verify_systemd_version(ver).is_ok());
    assert!(verify_systemd_version(260).is_ok());
    assert!(matches!(
        verify_systemd_version(258),
        Err(ReleaseError::SystemdVersionTooLow {
            expected: 259,
            got: 258
        })
    ));
}

#[test]
fn test_web_origin_validation() {
    assert_eq!(
        validate_web_origin("http://localhost:4802").unwrap(),
        "http://localhost:4802"
    );
    assert_eq!(
        validate_web_origin("http://localhost:4802/").unwrap(),
        "http://localhost:4802"
    );
    assert_eq!(
        validate_web_origin("https://workspace.internal").unwrap(),
        "https://workspace.internal"
    );
    assert_eq!(
        validate_web_origin("https://workspace.internal:8443").unwrap(),
        "https://workspace.internal:8443"
    );

    // Reject wildcards
    assert!(matches!(
        validate_web_origin("http://*"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));
    assert!(matches!(
        validate_web_origin("https://*.example.com"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));

    // Reject non-http(s)
    assert!(matches!(
        validate_web_origin("ftp://host"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));

    // Reject userinfo
    assert!(matches!(
        validate_web_origin("http://admin:secret@host"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));

    // Reject paths
    assert!(matches!(
        validate_web_origin("http://host/api/v1"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));

    // Reject query and fragment
    assert!(matches!(
        validate_web_origin("http://host?token=secret"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));
    assert!(matches!(
        validate_web_origin("http://host#section"),
        Err(ReleaseError::InvalidWebOrigin { .. })
    ));
}

#[test]
fn test_web_origins_duplicate_rejection() {
    let origins = vec![
        "http://localhost:4802".to_string(),
        "http://localhost:4802/".to_string(),
    ];
    assert!(matches!(
        validate_web_origins(&origins),
        Err(ReleaseError::DuplicateWebOrigin(_))
    ));
}

#[test]
fn test_host_config_roundtrip() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join("host.toml");

    let initial = load_host_config(&config_path).unwrap();
    assert!(initial.is_none());

    let config = HostConfig::new(
        TargetRole::Both,
        vec![
            "http://localhost:4802".to_string(),
            "https://app.dev".to_string(),
        ],
    )
    .unwrap();

    save_host_config(&config_path, &config).unwrap();

    let loaded = load_host_config(&config_path)
        .unwrap()
        .expect("loaded host config");
    assert_eq!(loaded.role, TargetRole::Both);
    assert_eq!(
        loaded.allowed_web_origins,
        vec!["http://localhost:4802", "https://app.dev"]
    );
}
