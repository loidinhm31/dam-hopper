use std::time::Duration;

pub const MAX_PACKAGE_COMPRESSED_BYTES: u64 = 32 * 1024 * 1024; // 32 MiB
pub const MAX_PACKAGE_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024; // 64 MiB
pub const MAX_STAGE_CHUNK_BYTES: usize = 512 * 1024; // 512 KiB
pub const MAX_ARCHIVE_ENTRIES: usize = 2048;
pub const MAX_UI_DOCUMENT_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB
pub const STAGE_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
pub const STAGE_EXPIRATION_SECONDS: i64 = 300; // 5 minutes
pub const MAX_PATH_LENGTH: usize = 1024;
pub const MAX_ENTRY_NAME_LENGTH: usize = 255;
