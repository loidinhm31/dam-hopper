use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};

pub(crate) const MAX_MEDIA_TICKETS: usize = 256;
pub(crate) const MEDIA_TICKET_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
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

pub(crate) enum MediaTicketIssue {
    Issued(MediaTicketLease),
    Capacity,
    ContextChanged,
}

#[derive(Clone)]
pub struct MediaTicketStore {
    inner: Arc<Mutex<MediaTicketInner>>,
    clock: Arc<dyn MediaTicketClock>,
}

struct MediaTicketInner {
    tickets: HashMap<String, StoredMediaTicket>,
    generation: u64,
}

struct StoredMediaTicket {
    record: MediaTicketRecord,
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
                generation: 0,
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

    pub(crate) fn issue(
        &self,
        expected_generation: u64,
        record: MediaTicketRecord,
    ) -> MediaTicketIssue {
        let now = self.clock.now_instant();
        let absolute_expires_at = now + MEDIA_TICKET_ABSOLUTE_TTL;
        let idle_expires_at = now + MEDIA_TICKET_IDLE_TTL;
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if inner.generation != expected_generation {
            return MediaTicketIssue::ContextChanged;
        }
        inner.tickets.retain(|_, ticket| !is_expired(ticket, now));
        if inner.tickets.len() >= MAX_MEDIA_TICKETS {
            return MediaTicketIssue::Capacity;
        }

        for _ in 0..4 {
            let ticket = random_token();
            if inner.tickets.contains_key(&ticket) {
                continue;
            }
            inner.tickets.insert(
                ticket.clone(),
                StoredMediaTicket {
                    record: record.clone(),
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

    /// Unknown, expired, revoked, and wrong-kind tickets are indistinguishable.
    pub(crate) fn lookup_and_touch(
        &self,
        ticket: &str,
        expected_kind: MediaTicketKind,
    ) -> Option<MediaTicketRecord> {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let stored = inner.tickets.get_mut(ticket)?;
        if stored.record.kind != expected_kind {
            return None;
        }
        if is_expired(stored, now) {
            inner.tickets.remove(ticket);
            return None;
        }
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

    pub(crate) fn revoke_all(&self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.tickets.clear();
        inner.generation = inner.generation.wrapping_add(1);
    }

    #[cfg(test)]
    pub(crate) fn live_count(&self) -> usize {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.tickets.retain(|_, ticket| !is_expired(ticket, now));
        inner.tickets.len()
    }
}

fn is_expired(ticket: &StoredMediaTicket, now: Instant) -> bool {
    now >= ticket.idle_expires_at || now >= ticket.absolute_expires_at
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
            purpose: match kind {
                MediaTicketKind::Video => MediaTicketPurpose::Playback,
                MediaTicketKind::Image => MediaTicketPurpose::Preview,
            },
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
            MediaTicketIssue::Capacity | MediaTicketIssue::ContextChanged => {
                panic!("test ticket should be issued")
            }
        }
    }

    #[test]
    fn lifecycle_is_idle_absolute_and_generation_bound() {
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

        let old_generation = store.generation();
        store.revoke_all();
        assert!(matches!(
            store.issue(old_generation, record(MediaTicketKind::Image)),
            MediaTicketIssue::ContextChanged
        ));
    }

    #[test]
    fn capacity_prunes_expired_without_evicting_live_tickets() {
        let (store, clock) = store();
        for _ in 0..MAX_MEDIA_TICKETS {
            issue(&store, record(MediaTicketKind::Video));
        }
        assert!(matches!(
            store.issue(store.generation(), record(MediaTicketKind::Image)),
            MediaTicketIssue::Capacity
        ));
        clock.advance(MEDIA_TICKET_IDLE_TTL);
        issue(&store, record(MediaTicketKind::Image));
        assert_eq!(store.live_count(), 1);
    }

    #[test]
    fn kind_isolation_keeps_image_and_video_capabilities_separate() {
        let (store, _) = store();
        let image = issue(&store, record(MediaTicketKind::Image));
        assert!(store
            .lookup_and_touch(&image, MediaTicketKind::Video)
            .is_none());
        assert!(store
            .lookup_and_touch(&image, MediaTicketKind::Image)
            .is_some());
    }

    #[test]
    fn tokens_are_unique_and_revoke_is_kind_scoped() {
        let (store, _) = store();
        let video = issue(&store, record(MediaTicketKind::Video));
        let image = issue(&store, record(MediaTicketKind::Image));
        assert_ne!(video, image);

        store.revoke(&video, MediaTicketKind::Image);
        assert!(store
            .lookup_and_touch(&video, MediaTicketKind::Video)
            .is_some());
        store.revoke(&video, MediaTicketKind::Video);
        assert!(store
            .lookup_and_touch(&video, MediaTicketKind::Video)
            .is_none());
        assert!(store
            .lookup_and_touch(&image, MediaTicketKind::Image)
            .is_some());
    }
}
