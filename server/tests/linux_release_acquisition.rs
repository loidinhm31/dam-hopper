//! Tests for release acquisition URL validation and redirect constraints.

use dam_hopper_server::linux_release::acquire_client::validate_url_host;
use dam_hopper_server::linux_release::ReleaseError;

#[test]
fn test_acquire_url_validation_https_enforcement() {
    let http_url = reqwest::Url::parse("http://github.com/loidinhm31/dam-hopper/releases").unwrap();
    assert!(matches!(
        validate_url_host(&http_url),
        Err(ReleaseError::AcquisitionFailed(msg)) if msg.contains("refusing non-HTTPS")
    ));

    let ftp_url = reqwest::Url::parse("ftp://github.com/loidinhm31/dam-hopper/releases").unwrap();
    assert!(matches!(
        validate_url_host(&ftp_url),
        Err(ReleaseError::AcquisitionFailed(msg)) if msg.contains("refusing non-HTTPS")
    ));
}

#[test]
fn test_acquire_url_validation_allowed_hosts() {
    let allowed = [
        "https://github.com/loidinhm31/dam-hopper",
        "https://api.github.com/repos/loidinhm31/dam-hopper/releases/latest",
        "https://objects.githubusercontent.com/github-production-release-asset-2e65be",
        "https://github-production-release-asset-2e65be.s3.amazonaws.com/asset.tar.gz",
        "https://raw.githubusercontent.com/loidinhm31/dam-hopper/main/README.md",
    ];

    for url_str in allowed {
        let url = reqwest::Url::parse(url_str).unwrap();
        assert!(
            validate_url_host(&url).is_ok(),
            "expected '{url_str}' to be allowed"
        );
    }
}

#[test]
fn test_acquire_url_validation_rejected_hosts() {
    let rejected = [
        "https://evil.com/fake-release.tar.gz",
        "https://github.com.evil.com/asset.tar.gz",
        "https://githubusercontent.com.attacker.org/asset.tar.gz",
        "https://192.168.1.1/asset.tar.gz",
        "https://attacker-s3.amazonaws.com.evil.org/asset.tar.gz",
    ];

    for url_str in rejected {
        let url = reqwest::Url::parse(url_str).unwrap();
        assert!(
            matches!(
                validate_url_host(&url),
                Err(ReleaseError::AcquisitionFailed(_))
            ),
            "expected '{url_str}' to be rejected"
        );
    }
}
