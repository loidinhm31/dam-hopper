//! Bounded HTTP client and download helpers for release acquisition.

use super::constants::MAX_MANIFEST_BYTES;
use super::error::ReleaseError;
use serde::Deserialize;
use std::time::Duration;

pub fn validate_url_host(url: &reqwest::Url) -> Result<(), ReleaseError> {
    if url.scheme() != "https" {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "refusing non-HTTPS redirect URL: {url}"
        )));
    }
    let host = url.host_str().unwrap_or("");
    let is_allowed = host == "github.com"
        || host == "api.github.com"
        || host == "objects.githubusercontent.com"
        || host.ends_with(".github.com")
        || host.ends_with(".githubusercontent.com")
        || (host.ends_with(".amazonaws.com") && host.contains("github"));
    if !is_allowed {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "refusing redirect to unauthorized host: {host}"
        )));
    }
    Ok(())
}

pub fn build_http_client() -> Result<reqwest::Client, ReleaseError> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects (max 5)");
        }
        if let Err(e) = validate_url_host(attempt.url()) {
            return attempt.error(e.to_string());
        }
        attempt.follow()
    });

    reqwest::Client::builder()
        .user_agent("dam-hopper-installer")
        .redirect(redirect_policy)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| ReleaseError::AcquisitionFailed(format!("failed to build HTTP client: {e}")))
}

pub async fn fetch_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, ReleaseError> {
    let bytes = fetch_bytes(client, url, MAX_MANIFEST_BYTES).await?;
    serde_json::from_slice(&bytes).map_err(|e| {
        ReleaseError::AcquisitionFailed(format!("failed to parse GitHub API response: {e}"))
    })
}

pub async fn fetch_bytes(
    client: &reqwest::Client,
    url: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, ReleaseError> {
    let parsed_url = reqwest::Url::parse(url)
        .map_err(|e| ReleaseError::AcquisitionFailed(format!("invalid URL '{url}': {e}")))?;
    validate_url_host(&parsed_url)?;

    let resp = client.get(url).send().await.map_err(|e| {
        ReleaseError::AcquisitionFailed(format!("HTTP request failed for '{url}': {e}"))
    })?;

    if !resp.status().is_success() {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "HTTP {} for '{url}'",
            resp.status()
        )));
    }

    if let Some(content_len) = resp.content_length() {
        if content_len > max_bytes as u64 {
            return Err(ReleaseError::AcquisitionFailed(format!(
                "response length {content_len} exceeds limit of {max_bytes} bytes"
            )));
        }
    }

    let bytes = resp.bytes().await.map_err(|e| {
        ReleaseError::AcquisitionFailed(format!("failed to read response body: {e}"))
    })?;

    if bytes.len() > max_bytes {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "response size {} exceeds limit of {max_bytes} bytes",
            bytes.len()
        )));
    }

    Ok(bytes.to_vec())
}
