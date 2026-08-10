use std::path::{Path, PathBuf};

use serde::Serialize;

use super::media_ticket::{
    MediaFileVersion, MediaTicketIssue, MediaTicketKind, MediaTicketPurpose, MediaTicketRecord,
    MediaTicketStore, MAX_MEDIA_TICKETS,
};

pub const MAX_IMAGE_TICKETS: usize = MAX_MEDIA_TICKETS;

const IMAGE_TYPES: [(&str, &str); 5] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageTicketPurpose {
    Preview,
}

pub fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?;
    IMAGE_TYPES
        .iter()
        .find(|(allowed, _)| extension.eq_ignore_ascii_case(allowed))
        .map(|(_, mime)| *mime)
}

pub fn is_supported_image(path: &Path) -> bool {
    image_mime(path).is_some()
}

#[derive(Clone)]
pub struct ImageTicketRecord {
    pub project: String,
    pub project_relative_path: PathBuf,
    pub file: MediaFileVersion,
    pub mime: String,
    pub filename: String,
}

#[derive(Clone)]
pub struct ImageTicketLease {
    pub ticket: String,
    pub expires_at_epoch_ms: u128,
}

pub(crate) enum ImageTicketIssue {
    Issued(ImageTicketLease),
    Capacity,
    ContextChanged,
}

#[derive(Clone)]
pub struct ImageStreamTicketStore {
    media: MediaTicketStore,
}

impl Default for ImageStreamTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageStreamTicketStore {
    pub fn new() -> Self {
        Self::from_media(MediaTicketStore::new())
    }

    pub(crate) fn from_media(media: MediaTicketStore) -> Self {
        Self { media }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.media.generation()
    }

    pub(crate) fn issue(
        &self,
        expected_generation: u64,
        record: ImageTicketRecord,
    ) -> ImageTicketIssue {
        match self.media.issue(expected_generation, record.into_media()) {
            MediaTicketIssue::Issued(lease) => ImageTicketIssue::Issued(ImageTicketLease {
                ticket: lease.ticket,
                expires_at_epoch_ms: lease.expires_at_epoch_ms,
            }),
            MediaTicketIssue::Capacity => ImageTicketIssue::Capacity,
            MediaTicketIssue::ContextChanged => ImageTicketIssue::ContextChanged,
        }
    }

    /// Unknown, expired, revoked, and non-image tickets all return `None`.
    pub fn lookup_and_touch(&self, ticket: &str) -> Option<ImageTicketRecord> {
        self.media
            .lookup_and_touch(ticket, MediaTicketKind::Image)
            .and_then(ImageTicketRecord::from_media)
    }

    pub fn revoke(&self, ticket: &str) {
        self.media.revoke(ticket, MediaTicketKind::Image);
    }

    pub fn revoke_all(&self) {
        self.media.revoke_all();
    }
}

impl ImageTicketRecord {
    pub(crate) fn into_media(self) -> MediaTicketRecord {
        MediaTicketRecord {
            kind: MediaTicketKind::Image,
            purpose: MediaTicketPurpose::Preview,
            project: self.project,
            project_relative_path: self.project_relative_path,
            file: self.file,
            mime: self.mime,
            filename: self.filename,
        }
    }

    fn from_media(record: MediaTicketRecord) -> Option<Self> {
        (record.kind == MediaTicketKind::Image && record.purpose == MediaTicketPurpose::Preview)
            .then_some(Self {
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
    fn image_allowlist_is_case_insensitive_and_closed() {
        for extension in ["PNG", "jpg", "JPEG", "gif", "WebP"] {
            assert!(is_supported_image(Path::new(&format!(
                "preview.{extension}"
            ))));
        }
        for extension in ["svg", "avif", "bmp", "tiff", "txt", ""] {
            assert!(!is_supported_image(Path::new(&format!(
                "preview.{extension}"
            ))));
        }
        assert_eq!(image_mime(Path::new("preview.JPG")), Some("image/jpeg"));
    }
}
