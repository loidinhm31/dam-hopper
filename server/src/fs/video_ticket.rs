use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{
    media_session::MediaSessionToken,
    media_ticket::{
        MediaFileVersion, MediaTicketBoundIssue, MediaTicketIssue, MediaTicketKind,
        MediaTicketPurpose, MediaTicketRecord, MediaTicketStore, MAX_MEDIA_TICKETS,
        MEDIA_TICKET_ABSOLUTE_TTL, MEDIA_TICKET_IDLE_TTL,
    },
};

pub const MAX_VIDEO_TICKETS: usize = MAX_MEDIA_TICKETS;
pub const VIDEO_TICKET_IDLE_TTL: std::time::Duration = MEDIA_TICKET_IDLE_TTL;
pub const VIDEO_TICKET_ABSOLUTE_TTL: std::time::Duration = MEDIA_TICKET_ABSOLUTE_TTL;

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

pub type VideoFileVersion = MediaFileVersion;

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
    media: MediaTicketStore,
}

impl Default for VideoStreamTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoStreamTicketStore {
    pub fn new() -> Self {
        Self::from_media(MediaTicketStore::new())
    }

    pub(crate) fn from_media(media: MediaTicketStore) -> Self {
        Self { media }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.media.generation()
    }

    pub(crate) fn issue_bound(
        &self,
        expected_generation: u64,
        actor_subject: &str,
        existing: Option<MediaSessionToken>,
        record: VideoTicketRecord,
    ) -> Result<(VideoTicketLease, super::media_session::MediaSessionLease), VideoTicketIssue> {
        let purpose = record.purpose;
        match self.media.issue_bound(
            expected_generation,
            actor_subject,
            existing,
            record.into_media(),
        ) {
            MediaTicketBoundIssue::Issued(lease) => Ok((
                VideoTicketLease {
                    ticket: lease.ticket.ticket,
                    expires_at_epoch_ms: lease.ticket.expires_at_epoch_ms,
                    purpose,
                },
                lease.session,
            )),
            MediaTicketBoundIssue::Capacity => Err(VideoTicketIssue::Capacity),
            MediaTicketBoundIssue::ContextChanged => Err(VideoTicketIssue::ContextChanged),
        }
    }

    pub(crate) fn issue(
        &self,
        expected_generation: u64,
        record: VideoTicketRecord,
    ) -> VideoTicketIssue {
        let purpose = record.purpose;
        match self.media.issue(expected_generation, record.into_media()) {
            MediaTicketIssue::Issued(lease) => VideoTicketIssue::Issued(VideoTicketLease {
                ticket: lease.ticket,
                expires_at_epoch_ms: lease.expires_at_epoch_ms,
                purpose,
            }),
            MediaTicketIssue::Capacity => VideoTicketIssue::Capacity,
            MediaTicketIssue::ContextChanged => VideoTicketIssue::ContextChanged,
        }
    }

    /// Unknown, expired, revoked, and non-video tickets all return `None`.
    pub fn lookup_and_touch(&self, ticket: &str) -> Option<VideoTicketRecord> {
        self.media
            .lookup_and_touch(ticket, MediaTicketKind::Video)
            .and_then(VideoTicketRecord::from_media)
    }

    pub(crate) fn authorize_bound(
        &self,
        ticket: &str,
        token: &MediaSessionToken,
    ) -> Option<super::media_ticket::MediaTicketAuthorization> {
        self.media
            .authorize_bound(ticket, MediaTicketKind::Video, token)
    }

    pub(crate) fn finalize_bound_and_touch(
        &self,
        ticket: &str,
        token: &MediaSessionToken,
        authorization: &super::media_ticket::MediaTicketAuthorization,
    ) -> bool {
        self.media
            .finalize_bound_and_touch(ticket, MediaTicketKind::Video, token, authorization)
    }

    pub(crate) fn revoke_bound(
        &self,
        ticket: &str,
        actor_subject: &str,
        token: &MediaSessionToken,
    ) {
        self.media
            .revoke_bound(ticket, MediaTicketKind::Video, actor_subject, token);
    }

    pub fn revoke(&self, ticket: &str) {
        self.media.revoke(ticket, MediaTicketKind::Video);
    }

    pub fn revoke_all(&self) {
        self.media.revoke_all();
    }
}

impl VideoTicketRecord {
    pub(crate) fn into_media(self) -> MediaTicketRecord {
        MediaTicketRecord {
            kind: MediaTicketKind::Video,
            purpose: match self.purpose {
                VideoTicketPurpose::Playback => MediaTicketPurpose::Playback,
                VideoTicketPurpose::Download => MediaTicketPurpose::Download,
            },
            project: self.project,
            project_relative_path: self.project_relative_path,
            file: self.file,
            mime: self.mime,
            filename: self.filename,
        }
    }

    fn from_media(record: MediaTicketRecord) -> Option<Self> {
        let purpose = match record.purpose {
            MediaTicketPurpose::Playback => VideoTicketPurpose::Playback,
            MediaTicketPurpose::Download => VideoTicketPurpose::Download,
            MediaTicketPurpose::Preview => return None,
        };
        (record.kind == MediaTicketKind::Video).then_some(Self {
            purpose,
            project: record.project,
            project_relative_path: record.project_relative_path,
            file: record.file,
            mime: record.mime,
            filename: record.filename,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_is_case_insensitive_and_closed() {
        assert!(is_supported_video(Path::new("clip.M4V")));
        assert!(is_supported_video(Path::new("clip.ogg")));
        assert!(!is_supported_video(Path::new("clip.avi")));
        assert!(!is_supported_video(Path::new("clip")));
    }

    #[test]
    fn video_adapter_keeps_purpose_values_stable() {
        let record = VideoTicketRecord {
            purpose: VideoTicketPurpose::Download,
            project: "project".into(),
            project_relative_path: PathBuf::from("clip.webm"),
            file: MediaFileVersion {
                canonical_path: PathBuf::from("/private/clip.webm"),
                size: 1,
                modified: std::time::SystemTime::UNIX_EPOCH,
                validator: "opaque".into(),
                #[cfg(unix)]
                device: 1,
                #[cfg(unix)]
                inode: 1,
                #[cfg(windows)]
                volume_serial: None,
                #[cfg(windows)]
                file_index: None,
            },
            mime: "video/webm".into(),
            filename: "clip.webm".into(),
        };
        assert_eq!(
            VideoTicketRecord::from_media(record.clone().into_media())
                .unwrap()
                .purpose,
            VideoTicketPurpose::Download
        );
        let mut image_record = record.into_media();
        image_record.kind = MediaTicketKind::Image;
        assert!(VideoTicketRecord::from_media(image_record).is_none());
    }

    #[test]
    fn video_adapter_preserves_issue_lookup_and_revoke_lifecycle() {
        let store = VideoStreamTicketStore::from_media(MediaTicketStore::new());
        let playback = match store.issue(
            store.generation(),
            VideoTicketRecord {
                purpose: VideoTicketPurpose::Playback,
                ..record(VideoTicketPurpose::Playback)
            },
        ) {
            VideoTicketIssue::Issued(lease) => lease,
            VideoTicketIssue::Capacity | VideoTicketIssue::ContextChanged => {
                panic!("video ticket should be issued")
            }
        };
        let download = match store.issue(
            store.generation(),
            VideoTicketRecord {
                purpose: VideoTicketPurpose::Download,
                ..record(VideoTicketPurpose::Download)
            },
        ) {
            VideoTicketIssue::Issued(lease) => lease,
            VideoTicketIssue::Capacity | VideoTicketIssue::ContextChanged => {
                panic!("video ticket should be issued")
            }
        };

        assert_eq!(
            store.lookup_and_touch(&playback.ticket).unwrap().purpose,
            VideoTicketPurpose::Playback
        );
        assert_eq!(
            store.lookup_and_touch(&download.ticket).unwrap().purpose,
            VideoTicketPurpose::Download
        );
        store.revoke(&playback.ticket);
        assert!(store.lookup_and_touch(&playback.ticket).is_none());
        assert!(store.lookup_and_touch(&download.ticket).is_some());
    }

    fn record(purpose: VideoTicketPurpose) -> VideoTicketRecord {
        VideoTicketRecord {
            purpose,
            project: "project".into(),
            project_relative_path: PathBuf::from("clip.webm"),
            file: MediaFileVersion {
                canonical_path: PathBuf::from("/private/clip.webm"),
                size: 1,
                modified: std::time::SystemTime::UNIX_EPOCH,
                validator: "opaque".into(),
                #[cfg(unix)]
                device: 1,
                #[cfg(unix)]
                inode: 1,
                #[cfg(windows)]
                volume_serial: None,
                #[cfg(windows)]
                file_index: None,
            },
            mime: "video/webm".into(),
            filename: "clip.webm".into(),
        }
    }
}
