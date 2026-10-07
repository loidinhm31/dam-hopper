//! Secure file preparation, connection setup and versioned schema migration
//! for the SQLite authentication database.
//!
//! Every failure aborts the open: an unsafe, unwritable, foreign, corrupt or
//! newer-schema database never selects another backend and never authorizes.
use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, TransactionBehavior};

use crate::auth::store::StoreError;

/// `PRAGMA application_id` stamped on every authentication database ("DHAU").
const APPLICATION_ID: i64 = 0x4448_4155;

/// Ordered migrations; entry `n` upgrades schema version `n` to `n + 1`.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/001-auth.sql")];

/// Bounded wait for a competing writer; matches the 2s database admission cap.
const BUSY_TIMEOUT: Duration = Duration::from_millis(2_000);

fn unavailable(detail: impl std::fmt::Display) -> StoreError {
    StoreError::Unavailable(detail.to_string())
}

/// Create/validate the private file, open it, configure the connection and
/// bring the schema to the latest version.
pub(super) fn open_connection(path: &Path) -> Result<Connection, StoreError> {
    prepare_file(path)?;
    // The file exists after `prepare_file`, so no CREATE flag; NOFOLLOW makes
    // SQLite itself refuse a symlink swapped in after the check.
    let mut conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    // Identity/version gate runs before any pragma that would mutate a
    // foreign database file.
    read_version(&conn)?;
    let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(unavailable(format_args!(
            "authentication database cannot use WAL journaling (got '{mode}')"
        )));
    }
    // FULL: a revocation/consumption must survive power loss, never OFF.
    conn.execute_batch("PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Current schema version, or an error for a foreign/newer database.
///
/// `Ok(0)` only for a brand-new empty file.
fn read_version(conn: &Connection) -> Result<usize, StoreError> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application_id: i64 = conn.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let has_objects: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%')",
        [],
        |row| row.get(0),
    )?;
    let latest = MIGRATIONS.len();
    if version == 0 && application_id == 0 && !has_objects {
        return Ok(0);
    }
    if application_id != APPLICATION_ID || version < 1 {
        return Err(unavailable(
            "file is not a DamHopper authentication database",
        ));
    }
    match usize::try_from(version) {
        Ok(version) if version <= latest => Ok(version),
        _ => Err(unavailable(format_args!(
            "authentication database schema version {version} is newer than supported version {latest}"
        ))),
    }
}

/// Apply pending migrations atomically. A concurrent opener serializes on the
/// IMMEDIATE lock and re-reads the version, so each migration runs once.
fn migrate(conn: &mut Connection) -> Result<(), StoreError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = read_version(&tx)?;
    if current == MIGRATIONS.len() {
        return Ok(());
    }
    for sql in &MIGRATIONS[current..] {
        tx.execute_batch(sql)?;
    }
    tx.pragma_update(None, "application_id", APPLICATION_ID)?;
    tx.pragma_update(None, "user_version", MIGRATIONS.len() as i64)?;
    tx.commit()?;
    Ok(())
}

/// Create the owner-private parent directory and database file.
///
/// Unix: directories are created `0700`; an existing parent that group/others
/// can write is rejected (they could swap the file or sidecars). The file is
/// created `0600` with `O_NOFOLLOW`, and an existing file with group/other
/// permission bits is rejected. SQLite creates the `-wal`/`-shm` sidecars with
/// the main file's mode, so they inherit `0600`.
fn prepare_file(path: &Path) -> Result<(), StoreError> {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    create_private_dir(parent)?;

    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(not(unix))]
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(unavailable("authentication database path is a symlink"));
    }
    let file = options.open(path).map_err(|error| {
        unavailable(format_args!("cannot open authentication database: {error}"))
    })?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(unavailable(
            "authentication database path is not a regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(unavailable(
                "authentication database must not be accessible to group or others (expected mode 0600)",
            ));
        }
    }
    Ok(())
}

fn create_private_dir(dir: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        let metadata = fs::metadata(dir)?;
        if !metadata.is_dir() {
            return Err(unavailable(
                "authentication database parent is not a directory",
            ));
        }
        if metadata.permissions().mode() & 0o022 != 0 {
            return Err(unavailable(
                "authentication database directory must not be writable by group or others",
            ));
        }
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir)?;
    Ok(())
}
