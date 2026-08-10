use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};

pub const MAX_VIDEO_TICKETS: usize = 256;
pub const VIDEO_TICKET_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
pub const VIDEO_TICKET_ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 60 * 60);

const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "m4v", "webm", "ogv", "ogg", "mov"];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoTicketPurpose {
    Playback,
    Download,
}

pub fn is_supported_video(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

#[derive(Clone)]
pub struct VideoFileVersion {
    pub canonical_path: PathBuf,
    pub size: u64,
    pub modified: SystemTime,
    pub validator: String,
    #[cfg(unix)]
    pub device: u64,
    #[cfg(unix)]
    pub inode: u64,
}

impl VideoFileVersion {
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
        })
    }
}

#[derive(Clone)]
pub struct VideoTicketRecord {
    pub purpose: VideoTicketPurpose,
    pub project: String,
    pub project_relative_path: PathBuf,
    pub file: VideoFileVersion,
    pub mime: String,
    pub filename: String,
}

#[derive(Clone)]
pub struct VideoTicketLease {
    pub ticket: String,
    pub expires_at_epoch_ms: u128,
    pub purpose: VideoTicketPurpose,
}

pub(crate) enum VideoTicketIssue {
    Issued(VideoTicketLease),
    Capacity,
    ContextChanged,
}

#[derive(Clone)]
pub struct VideoStreamTicketStore {
    inner: Arc<Mutex<VideoTicketInner>>,
    clock: Arc<dyn VideoTicketClock>,
}

struct VideoTicketInner {
    tickets: HashMap<String, StoredVideoTicket>,
    generation: u64,
}

struct StoredVideoTicket {
    record: VideoTicketRecord,
    idle_expires_at: Instant,
    absolute_expires_at: Instant,
}

trait VideoTicketClock: Send + Sync {
    fn now_instant(&self) -> Instant;
    fn now_system(&self) -> SystemTime;
}

struct SystemVideoTicketClock;

impl VideoTicketClock for SystemVideoTicketClock {
    fn now_instant(&self) -> Instant {
        Instant::now()
    }

    fn now_system(&self) -> SystemTime {
        SystemTime::now()
    }
}

impl Default for VideoStreamTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoStreamTicketStore {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(SystemVideoTicketClock))
    }

    fn with_clock(clock: Arc<dyn VideoTicketClock>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(VideoTicketInner {
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
        record: VideoTicketRecord,
    ) -> VideoTicketIssue {
        let now = self.clock.now_instant();
        let absolute_expires_at = now + VIDEO_TICKET_ABSOLUTE_TTL;
        let idle_expires_at = now + VIDEO_TICKET_IDLE_TTL;
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if inner.generation != expected_generation {
            return VideoTicketIssue::ContextChanged;
        }
        inner.tickets.retain(|_, ticket| !is_expired(ticket, now));
        if inner.tickets.len() >= MAX_VIDEO_TICKETS {
            return VideoTicketIssue::Capacity;
        }

        for _ in 0..4 {
            let ticket = random_token();
            if inner.tickets.contains_key(&ticket) {
                continue;
            }
            inner.tickets.insert(
                ticket.clone(),
                StoredVideoTicket {
                    record: record.clone(),
                    idle_expires_at,
                    absolute_expires_at,
                },
            );
            return VideoTicketIssue::Issued(VideoTicketLease {
                ticket,
                expires_at_epoch_ms: epoch_ms(self.clock.now_system() + VIDEO_TICKET_IDLE_TTL),
                purpose: record.purpose,
            });
        }
        VideoTicketIssue::Capacity
    }

    /// Unknown, expired, and revoked tickets all return `None`.
    pub fn lookup_and_touch(&self, ticket: &str) -> Option<VideoTicketRecord> {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let stored = inner.tickets.get_mut(ticket)?;
        if is_expired(stored, now) {
            inner.tickets.remove(ticket);
            return None;
        }
        stored.idle_expires_at =
            std::cmp::min(now + VIDEO_TICKET_IDLE_TTL, stored.absolute_expires_at);
        Some(stored.record.clone())
    }

    pub fn revoke(&self, ticket: &str) {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .tickets
            .remove(ticket);
    }

    pub fn revoke_all(&self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.tickets.clear();
        inner.generation = inner.generation.wrapping_add(1);
    }

    #[cfg(test)]
    fn live_count(&self) -> usize {
        let now = self.clock.now_instant();
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.tickets.retain(|_, ticket| !is_expired(ticket, now));
        inner.tickets.len()
    }
}

fn is_expired(ticket: &StoredVideoTicket, now: Instant) -> bool {
    now >= ticket.idle_expires_at || now >= ticket.absolute_expires_at
}

fn random_token() -> String {
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

    impl VideoTicketClock for TestClock {
        fn now_instant(&self) -> Instant {
            *self.instant.lock().unwrap()
        }

        fn now_system(&self) -> SystemTime {
            *self.system.lock().unwrap()
        }
    }

    fn record(purpose: VideoTicketPurpose) -> VideoTicketRecord {
        let metadata = std::fs::metadata(env!("CARGO_MANIFEST_DIR")).unwrap();
        VideoTicketRecord {
            purpose,
            project: "project".into(),
            project_relative_path: PathBuf::from("clip.webm"),
            file: VideoFileVersion::from_metadata(PathBuf::from("/private/clip.webm"), &metadata)
                .unwrap(),
            mime: "video/webm".into(),
            filename: "clip.webm".into(),
        }
    }

    fn store() -> (VideoStreamTicketStore, Arc<TestClock>) {
        let clock = Arc::new(TestClock {
            instant: Mutex::new(Instant::now()),
            system: Mutex::new(UNIX_EPOCH + Duration::from_secs(1_000)),
        });
        (VideoStreamTicketStore::with_clock(clock.clone()), clock)
    }

    fn issue(store: &VideoStreamTicketStore, record: VideoTicketRecord) -> VideoTicketLease {
        match store.issue(store.generation(), record) {
            VideoTicketIssue::Issued(lease) => lease,
            VideoTicketIssue::Capacity | VideoTicketIssue::ContextChanged => {
                panic!("test ticket should be issued")
            }
        }
    }

    #[test]
    fn purposes_have_independent_lifecycles() {
        let (store, clock) = store();
        let playback = issue(&store, record(VideoTicketPurpose::Playback));
        let download = issue(&store, record(VideoTicketPurpose::Download));
        store.revoke(&playback.ticket);

        assert!(store.lookup_and_touch(&playback.ticket).is_none());
        assert_eq!(
            store.lookup_and_touch(&download.ticket).unwrap().purpose,
            VideoTicketPurpose::Download
        );
        clock.advance(VIDEO_TICKET_IDLE_TTL);
        assert!(store.lookup_and_touch(&download.ticket).is_none());
    }

    #[test]
    fn unknown_expired_and_revoked_tickets_are_indistinguishable() {
        let (store, clock) = store();
        let revoked = issue(&store, record(VideoTicketPurpose::Playback));
        let expired = issue(&store, record(VideoTicketPurpose::Download));
        store.revoke(&revoked.ticket);
        clock.advance(VIDEO_TICKET_IDLE_TTL);

        assert!(store.lookup_and_touch("unknown-ticket").is_none());
        assert!(store.lookup_and_touch(&revoked.ticket).is_none());
        assert!(store.lookup_and_touch(&expired.ticket).is_none());
    }

    #[test]
    fn capacity_prunes_expired_without_evicting_live_tickets() {
        let (store, clock) = store();
        for _ in 0..MAX_VIDEO_TICKETS {
            issue(&store, record(VideoTicketPurpose::Playback));
        }
        assert!(matches!(
            store.issue(store.generation(), record(VideoTicketPurpose::Playback)),
            VideoTicketIssue::Capacity
        ));
        assert_eq!(store.live_count(), MAX_VIDEO_TICKETS);

        clock.advance(VIDEO_TICKET_IDLE_TTL);
        issue(&store, record(VideoTicketPurpose::Download));
        assert_eq!(store.live_count(), 1);
    }

    #[test]
    fn stale_issuance_cannot_survive_workspace_reinitialization() {
        let (store, _) = store();
        let old_generation = store.generation();
        store.revoke_all();

        assert!(matches!(
            store.issue(old_generation, record(VideoTicketPurpose::Playback)),
            VideoTicketIssue::ContextChanged
        ));
        assert_eq!(store.live_count(), 0);
    }

    #[test]
    fn touches_never_extend_beyond_absolute_expiry() {
        let (store, clock) = store();
        let ticket = issue(&store, record(VideoTicketPurpose::Playback));
        clock.advance(VIDEO_TICKET_IDLE_TTL - Duration::from_secs(1));
        assert!(store.lookup_and_touch(&ticket.ticket).is_some());
        clock.advance(VIDEO_TICKET_ABSOLUTE_TTL - VIDEO_TICKET_IDLE_TTL + Duration::from_secs(1));
        assert!(store.lookup_and_touch(&ticket.ticket).is_none());
    }

    #[test]
    fn allowlist_is_case_insensitive_and_closed() {
        assert!(is_supported_video(Path::new("clip.M4V")));
        assert!(is_supported_video(Path::new("clip.ogg")));
        assert!(!is_supported_video(Path::new("clip.avi")));
        assert!(!is_supported_video(Path::new("clip")));
    }
}
