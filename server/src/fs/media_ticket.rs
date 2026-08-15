use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};

use super::media_session::{
    MediaSessionBinding, MediaSessionDigest, MediaSessionLease, MediaSessionToken,
    MEDIA_SESSION_ABSOLUTE_TTL, MEDIA_SESSION_IDLE_TTL,
};

pub(crate) const MEDIA_TICKET_IDLE_TTL: Duration = Duration::from_secs(15 * 60);
pub(crate) const MEDIA_TICKET_ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 60 * 60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MediaTicketKind {
    Video,
    Image,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MediaTicketPurpose {
    Playback,
    Download,
    Preview,
}

#[derive(Clone)]
pub struct MediaFileVersion {
    pub canonical_path: PathBuf,
    pub size: u64,
    pub modified: SystemTime,
    pub validator: String,
    #[cfg(unix)]
    pub device: u64,
    #[cfg(unix)]
    pub inode: u64,
    #[cfg(windows)]
    pub volume_serial: Option<u32>,
    #[cfg(windows)]
    pub file_index: Option<u64>,
}

impl MediaFileVersion {
    pub fn from_metadata(
        canonical_path: PathBuf,
        metadata: &std::fs::Metadata,
    ) -> std::io::Result<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;

        Ok(Self {
            canonical_path,
            size: metadata.len(),
            modified: metadata.modified()?,
            validator: random_token(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            #[cfg(windows)]
            volume_serial: None,
            #[cfg(windows)]
            file_index: None,
        })
    }
}

#[derive(Clone)]
pub(crate) struct MediaTicketRecord {
    pub kind: MediaTicketKind,
    pub purpose: MediaTicketPurpose,
    pub project: String,
    pub project_relative_path: PathBuf,
    pub file: MediaFileVersion,
    pub mime: String,
    pub filename: String,
}

#[derive(Clone)]
pub(crate) struct MediaTicketLease {
    pub ticket: String,
    pub expires_at_epoch_ms: u128,
}

/// Authorization snapshot that must be finalized after async file validation.
#[derive(Clone)]
pub(crate) struct MediaTicketAuthorization {
    pub record: MediaTicketRecord,
    ticket_incarnation: u64,
    binding: MediaSessionBinding,
}

pub(crate) struct MediaTicketBoundLease {
    pub ticket: MediaTicketLease,
    pub session: MediaSessionLease,
}

pub(crate) enum MediaTicketIssue {
    Issued(MediaTicketLease),
    Capacity,
    ContextChanged,
}

pub(crate) enum MediaTicketBoundIssue {
    Issued(MediaTicketBoundLease),
    Capacity,
    ContextChanged,
}

pub(crate) enum MediaSessionIssue {
    Issued(MediaSessionLease),
    Capacity,
}

#[derive(Clone)]
pub struct MediaTicketStore {
    inner: Arc<Mutex<MediaTicketInner>>,
    clock: Arc<dyn MediaTicketClock>,
}

struct MediaTicketInner {
    tickets: HashMap<String, StoredMediaTicket>,
    sessions: HashMap<MediaSessionDigest, StoredMediaSession>,
    generation: u64,
    next_ticket_incarnation: u64,
}

struct StoredMediaTicket {
    record: MediaTicketRecord,
    binding: Option<MediaSessionBinding>,
    incarnation: u64,
    idle_expires_at: Instant,
    absolute_expires_at: Instant,
}

struct StoredMediaSession {
    actor_subject: String,
    idle_expires_at: Instant,
    absolute_expires_at: Instant,
}

pub(crate) trait MediaTicketClock: Send + Sync {
    fn now_instant(&self) -> Instant;
    fn now_system(&self) -> SystemTime;
}

struct SystemMediaTicketClock;

impl MediaTicketClock for SystemMediaTicketClock {
    fn now_instant(&self) -> Instant {
        Instant::now()
    }

    fn now_system(&self) -> SystemTime {
        SystemTime::now()
    }
}

impl Default for MediaTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaTicketStore {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(SystemMediaTicketClock))
    }

    pub(crate) fn with_clock(clock: Arc<dyn MediaTicketClock>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(MediaTicketInner {
                tickets: HashMap::new(),
                sessions: HashMap::new(),
                generation: 0,
                next_ticket_incarnation: 0,
            })),
            clock,
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .generation
    }

    /// Creates a session or safely reuses the supplied cookie for the same actor.
    pub(crate) fn establish_session(
        &self,
        actor_subject: &str,
        existing: Option<MediaSessionToken>,
    ) -> MediaSessionIssue {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);

        if let Some(token) = existing {
            let digest = token.digest();
            if let Some((stored_digest, session)) = inner
                .sessions
                .iter_mut()
                .find(|(stored_digest, _)| stored_digest.matches(&digest))
            {
                if session.actor_subject == actor_subject {
                    session.idle_expires_at =
                        std::cmp::min(now + MEDIA_SESSION_IDLE_TTL, session.absolute_expires_at);
                    return MediaSessionIssue::Issued(MediaSessionLease {
                        token,
                        binding: MediaSessionBinding {
                            actor_subject: actor_subject.to_owned(),
                            session_digest: *stored_digest,
                        },
                    });
                }
            }
        }

        for _ in 0..4 {
            let token = MediaSessionToken::new();
            let digest = token.digest();
            if inner.sessions.contains_key(&digest) {
                continue;
            }
            let absolute_expires_at = now + MEDIA_SESSION_ABSOLUTE_TTL;
            inner.sessions.insert(
                digest,
                StoredMediaSession {
                    actor_subject: actor_subject.to_owned(),
                    idle_expires_at: now + MEDIA_SESSION_IDLE_TTL,
                    absolute_expires_at,
                },
            );
            return MediaSessionIssue::Issued(MediaSessionLease {
                token,
                binding: MediaSessionBinding {
                    actor_subject: actor_subject.to_owned(),
                    session_digest: digest,
                },
            });
        }
        MediaSessionIssue::Capacity
    }

    /// Atomically establishes/reuses a session and admits a ticket bound to it.
    pub(crate) fn issue_bound(
        &self,
        expected_generation: u64,
        actor_subject: &str,
        existing: Option<MediaSessionToken>,
        record: MediaTicketRecord,
    ) -> MediaTicketBoundIssue {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        if inner.generation != expected_generation {
            return MediaTicketBoundIssue::ContextChanged;
        }

        let reusable = existing.and_then(|token| {
            let digest = token.digest();
            inner
                .sessions
                .iter()
                .find(|(stored_digest, stored)| {
                    stored_digest.matches(&digest) && stored.actor_subject == actor_subject
                })
                .map(|(stored_digest, _)| MediaSessionLease {
                    token,
                    binding: MediaSessionBinding {
                        actor_subject: actor_subject.to_owned(),
                        session_digest: *stored_digest,
                    },
                })
        });
        let Some(ticket) = (0..4)
            .map(|_| random_token())
            .find(|ticket| !inner.tickets.contains_key(ticket))
        else {
            return MediaTicketBoundIssue::Capacity;
        };
        let session = if let Some(session) = reusable {
            let stored = inner
                .sessions
                .get_mut(&session.binding.session_digest)
                .expect("reusable session remains live while locked");
            stored.idle_expires_at =
                std::cmp::min(now + MEDIA_SESSION_IDLE_TTL, stored.absolute_expires_at);
            session
        } else {
            let Some((token, digest)) = (0..4)
                .map(|_| {
                    let token = MediaSessionToken::new();
                    let digest = token.digest();
                    (token, digest)
                })
                .find(|(_, digest)| !inner.sessions.contains_key(digest))
            else {
                return MediaTicketBoundIssue::Capacity;
            };
            inner.sessions.insert(
                digest,
                StoredMediaSession {
                    actor_subject: actor_subject.to_owned(),
                    idle_expires_at: now + MEDIA_SESSION_IDLE_TTL,
                    absolute_expires_at: now + MEDIA_SESSION_ABSOLUTE_TTL,
                },
            );
            MediaSessionLease {
                token,
                binding: MediaSessionBinding {
                    actor_subject: actor_subject.to_owned(),
                    session_digest: digest,
                },
            }
        };
        let incarnation = next_ticket_incarnation(&mut inner);
        inner.tickets.insert(
            ticket.clone(),
            StoredMediaTicket {
                record,
                binding: Some(session.binding.clone()),
                incarnation,
                idle_expires_at: now + MEDIA_TICKET_IDLE_TTL,
                absolute_expires_at: now + MEDIA_TICKET_ABSOLUTE_TTL,
            },
        );
        MediaTicketBoundIssue::Issued(MediaTicketBoundLease {
            ticket: MediaTicketLease {
                ticket,
                expires_at_epoch_ms: epoch_ms(self.clock.now_system() + MEDIA_TICKET_IDLE_TTL),
            },
            session,
        })
    }

    /// Issues a legacy ticket retained only for existing adapter tests.
    pub(crate) fn issue(
        &self,
        expected_generation: u64,
        record: MediaTicketRecord,
    ) -> MediaTicketIssue {
        self.issue_inner(expected_generation, record, None)
    }

    /// Atomically admits a ticket bound to a live session owned by `actor_subject`.
    pub(crate) fn issue_for_session(
        &self,
        expected_generation: u64,
        actor_subject: &str,
        session: &MediaSessionLease,
        record: MediaTicketRecord,
    ) -> MediaTicketIssue {
        if session.binding.actor_subject != actor_subject {
            return MediaTicketIssue::ContextChanged;
        }
        self.issue_inner(expected_generation, record, Some(&session.binding))
    }

    fn issue_inner(
        &self,
        expected_generation: u64,
        record: MediaTicketRecord,
        binding: Option<&MediaSessionBinding>,
    ) -> MediaTicketIssue {
        let now = self.clock.now_instant();
        let absolute_expires_at = now + MEDIA_TICKET_ABSOLUTE_TTL;
        let idle_expires_at = now + MEDIA_TICKET_IDLE_TTL;
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        if inner.generation != expected_generation {
            return MediaTicketIssue::ContextChanged;
        }
        if !binding.is_none_or(|binding| binding_matches_live_session(binding, &inner.sessions)) {
            return MediaTicketIssue::Capacity;
        }

        for _ in 0..4 {
            let ticket = random_token();
            if inner.tickets.contains_key(&ticket) {
                continue;
            }
            let incarnation = next_ticket_incarnation(&mut inner);
            inner.tickets.insert(
                ticket.clone(),
                StoredMediaTicket {
                    record: record.clone(),
                    binding: binding.cloned(),
                    incarnation,
                    idle_expires_at,
                    absolute_expires_at,
                },
            );
            return MediaTicketIssue::Issued(MediaTicketLease {
                ticket,
                expires_at_epoch_ms: epoch_ms(self.clock.now_system() + MEDIA_TICKET_IDLE_TTL),
            });
        }
        MediaTicketIssue::Capacity
    }

    /// Authorizes a bound stream without extending ticket or session TTLs.
    pub(crate) fn authorize_bound(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        token: &MediaSessionToken,
    ) -> Option<MediaTicketAuthorization> {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let stored = inner.tickets.get(ticket)?;
        let binding = stored.binding.clone()?;
        if stored.record.kind != expected_kind
            || !session_matches(Some(&binding), Some(token), &inner.sessions)
        {
            return None;
        }
        Some(MediaTicketAuthorization {
            record: stored.record.clone(),
            ticket_incarnation: stored.incarnation,
            binding,
        })
    }

    /// Authorizes a bound ticket using the ticket URL as the media capability.
    ///
    /// This fallback is needed for cross-origin native media elements, which cannot
    /// attach an Authorization header and may not receive a third-party cookie.
    /// The ticket remains bound to a live authenticated actor/session and is
    /// revoked with that session.
    pub(crate) fn authorize_ticket(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
    ) -> Option<MediaTicketAuthorization> {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let stored = inner.tickets.get(ticket)?;
        let binding = stored.binding.clone()?;
        if stored.record.kind != expected_kind
            || !binding_matches_live_session(&binding, &inner.sessions)
        {
            return None;
        }
        Some(MediaTicketAuthorization {
            record: stored.record.clone(),
            ticket_incarnation: stored.incarnation,
            binding,
        })
    }

    /// Rechecks a bound ticket after async validation, then extends idle TTLs.
    pub(crate) fn finalize_bound_and_touch(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        token: &MediaSessionToken,
        authorization: &MediaTicketAuthorization,
    ) -> bool {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let Some(stored) = inner.tickets.get(ticket) else {
            return false;
        };
        if stored.record.kind != expected_kind
            || stored.incarnation != authorization.ticket_incarnation
            || stored.binding.as_ref() != Some(&authorization.binding)
            || !session_matches(stored.binding.as_ref(), Some(token), &inner.sessions)
            || !inner
                .sessions
                .contains_key(&authorization.binding.session_digest)
        {
            return false;
        }
        let session = inner
            .sessions
            .get_mut(&authorization.binding.session_digest)
            .expect("checked live session");
        session.idle_expires_at =
            std::cmp::min(now + MEDIA_SESSION_IDLE_TTL, session.absolute_expires_at);
        let stored = inner.tickets.get_mut(ticket).expect("checked live ticket");
        stored.idle_expires_at =
            std::cmp::min(now + MEDIA_TICKET_IDLE_TTL, stored.absolute_expires_at);
        true
    }

    /// Rechecks a ticket-only media capability after async validation.
    pub(crate) fn finalize_ticket_and_touch(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        authorization: &MediaTicketAuthorization,
    ) -> bool {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let Some(stored) = inner.tickets.get(ticket) else {
            return false;
        };
        if stored.record.kind != expected_kind
            || stored.incarnation != authorization.ticket_incarnation
            || stored.binding.as_ref() != Some(&authorization.binding)
            || !binding_matches_live_session(&authorization.binding, &inner.sessions)
        {
            return false;
        }
        let session = inner
            .sessions
            .get_mut(&authorization.binding.session_digest)
            .expect("checked live session");
        session.idle_expires_at =
            std::cmp::min(now + MEDIA_SESSION_IDLE_TTL, session.absolute_expires_at);
        let stored = inner.tickets.get_mut(ticket).expect("checked live ticket");
        stored.idle_expires_at =
            std::cmp::min(now + MEDIA_TICKET_IDLE_TTL, stored.absolute_expires_at);
        true
    }

    /// Unknown, expired, revoked, and wrong-kind tickets are indistinguishable.
    pub(crate) fn lookup_and_touch(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
    ) -> Option<MediaTicketRecord> {
        self.lookup_inner(ticket, expected_kind, None)
    }

    /// Legacy test adapter for the pre-finalization stream flow.
    pub(crate) fn lookup_and_touch_for_session(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        token: &MediaSessionToken,
    ) -> Option<MediaTicketRecord> {
        self.lookup_inner(ticket, expected_kind, Some(token))
    }

    fn lookup_inner(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        token: Option<&MediaSessionToken>,
    ) -> Option<MediaTicketRecord> {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let stored = inner.tickets.get(ticket)?;
        let binding = stored.binding.clone();
        if stored.record.kind != expected_kind
            || !session_matches(binding.as_ref(), token, &inner.sessions)
        {
            return None;
        }
        if let Some(binding) = binding {
            let session = inner
                .sessions
                .get_mut(&binding.session_digest)
                .expect("validated binding must reference a live session");
            session.idle_expires_at =
                std::cmp::min(now + MEDIA_SESSION_IDLE_TTL, session.absolute_expires_at);
        }
        let stored = inner.tickets.get_mut(ticket)?;
        stored.idle_expires_at =
            std::cmp::min(now + MEDIA_TICKET_IDLE_TTL, stored.absolute_expires_at);
        Some(stored.record.clone())
    }

    pub(crate) fn revoke(&self, ticket: &str, expected_kind: MediaTicketKind) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if inner
            .tickets
            .get(ticket)
            .is_some_and(|stored| stored.record.kind == expected_kind)
        {
            inner.tickets.remove(ticket);
        }
    }

    /// Revokes only a ticket owned by the presented actor/session pair.
    pub(crate) fn revoke_bound(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
        actor_subject: &str,
        token: &MediaSessionToken,
    ) {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        let remove = inner.tickets.get(ticket).is_some_and(|stored| {
            stored.record.kind == expected_kind
                && stored.binding.as_ref().is_some_and(|binding| {
                    binding.actor_subject == actor_subject
                        && session_matches(Some(binding), Some(token), &inner.sessions)
                })
        });
        if remove {
            inner.tickets.remove(ticket);
        }
    }

    /// Revokes the current session only when it belongs to the authenticated actor.
    pub(crate) fn revoke_session_for_actor(&self, actor_subject: &str, token: &MediaSessionToken) {
        let digest = token.digest();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let removed = inner
            .sessions
            .iter()
            .find(|(stored, session)| {
                stored.matches(&digest) && session.actor_subject == actor_subject
            })
            .map(|(stored, _)| *stored);
        if let Some(digest) = removed {
            inner.sessions.remove(&digest);
            inner.tickets.retain(|_, ticket| {
                ticket
                    .binding
                    .as_ref()
                    .is_none_or(|binding| binding.session_digest != digest)
            });
        }
    }

    /// Revokes one session and every ticket bound to it.
    pub(crate) fn revoke_session(&self, token: &MediaSessionToken) {
        let digest = token.digest();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let removed = inner
            .sessions
            .keys()
            .find(|stored_digest| stored_digest.matches(&digest))
            .copied();
        if let Some(digest) = removed {
            inner.sessions.remove(&digest);
            inner.tickets.retain(|_, ticket| {
                ticket
                    .binding
                    .as_ref()
                    .is_none_or(|binding| binding.session_digest != digest)
            });
        }
    }

    pub(crate) fn revoke_all(&self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.tickets.clear();
        inner.sessions.clear();
        inner.generation = inner.generation.wrapping_add(1);
    }

    #[cfg(test)]
    pub(crate) fn live_count(&self) -> usize {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        inner.tickets.len()
    }

    #[cfg(test)]
    pub(crate) fn live_session_count(&self) -> usize {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_expired(&mut inner, now);
        inner.sessions.len()
    }
}

fn next_ticket_incarnation(inner: &mut MediaTicketInner) -> u64 {
    let incarnation = inner.next_ticket_incarnation;
    inner.next_ticket_incarnation = inner.next_ticket_incarnation.wrapping_add(1);
    incarnation
}

fn binding_matches_live_session(
    binding: &MediaSessionBinding,
    sessions: &HashMap<MediaSessionDigest, StoredMediaSession>,
) -> bool {
    sessions.iter().any(|(stored_digest, session)| {
        stored_digest.matches(&binding.session_digest)
            && session.actor_subject == binding.actor_subject
    })
}

fn session_matches(
    binding: Option<&MediaSessionBinding>,
    token: Option<&MediaSessionToken>,
    sessions: &HashMap<MediaSessionDigest, StoredMediaSession>,
) -> bool {
    let (Some(binding), Some(token)) = (binding, token) else {
        return binding.is_none() && token.is_none();
    };
    let digest = token.digest();
    sessions.iter().any(|(stored_digest, session)| {
        stored_digest.matches(&digest)
            && stored_digest.matches(&binding.session_digest)
            && session.actor_subject == binding.actor_subject
    })
}

fn prune_expired(inner: &mut MediaTicketInner, now: Instant) {
    inner
        .sessions
        .retain(|_, session| !session_expired(session, now));
    inner.tickets.retain(|_, ticket| {
        !ticket_expired(ticket, now)
            && ticket
                .binding
                .as_ref()
                .is_none_or(|binding| inner.sessions.contains_key(&binding.session_digest))
    });
}

fn ticket_expired(ticket: &StoredMediaTicket, now: Instant) -> bool {
    now >= ticket.idle_expires_at || now >= ticket.absolute_expires_at
}

fn session_expired(session: &StoredMediaSession, now: Instant) -> bool {
    now >= session.idle_expires_at || now >= session.absolute_expires_at
}

pub(crate) fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn epoch_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    struct TestClock {
        instant: Mutex<Instant>,
        system: Mutex<SystemTime>,
    }

    impl TestClock {
        fn advance(&self, duration: Duration) {
            *self.instant.lock().unwrap() += duration;
            *self.system.lock().unwrap() += duration;
        }
    }

    impl MediaTicketClock for TestClock {
        fn now_instant(&self) -> Instant {
            *self.instant.lock().unwrap()
        }

        fn now_system(&self) -> SystemTime {
            *self.system.lock().unwrap()
        }
    }

    fn record(kind: MediaTicketKind) -> MediaTicketRecord {
        let metadata = std::fs::metadata(env!("CARGO_MANIFEST_DIR")).unwrap();
        MediaTicketRecord {
            kind,
            purpose: MediaTicketPurpose::Playback,
            project: "project".into(),
            project_relative_path: PathBuf::from("media.bin"),
            file: MediaFileVersion::from_metadata(PathBuf::from("/private/media.bin"), &metadata)
                .unwrap(),
            mime: "application/octet-stream".into(),
            filename: "media.bin".into(),
        }
    }

    fn store() -> (MediaTicketStore, Arc<TestClock>) {
        let clock = Arc::new(TestClock {
            instant: Mutex::new(Instant::now()),
            system: Mutex::new(UNIX_EPOCH + Duration::from_secs(1_000)),
        });
        (MediaTicketStore::with_clock(clock.clone()), clock)
    }

    fn issue(store: &MediaTicketStore, record: MediaTicketRecord) -> String {
        match store.issue(store.generation(), record) {
            MediaTicketIssue::Issued(lease) => lease.ticket,
            MediaTicketIssue::Capacity | MediaTicketIssue::ContextChanged => panic!("issue failed"),
        }
    }

    #[test]
    fn legacy_tickets_remain_idle_absolute_and_generation_bound() {
        let (store, clock) = store();
        let ticket = issue(&store, record(MediaTicketKind::Video));
        clock.advance(MEDIA_TICKET_IDLE_TTL - Duration::from_secs(1));
        assert!(store
            .lookup_and_touch(&ticket, MediaTicketKind::Video)
            .is_some());
        clock.advance(MEDIA_TICKET_ABSOLUTE_TTL - MEDIA_TICKET_IDLE_TTL + Duration::from_secs(1));
        assert!(store
            .lookup_and_touch(&ticket, MediaTicketKind::Video)
            .is_none());

        let generation = store.generation();
        store.revoke_all();
        assert!(matches!(
            store.issue(generation, record(MediaTicketKind::Image)),
            MediaTicketIssue::ContextChanged
        ));
    }

    #[test]
    fn session_expiry_prunes_its_tickets_without_live_eviction() {
        let (store, clock) = store();
        let session = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            MediaSessionIssue::Capacity => panic!("session issue failed"),
        };
        let ticket = match store.issue_for_session(
            store.generation(),
            "actor",
            &session,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketIssue::Issued(lease) => lease.ticket,
            _ => panic!("ticket issue failed"),
        };
        clock.advance(MEDIA_SESSION_IDLE_TTL);
        assert_eq!(store.live_session_count(), 0);
        assert_eq!(store.live_count(), 0);
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &session.token)
            .is_none());
    }

    #[test]
    fn bound_lookup_refreshes_session_idle_but_not_its_absolute_deadline() {
        let (store, clock) = store();
        let session = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session issue failed"),
        };
        let ticket = match store.issue_for_session(
            store.generation(),
            "actor",
            &session,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketIssue::Issued(lease) => lease.ticket,
            _ => panic!("ticket issue failed"),
        };
        clock.advance(MEDIA_TICKET_IDLE_TTL - Duration::from_secs(1));
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &session.token)
            .is_some());
        clock.advance(MEDIA_TICKET_IDLE_TTL - Duration::from_secs(1));
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &session.token)
            .is_some());
        clock.advance(Duration::from_secs(3));
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &session.token)
            .is_some());
        clock.advance(MEDIA_SESSION_ABSOLUTE_TTL - MEDIA_SESSION_IDLE_TTL);
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &session.token)
            .is_none());
    }

    #[test]
    fn session_issuance_is_not_limited_by_live_session_counts() {
        const FORMER_PER_ACTOR_SESSION_LIMIT: usize = 8;
        const FORMER_GLOBAL_SESSION_LIMIT: usize = 256;

        let (store, _) = store();
        for _ in 0..=FORMER_PER_ACTOR_SESSION_LIMIT {
            assert!(matches!(
                store.establish_session("actor", None),
                MediaSessionIssue::Issued(_)
            ));
        }
        for actor in 0..(FORMER_GLOBAL_SESSION_LIMIT - FORMER_PER_ACTOR_SESSION_LIMIT) {
            assert!(matches!(
                store.establish_session(&format!("actor-{actor}"), None),
                MediaSessionIssue::Issued(_)
            ));
        }
        assert_eq!(store.live_session_count(), FORMER_GLOBAL_SESSION_LIMIT + 1);
    }

    #[test]
    fn ticket_issuance_is_not_limited_by_live_ticket_counts() {
        const FORMER_PER_SESSION_TICKET_LIMIT: usize = 64;
        const FORMER_PER_ACTOR_TICKET_LIMIT: usize = 128;
        const FORMER_GLOBAL_TICKET_LIMIT: usize = 256;

        let (store, _) = store();
        let first = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session issue failed"),
        };
        let second = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session issue failed"),
        };
        for _ in 0..=FORMER_PER_SESSION_TICKET_LIMIT {
            assert!(matches!(
                store.issue_for_session(
                    store.generation(),
                    "actor",
                    &first,
                    record(MediaTicketKind::Video)
                ),
                MediaTicketIssue::Issued(_)
            ));
        }
        for _ in 0..(FORMER_PER_ACTOR_TICKET_LIMIT - FORMER_PER_SESSION_TICKET_LIMIT) {
            assert!(matches!(
                store.issue_for_session(
                    store.generation(),
                    "actor",
                    &second,
                    record(MediaTicketKind::Video)
                ),
                MediaTicketIssue::Issued(_)
            ));
        }
        for _ in 0..=(FORMER_GLOBAL_TICKET_LIMIT - (FORMER_PER_ACTOR_TICKET_LIMIT + 1)) {
            issue(&store, record(MediaTicketKind::Video));
        }
        assert_eq!(store.live_count(), FORMER_GLOBAL_TICKET_LIMIT + 1);
    }

    #[test]
    fn rejected_bound_authorization_does_not_touch_session_or_ticket_ttl() {
        let (store, clock) = store();
        let issued = match store.issue_bound(
            store.generation(),
            "actor",
            None,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketBoundIssue::Issued(lease) => lease,
            _ => panic!("bound ticket should be issued"),
        };
        let foreign = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("foreign session should be issued"),
        };
        clock.advance(MEDIA_SESSION_IDLE_TTL - Duration::from_secs(1));

        assert!(store
            .authorize_bound(
                &issued.ticket.ticket,
                MediaTicketKind::Video,
                &foreign.token,
            )
            .is_none());
        clock.advance(Duration::from_secs(1));
        assert_eq!(store.live_session_count(), 0);
        assert_eq!(store.live_count(), 0);
    }

    #[test]
    fn bound_issue_creates_a_session_after_former_global_limits() {
        const FORMER_GLOBAL_TICKET_LIMIT: usize = 256;
        const FORMER_GLOBAL_SESSION_LIMIT: usize = 256;

        let (store, _) = store();
        for _ in 0..=FORMER_GLOBAL_TICKET_LIMIT {
            assert!(matches!(
                store.issue(store.generation(), record(MediaTicketKind::Video)),
                MediaTicketIssue::Issued(_)
            ));
        }
        for actor in 0..FORMER_GLOBAL_SESSION_LIMIT {
            assert!(matches!(
                store.establish_session(&format!("actor-{actor}"), None),
                MediaSessionIssue::Issued(_)
            ));
        }
        assert!(matches!(
            store.issue_bound(
                store.generation(),
                "actor",
                None,
                record(MediaTicketKind::Image),
            ),
            MediaTicketBoundIssue::Issued(_)
        ));
        assert_eq!(store.live_session_count(), FORMER_GLOBAL_SESSION_LIMIT + 1);
    }

    #[test]
    fn bound_issue_refreshes_a_reused_session_after_live_tickets() {
        let (store, clock) = store();
        let session = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session should be issued"),
        };
        for _ in 0..=64 {
            assert!(matches!(
                store.issue_for_session(
                    store.generation(),
                    "actor",
                    &session,
                    record(MediaTicketKind::Video),
                ),
                MediaTicketIssue::Issued(_)
            ));
        }
        clock.advance(MEDIA_SESSION_IDLE_TTL - Duration::from_secs(1));

        assert!(matches!(
            store.issue_bound(
                store.generation(),
                "actor",
                Some(session.token.clone()),
                record(MediaTicketKind::Image),
            ),
            MediaTicketBoundIssue::Issued(_)
        ));
        clock.advance(Duration::from_secs(1));
        assert_eq!(store.live_session_count(), 1);
    }

    #[test]
    fn bound_finalization_rejects_a_replaced_ticket_incarnation() {
        let (store, _) = store();
        let issued = match store.issue_bound(
            store.generation(),
            "actor",
            None,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketBoundIssue::Issued(lease) => lease,
            _ => panic!("bound ticket should be issued"),
        };
        let authorization = store
            .authorize_bound(
                &issued.ticket.ticket,
                MediaTicketKind::Video,
                &issued.session.token,
            )
            .expect("authorization should succeed");
        {
            let mut inner = store.inner.lock().unwrap();
            let ticket = inner.tickets.get_mut(&issued.ticket.ticket).unwrap();
            ticket.incarnation = ticket.incarnation.wrapping_add(1);
        }

        assert!(!store.finalize_bound_and_touch(
            &issued.ticket.ticket,
            MediaTicketKind::Video,
            &issued.session.token,
            &authorization,
        ));
    }

    #[test]
    fn concurrent_bound_finalization_allows_each_authorized_request() {
        let (store, _) = store();
        let issued = match store.issue_bound(
            store.generation(),
            "actor",
            None,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketBoundIssue::Issued(lease) => lease,
            _ => panic!("bound ticket should be issued"),
        };
        let first = store
            .authorize_bound(
                &issued.ticket.ticket,
                MediaTicketKind::Video,
                &issued.session.token,
            )
            .expect("first authorization should succeed");
        let second = store
            .authorize_bound(
                &issued.ticket.ticket,
                MediaTicketKind::Video,
                &issued.session.token,
            )
            .expect("second authorization should succeed");

        assert!(store.finalize_bound_and_touch(
            &issued.ticket.ticket,
            MediaTicketKind::Video,
            &issued.session.token,
            &first,
        ));
        assert!(store.finalize_bound_and_touch(
            &issued.ticket.ticket,
            MediaTicketKind::Video,
            &issued.session.token,
            &second,
        ));
    }

    #[test]
    fn bound_tickets_require_matching_session_and_revoke_with_it() {
        let (store, _) = store();
        let first = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session issue failed"),
        };
        let second = match store.establish_session("actor", None) {
            MediaSessionIssue::Issued(lease) => lease,
            _ => panic!("session issue failed"),
        };
        let ticket = match store.issue_for_session(
            store.generation(),
            "actor",
            &first,
            record(MediaTicketKind::Video),
        ) {
            MediaTicketIssue::Issued(lease) => lease.ticket,
            _ => panic!("ticket issue failed"),
        };
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &second.token)
            .is_none());
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &first.token)
            .is_some());
        store.revoke_session(&first.token);
        assert!(store
            .lookup_and_touch_for_session(&ticket, MediaTicketKind::Video, &first.token)
            .is_none());
    }
}
