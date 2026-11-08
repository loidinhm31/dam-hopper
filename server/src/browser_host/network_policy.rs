use std::fmt;
use std::net::IpAddr;
use url::Url;

pub const MAX_URL_BYTES: usize = 4096;
pub const MAX_TITLE_BYTES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetworkPolicyError {
    EmptyUrl,
    UrlTooLong { length: usize, max: usize },
    InvalidUrl(String),
    UnsupportedScheme(String),
    CredentialsNotAllowed,
    MissingHost,
    DeniedDestination(String),
    DevOriginNotAllowed(String),
}

impl fmt::Display for NetworkPolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyUrl => write!(f, "url cannot be empty"),
            Self::UrlTooLong { length, max } => {
                write!(f, "url length {length} exceeds maximum {max} bytes")
            }
            Self::InvalidUrl(err) => write!(f, "invalid url: {err}"),
            Self::UnsupportedScheme(scheme) => {
                write!(
                    f,
                    "unsupported scheme '{scheme}': only http, https, and about:blank are allowed"
                )
            }
            Self::CredentialsNotAllowed => {
                write!(f, "credentials in url are strictly forbidden")
            }
            Self::MissingHost => write!(f, "url must include a valid host"),
            Self::DeniedDestination(dest) => {
                write!(f, "access to destination '{dest}' is denied by network policy")
            }
            Self::DevOriginNotAllowed(origin) => {
                write!(
                    f,
                    "origin '{origin}' is not in the development allowlist"
                )
            }
        }
    }
}

impl std::error::Error for NetworkPolicyError {}

/// Check if an IP address is a private, loopback, link-local, or cloud metadata address.
pub fn is_private_or_metadata_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_documentation()
                || ipv4.octets() == [169, 254, 169, 254] // AWS/OpenStack/Azure metadata
                || ipv4.octets() == [100, 100, 100, 200] // Alibaba Cloud metadata
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00 // Unique local address fc00::/7
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80 // Link-local fe80::/10
        }
    }
}

/// Evaluates a URL against navigation and HTTP request policy.
///
/// In production:
/// - Only http and https (and about:blank) are permitted.
/// - Credentials in URL are strictly rejected.
/// - Cloud metadata endpoints and private IP ranges are blocked unless matching
///   explicit project origin exceptions.
///
/// In development:
/// - Only explicit target + asset origins (loopback, localhost, and configured origins)
///   are allowed; general internet is blocked.
pub fn validate_navigation_url(
    raw_url: &str,
    is_dev: bool,
    allowed_origins: &[String],
) -> Result<Url, NetworkPolicyError> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err(NetworkPolicyError::EmptyUrl);
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err(NetworkPolicyError::UrlTooLong {
            length: trimmed.len(),
            max: MAX_URL_BYTES,
        });
    }

    if trimmed == "about:blank" {
        return Url::parse("about:blank")
            .map_err(|e| NetworkPolicyError::InvalidUrl(e.to_string()));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|e| NetworkPolicyError::InvalidUrl(e.to_string()))?;

    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(NetworkPolicyError::UnsupportedScheme(scheme.to_string()));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(NetworkPolicyError::CredentialsNotAllowed);
    }

    let host_str = parsed.host_str().ok_or(NetworkPolicyError::MissingHost)?;
    let origin_str = format!(
        "{}://{}{}",
        parsed.scheme(),
        host_str,
        parsed.port().map(|p| format!(":{p}")).unwrap_or_default()
    );

    // Check if origin matches an explicit allowed project origin
    let is_allowed_project_origin = allowed_origins.iter().any(|allowed| {
        let allowed_trimmed = allowed.trim_end_matches('/');
        origin_str.eq_ignore_ascii_case(allowed_trimmed)
            || host_str.eq_ignore_ascii_case(allowed_trimmed)
    });

    if is_dev {
        // Development mode: only explicit loopback/localhost or allowed origins are permitted
        let is_dev_loopback = host_str.eq_ignore_ascii_case("localhost")
            || host_str.eq_ignore_ascii_case("127.0.0.1")
            || host_str == "::1"
            || host_str == "[::1]";

        if !is_dev_loopback && !is_allowed_project_origin {
            return Err(NetworkPolicyError::DevOriginNotAllowed(origin_str));
        }

        return Ok(parsed);
    }

    // Production mode:
    // Reject localhost hostname in production unless explicitly allowed as project origin
    if host_str.eq_ignore_ascii_case("localhost") && !is_allowed_project_origin {
        return Err(NetworkPolicyError::DeniedDestination(host_str.to_string()));
    }

    // Check known metadata hostnames
    if host_str.eq_ignore_ascii_case("metadata.google.internal")
        || host_str.eq_ignore_ascii_case("169.254.169.254")
        || host_str.eq_ignore_ascii_case("instance-data")
    {
        return Err(NetworkPolicyError::DeniedDestination(host_str.to_string()));
    }

    // Parse host as IP address if applicable (stripping optional IPv6 brackets)
    let unbracketed_host = host_str.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = unbracketed_host.parse::<IpAddr>() {
        if is_private_or_metadata_ip(ip) && !is_allowed_project_origin {
            return Err(NetworkPolicyError::DeniedDestination(format!("{ip} (private/metadata IP)")));
        }
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_about_blank_allowed() {
        assert!(validate_navigation_url("about:blank", false, &[]).is_ok());
        assert!(validate_navigation_url("about:blank", true, &[]).is_ok());
    }

    #[test]
    fn test_forbidden_schemes() {
        let bad_schemes = [
            "about:version",
            "file:///etc/passwd",
            "data:text/html,<h1>Hello</h1>",
            "javascript:alert(1)",
            "chrome://settings",
            "devtools://devtools",
        ];
        for s in bad_schemes {
            assert!(validate_navigation_url(s, false, &[]).is_err());
            assert!(validate_navigation_url(s, true, &[]).is_err());
        }
    }

    #[test]
    fn test_credentials_in_url_rejected() {
        let urls = [
            "http://user:pass@example.com/",
            "https://admin@example.com/dashboard",
        ];
        for u in urls {
            assert_eq!(
                validate_navigation_url(u, false, &[]),
                Err(NetworkPolicyError::CredentialsNotAllowed)
            );
        }
    }

    #[test]
    fn test_dev_mode_allowlist() {
        let allowed = vec!["http://127.0.0.1:5173".to_string()];
        // Loopback and localhost allowed
        assert!(validate_navigation_url("http://127.0.0.1:8080/app", true, &allowed).is_ok());
        assert!(validate_navigation_url("http://localhost:3000/", true, &allowed).is_ok());
        assert!(validate_navigation_url("http://127.0.0.1:5173/vite", true, &allowed).is_ok());

        // External internet denied in dev mode unless in allowed origins
        assert!(validate_navigation_url("https://example.com/", true, &allowed).is_err());
    }

    #[test]
    fn test_production_metadata_and_private_denial() {
        // Metadata denied
        assert!(validate_navigation_url("http://169.254.169.254/latest/meta-data/", false, &[]).is_err());
        assert!(validate_navigation_url("http://metadata.google.internal/computeMetadata/v1/", false, &[]).is_err());

        // Private IPs denied by default in prod
        assert!(validate_navigation_url("http://10.0.0.5:8080/", false, &[]).is_err());
        assert!(validate_navigation_url("http://192.168.1.1/", false, &[]).is_err());
        assert!(validate_navigation_url("http://127.0.0.1:3000/", false, &[]).is_err());
        assert!(validate_navigation_url("http://localhost:3000/", false, &[]).is_err());
        assert!(validate_navigation_url("http://[::1]:3000/", false, &[]).is_err());
        // Explicit project origin allowed
        let project_origins = vec!["http://127.0.0.1:3000".to_string(), "http://10.0.0.5:8080".to_string()];
        assert!(validate_navigation_url("http://127.0.0.1:3000/app", false, &project_origins).is_ok());
        assert!(validate_navigation_url("http://10.0.0.5:8080/api", false, &project_origins).is_ok());

        // Public internet allowed in prod
        assert!(validate_navigation_url("https://example.com/page", false, &[]).is_ok());
    }
}
