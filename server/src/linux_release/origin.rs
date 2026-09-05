//! Allowed web origin validation and normalization.

use super::error::ReleaseError;
use std::collections::HashSet;

/// Validate and normalize a single web origin.
///
/// Must be an exact HTTP or HTTPS origin with no userinfo, path, query,
/// fragment, or wildcard.
pub fn validate_web_origin(origin: &str) -> Result<String, ReleaseError> {
    let trimmed = origin.trim();
    if trimmed.is_empty() {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "origin cannot be empty",
        });
    }

    if trimmed.contains('*') {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "wildcard origin is forbidden",
        });
    }

    let (scheme, rest) = if let Some(stripped) = trimmed.strip_prefix("https://") {
        ("https", stripped)
    } else if let Some(stripped) = trimmed.strip_prefix("http://") {
        ("http", stripped)
    } else {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "scheme must be http:// or https://",
        });
    };

    if rest.is_empty() {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "missing host",
        });
    }

    if rest.contains('@') {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "userinfo (username/password) is forbidden",
        });
    }

    if rest.contains('?') || rest.contains('#') {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "query parameters and fragments are forbidden in origins",
        });
    }

    let (host_port, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };

    if !path.is_empty() && path != "/" {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "path components are forbidden in origins",
        });
    }

    if host_port.is_empty() {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "host cannot be empty",
        });
    }

    let (host, port) = if let Some((h, p)) = host_port.split_once(':') {
        if p.is_empty() {
            return Err(ReleaseError::InvalidWebOrigin {
                origin: origin.to_string(),
                reason: "port cannot be empty when ':' is present",
            });
        }
        if p.parse::<u16>().is_err() {
            return Err(ReleaseError::InvalidWebOrigin {
                origin: origin.to_string(),
                reason: "invalid port number",
            });
        }
        (h, Some(p))
    } else {
        (host_port, None)
    };

    if host.is_empty() {
        return Err(ReleaseError::InvalidWebOrigin {
            origin: origin.to_string(),
            reason: "host cannot be empty",
        });
    }

    let normalized = match port {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    };

    Ok(normalized)
}

/// Validate a list of origins and ensure no duplicates.
pub fn validate_web_origins(origins: &[String]) -> Result<Vec<String>, ReleaseError> {
    let mut normalized_list = Vec::with_capacity(origins.len());
    let mut seen = HashSet::new();

    for origin in origins {
        let normalized = validate_web_origin(origin)?;
        if !seen.insert(normalized.clone()) {
            return Err(ReleaseError::DuplicateWebOrigin(normalized));
        }
        normalized_list.push(normalized);
    }

    Ok(normalized_list)
}
