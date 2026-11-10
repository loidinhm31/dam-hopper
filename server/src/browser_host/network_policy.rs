use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use super::config::{BrowserHostConfig, DEFAULT_DENIED_DESTINATIONS};

pub const MAX_URL_BYTES: usize = 4096;
pub const MAX_TITLE_BYTES: usize = 512;

/// Cloud metadata hostnames denied in every mode, independent of operator configuration.
const METADATA_HOSTNAMES: &[&str] = &["metadata.google.internal", "instance-data"];

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
    InvalidConfiguration(String),
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
                write!(
                    f,
                    "access to destination '{dest}' is denied by network policy"
                )
            }
            Self::DevOriginNotAllowed(origin) => {
                write!(
                    f,
                    "origin '{origin}' is not in the configured target/asset origins"
                )
            }
            Self::InvalidConfiguration(reason) => {
                write!(f, "invalid browser network policy configuration: {reason}")
            }
        }
    }
}

impl std::error::Error for NetworkPolicyError {}

/// Whether a request is a top-level/frame navigation or a subresource fetch.
///
/// Navigations may only reach target origins; subresources may additionally reach
/// configured asset origins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
    Navigation,
    Subresource,
}

/// One configured denied destination: IP, CIDR, hostname, optionally with a port.
#[derive(Debug, Clone, PartialEq, Eq)]
enum DeniedDestination {
    Ip { ip: IpAddr, port: Option<u16> },
    Cidr { network: IpAddr, prefix: u8 },
    Host { name: String, port: Option<u16> },
}

impl DeniedDestination {
    fn parse(raw: &str) -> Result<Self, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("destination cannot be empty".to_string());
        }
        if let Ok(ip) = trimmed.parse::<IpAddr>() {
            return Ok(Self::Ip {
                ip: canonical_ip(ip),
                port: None,
            });
        }
        if let Some((net, len)) = trimmed.split_once('/') {
            let network: IpAddr = net
                .parse()
                .map_err(|_| format!("invalid CIDR '{trimmed}'"))?;
            let prefix: u8 = len
                .parse()
                .map_err(|_| format!("invalid CIDR '{trimmed}'"))?;
            let max = if network.is_ipv4() { 32 } else { 128 };
            if prefix > max {
                return Err(format!("CIDR prefix too long in '{trimmed}'"));
            }
            return Ok(Self::Cidr { network, prefix });
        }
        let (host, port) = if let Some(rest) = trimmed.strip_prefix('[') {
            let (inner, tail) = rest
                .split_once(']')
                .ok_or_else(|| format!("unterminated IPv6 literal '{trimmed}'"))?;
            let port = match tail {
                "" => None,
                t => {
                    Some(parse_port(t.strip_prefix(':').ok_or_else(|| {
                        format!("invalid destination '{trimmed}'")
                    })?)?)
                }
            };
            (inner, port)
        } else if let Some((h, p)) = trimmed.split_once(':') {
            (h, Some(parse_port(p)?))
        } else {
            (trimmed, None)
        };
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(Self::Ip {
                ip: canonical_ip(ip),
                port,
            });
        }
        let name = normalize_hostname(host);
        if name.is_empty() {
            return Err(format!("invalid destination '{trimmed}'"));
        }
        Ok(Self::Host { name, port })
    }

    fn matches(&self, host: &Host<&str>, port: Option<u16>) -> bool {
        match self {
            Self::Ip { ip, port: want } => {
                host_ip(host).is_some_and(|actual| actual == *ip)
                    && want.is_none_or(|p| Some(p) == port)
            }
            Self::Cidr { network, prefix } => {
                host_ip(host).is_some_and(|actual| cidr_contains(*network, *prefix, actual))
            }
            Self::Host { name, port: want } => {
                matches!(host, Host::Domain(d) if normalize_hostname(d) == *name)
                    && want.is_none_or(|p| Some(p) == port)
            }
        }
    }
}

fn parse_port(raw: &str) -> Result<u16, String> {
    raw.parse::<u16>()
        .map_err(|_| format!("invalid port '{raw}'"))
}

fn normalize_hostname(host: &str) -> String {
    host.trim().trim_end_matches('.').to_ascii_lowercase()
}

/// IPv4-mapped IPv6 addresses are policy-equivalent to the embedded IPv4 address.
fn canonical_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

fn host_ip(host: &Host<&str>) -> Option<IpAddr> {
    match host {
        Host::Ipv4(v4) => Some(IpAddr::V4(*v4)),
        Host::Ipv6(v6) => Some(canonical_ip(IpAddr::V6(*v6))),
        Host::Domain(_) => None,
    }
}

fn cidr_contains(network: IpAddr, prefix: u8, ip: IpAddr) -> bool {
    match (canonical_ip(network), ip) {
        (IpAddr::V4(net), IpAddr::V4(addr)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - u32::from(prefix.min(32)))
            };
            u32::from(net) & mask == u32::from(addr) & mask
        }
        (IpAddr::V6(net), IpAddr::V6(addr)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - u32::from(prefix.min(128)))
            };
            u128::from(net) & mask == u128::from(addr) & mask
        }
        _ => false,
    }
}

/// Check if an IP address is a private, loopback, link-local, unspecified, or cloud metadata address.
pub fn is_private_or_metadata_ip(ip: IpAddr) -> bool {
    match canonical_ip(ip) {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_documentation()
                || ipv4.is_unspecified()
                || ipv4 == Ipv4Addr::new(100, 100, 100, 200) // Alibaba Cloud metadata
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00 // Unique local address fc00::/7
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80 // Link-local fe80::/10
        }
    }
}

fn is_local_hostname(name: &str) -> bool {
    name == "localhost" || name.ends_with(".localhost")
}

fn is_metadata_destination(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(d) => {
            let name = normalize_hostname(d);
            METADATA_HOSTNAMES.contains(&name.as_str())
        }
        Host::Ipv4(v4) => *v4 == Ipv4Addr::new(169, 254, 169, 254),
        Host::Ipv6(v6) => {
            canonical_ip(IpAddr::V6(*v6)) == IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))
                || *v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)
        }
    }
}

/// Central Browser request policy built from the Browser host configuration.
///
/// One instance gates REST navigation (`validate_navigation`) and the browser-owned CDP
/// Fetch interceptor, including frames, worker scripts/fetches, redirects and subresources
/// (`check_request`). Target and asset origins come from `allowed_target_origins` and
/// `allowed_asset_origins`; web-UI/CORS origins are never request-policy inputs.
///
/// Caveat (unchanged contract): raw CDP and Admin authority are trusted, and WebSocket,
/// WebRTC and DNS resolution are not covered, so this is not an egress sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkPolicy {
    is_dev: bool,
    target_origins: Vec<String>,
    asset_origins: Vec<String>,
    denied: Vec<DeniedDestination>,
}

impl NetworkPolicy {
    /// Builds the policy from Browser config. Invalid origin or destination entries fail
    /// closed with an error instead of being skipped.
    pub fn from_config(
        config: &BrowserHostConfig,
        is_dev: bool,
    ) -> Result<Self, NetworkPolicyError> {
        Self::new(
            is_dev,
            &config.allowed_target_origins,
            &config.allowed_asset_origins,
            &config.denied_destinations,
        )
    }

    fn new(
        is_dev: bool,
        target_origins: &[String],
        asset_origins: &[String],
        denied_destinations: &[String],
    ) -> Result<Self, NetworkPolicyError> {
        let normalize = |list: &[String]| -> Result<Vec<String>, NetworkPolicyError> {
            list.iter().map(|o| normalize_origin(o)).collect()
        };
        let denied = DEFAULT_DENIED_DESTINATIONS
            .iter()
            .map(|d| (*d).to_string())
            .chain(denied_destinations.iter().cloned())
            .map(|d| DeniedDestination::parse(&d).map_err(NetworkPolicyError::InvalidConfiguration))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            is_dev,
            target_origins: normalize(target_origins)?,
            asset_origins: normalize(asset_origins)?,
            denied,
        })
    }

    /// Validates a navigation URL (REST create/navigate).
    pub fn validate_navigation(&self, raw_url: &str) -> Result<Url, NetworkPolicyError> {
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
        let parsed =
            Url::parse(trimmed).map_err(|e| NetworkPolicyError::InvalidUrl(e.to_string()))?;
        match parsed.scheme() {
            "http" | "https" => {}
            scheme => return Err(NetworkPolicyError::UnsupportedScheme(scheme.to_string())),
        }
        self.evaluate_network_url(&parsed, RequestKind::Navigation)?;
        Ok(parsed)
    }

    /// Evaluates one browser-initiated request observed by the Fetch interceptor.
    ///
    /// Network schemes follow the navigation/subresource origin rules. Schemes that never
    /// leave the browser (`data:`, `blob:`, `about:`) are allowed for subresources only; every
    /// other scheme (`file:`, `ftp:`, extensions, ...) is denied.
    pub fn check_request(
        &self,
        raw_url: &str,
        kind: RequestKind,
    ) -> Result<(), NetworkPolicyError> {
        if raw_url.len() > MAX_URL_BYTES {
            return Err(NetworkPolicyError::UrlTooLong {
                length: raw_url.len(),
                max: MAX_URL_BYTES,
            });
        }
        let parsed =
            Url::parse(raw_url).map_err(|e| NetworkPolicyError::InvalidUrl(e.to_string()))?;
        match parsed.scheme() {
            "http" | "https" => self.evaluate_network_url(&parsed, kind),
            "data" | "blob" | "about" if kind == RequestKind::Subresource => Ok(()),
            "about" if raw_url == "about:blank" || raw_url == "about:srcdoc" => Ok(()),
            scheme => Err(NetworkPolicyError::UnsupportedScheme(scheme.to_string())),
        }
    }

    fn evaluate_network_url(
        &self,
        parsed: &Url,
        kind: RequestKind,
    ) -> Result<(), NetworkPolicyError> {
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(NetworkPolicyError::CredentialsNotAllowed);
        }
        let host = parsed.host().ok_or(NetworkPolicyError::MissingHost)?;
        let port = parsed.port_or_known_default();
        let origin = parsed.origin().ascii_serialization();

        // Explicit deny always wins, including over a configured project origin.
        if is_metadata_destination(&host) || self.denied.iter().any(|d| d.matches(&host, port)) {
            return Err(NetworkPolicyError::DeniedDestination(destination_label(
                &host,
            )));
        }

        let allowed_origin = self.target_origins.contains(&origin)
            || (kind == RequestKind::Subresource && self.asset_origins.contains(&origin));
        if allowed_origin {
            return Ok(());
        }

        // Public internet is allowed in both production and development; local/private/metadata
        // destinations need an explicit project origin.
        match &host {
            Host::Domain(d) if is_local_hostname(&normalize_hostname(d)) => {
                if self.is_dev {
                    Err(NetworkPolicyError::DevOriginNotAllowed(origin))
                } else {
                    Err(NetworkPolicyError::DeniedDestination(destination_label(&host)))
                }
            }
            Host::Domain(_) => Ok(()),
            ip_host => match host_ip(ip_host) {
                Some(ip) if is_private_or_metadata_ip(ip) => {
                    if self.is_dev {
                        Err(NetworkPolicyError::DevOriginNotAllowed(origin))
                    } else {
                        Err(NetworkPolicyError::DeniedDestination(format!(
                            "{ip} (private/metadata IP)"
                        )))
                    }
                }
                _ => Ok(()),
            },
        }
    }
}

fn destination_label(host: &Host<&str>) -> String {
    match host {
        Host::Domain(d) => (*d).to_string(),
        Host::Ipv4(v4) => v4.to_string(),
        Host::Ipv6(v6) => v6.to_string(),
    }
}

/// Parses a configured origin into its canonical `scheme://host[:port]` serialization.
fn normalize_origin(raw: &str) -> Result<String, NetworkPolicyError> {
    BrowserHostConfig::validate_origin(raw).map_err(NetworkPolicyError::InvalidConfiguration)?;
    let url = Url::parse(raw.trim())
        .map_err(|e| NetworkPolicyError::InvalidConfiguration(e.to_string()))?;
    Ok(url.origin().ascii_serialization())
}

/// Evaluates a navigation URL against the target-origin policy with only the built-in
/// metadata denials (no asset origins, default denied destinations).
///
/// Public internet destinations are permitted in both production and development; only
/// explicitly allowed origins may reach loopback/private destinations, and there is no
/// implicit localhost/loopback permission. Callers holding the Browser config should build a
/// [`NetworkPolicy`] with [`NetworkPolicy::from_config`] to include denied destinations and
/// asset origins.
pub fn validate_navigation_url(
    raw_url: &str,
    is_dev: bool,
    allowed_origins: &[String],
) -> Result<Url, NetworkPolicyError> {
    // Origins that cannot be normalized can never match a request, so they only fail closed.
    let targets: Vec<String> = allowed_origins
        .iter()
        .filter_map(|o| normalize_origin(o).ok())
        .collect();
    let policy = NetworkPolicy::new(is_dev, &targets, &[], &[])?;
    policy.validate_navigation(raw_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(targets: &[&str], assets: &[&str], denied: &[&str]) -> NetworkPolicy {
        let to_vec = |s: &[&str]| s.iter().map(|v| (*v).to_string()).collect::<Vec<_>>();
        NetworkPolicy::new(true, &to_vec(targets), &to_vec(assets), &to_vec(denied)).unwrap()
    }

    fn prod(targets: &[&str], denied: &[&str]) -> NetworkPolicy {
        let to_vec = |s: &[&str]| s.iter().map(|v| (*v).to_string()).collect::<Vec<_>>();
        NetworkPolicy::new(false, &to_vec(targets), &[], &to_vec(denied)).unwrap()
    }

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
    fn test_dev_has_no_implicit_loopback_permission() {
        let allowed = vec!["http://127.0.0.1:5173".to_string()];
        assert!(validate_navigation_url("http://127.0.0.1:5173/vite", true, &allowed).is_ok());
        // Unlisted loopback ports and localhost are NOT implicitly allowed in development.
        assert!(validate_navigation_url("http://127.0.0.1:8080/app", true, &allowed).is_err());
        assert!(validate_navigation_url("http://localhost:3000/", true, &allowed).is_err());
        assert!(validate_navigation_url("http://localhost:5173/", true, &allowed).is_err());
        assert!(validate_navigation_url("https://example.com/", true, &allowed).is_ok());
        // With no configuration nothing but about:blank is reachable.
        assert!(validate_navigation_url("http://127.0.0.1:5173/", true, &[]).is_err());
    }

    #[test]
    fn test_production_metadata_and_private_denial() {
        assert!(
            validate_navigation_url("http://169.254.169.254/latest/meta-data/", false, &[])
                .is_err()
        );
        assert!(validate_navigation_url(
            "http://metadata.google.internal/computeMetadata/v1/",
            false,
            &[]
        )
        .is_err());
        assert!(validate_navigation_url("http://10.0.0.5:8080/", false, &[]).is_err());
        assert!(validate_navigation_url("http://192.168.1.1/", false, &[]).is_err());
        assert!(validate_navigation_url("http://127.0.0.1:3000/", false, &[]).is_err());
        assert!(validate_navigation_url("http://localhost:3000/", false, &[]).is_err());
        assert!(validate_navigation_url("http://[::1]:3000/", false, &[]).is_err());
        // Alternate numeric spellings normalize to the same denied IP.
        assert!(validate_navigation_url("http://2852039166/", false, &[]).is_err());
        assert!(validate_navigation_url("http://[::ffff:127.0.0.1]/", false, &[]).is_err());
        // Explicit project origin allowed
        let project_origins = vec![
            "http://127.0.0.1:3000".to_string(),
            "http://10.0.0.5:8080".to_string(),
        ];
        assert!(
            validate_navigation_url("http://127.0.0.1:3000/app", false, &project_origins).is_ok()
        );
        assert!(
            validate_navigation_url("http://10.0.0.5:8080/api", false, &project_origins).is_ok()
        );
        // Another port on the same host stays denied.
        assert!(
            validate_navigation_url("http://127.0.0.1:3001/app", false, &project_origins).is_err()
        );
        assert!(validate_navigation_url("https://example.com/page", false, &[]).is_ok());
    }

    #[test]
    fn test_metadata_denied_even_for_configured_origin() {
        let origins = vec!["http://169.254.169.254".to_string()];
        assert!(validate_navigation_url("http://169.254.169.254/", false, &origins).is_err());
        assert!(validate_navigation_url("http://169.254.169.254/", true, &origins).is_err());
    }

    #[test]
    fn test_configured_denied_destinations() {
        let policy = prod(
            &[],
            &[
                "203.0.113.0/24",
                "internal.example:8443",
                "[2001:db8::1]:9000",
            ],
        );
        assert!(policy
            .check_request("https://example.com/", RequestKind::Navigation)
            .is_ok());
        assert!(policy
            .check_request("http://203.0.113.9/", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("https://internal.example:8443/x", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("https://internal.example/x", RequestKind::Subresource)
            .is_ok());
        assert!(policy
            .check_request("http://[2001:db8::1]:9000/", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("http://[2001:db8::1]:9001/", RequestKind::Subresource)
            .is_ok());
        // Explicit deny wins over a configured project origin.
        let deny_over_allow = prod(&["http://203.0.113.9"], &["203.0.113.0/24"]);
        assert!(deny_over_allow
            .check_request("http://203.0.113.9/", RequestKind::Navigation)
            .is_err());
    }

    #[test]
    fn test_dev_request_policy_target_asset_split() {
        let policy = dev(&["http://127.0.0.1:3000"], &["http://127.0.0.1:3001"], &[]);
        assert!(policy
            .check_request("http://127.0.0.1:3000/a", RequestKind::Navigation)
            .is_ok());
        assert!(policy
            .check_request("http://127.0.0.1:3000/a.png", RequestKind::Subresource)
            .is_ok());
        assert!(policy
            .check_request("http://127.0.0.1:3001/a.png", RequestKind::Subresource)
            .is_ok());
        // Asset origins are not navigation targets.
        assert!(policy
            .check_request("http://127.0.0.1:3001/", RequestKind::Navigation)
            .is_err());
        assert!(policy
            .check_request("http://127.0.0.1:3002/", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("http://169.254.169.254/", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("data:image/png;base64,AAAA", RequestKind::Subresource)
            .is_ok());
        assert!(policy
            .check_request("data:text/html,x", RequestKind::Navigation)
            .is_err());
        assert!(policy
            .check_request("file:///etc/passwd", RequestKind::Subresource)
            .is_err());
        assert!(policy
            .check_request("ftp://127.0.0.1/", RequestKind::Subresource)
            .is_err());
    }

    #[test]
    fn test_invalid_configuration_fails_closed() {
        let bad_origin = NetworkPolicy::new(true, &["not an origin".to_string()], &[], &[]);
        assert!(matches!(
            bad_origin,
            Err(NetworkPolicyError::InvalidConfiguration(_))
        ));
        let bad_dest = NetworkPolicy::new(true, &[], &[], &["999.1.1.1/99".to_string()]);
        assert!(matches!(
            bad_dest,
            Err(NetworkPolicyError::InvalidConfiguration(_))
        ));
    }
}
