use std::collections::BTreeSet;

use url::Url;

/// URLs accepted by the native browser target. The policy intentionally works
/// on parsed URL components and canonical origins; it never uses prefixes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NavigationPolicy {
    tunnel_origins: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NavigationDecision {
    Allow,
    Reject(NavigationRejection),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NavigationRejection {
    InvalidScheme,
    Credentials,
    MissingHost,
    UnapprovedOrigin,
}

impl NavigationPolicy {
    pub fn new<I, S>(tunnel_origins: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut approved = BTreeSet::new();
        for raw_origin in tunnel_origins {
            let url = Url::parse(raw_origin.as_ref().trim())
                .map_err(|_| "invalid tunnel origin".to_string())?;
            if url.username().is_empty() == false
                || url.password().is_some()
                || url.scheme() != "https"
                || url.host_str().is_none()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err("tunnel origins must be credential-free HTTPS origins".into());
            }
            approved.insert(canonical_origin(&url)?);
        }
        Ok(Self {
            tunnel_origins: approved,
        })
    }

    pub fn check(&self, url: &Url) -> NavigationDecision {
        if url.username().is_empty() == false || url.password().is_some() {
            return NavigationDecision::Reject(NavigationRejection::Credentials);
        }
        if url.scheme() != "http" && url.scheme() != "https" {
            return NavigationDecision::Reject(NavigationRejection::InvalidScheme);
        }
        let Some(host) = url.host_str() else {
            return NavigationDecision::Reject(NavigationRejection::MissingHost);
        };

        if url.scheme() == "http" && is_loopback_host(host) {
            return NavigationDecision::Allow;
        }

        match canonical_origin(url) {
            Ok(origin) if self.tunnel_origins.contains(&origin) => NavigationDecision::Allow,
            _ => NavigationDecision::Reject(NavigationRejection::UnapprovedOrigin),
        }
    }

    pub fn allows(&self, url: &Url) -> bool {
        self.check(url) == NavigationDecision::Allow
    }

    pub fn origin_for(url: &Url) -> Option<String> {
        canonical_origin(url).ok()
    }

    #[cfg(test)]
    fn tunnel_origins(&self) -> &BTreeSet<String> {
        &self.tunnel_origins
    }
}

pub fn parse_target_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "invalid target URL".to_string())?;
    if url.username().is_empty() == false || url.password().is_some() {
        return Err("target URLs cannot contain credentials".into());
    }
    Ok(url)
}

fn is_loopback_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "[::1]"
    )
}

fn canonical_origin(url: &Url) -> Result<String, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_ascii_lowercase()
    };
    let default_port = match url.scheme() {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    };
    let port = url.port().filter(|port| Some(*port) != default_port);
    Ok(match port {
        Some(port) => format!("{}://{host}:{port}", url.scheme().to_ascii_lowercase()),
        None => format!("{}://{host}", url.scheme().to_ascii_lowercase()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> NavigationPolicy {
        NavigationPolicy::new(["https://demo.trycloudflare.com/"]).unwrap()
    }

    #[test]
    fn allows_loopback_and_exact_tunnel_origins() {
        let policy = policy();
        assert!(policy.allows(&Url::parse("http://localhost:3000/path").unwrap()));
        assert!(policy.allows(&Url::parse("http://127.0.0.1:5173/").unwrap()));
        assert!(policy.allows(&Url::parse("https://demo.trycloudflare.com/app").unwrap()));
        assert!(!policy.allows(&Url::parse("https://demo.trycloudflare.com.evil/").unwrap()));
        assert_eq!(policy.tunnel_origins().len(), 1);
    }

    #[test]
    fn rejects_credentials_unsafe_schemes_and_unapproved_hosts() {
        let policy = policy();
        assert_eq!(
            policy.check(&Url::parse("http://user:pass@localhost:3000/").unwrap()),
            NavigationDecision::Reject(NavigationRejection::Credentials)
        );
        assert_eq!(
            policy.check(&Url::parse("file:///tmp/page.html").unwrap()),
            NavigationDecision::Reject(NavigationRejection::InvalidScheme)
        );
        assert_eq!(
            policy.check(&Url::parse("https://example.com/").unwrap()),
            NavigationDecision::Reject(NavigationRejection::UnapprovedOrigin)
        );
        assert_eq!(
            policy.check(&Url::parse("http://example.com/").unwrap()),
            NavigationDecision::Reject(NavigationRejection::UnapprovedOrigin)
        );
    }

    #[test]
    fn rejects_malformed_tunnel_origins_and_non_origin_urls() {
        assert!(NavigationPolicy::new(["https://demo.trycloudflare.com/path"]).is_err());
        assert!(NavigationPolicy::new(["https://demo.trycloudflare.com/?token=secret"]).is_err());
        assert!(NavigationPolicy::new(["https://user@demo.trycloudflare.com/"]).is_err());
        assert!(parse_target_url("https://user:secret@example.com/").is_err());
    }

    #[test]
    fn canonicalizes_default_ports_and_ipv6_loopback() {
        let policy = NavigationPolicy::new(["https://demo.trycloudflare.com:443/"]).unwrap();
        assert!(policy.allows(&Url::parse("https://demo.trycloudflare.com/app").unwrap()));
        assert!(policy.allows(&Url::parse("http://[::1]:3000/").unwrap()));
    }
}
