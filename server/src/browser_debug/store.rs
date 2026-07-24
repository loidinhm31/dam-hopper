use std::{
    collections::HashMap,
    io::{Cursor, Write},
    path::PathBuf,
    sync::Arc,
};

use axum::body::Bytes;
use chrono::Utc;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{
    BrowserDebugArtifactResponse, BrowserDebugError, BrowserSelectionV1, ARTIFACT_TTL_MS,
    MAX_PNG_BYTES, MAX_SELECTION_JSON_BYTES,
};

#[derive(Clone)]
pub struct BrowserDebugArtifactManager {
    pub(super) root: Arc<TempDir>,
    pub(super) entries: Arc<RwLock<HashMap<Uuid, ArtifactMetadata>>>,
}

#[derive(Clone)]
pub(super) struct ArtifactMetadata {
    terminal_id: String,
    pub(super) expires_at: i64,
    json: ArtifactFile,
    png: Option<ArtifactFile>,
    png_uploading: bool,
    handoff_claimed: bool,
}

#[derive(Clone)]
struct ArtifactFile {
    path: PathBuf,
    size: u64,
    sha256: String,
}

impl BrowserDebugArtifactManager {
    pub fn new() -> Result<Self, BrowserDebugError> {
        Ok(Self {
            root: Arc::new(
                tempfile::Builder::new()
                    .prefix("dam-hopper-browser-debug-")
                    .tempdir()?,
            ),
            entries: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    pub async fn create(
        &self,
        terminal_id: String,
        selection: BrowserSelectionV1,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        if !selection.is_valid() {
            return Err(BrowserDebugError::InvalidSelection);
        }
        let json =
            serde_json::to_vec(&selection).map_err(|_| BrowserDebugError::InvalidSelection)?;
        if json.len() > MAX_SELECTION_JSON_BYTES {
            return Err(BrowserDebugError::TooLarge);
        }
        let id = Uuid::new_v4();
        let json_path = self.root.path().join(format!("{id}.json"));
        let json_file = write_file(json_path, Bytes::from(json)).await?;
        let metadata = ArtifactMetadata {
            terminal_id,
            expires_at: Utc::now().timestamp_millis() + ARTIFACT_TTL_MS,
            json: json_file,
            png: None,
            png_uploading: false,
            handoff_claimed: false,
        };
        let response = response_for(id, &metadata);
        self.entries.write().await.insert(id, metadata);
        tracing::info!(artifact_id = %id, size = response.json_size, sha256 = %response.json_sha256, "browser debug artifact created");
        Ok(response)
    }

    pub async fn upload_png(
        &self,
        id: Uuid,
        png: Bytes,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        if png.len() > MAX_PNG_BYTES {
            return Err(BrowserDebugError::TooLarge);
        }
        if !is_png(&png) {
            return Err(BrowserDebugError::InvalidPng);
        }
        let png_path = match {
            let mut entries = self.entries.write().await;
            if entries.get(&id).is_none() {
                Err(None)
            } else if entries.get(&id).is_some_and(expired) {
                Err(entries.remove(&id))
            } else {
                let metadata = entries.get_mut(&id).expect("entry was checked above");
                if metadata.handoff_claimed {
                    return Err(BrowserDebugError::AlreadyHandedOff);
                }
                if metadata.png.is_some() || metadata.png_uploading {
                    return Err(BrowserDebugError::PngAlreadyUploaded);
                }
                metadata.png_uploading = true;
                Ok(self.root.path().join(format!("{id}.png")))
            }
        } {
            Ok(path) => path,
            Err(metadata) => {
                if let Some(metadata) = metadata {
                    self.retry_expired_cleanup(id, metadata, "before PNG upload")
                        .await;
                }
                return Err(BrowserDebugError::NotFound);
            }
        };
        let png_file = match write_file(png_path.clone(), png).await {
            Ok(file) => file,
            Err(error) => {
                self.clear_upload_reservation(id).await;
                return Err(error);
            }
        };
        let result = {
            let mut entries = self.entries.write().await;
            if entries.get(&id).is_none() {
                Err(None)
            } else if entries.get(&id).is_some_and(expired) {
                Err(entries.remove(&id))
            } else {
                let metadata = entries.get_mut(&id).expect("entry was checked above");
                metadata.png_uploading = false;
                metadata.png = Some(png_file.clone());
                Ok(response_for(id, metadata))
            }
        };
        match result {
            Ok(response) => {
                tracing::info!(artifact_id = %id, size = png_file.size, sha256 = %png_file.sha256, "browser debug PNG uploaded");
                Ok(response)
            }
            Err(metadata) => {
                remove_or_log(vec![png_path], "discard PNG after upload race").await;
                if let Some(metadata) = metadata {
                    self.retry_expired_cleanup(id, metadata, "during PNG upload")
                        .await;
                }
                Err(BrowserDebugError::NotFound)
            }
        }
    }

    pub async fn delete(&self, id: Uuid) -> Result<(), BrowserDebugError> {
        let metadata = {
            let mut entries = self.entries.write().await;
            let metadata = entries.get(&id).ok_or(BrowserDebugError::NotFound)?;
            if metadata.handoff_claimed {
                return Err(BrowserDebugError::AlreadyHandedOff);
            }
            entries.remove(&id).expect("entry was checked above")
        };
        if let Err(error) = remove_files(paths_for(&metadata)).await {
            self.entries.write().await.insert(id, metadata);
            return Err(error);
        }
        tracing::info!(artifact_id = %id, "browser debug artifact deleted");
        Ok(())
    }

    /// Atomically reserves an artifact for its one permitted terminal write.
    /// A failed terminal write must call `release_handoff` so a later retry can
    /// still succeed while the artifact remains available.
    pub async fn claim_handoff(
        &self,
        id: Uuid,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        enum Claim {
            Claimed(BrowserDebugArtifactResponse),
            Expired(ArtifactMetadata),
            Missing,
            Unavailable(BrowserDebugError),
        }

        let claim = {
            let mut entries = self.entries.write().await;
            match entries.get(&id) {
                None => Claim::Missing,
                Some(metadata) if expired(metadata) => {
                    Claim::Expired(entries.remove(&id).expect("entry was checked above"))
                }
                Some(metadata) if metadata.handoff_claimed => {
                    Claim::Unavailable(BrowserDebugError::AlreadyHandedOff)
                }
                Some(metadata) if metadata.png_uploading => {
                    Claim::Unavailable(BrowserDebugError::ArtifactBusy)
                }
                Some(_) => {
                    let metadata = entries.get_mut(&id).expect("entry was checked above");
                    metadata.handoff_claimed = true;
                    Claim::Claimed(response_for(id, metadata))
                }
            }
        };
        match claim {
            Claim::Claimed(response) => Ok(response),
            Claim::Expired(metadata) => {
                self.retry_expired_cleanup(id, metadata, "before terminal handoff")
                    .await;
                Err(BrowserDebugError::NotFound)
            }
            Claim::Missing => Err(BrowserDebugError::NotFound),
            Claim::Unavailable(error) => Err(error),
        }
    }

    pub async fn release_handoff(&self, id: Uuid) {
        if let Some(metadata) = self.entries.write().await.get_mut(&id) {
            metadata.handoff_claimed = false;
        }
    }

    pub async fn sweep_expired(&self) {
        let expired = {
            let mut entries = self.entries.write().await;
            let ids = entries
                .iter()
                .filter_map(|(id, metadata)| expired(metadata).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| entries.remove(&id).map(|metadata| (id, metadata)))
                .collect::<Vec<_>>()
        };
        for (id, metadata) in expired {
            if let Err(error) = remove_files(paths_for(&metadata)).await {
                tracing::warn!(artifact_id = %id, error = %error, "browser debug artifact expiry cleanup failed");
                self.entries.write().await.insert(id, metadata);
                continue;
            }
            tracing::info!(artifact_id = %id, "browser debug artifact expired");
        }
    }

    pub async fn dispose_all(&self) {
        let entries = std::mem::take(&mut *self.entries.write().await);
        for metadata in entries.into_values() {
            remove_or_log(paths_for(&metadata), "shutdown").await;
        }
        let root = self.root.path().to_path_buf();
        match tokio::task::spawn_blocking(move || std::fs::remove_dir_all(root)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(error = %error, "browser debug root cleanup failed"),
            Err(error) => tracing::warn!(error = %error, "browser debug root cleanup task failed"),
        }
    }

    async fn clear_upload_reservation(&self, id: Uuid) {
        if let Some(metadata) = self.entries.write().await.get_mut(&id) {
            metadata.png_uploading = false;
        }
    }

    async fn retry_expired_cleanup(
        &self,
        id: Uuid,
        metadata: ArtifactMetadata,
        stage: &'static str,
    ) {
        if let Err(error) = remove_files(paths_for(&metadata)).await {
            tracing::warn!(artifact_id = %id, error = %error, stage, "browser debug expired artifact cleanup failed");
            self.entries.write().await.insert(id, metadata);
        }
    }
}

fn expired(metadata: &ArtifactMetadata) -> bool {
    metadata.expires_at <= Utc::now().timestamp_millis()
}

fn response_for(id: Uuid, metadata: &ArtifactMetadata) -> BrowserDebugArtifactResponse {
    BrowserDebugArtifactResponse {
        artifact_id: id.to_string(),
        terminal_id: metadata.terminal_id.clone(),
        expires_at: metadata.expires_at,
        json_path: metadata.json.path.display().to_string(),
        json_size: metadata.json.size,
        json_sha256: metadata.json.sha256.clone(),
        png_path: metadata
            .png
            .as_ref()
            .map(|file| file.path.display().to_string()),
        png_size: metadata.png.as_ref().map(|file| file.size),
        png_sha256: metadata.png.as_ref().map(|file| file.sha256.clone()),
    }
}

fn paths_for(metadata: &ArtifactMetadata) -> Vec<PathBuf> {
    std::iter::once(metadata.json.path.clone())
        .chain(metadata.png.iter().map(|file| file.path.clone()))
        .collect()
}

async fn write_file(path: PathBuf, bytes: Bytes) -> Result<ArtifactFile, BrowserDebugError> {
    tokio::task::spawn_blocking(move || write_file_sync(path, bytes))
        .await
        .map_err(|error| BrowserDebugError::Task(error.to_string()))?
}

fn write_file_sync(path: PathBuf, bytes: Bytes) -> Result<ArtifactFile, BrowserDebugError> {
    let parent = path
        .parent()
        .ok_or_else(|| BrowserDebugError::Task("artifact path has no parent".into()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    temp.write_all(bytes.as_ref())?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(&path)
        .map_err(|error| BrowserDebugError::Io(error.error))?;
    Ok(ArtifactFile {
        path,
        size: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes.as_ref())),
    })
}

async fn remove_files(paths: Vec<PathBuf>) -> Result<(), BrowserDebugError> {
    tokio::task::spawn_blocking(move || {
        for path in paths {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| BrowserDebugError::Task(error.to_string()))??;
    Ok(())
}

async fn remove_or_log(paths: Vec<PathBuf>, operation: &'static str) {
    if let Err(error) = remove_files(paths).await {
        tracing::warn!(error = %error, operation, "browser debug artifact cleanup failed");
    }
}

fn is_png(bytes: &[u8]) -> bool {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const MAX_DECODED_PNG_BYTES: usize = 64 * 1024 * 1024;
    if !bytes.starts_with(SIGNATURE) {
        return false;
    }
    let mut offset = SIGNATURE.len();
    let mut saw_ihdr = false;
    let mut saw_idat = false;
    let mut idat_finished = false;
    while offset < bytes.len() {
        let Some(header_end) = offset.checked_add(8) else {
            return false;
        };
        if header_end > bytes.len() {
            return false;
        }
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let Some(chunk_end) = header_end
            .checked_add(length)
            .and_then(|end| end.checked_add(4))
        else {
            return false;
        };
        if chunk_end > bytes.len() {
            return false;
        }
        let kind = &bytes[offset + 4..header_end];
        let data = &bytes[header_end..header_end + length];
        let checksum =
            u32::from_be_bytes(bytes[header_end + length..chunk_end].try_into().unwrap());
        if !kind.iter().all(u8::is_ascii_alphabetic)
            || png_crc32(&bytes[offset + 4..header_end + length]) != checksum
        {
            return false;
        }
        if !saw_ihdr {
            if kind != b"IHDR"
                || length != 13
                || data[..4].iter().all(|byte| *byte == 0)
                || data[4..8].iter().all(|byte| *byte == 0)
            {
                return false;
            }
            saw_ihdr = true;
        } else if kind == b"IHDR" || (kind == b"IDAT" && idat_finished) {
            return false;
        } else if kind == b"IDAT" {
            saw_idat |= !data.is_empty();
        } else if kind == b"IEND" {
            if length != 0 || !saw_idat || chunk_end != bytes.len() {
                return false;
            }
            let decoder = png::Decoder::new(Cursor::new(bytes));
            let Ok(mut reader) = decoder.read_info() else {
                return false;
            };
            if reader.output_buffer_size() > MAX_DECODED_PNG_BYTES {
                return false;
            }
            let mut output = vec![0; reader.output_buffer_size()];
            return reader.next_frame(&mut output).is_ok();
        } else if saw_idat {
            idat_finished = true;
        }
        offset = chunk_end;
    }
    false
}

fn png_crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}
