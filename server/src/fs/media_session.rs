use std::{fmt, time::Duration};

use axum::http::{header::COOKIE, HeaderMap, HeaderValue};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

pub(crate) const MEDIA_SESSION_COOKIE_PREFIX: &str = "damhopper-media-session-";
pub(crate) const MEDIA_SESSION_PATH: &str = "/api/fs";
pub(crate) const MEDIA_SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
pub(crate) const MEDIA_SESSION_ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 60 * 60);

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct MediaClientId(String);

impl MediaClientId {
    pub fn parse(value: &str) -> Option<Self> {
        let parsed = Uuid::parse_str(value).ok()?;
        if parsed.get_version() != Some(uuid::Version::Random) {
            return None;
        }
        Some(Self(parsed.hyphenated().to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for MediaClientId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        MediaClientId::parse(&s)
            .ok_or_else(|| serde::de::Error::custom("invalid mediaClientId: must be a valid UUIDv4"))
    }
}

impl Serialize for MediaClientId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}
/// Opaque, cookie-only media session token. Its value is intentionally redacted in Debug output.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct MediaSessionToken(String);

impl fmt::Debug for MediaSessionToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MediaSessionToken([redacted])")
    }
}
impl MediaSessionToken {
    pub(crate) fn new() -> Self {
        let mut bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut bytes);
        Self(URL_SAFE_NO_PAD.encode(bytes))
    }

    pub(crate) fn from_cookie_value(value: &str) -> Option<Self> {
        let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
        (bytes.len() == 32).then(|| Self(value.to_owned()))
    }

    pub(crate) fn digest(&self) -> MediaSessionDigest {
        MediaSessionDigest(Sha256::digest(self.0.as_bytes()).into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub(crate) struct MediaSessionDigest([u8; 32]);

impl MediaSessionDigest {
    pub(crate) fn matches(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl fmt::Debug for MediaSessionDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MediaSessionDigest([redacted])")
    }
}

/// Server-side ticket binding. Its digest is intentionally redacted in Debug output.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct MediaSessionBinding {
    pub(crate) actor_subject: String,
    pub(crate) client_id: MediaClientId,
    pub(crate) session_digest: MediaSessionDigest,
}

impl fmt::Debug for MediaSessionBinding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MediaSessionBinding")
            .field("actor_subject", &self.actor_subject)
            .field("client_id", &self.client_id.as_str())
            .field("session_digest", &self.session_digest)
            .finish()
    }
}

/// Cookie-bearing lease. Do not log or serialize it.
#[derive(Clone)]
pub(crate) struct MediaSessionLease {
    pub(crate) token: MediaSessionToken,
    pub(crate) binding: MediaSessionBinding,
}

pub(crate) fn media_session_cookie_name(client_id: &MediaClientId) -> String {
    format!("{MEDIA_SESSION_COOKIE_PREFIX}{}", client_id.as_str())
}

pub(crate) fn media_session_cookie(lease: &MediaSessionLease) -> HeaderValue {
    cookie_header(
        &media_session_cookie_name(&lease.binding.client_id),
        lease.token.as_str(),
        MEDIA_SESSION_ABSOLUTE_TTL.as_secs(),
    )
}

pub(crate) fn clear_media_session_cookie(client_id: &MediaClientId) -> HeaderValue {
    cookie_header(&media_session_cookie_name(client_id), "", 0)
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum HeaderCookieParseResult {
    Found(MediaSessionToken),
    None,
    Duplicate,
}

pub(crate) fn media_session_from_headers_for_client(
    headers: &HeaderMap,
    client_id: &MediaClientId,
) -> HeaderCookieParseResult {
    let expected_name = media_session_cookie_name(client_id);
    let mut found: Option<&str> = None;
    for header in headers.get_all(COOKIE) {
        let Ok(raw_cookie) = header.to_str() else {
            continue;
        };
        for part in raw_cookie.split(';') {
            let Some((name, value)) = part.trim().split_once('=') else {
                continue;
            };
            if name == expected_name {
                if found.is_some() {
                    return HeaderCookieParseResult::Duplicate;
                }
                found = Some(value);
            }
        }
    }
    match found {
        Some(val) => {
            if let Some(token) = MediaSessionToken::from_cookie_value(val) {
                HeaderCookieParseResult::Found(token)
            } else {
                HeaderCookieParseResult::None
            }
        }
        None => HeaderCookieParseResult::None,
    }
}

fn cookie_header(name: &str, value: &str, max_age: u64) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{name}={value}; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age={max_age}"
    ))
    .expect("generated media session cookie must be valid")
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::*;

    #[test]
    fn token_is_random_digest_only_and_cookie_attributes_are_exact() {
        let first = MediaSessionToken::new();
        let second = MediaSessionToken::new();
        assert_ne!(first.as_str(), second.as_str());
        assert_eq!(first.as_str().len(), 43);
        assert_ne!(first.digest(), second.digest());

        let client_id = MediaClientId::parse("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d").unwrap();
        let lease = MediaSessionLease {
            binding: MediaSessionBinding {
                actor_subject: "actor".into(),
                client_id: client_id.clone(),
                session_digest: first.digest(),
            },
            token: first,
        };
        assert!(!format!("{:?}", lease.binding).contains(lease.token.as_str()));
        let cookie_name = format!("{MEDIA_SESSION_COOKIE_PREFIX}9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
        assert_eq!(
            media_session_cookie(&lease),
            format!(
                "{cookie_name}={}; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age=28800",
                lease.token.as_str()
            )
        );
        assert_eq!(
            clear_media_session_cookie(&client_id),
            format!("{cookie_name}=; HttpOnly; SameSite=Lax; Path={MEDIA_SESSION_PATH}; Max-Age=0")
        );
    }

    #[test]
    fn cookie_parser_rejects_invalid_or_ambiguous_values() {
        let token = MediaSessionToken::new();
        let client_id = MediaClientId::parse("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d").unwrap();
        let cookie_name = media_session_cookie_name(&client_id);
        let mut headers = HeaderMap::new();

        headers.insert(
            COOKIE,
            format!("{cookie_name}={}", token.as_str())
                .parse()
                .unwrap(),
        );
        assert_eq!(
            media_session_from_headers_for_client(&headers, &client_id),
            HeaderCookieParseResult::Found(token.clone())
        );

        // Invalid short token returns None
        headers.insert(COOKIE, format!("{cookie_name}=short").parse().unwrap());
        assert_eq!(
            media_session_from_headers_for_client(&headers, &client_id),
            HeaderCookieParseResult::None
        );

        // Duplicate cookies for same client_id returns Duplicate
        headers.insert(
            COOKIE,
            format!("{cookie_name}={}; {cookie_name}={}", token.as_str(), token.as_str())
                .parse()
                .unwrap(),
        );
        assert_eq!(
            media_session_from_headers_for_client(&headers, &client_id),
            HeaderCookieParseResult::Duplicate
        );

        // Old v1 cookie is ignored
        let other_client = MediaClientId::parse("11111111-1111-4111-8111-111111111111").unwrap();
        headers.insert(
            COOKIE,
            format!("damhopper-media-session={}; {cookie_name}={}", token.as_str(), token.as_str())
                .parse()
                .unwrap(),
        );
        assert_eq!(
            media_session_from_headers_for_client(&headers, &client_id),
            HeaderCookieParseResult::Found(token.clone())
        );
        assert_eq!(
            media_session_from_headers_for_client(&headers, &other_client),
            HeaderCookieParseResult::None
        );
    }

    #[test]
    fn media_client_id_validation() {
        assert!(MediaClientId::parse("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d").is_some());
        // v1 UUID rejected (version != 4)
        assert!(MediaClientId::parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8").is_none());
        // invalid string rejected
        assert!(MediaClientId::parse("not-a-uuid").is_none());
    }
}
