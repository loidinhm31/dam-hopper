//! Refusal-based provisioning of the API runtime state and audit paths.
//!
//! The production path is intentionally fixed.  It opens the trusted layout root,
//! walks fixed components with directory descriptors, and never follows a symlink
//! or repairs metadata that was not created by this invocation.

use super::account::{resolve_api_runtime_identity, ApiRuntimeIdentity};
use super::error::ReleaseError;
use super::layout::Layout;
use super::unit_parser::ParsedUnit;
use std::ffi::CString;
use std::fs;
use std::io;
use std::os::fd::RawFd;
use std::path::Path;

const ROOT_DIR_MODE: u32 = 0o755;
const API_DIR_MODE: u32 = 0o700;
const AUDIT_FILE_MODE: u32 = 0o600;
const CONFIG_FILE_MODE: u32 = 0o600;
const LEGACY_CONFIG_MODE: u32 = 0o644;

const VAR_PATH: &str = "/var";
const VAR_LIB_PATH: &str = "/var/lib";
const API_STATE_PATH: &str = "/var/lib/dam-hopper";
const API_DOT_CONFIG_PATH: &str = "/var/lib/dam-hopper/.config";
const API_CONFIG_PATH: &str = "/var/lib/dam-hopper/.config/dam-hopper";
const CANONICAL_CONFIG_PATH: &str = "/var/lib/dam-hopper/dam-hopper.toml";
const CONFIG_TEMP_PATH: &str = "/var/lib/dam-hopper/.dam-hopper.toml.provisioning";
const AUDIT_PATH: &str = "/var/lib/dam-hopper/idle-suspend-audit.jsonl";

const ETC_PATH: &str = "/etc";
const API_ETC_PATH: &str = "/etc/dam-hopper";
const LEGACY_CONFIG_PATH: &str = "/etc/dam-hopper/dam-hopper.toml";

const CONFIG_NAME: &str = "dam-hopper.toml";
const CONFIG_TEMP_NAME: &str = ".dam-hopper.toml.provisioning";
const AUDIT_NAME: &str = "idle-suspend-audit.jsonl";

const MAX_CONFIG_BYTES: u64 = 64 * 1024;
const SEED_CONFIG_BYTES: &[u8] = b"[workspace]\nname = \"default\"\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ObjectType {
    Directory,
    RegularFile,
    Symlink,
    Other,
}

impl ObjectType {
    fn label(self) -> &'static str {
        match self {
            Self::Directory => "directory",
            Self::RegularFile => "regular-file",
            Self::Symlink => "symlink",
            Self::Other => "special-file",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Stat {
    pub(crate) object_type: ObjectType,
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    pub(crate) mode: u32,
    pub(crate) dev: u64,
    pub(crate) ino: u64,
    pub(crate) size: u64,
}

impl Stat {
    fn identity(self) -> ObjectIdentity {
        ObjectIdentity {
            dev: self.dev,
            ino: self.ino,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ObjectIdentity {
    dev: u64,
    ino: u64,
}

#[derive(Debug)]
struct DirFd(RawFd);

impl Drop for DirFd {
    fn drop(&mut self) {
        // Closing a descriptor during error cleanup is best effort; the primary
        // operation error is more useful than a close error.
        unsafe {
            libc::close(self.0);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreatedKind {
    Directory,
    RegularFile,
    UnpublishedTemp,
}
#[derive(Debug)]
struct CreatedObject {
    parent: RawFd,
    name: &'static str,
    path: &'static str,
    kind: CreatedKind,
    identity: Option<ObjectIdentity>,
}

/// Private syscall seam.  Production uses `LinuxSyscalls`; unit tests can
/// inject deterministic failures without supplying arbitrary filesystem paths.
trait RuntimeSyscalls {
    fn open_root(&self, root: &Path) -> io::Result<RawFd>;
    fn stat_at(&self, parent: RawFd, name: &'static str) -> io::Result<Stat>;
    fn open_dir_at(&self, parent: RawFd, name: &'static str) -> io::Result<RawFd>;
    fn mkdir_at(&self, parent: RawFd, name: &'static str, mode: u32) -> io::Result<()>;
    fn open_existing_file_at(
        &self,
        parent: RawFd,
        name: &'static str,
    ) -> io::Result<RawFd>;
    fn create_file_at(
        &self,
        parent: RawFd,
        name: &'static str,
        mode: u32,
    ) -> io::Result<RawFd>;
    fn open_readable_file_at(
        &self,
        parent: RawFd,
        name: &'static str,
    ) -> io::Result<RawFd>;
    fn read_bounded(
        &self,
        fd: RawFd,
        limit: usize,
    ) -> io::Result<Vec<u8>>;
    fn write_all(
        &self,
        fd: RawFd,
        bytes: &[u8],
    ) -> io::Result<()>;
    fn sync_file(&self, fd: RawFd) -> io::Result<()>;
    fn sync_dir(&self, fd: RawFd) -> io::Result<()>;
    fn rename_no_replace(
        &self,
        old_dir: RawFd,
        old_name: &'static str,
        new_dir: RawFd,
        new_name: &'static str,
    ) -> io::Result<()>;
    fn fstat(&self, fd: RawFd) -> io::Result<Stat>;
    fn chown(&self, fd: RawFd, uid: u32, gid: u32) -> io::Result<()>;
    fn chmod(&self, fd: RawFd, mode: u32) -> io::Result<()>;
    fn unlink(
        &self,
        parent: RawFd,
        name: &'static str,
        kind: CreatedKind,
        identity: ObjectIdentity,
    ) -> io::Result<()>;
}

#[derive(Debug, Default, Clone, Copy)]
struct LinuxSyscalls;

impl LinuxSyscalls {
    fn c_name(name: &str) -> io::Result<CString> {
        CString::new(name).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))
    }

    fn c_path(path: &Path) -> io::Result<CString> {
        use std::os::unix::ffi::OsStrExt;
        CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))
    }
    fn stat_from(raw: &libc::stat) -> Stat {
        let kind = match raw.st_mode & libc::S_IFMT {
            libc::S_IFDIR => ObjectType::Directory,
            libc::S_IFREG => ObjectType::RegularFile,
            libc::S_IFLNK => ObjectType::Symlink,
            _ => ObjectType::Other,
        };
        Stat {
            object_type: kind,
            uid: raw.st_uid,
            gid: raw.st_gid,
            mode: raw.st_mode & 0o7777,
            dev: raw.st_dev,
            ino: raw.st_ino,
            size: raw.st_size.max(0) as u64,
        }
}
}

impl RuntimeSyscalls for LinuxSyscalls {
    fn open_root(&self, root: &Path) -> io::Result<RawFd> {
        let name = Self::c_path(root)?;
        let fd = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(fd)
        }
    }

    fn stat_at(&self, parent: RawFd, name: &'static str) -> io::Result<Stat> {
        let name = Self::c_name(name)?;
        let mut raw = unsafe { std::mem::zeroed::<libc::stat>() };
        let rc = unsafe { libc::fstatat(parent, name.as_ptr(), &mut raw, libc::AT_SYMLINK_NOFOLLOW) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self::stat_from(&raw))
        }
    }

    fn open_dir_at(&self, parent: RawFd, name: &'static str) -> io::Result<RawFd> {
        let name = Self::c_name(name)?;
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(fd)
        }
    }

    fn mkdir_at(&self, parent: RawFd, name: &'static str, mode: u32) -> io::Result<()> {
        let name = Self::c_name(name)?;
        let rc = unsafe { libc::mkdirat(parent, name.as_ptr(), mode as libc::mode_t) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn open_existing_file_at(&self, parent: RawFd, name: &'static str) -> io::Result<RawFd> {
        let name = Self::c_name(name)?;
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_PATH | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(fd)
        }
    }

    fn create_file_at(&self, parent: RawFd, name: &'static str, mode: u32) -> io::Result<RawFd> {
        let name = Self::c_name(name)?;
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_WRONLY
                    | libc::O_CREAT
                    | libc::O_EXCL
                    | libc::O_NOFOLLOW
                    | libc::O_CLOEXEC,
                mode as libc::mode_t,
            )
        };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(fd)
        }
    }

    fn open_readable_file_at(&self, parent: RawFd, name: &'static str) -> io::Result<RawFd> {
        let name = Self::c_name(name)?;
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(fd)
        }
    }

    fn read_bounded(&self, fd: RawFd, limit: usize) -> io::Result<Vec<u8>> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        while buf.len() <= limit {
            let to_read = chunk.len().min(limit.saturating_add(1) - buf.len());
            if to_read == 0 {
                break;
            }
            let rc = unsafe {
                libc::read(
                    fd,
                    chunk.as_mut_ptr() as *mut libc::c_void,
                    to_read,
                )
            };
            if rc < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(err);
            }
            if rc == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..rc as usize]);
        }
        Ok(buf)
    }

    fn write_all(&self, fd: RawFd, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            let rc = unsafe {
                libc::write(
                    fd,
                    bytes.as_ptr() as *const libc::c_void,
                    bytes.len(),
                )
            };
            if rc < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(err);
            }
            if rc == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "failed to write whole buffer",
                ));
            }
            let written = rc as usize;
            bytes = &bytes[written..];
        }
        Ok(())
    }

    fn sync_file(&self, fd: RawFd) -> io::Result<()> {
        let rc = unsafe { libc::fsync(fd) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn sync_dir(&self, fd: RawFd) -> io::Result<()> {
        let rc = unsafe { libc::fsync(fd) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn rename_no_replace(
        &self,
        old_dir: RawFd,
        old_name: &'static str,
        new_dir: RawFd,
        new_name: &'static str,
    ) -> io::Result<()> {
        let old_c = Self::c_name(old_name)?;
        let new_c = Self::c_name(new_name)?;
        let rc = unsafe {
            libc::renameat2(
                old_dir,
                old_c.as_ptr(),
                new_dir,
                new_c.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn fstat(&self, fd: RawFd) -> io::Result<Stat> {
        let mut raw = unsafe { std::mem::zeroed::<libc::stat>() };
        let rc = unsafe { libc::fstat(fd, &mut raw) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self::stat_from(&raw))
        }
    }

    fn chown(&self, fd: RawFd, uid: u32, gid: u32) -> io::Result<()> {
        let rc = unsafe { libc::fchown(fd, uid, gid) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn chmod(&self, fd: RawFd, mode: u32) -> io::Result<()> {
        let rc = unsafe { libc::fchmod(fd, mode as libc::mode_t) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn unlink(
        &self,
        parent: RawFd,
        name: &'static str,
        kind: CreatedKind,
        identity: ObjectIdentity,
    ) -> io::Result<()> {
        let current = self.stat_at(parent, name)?;
        if current.identity() != identity {
            return Err(io::Error::from_raw_os_error(libc::EAGAIN));
        }
        match kind {
            CreatedKind::Directory if current.object_type != ObjectType::Directory => {
                return Err(io::Error::from_raw_os_error(libc::ENOTDIR));
            }
            CreatedKind::RegularFile | CreatedKind::UnpublishedTemp
                if current.object_type != ObjectType::RegularFile =>
            {
                return Err(io::Error::from_raw_os_error(libc::EINVAL));
            }
            CreatedKind::RegularFile if current.size != 0 => {
                return Err(io::Error::from_raw_os_error(libc::ENOTEMPTY));
            }
            _ => {}
        }

        let name = Self::c_name(name)?;
        let flags = match kind {
            CreatedKind::Directory => libc::AT_REMOVEDIR,
            CreatedKind::RegularFile | CreatedKind::UnpublishedTemp => 0,
        };
        let rc = unsafe { libc::unlinkat(parent, name.as_ptr(), flags) };
        if rc < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

fn errno(error: &io::Error) -> i32 {
    error.raw_os_error().unwrap_or(libc::EIO)
}

fn io_error(path: &'static str, operation: &'static str, error: io::Error) -> ReleaseError {
    ReleaseError::ApiRuntimeIo {
        path,
        operation,
        errno: errno(&error),
    }
}

fn mismatch(path: &'static str, expected: (ObjectType, u32, u32, u32), current: Stat) -> ReleaseError {
    ReleaseError::ApiRuntimeMetadataMismatch {
        path,
        expected_type: expected.0.label(),
        current_type: current.object_type.label(),
        expected_uid: expected.1,
        current_uid: current.uid,
        expected_gid: expected.2,
        current_gid: current.gid,
        expected_mode: expected.3,
        current_mode: current.mode,
    }
}

fn validate(path: &'static str, stat: Stat, expected: (ObjectType, u32, u32, u32)) -> Result<(), ReleaseError> {
    if stat.object_type != expected.0
        || stat.uid != expected.1
        || stat.gid != expected.2
        || stat.mode != expected.3
    {
        return Err(mismatch(path, expected, stat));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingDirModePolicy {
    Exact,
    TightenFrom(u32),
}

fn ensure_dir<S: RuntimeSyscalls>(
    sys: &S,
    parent: RawFd,
    name: &'static str,
    path: &'static str,
    uid: u32,
    gid: u32,
    mode: u32,
    policy: ExistingDirModePolicy,
    created: &mut Vec<CreatedObject>,
) -> Result<DirFd, ReleaseError> {
    let expected = (ObjectType::Directory, uid, gid, mode);
    let mut created_index = None;
    let fd = match sys.stat_at(parent, name) {
        Ok(stat) => {
            match policy {
                ExistingDirModePolicy::Exact => {
                    validate(path, stat, expected)?;
                }
                ExistingDirModePolicy::TightenFrom(legacy_mode) => {
                    if stat.object_type != ObjectType::Directory
                        || stat.uid != uid
                        || stat.gid != gid
                        || (stat.mode != mode && stat.mode != legacy_mode)
                    {
                        return Err(mismatch(path, expected, stat));
                    }
                }
            }
            sys.open_dir_at(parent, name)
                .map_err(|e| io_error(path, "open directory", e))?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            sys.mkdir_at(parent, name, mode)
                .map_err(|e| io_error(path, "create directory", e))?;
            created_index = Some(created.len());
            created.push(CreatedObject {
                parent,
                name,
                path,
                kind: CreatedKind::Directory,
                identity: None,
            });
            sys.open_dir_at(parent, name)
                .map_err(|e| io_error(path, "open created directory", e))?
        }
        Err(error) => return Err(io_error(path, "inspect directory", error)),
    };
    let guard = DirFd(fd);
    if let Some(index) = created_index {
        let stat = sys
            .fstat(guard.0)
            .map_err(|e| io_error(path, "identify created directory", e))?;
        created[index].identity = Some(stat.identity());
        sys.chown(guard.0, uid, gid)
            .map_err(|e| io_error(path, "set directory ownership", e))?;
        sys.chmod(guard.0, mode)
            .map_err(|e| io_error(path, "set directory mode", e))?;
    } else if let ExistingDirModePolicy::TightenFrom(legacy_mode) = policy {
        let current_stat = sys
            .fstat(guard.0)
            .map_err(|e| io_error(path, "verify directory metadata", e))?;
        if current_stat.object_type != ObjectType::Directory
            || current_stat.uid != uid
            || current_stat.gid != gid
            || (current_stat.mode != mode && current_stat.mode != legacy_mode)
        {
            return Err(mismatch(path, expected, current_stat));
        }
        if current_stat.mode == legacy_mode {
            sys.chmod(guard.0, mode)
                .map_err(|e| io_error(path, "tighten directory mode", e))?;
        }
    }
    let stat = sys
        .fstat(guard.0)
        .map_err(|e| io_error(path, "verify directory", e))?;
    validate(path, stat, expected)?;
    Ok(guard)
}

fn ensure_file<S: RuntimeSyscalls>(
    sys: &S,
    parent: RawFd,
    name: &'static str,
    path: &'static str,
    uid: u32,
    gid: u32,
    mode: u32,
    created: &mut Vec<CreatedObject>,
) -> Result<(), ReleaseError> {
    let expected = (ObjectType::RegularFile, uid, gid, mode);
    let mut created_index = None;
    let fd = match sys.stat_at(parent, name) {
        Ok(stat) => {
            validate(path, stat, expected)?;
            sys.open_existing_file_at(parent, name)
                .map_err(|e| io_error(path, "open file", e))?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let fd = sys
                .create_file_at(parent, name, mode)
                .map_err(|e| io_error(path, "create file", e))?;
            created_index = Some(created.len());
            created.push(CreatedObject {
                parent,
                name,
                path,
                kind: CreatedKind::RegularFile,
                identity: None,
            });
            fd
        }
        Err(error) => return Err(io_error(path, "inspect file", error)),
    };
    let guard = DirFd(fd);
    if let Some(index) = created_index {
        let stat = sys
            .fstat(guard.0)
            .map_err(|e| io_error(path, "identify created file", e))?;
        created[index].identity = Some(stat.identity());
        sys.chown(guard.0, uid, gid)
            .map_err(|e| io_error(path, "set file ownership", e))?;
        sys.chmod(guard.0, mode)
            .map_err(|e| io_error(path, "set file mode", e))?;
    }
    let stat = sys
        .fstat(guard.0)
        .map_err(|e| io_error(path, "verify file", e))?;
    validate(path, stat, expected)?;
    drop(guard);
    Ok(())
}

fn validate_toml_bytes(
    path: &'static str,
    bytes: &[u8],
    is_legacy: bool,
) -> Result<(), ReleaseError> {
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err(ReleaseError::ApiRuntimeConfigInvalid {
            path,
            reason: "exceeds maximum size of 65536 bytes",
        });
    }
    let s = std::str::from_utf8(bytes).map_err(|_| ReleaseError::ApiRuntimeConfigInvalid {
        path,
        reason: "not valid UTF-8",
    })?;
    let val: toml::Value = toml::from_str(s).map_err(|_| ReleaseError::ApiRuntimeConfigInvalid {
        path,
        reason: "invalid TOML syntax",
    })?;
    if is_legacy {
        if let Some(projects) = val.get("projects").and_then(toml::Value::as_array) {
            for proj in projects {
                if let Some(path_val) = proj.get("path") {
                    let path_str = path_val.as_str().ok_or_else(|| {
                        ReleaseError::ApiRuntimeConfigInvalid {
                            path,
                            reason: "contains relative or traversing project path",
                        }
                    })?;
                    let p = Path::new(path_str);
                    if !p.is_absolute()
                        || p.components().any(|c| matches!(c, std::path::Component::ParentDir))
                    {
                        return Err(ReleaseError::ApiRuntimeConfigInvalid {
                            path,
                            reason: "contains relative or traversing project path",
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

enum LegacyStatus {
    Absent,
    Valid(Vec<u8>),
}

fn inspect_legacy<S: RuntimeSyscalls>(
    sys: &S,
    root_fd: RawFd,
) -> Result<LegacyStatus, ReleaseError> {
    let etc_stat = match sys.stat_at(root_fd, "etc") {
        Ok(stat) => stat,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(LegacyStatus::Absent),
        Err(e) => return Err(io_error(ETC_PATH, "inspect directory", e)),
    };
    validate(ETC_PATH, etc_stat, (ObjectType::Directory, 0, 0, ROOT_DIR_MODE))?;
    let etc_fd = sys
        .open_dir_at(root_fd, "etc")
        .map_err(|e| io_error(ETC_PATH, "open directory", e))?;
    let etc_guard = DirFd(etc_fd);

    let api_etc_stat = match sys.stat_at(etc_guard.0, "dam-hopper") {
        Ok(stat) => stat,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(LegacyStatus::Absent),
        Err(e) => return Err(io_error(API_ETC_PATH, "inspect directory", e)),
    };
    validate(API_ETC_PATH, api_etc_stat, (ObjectType::Directory, 0, 0, ROOT_DIR_MODE))?;
    let api_etc_fd = sys
        .open_dir_at(etc_guard.0, "dam-hopper")
        .map_err(|e| io_error(API_ETC_PATH, "open directory", e))?;
    let api_etc_guard = DirFd(api_etc_fd);

    let legacy_config_stat = match sys.stat_at(api_etc_guard.0, CONFIG_NAME) {
        Ok(stat) => stat,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(LegacyStatus::Absent),
        Err(e) => return Err(io_error(LEGACY_CONFIG_PATH, "inspect configuration file", e)),
    };
    validate(
        LEGACY_CONFIG_PATH,
        legacy_config_stat,
        (ObjectType::RegularFile, 0, 0, LEGACY_CONFIG_MODE),
    )?;
    if legacy_config_stat.size > MAX_CONFIG_BYTES {
        return Err(ReleaseError::ApiRuntimeConfigInvalid {
            path: LEGACY_CONFIG_PATH,
            reason: "exceeds maximum size of 65536 bytes",
        });
    }
    let file_fd = sys
        .open_readable_file_at(api_etc_guard.0, CONFIG_NAME)
        .map_err(|e| io_error(LEGACY_CONFIG_PATH, "open configuration file", e))?;
    let file_guard = DirFd(file_fd);
    let open_stat = sys
        .fstat(file_guard.0)
        .map_err(|e| io_error(LEGACY_CONFIG_PATH, "verify configuration file metadata", e))?;
    validate(
        LEGACY_CONFIG_PATH,
        open_stat,
        (ObjectType::RegularFile, 0, 0, LEGACY_CONFIG_MODE),
    )?;
    let bytes = sys
        .read_bounded(file_guard.0, MAX_CONFIG_BYTES as usize)
        .map_err(|e| io_error(LEGACY_CONFIG_PATH, "read configuration bytes", e))?;
    validate_toml_bytes(LEGACY_CONFIG_PATH, &bytes, true)?;
    Ok(LegacyStatus::Valid(bytes))
}

fn publish_config<S: RuntimeSyscalls>(
    sys: &S,
    state_fd: RawFd,
    identity: &ApiRuntimeIdentity,
    bytes: &[u8],
    created: &mut Vec<CreatedObject>,
) -> Result<(), ReleaseError> {
    let temp_fd = sys
        .create_file_at(state_fd, CONFIG_TEMP_NAME, CONFIG_FILE_MODE)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "create provisioning temporary file", e))?;
    let temp_guard = DirFd(temp_fd);

    let stat = sys
        .fstat(temp_guard.0)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "identify created provisioning temporary file", e))?;

    created.push(CreatedObject {
        parent: state_fd,
        name: CONFIG_TEMP_NAME,
        path: CONFIG_TEMP_PATH,
        kind: CreatedKind::UnpublishedTemp,
        identity: Some(stat.identity()),
    });
    sys.write_all(temp_guard.0, bytes)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "write configuration bytes", e))?;

    sys.sync_file(temp_guard.0)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "sync configuration file", e))?;

    sys.chown(temp_guard.0, identity.uid, identity.gid)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "set configuration ownership", e))?;

    sys.chmod(temp_guard.0, CONFIG_FILE_MODE)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "set configuration mode", e))?;

    let stat = sys
        .fstat(temp_guard.0)
        .map_err(|e| io_error(CONFIG_TEMP_PATH, "verify configuration metadata", e))?;
    validate(
        CONFIG_TEMP_PATH,
        stat,
        (ObjectType::RegularFile, identity.uid, identity.gid, CONFIG_FILE_MODE),
    )?;
    if stat.size != bytes.len() as u64 {
        return Err(io_error(
            CONFIG_TEMP_PATH,
            "verify configuration size",
            io::Error::from_raw_os_error(libc::EIO),
        ));
    }

    drop(temp_guard);

    sys.rename_no_replace(state_fd, CONFIG_TEMP_NAME, state_fd, CONFIG_NAME)
        .map_err(|e| io_error(CANONICAL_CONFIG_PATH, "install canonical configuration with no-replace", e))?;

    created.pop();

    sys.sync_dir(state_fd)
        .map_err(|e| io_error(API_STATE_PATH, "sync state directory", e))?;

    Ok(())
}

fn cleanup<S: RuntimeSyscalls>(sys: &S, created: &[CreatedObject]) -> Result<(), ReleaseError> {
    let mut first_error = None;
    for item in created.iter().rev() {
        let identity = match item.identity {
            Some(identity) => identity,
            None => {
                if first_error.is_none() {
                    first_error = Some(ReleaseError::ApiRuntimeCleanup {
                        path: item.path,
                        errno: libc::EIO,
                    });
                }
                continue;
            }
        };
        if let Err(error) = sys.unlink(item.parent, item.name, item.kind, identity) {
            if first_error.is_none() {
                first_error = Some(ReleaseError::ApiRuntimeCleanup {
                    path: item.path,
                    errno: errno(&error),
                });
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn provision_with<S: RuntimeSyscalls>(
    layout: &Layout,
    identity: &ApiRuntimeIdentity,
    sys: &S,
) -> Result<(), ReleaseError> {
    let root = sys
        .open_root(&layout.trusted_root())
        .map_err(|e| io_error("/", "open trusted root", e))?;
    let root_guard = DirFd(root);
    let mut created = Vec::new();
    let mut dir_guards = Vec::new();
    let result = (|| {
        let var = ensure_dir(
            sys,
            root_guard.0,
            "var",
            VAR_PATH,
            0,
            0,
            ROOT_DIR_MODE,
            ExistingDirModePolicy::Exact,
            &mut created,
        )?;
        let var_fd = var.0;
        dir_guards.push(var);
        let var_lib = ensure_dir(
            sys,
            var_fd,
            "lib",
            VAR_LIB_PATH,
            0,
            0,
            ROOT_DIR_MODE,
            ExistingDirModePolicy::Exact,
            &mut created,
        )?;
        let var_lib_fd = var_lib.0;
        dir_guards.push(var_lib);
        let state = ensure_dir(
            sys,
            var_lib_fd,
            "dam-hopper",
            API_STATE_PATH,
            identity.uid,
            identity.gid,
            API_DIR_MODE,
            ExistingDirModePolicy::TightenFrom(0o755),
            &mut created,
        )?;
        let state_fd = state.0;
        dir_guards.push(state);
        let dot_config = ensure_dir(
            sys,
            state_fd,
            ".config",
            API_DOT_CONFIG_PATH,
            identity.uid,
            identity.gid,
            API_DIR_MODE,
            ExistingDirModePolicy::Exact,
            &mut created,
        )?;
        let dot_config_fd = dot_config.0;
        dir_guards.push(dot_config);
        let config = ensure_dir(
            sys,
            dot_config_fd,
            "dam-hopper",
            API_CONFIG_PATH,
            identity.uid,
            identity.gid,
            API_DIR_MODE,
            ExistingDirModePolicy::Exact,
            &mut created,
        )?;
        dir_guards.push(config);

        let canonical_stat = match sys.stat_at(state_fd, CONFIG_NAME) {
            Ok(stat) => Some(stat),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(io_error(CANONICAL_CONFIG_PATH, "inspect configuration file", e)),
        };

        if let Some(stat) = canonical_stat {
            validate(
                CANONICAL_CONFIG_PATH,
                stat,
                (ObjectType::RegularFile, identity.uid, identity.gid, CONFIG_FILE_MODE),
            )?;
            if stat.size > MAX_CONFIG_BYTES {
                return Err(ReleaseError::ApiRuntimeConfigInvalid {
                    path: CANONICAL_CONFIG_PATH,
                    reason: "exceeds maximum size of 65536 bytes",
                });
            }
            let file_fd = sys
                .open_readable_file_at(state_fd, CONFIG_NAME)
                .map_err(|e| io_error(CANONICAL_CONFIG_PATH, "open configuration file", e))?;
            let file_guard = DirFd(file_fd);
            let open_stat = sys
                .fstat(file_guard.0)
                .map_err(|e| io_error(CANONICAL_CONFIG_PATH, "verify configuration file metadata", e))?;
            validate(
                CANONICAL_CONFIG_PATH,
                open_stat,
                (ObjectType::RegularFile, identity.uid, identity.gid, CONFIG_FILE_MODE),
            )?;
            let bytes = sys
                .read_bounded(file_guard.0, MAX_CONFIG_BYTES as usize)
                .map_err(|e| io_error(CANONICAL_CONFIG_PATH, "read configuration bytes", e))?;
            validate_toml_bytes(CANONICAL_CONFIG_PATH, &bytes, false)?;
        } else {
            let bytes_to_publish = match inspect_legacy(sys, root_guard.0)? {
                LegacyStatus::Valid(bytes) => bytes,
                LegacyStatus::Absent => SEED_CONFIG_BYTES.to_vec(),
            };
            publish_config(sys, state_fd, identity, &bytes_to_publish, &mut created)?;
        }

        ensure_file(
            sys,
            state_fd,
            AUDIT_NAME,
            AUDIT_PATH,
            identity.uid,
            identity.gid,
            AUDIT_FILE_MODE,
            &mut created,
        )?;

        Ok(())
    })();
    if let Err(primary) = result {
        if let Err(cleanup_error) = cleanup(sys, &created) {
            return Err(ReleaseError::ApiRuntimeProvisionFailed {
                primary: Box::new(primary),
                cleanup: Box::new(cleanup_error),
            });
        }
        return Err(primary);
    }
    Ok(())
}

fn validate_identity(identity: &ApiRuntimeIdentity) -> Result<(), ReleaseError> {
    if identity.user == "root"
        || identity.group == "root"
        || identity.uid == 0
        || identity.gid == 0
    {
        return Err(ReleaseError::Config(
            "API runtime identity must be non-root with non-zero UID/GID".into(),
        ));
    }
    Ok(())
}
/// Provision all fixed API runtime paths for the final unit identity.
pub fn provision_api_runtime(
    layout: &Layout,
    identity: &ApiRuntimeIdentity,
) -> Result<(), ReleaseError> {
    validate_identity(identity)?;
    provision_with(layout, identity, &LinuxSyscalls)
}

fn provision_identity_then_start<P, F>(
    layout: &Layout,
    identity: &ApiRuntimeIdentity,
    provisioner: P,
    starter: F,
) -> Result<(), ReleaseError>
where
    P: FnOnce(&Layout, &ApiRuntimeIdentity) -> Result<(), ReleaseError>,
    F: FnOnce() -> Result<(), ReleaseError>,
{
    provisioner(layout, identity)?;
    starter()
}

/// Run final-unit identity parsing with injected provision and start operations.
#[doc(hidden)]
pub fn provision_and_start_api_with<P, F>(
    layout: &Layout,
    unit_path: &Path,
    provisioner: P,
    starter: F,
) -> Result<(), ReleaseError>
where
    P: FnOnce(&Layout, &ApiRuntimeIdentity) -> Result<(), ReleaseError>,
    F: FnOnce() -> Result<(), ReleaseError>,
{
    let content = fs::read_to_string(unit_path).map_err(|e| ReleaseError::Io {
        action: "read installed API unit before start",
        details: e.to_string(),
    })?;
    let identity = resolve_api_runtime_identity(&ParsedUnit::parse(&content)?)?;
    provision_identity_then_start(layout, &identity, provisioner, starter)
}

/// Parse the installed API unit, provision its final numeric identity, then start it.
pub(crate) fn provision_and_start_api<F>(
    layout: &Layout,
    unit_path: &Path,
    starter: F,
) -> Result<(), ReleaseError>
where
    F: FnOnce() -> Result<(), ReleaseError>,
{
    provision_and_start_api_with(layout, unit_path, provision_api_runtime, starter)
}

/// Provision the installed API unit without starting it (CLI and boot recovery).
pub fn provision_installed_api_runtime(layout: &Layout) -> Result<(), ReleaseError> {
    let unit_path = layout.systemd_unit_dir.join("dam-hopper-api.service");
    let content = fs::read_to_string(&unit_path).map_err(|e| ReleaseError::Io {
        action: "read installed API unit for runtime provisioning",
        details: e.to_string(),
    })?;
    let identity = resolve_api_runtime_identity(&ParsedUnit::parse(&content)?)?;
    provision_api_runtime(layout, &identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
        io,
        ffi::CString,
        os::fd::RawFd,
        rc::Rc,
    };
    use tempfile::tempdir;

    const ROOT_FD: RawFd = 10_000;
    const MANAGED_PATHS: [&str; 7] = [
        VAR_PATH,
        VAR_LIB_PATH,
        API_STATE_PATH,
        API_DOT_CONFIG_PATH,
        API_CONFIG_PATH,
        CANONICAL_CONFIG_PATH,
        AUDIT_PATH,
    ];
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct FakeCall {
        operation: &'static str,
        path: String,
    }

    #[derive(Debug, Clone, Copy)]
    struct Failure {
        operation: &'static str,
        path: &'static str,
    }

    struct FakeSyscalls {
        entries: RefCell<HashMap<String, Stat>>,
        contents: RefCell<HashMap<String, Vec<u8>>>,
        fd_paths: RefCell<HashMap<RawFd, String>>,
        next_fd: Cell<RawFd>,
        next_ino: Cell<u64>,
        calls: RefCell<Vec<FakeCall>>,
        failures: RefCell<Vec<Failure>>,
        race_winner_on_rename: RefCell<Option<(String, Stat, Vec<u8>)>>,
    }

    impl FakeSyscalls {
        fn new() -> Self {
            let mut fd_paths = HashMap::new();
            fd_paths.insert(ROOT_FD, "/".to_string());
            Self {
                entries: RefCell::new(HashMap::new()),
                contents: RefCell::new(HashMap::new()),
                fd_paths: RefCell::new(fd_paths),
                next_fd: Cell::new(ROOT_FD + 1),
                next_ino: Cell::new(1),
                calls: RefCell::new(Vec::new()),
                failures: RefCell::new(Vec::new()),
                race_winner_on_rename: RefCell::new(None),
            }
        }

        fn path_for(&self, parent: RawFd, name: &'static str) -> String {
            let base = self
                .fd_paths
                .borrow()
                .get(&parent)
                .cloned()
                .expect("fake parent descriptor");
            if base == "/" {
                format!("/{name}")
            } else {
                format!("{base}/{name}")
            }
        }

        fn attempt(&self, operation: &'static str, path: &str) -> io::Result<()> {
            self.calls.borrow_mut().push(FakeCall {
                operation,
                path: path.to_string(),
            });
            if self
                .failures
                .borrow()
                .iter()
                .any(|failure| failure.operation == operation && failure.path == path)
            {
                return Err(io::Error::from_raw_os_error(libc::EIO));
            }
            Ok(())
        }

        fn alloc_fd(&self, path: String) -> RawFd {
            let fd = self.next_fd.get();
            self.next_fd.set(fd + 1);
            self.fd_paths.borrow_mut().insert(fd, path);
            fd
        }

        fn alloc_ino(&self) -> u64 {
            let ino = self.next_ino.get();
            self.next_ino.set(ino + 1);
            ino
        }

        fn stat_path(&self, path: &str) -> io::Result<Stat> {
            self.entries
                .borrow()
                .get(path)
                .copied()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::ENOENT))
        }

        fn stat_for(&self, path: &str) -> Option<Stat> {
            self.entries.borrow().get(path).copied()
        }

        fn set_stat(&self, path: &str, stat: Stat) {
            *self
                .entries
                .borrow_mut()
                .get_mut(path)
                .expect("fake path to mutate") = stat;
        }

        fn remove_tree(&self, path: &str) {
            let prefix = format!("{path}/");
            self.entries
                .borrow_mut()
                .retain(|candidate, _| candidate != path && !candidate.starts_with(&prefix));
        }

        fn paths(&self) -> Vec<String> {
            let mut paths: Vec<_> = self.entries.borrow().keys().cloned().collect();
            paths.sort();
            paths
        }

        fn fd_for(&self, path: &str) -> RawFd {
            self.fd_paths
                .borrow()
                .iter()
                .find_map(|(fd, candidate)| (candidate == path).then_some(*fd))
                .expect("fake descriptor for path")
        }

        fn clear_calls(&self) {
            self.calls.borrow_mut().clear();
        }

        fn calls(&self) -> Vec<FakeCall> {
            self.calls.borrow().clone()
        }

        fn fail_on(&self, operation: &'static str, path: &'static str) {
            self.failures
                .borrow_mut()
                .push(Failure { operation, path });
        }

        fn content_for(&self, path: &str) -> Option<Vec<u8>> {
            self.contents.borrow().get(path).cloned()
        }

        fn set_file_content(&self, path: &str, data: Vec<u8>) {
            let mut entries = self.entries.borrow_mut();
            if let Some(stat) = entries.get_mut(path) {
                stat.size = data.len() as u64;
            }
            self.contents.borrow_mut().insert(path.to_string(), data);
        }

        fn add_file(&self, path: &str, uid: u32, gid: u32, mode: u32, data: &[u8]) {
            self.entries.borrow_mut().insert(
                path.to_string(),
                Stat {
                    object_type: ObjectType::RegularFile,
                    uid,
                    gid,
                    mode,
                    dev: 1,
                    ino: self.alloc_ino(),
                    size: data.len() as u64,
                },
            );
            self.contents
                .borrow_mut()
                .insert(path.to_string(), data.to_vec());
        }

        fn add_dir(&self, path: &str, uid: u32, gid: u32, mode: u32) {
            self.entries.borrow_mut().insert(
                path.to_string(),
                Stat {
                    object_type: ObjectType::Directory,
                    uid,
                    gid,
                    mode,
                    dev: 1,
                    ino: self.alloc_ino(),
                    size: 0,
                },
            );
        }

        fn set_race_winner_on_rename(
            &self,
            path: &str,
            uid: u32,
            gid: u32,
            mode: u32,
            data: &[u8],
        ) {
            *self.race_winner_on_rename.borrow_mut() = Some((
                path.to_string(),
                Stat {
                    object_type: ObjectType::RegularFile,
                    uid,
                    gid,
                    mode,
                    dev: 1,
                    ino: self.alloc_ino(),
                    size: data.len() as u64,
                },
                data.to_vec(),
            ));
        }
    }

    impl RuntimeSyscalls for FakeSyscalls {
        fn open_root(&self, _root: &Path) -> io::Result<RawFd> {
            self.attempt("open_root", "/")?;
            Ok(ROOT_FD)
        }

        fn stat_at(&self, parent: RawFd, name: &'static str) -> io::Result<Stat> {
            let path = self.path_for(parent, name);
            self.attempt("stat_at", &path)?;
            self.stat_path(&path)
        }

        fn open_dir_at(&self, parent: RawFd, name: &'static str) -> io::Result<RawFd> {
            let path = self.path_for(parent, name);
            self.attempt("open_dir_at", &path)?;
            let stat = self.stat_path(&path)?;
            if stat.object_type != ObjectType::Directory {
                return Err(io::Error::from_raw_os_error(libc::ENOTDIR));
            }
            Ok(self.alloc_fd(path))
        }

        fn mkdir_at(&self, parent: RawFd, name: &'static str, mode: u32) -> io::Result<()> {
            let path = self.path_for(parent, name);
            self.attempt("mkdirat", &path)?;
            if self.entries.borrow().contains_key(&path) {
                return Err(io::Error::from_raw_os_error(libc::EEXIST));
            }
            self.entries.borrow_mut().insert(
                path,
                Stat {
                    object_type: ObjectType::Directory,
                    uid: 0,
                    gid: 0,
                    mode,
                    dev: 1,
                    ino: self.alloc_ino(),
                    size: 0,
                },
            );
            Ok(())
        }

        fn open_existing_file_at(
            &self,
            parent: RawFd,
            name: &'static str,
        ) -> io::Result<RawFd> {
            let path = self.path_for(parent, name);
            self.attempt("open_existing_file_at", &path)?;
            let stat = self.stat_path(&path)?;
            if stat.object_type != ObjectType::RegularFile {
                return Err(io::Error::from_raw_os_error(libc::EISDIR));
            }
            Ok(self.alloc_fd(path))
        }

        fn create_file_at(
            &self,
            parent: RawFd,
            name: &'static str,
            mode: u32,
        ) -> io::Result<RawFd> {
            let path = self.path_for(parent, name);
            self.attempt("create_file_at", &path)?;
            if self.entries.borrow().contains_key(&path) {
                return Err(io::Error::from_raw_os_error(libc::EEXIST));
            }
            self.entries.borrow_mut().insert(
                path.clone(),
                Stat {
                    object_type: ObjectType::RegularFile,
                    uid: 0,
                    gid: 0,
                    mode,
                    dev: 1,
                    ino: self.alloc_ino(),
                    size: 0,
                },
            );
            self.contents.borrow_mut().insert(path.clone(), Vec::new());
            Ok(self.alloc_fd(path))
        }

        fn open_readable_file_at(
            &self,
            parent: RawFd,
            name: &'static str,
        ) -> io::Result<RawFd> {
            let path = self.path_for(parent, name);
            self.attempt("open_readable_file_at", &path)?;
            let stat = self.stat_path(&path)?;
            if stat.object_type != ObjectType::RegularFile {
                return Err(io::Error::from_raw_os_error(libc::EISDIR));
            }
            Ok(self.alloc_fd(path))
        }

        fn read_bounded(&self, fd: RawFd, limit: usize) -> io::Result<Vec<u8>> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("read_bounded", &path)?;
            let contents = self.contents.borrow();
            let data = contents.get(&path).cloned().unwrap_or_default();
            if data.len() > limit {
                Ok(data[..limit + 1].to_vec())
            } else {
                Ok(data)
            }
        }

        fn write_all(&self, fd: RawFd, bytes: &[u8]) -> io::Result<()> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("write_all", &path)?;
            let mut contents = self.contents.borrow_mut();
            let entry_bytes = contents.entry(path.clone()).or_default();
            entry_bytes.extend_from_slice(bytes);
            let mut entries = self.entries.borrow_mut();
            if let Some(stat) = entries.get_mut(&path) {
                stat.size = entry_bytes.len() as u64;
            }
            Ok(())
        }

        fn sync_file(&self, fd: RawFd) -> io::Result<()> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("sync_file", &path)?;
            Ok(())
        }

        fn sync_dir(&self, fd: RawFd) -> io::Result<()> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("sync_dir", &path)?;
            Ok(())
        }

        fn rename_no_replace(
            &self,
            old_dir: RawFd,
            old_name: &'static str,
            new_dir: RawFd,
            new_name: &'static str,
        ) -> io::Result<()> {
            let old_path = self.path_for(old_dir, old_name);
            let new_path = self.path_for(new_dir, new_name);
            self.attempt("rename_no_replace", &new_path)?;

            if let Some((path, stat, content)) = self.race_winner_on_rename.borrow_mut().take() {
                self.entries.borrow_mut().insert(path.clone(), stat);
                self.contents.borrow_mut().insert(path, content);
            }

            if self.entries.borrow().contains_key(&new_path) {
                return Err(io::Error::from_raw_os_error(libc::EEXIST));
            }
            let stat = self
                .entries
                .borrow_mut()
                .remove(&old_path)
                .ok_or_else(|| io::Error::from_raw_os_error(libc::ENOENT))?;
            self.entries.borrow_mut().insert(new_path.clone(), stat);
            let data = self.contents.borrow_mut().remove(&old_path);
            if let Some(data) = data {
                self.contents.borrow_mut().insert(new_path, data);
            }
            Ok(())
        }

        fn fstat(&self, fd: RawFd) -> io::Result<Stat> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("fstat", &path)?;
            self.stat_path(&path)
        }

        fn chown(&self, fd: RawFd, uid: u32, gid: u32) -> io::Result<()> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("chown", &path)?;
            let mut entries = self.entries.borrow_mut();
            let stat = entries.get_mut(&path).expect("fake descriptor path");
            stat.uid = uid;
            stat.gid = gid;
            Ok(())
        }

        fn chmod(&self, fd: RawFd, mode: u32) -> io::Result<()> {
            let path = self
                .fd_paths
                .borrow()
                .get(&fd)
                .cloned()
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EBADF))?;
            self.attempt("chmod", &path)?;
            self.entries
                .borrow_mut()
                .get_mut(&path)
                .expect("fake descriptor path")
                .mode = mode;
            Ok(())
        }

        fn unlink(
            &self,
            parent: RawFd,
            name: &'static str,
            kind: CreatedKind,
            identity: ObjectIdentity,
        ) -> io::Result<()> {
            let path = self.path_for(parent, name);
            self.attempt("unlinkat", &path)?;
            let stat = self.stat_path(&path)?;
            if stat.identity() != identity {
                return Err(io::Error::from_raw_os_error(libc::EAGAIN));
            }
            if (kind == CreatedKind::Directory) != (stat.object_type == ObjectType::Directory) {
                return Err(io::Error::from_raw_os_error(libc::EINVAL));
            }
            if kind == CreatedKind::RegularFile && stat.size != 0 {
                return Err(io::Error::from_raw_os_error(libc::ENOTEMPTY));
            }
            let prefix = format!("{path}/");
            if kind == CreatedKind::Directory
                && self
                    .entries
                    .borrow()
                    .keys()
                    .any(|candidate| candidate.starts_with(&prefix))
            {
                return Err(io::Error::from_raw_os_error(libc::ENOTEMPTY));
            }
            self.entries.borrow_mut().remove(&path);
            self.contents.borrow_mut().remove(&path);
            Ok(())
        }
    }
    fn identity() -> ApiRuntimeIdentity {
        ApiRuntimeIdentity {
            user: "api".into(),
            group: "api".into(),
            uid: 1001,
            gid: 1001,
        }
    }

    fn provisioned_fake() -> (tempfile::TempDir, Layout, FakeSyscalls, ApiRuntimeIdentity) {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();
        provision_with(&layout, &identity, &fake).unwrap();
        (tmp, layout, fake, identity)
    }

    fn assert_no_mutation(calls: &[FakeCall]) {
        assert!(
            calls.iter().all(|call| {
                !matches!(
                    call.operation,
                    "mkdirat"
                        | "create_file_at"
                        | "write_all"
                        | "sync_file"
                        | "sync_dir"
                        | "chown"
                        | "chmod"
                        | "rename_no_replace"
                        | "unlinkat"
                )
            }),
            "unexpected mutation calls: {calls:?}"
        );
    }

    #[test]
    fn missing_paths_are_created_with_final_metadata_and_valid_rerun_is_read_only() {
        let (_tmp, layout, fake, identity) = provisioned_fake();

        for (path, object_type, uid, gid, mode) in [
            (VAR_PATH, ObjectType::Directory, 0, 0, ROOT_DIR_MODE),
            (
                VAR_LIB_PATH,
                ObjectType::Directory,
                0,
                0,
                ROOT_DIR_MODE,
            ),
            (
                API_STATE_PATH,
                ObjectType::Directory,
                identity.uid,
                identity.gid,
                API_DIR_MODE,
            ),
            (
                API_DOT_CONFIG_PATH,
                ObjectType::Directory,
                identity.uid,
                identity.gid,
                API_DIR_MODE,
            ),
            (
                API_CONFIG_PATH,
                ObjectType::Directory,
                identity.uid,
                identity.gid,
                API_DIR_MODE,
            ),
            (
                CANONICAL_CONFIG_PATH,
                ObjectType::RegularFile,
                identity.uid,
                identity.gid,
                CONFIG_FILE_MODE,
            ),
            (
                AUDIT_PATH,
                ObjectType::RegularFile,
                identity.uid,
                identity.gid,
                AUDIT_FILE_MODE,
            ),
        ] {
            let stat = fake.stat_for(path).expect("managed path exists");
            assert_eq!(
                (stat.object_type, stat.uid, stat.gid, stat.mode),
                (object_type, uid, gid, mode),
                "unexpected metadata for {path}"
            );
        }

        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(SEED_CONFIG_BYTES)
        );
        assert_eq!(
            fake.content_for(AUDIT_PATH).as_deref(),
            Some(&b""[..])
        );

        let config_ino_before = fake.stat_for(CANONICAL_CONFIG_PATH).unwrap().ino;

        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());

        let config_ino_after = fake.stat_for(CANONICAL_CONFIG_PATH).unwrap().ino;
        assert_eq!(config_ino_before, config_ino_after);
        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(SEED_CONFIG_BYTES)
        );
    }

    #[test]
    fn every_preexisting_metadata_mismatch_refuses_without_mutation() {
        for path in MANAGED_PATHS {
            for mismatch_kind in ["type", "uid", "gid", "mode"] {
                let (_tmp, layout, fake, identity) = provisioned_fake();
                let valid = fake.stat_for(path).unwrap();
                let mut invalid = valid;
                match mismatch_kind {
                    "type" => invalid.object_type = ObjectType::Symlink,
                    "uid" => invalid.uid = valid.uid.wrapping_add(1).max(1),
                    "gid" => invalid.gid = valid.gid.wrapping_add(1).max(1),
                    "mode" => invalid.mode ^= 0o1,
                    _ => unreachable!(),
                }
                fake.set_stat(path, invalid);
                fake.clear_calls();

                let result = provision_with(&layout, &identity, &fake);
                assert!(matches!(
                    result,
                    Err(ReleaseError::ApiRuntimeMetadataMismatch {
                        path: actual,
                        ..
                    }) if actual == path
                ));
                assert_no_mutation(&fake.calls());
            }
        }
    }

    #[test]
    fn special_files_are_refused_without_mutation() {
        for test_path in [CANONICAL_CONFIG_PATH, AUDIT_PATH] {
            for object_type in [ObjectType::Symlink, ObjectType::Other] {
                let (_tmp, layout, fake, identity) = provisioned_fake();
                let mut invalid = fake.stat_for(test_path).unwrap();
                invalid.object_type = object_type;
                fake.set_stat(test_path, invalid);
                fake.clear_calls();

                let result = provision_with(&layout, &identity, &fake);
                assert!(matches!(
                    result,
                    Err(ReleaseError::ApiRuntimeMetadataMismatch {
                        path,
                        ..
                    }) if path == test_path
                ));
                assert_no_mutation(&fake.calls());
            }
        }
    }

    #[test]
    fn operator_repair_followed_by_rerun_succeeds_without_repairing_metadata() {
        let (_tmp, layout, fake, identity) = provisioned_fake();
        let valid = fake.stat_for(API_STATE_PATH).unwrap();
        let mut invalid = valid;
        invalid.mode = 0o750;
        fake.set_stat(API_STATE_PATH, invalid);
        fake.clear_calls();
        assert!(provision_with(&layout, &identity, &fake).is_err());
        assert_no_mutation(&fake.calls());

        fake.set_stat(API_STATE_PATH, valid);
        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());
    }

    #[test]
    fn legacy_state_root_mode_0755_is_tightened_to_0700_and_subsequent_runs_are_read_only() {
        let (_tmp, layout, fake, identity) = provisioned_fake();
        let valid = fake.stat_for(API_STATE_PATH).unwrap();
        let mut legacy = valid;
        legacy.mode = 0o755;
        fake.set_stat(API_STATE_PATH, legacy);
        fake.clear_calls();

        provision_with(&layout, &identity, &fake).unwrap();
        assert_eq!(fake.stat_for(API_STATE_PATH).unwrap().mode, 0o700);
        let chmod_calls: Vec<_> = fake
            .calls()
            .into_iter()
            .filter(|c| c.operation == "chmod" && c.path == API_STATE_PATH)
            .collect();
        assert_eq!(chmod_calls.len(), 1);

        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());
    }

    #[test]
    fn legacy_state_root_mode_0755_with_wrong_owner_or_non_directory_is_refused() {
        let (_tmp, layout, fake, identity) = provisioned_fake();
        let valid = fake.stat_for(API_STATE_PATH).unwrap();
        let mut invalid = valid;
        invalid.mode = 0o755;
        invalid.uid = valid.uid + 1;
        fake.set_stat(API_STATE_PATH, invalid);
        fake.clear_calls();

        assert!(provision_with(&layout, &identity, &fake).is_err());
        assert_no_mutation(&fake.calls());

        invalid.uid = valid.uid;
        invalid.object_type = ObjectType::Symlink;
        fake.set_stat(API_STATE_PATH, invalid);
        fake.clear_calls();

        assert!(provision_with(&layout, &identity, &fake).is_err());
        assert_no_mutation(&fake.calls());
    }

    #[test]
    fn each_post_creation_failure_removes_only_call_created_objects() {
        for path in [
            VAR_PATH,
            VAR_LIB_PATH,
            API_STATE_PATH,
            API_DOT_CONFIG_PATH,
            API_CONFIG_PATH,
            AUDIT_PATH,
        ] {
            for operation in ["chown", "chmod", "fstat"] {
                let (_tmp, layout, fake, identity) = provisioned_fake();
                let baseline = fake.paths();
                fake.remove_tree(path);
                let mut expected_paths: Vec<_> = baseline
                    .into_iter()
                    .filter(|candidate| {
                        candidate != path && !candidate.starts_with(&format!("{path}/"))
                    })
                    .collect();
                if operation == "fstat" {
                    expected_paths.push(path.to_string());
                    expected_paths.sort();
                }
                fake.fail_on(operation, path);
                fake.clear_calls();

                assert!(provision_with(&layout, &identity, &fake).is_err());
                assert_eq!(fake.paths(), expected_paths, "cleanup for {operation} {path}");
            }
        }
    }

    #[test]
    fn cleanup_failure_reports_primary_and_cleanup_errors() {
        let (_tmp, layout, fake, identity) = provisioned_fake();
        fake.remove_tree(AUDIT_PATH);
        fake.fail_on("chown", AUDIT_PATH);
        fake.fail_on("unlinkat", AUDIT_PATH);
        fake.clear_calls();

        let result = provision_with(&layout, &identity, &fake);
        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeProvisionFailed {
                primary,
                cleanup,
            }) if matches!(
                *primary,
                ReleaseError::ApiRuntimeIo { path: AUDIT_PATH, .. }
            ) && matches!(
                *cleanup,
                ReleaseError::ApiRuntimeCleanup { path: AUDIT_PATH, .. }
            )
        ));
        assert!(fake.stat_for(AUDIT_PATH).is_some());
    }

    #[test]
    fn cleanup_retains_nonempty_created_file() {
        let (_tmp, _layout, fake, _identity) = provisioned_fake();
        fake.remove_tree(AUDIT_PATH);
        let parent = fake.fd_for(API_STATE_PATH);
        let _fd = fake
            .create_file_at(parent, "idle-suspend-audit.jsonl", AUDIT_FILE_MODE)
            .unwrap();
        let identity = fake.stat_for(AUDIT_PATH).unwrap().identity();
        let mut stat = fake.stat_for(AUDIT_PATH).unwrap();
        stat.size = 1;
        fake.set_stat(AUDIT_PATH, stat);

        let result = cleanup(
            &fake,
            &[CreatedObject {
                parent,
                name: "idle-suspend-audit.jsonl",
                path: AUDIT_PATH,
                kind: CreatedKind::RegularFile,
                identity: Some(identity),
            }],
        );

        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeCleanup {
                path: AUDIT_PATH,
                errno: libc::ENOTEMPTY
            })
        ));
        assert_eq!(fake.stat_for(AUDIT_PATH).unwrap().size, 1);
    }

    #[test]
    fn cleanup_retains_replacement_with_different_identity() {
        let (_tmp, _layout, fake, _identity) = provisioned_fake();
        fake.remove_tree(AUDIT_PATH);
        let parent = fake.fd_for(API_STATE_PATH);
        let _fd = fake
            .create_file_at(parent, "idle-suspend-audit.jsonl", AUDIT_FILE_MODE)
            .unwrap();
        let original = fake.stat_for(AUDIT_PATH).unwrap().identity();
        let mut replacement = fake.stat_for(AUDIT_PATH).unwrap();
        replacement.dev = replacement.dev.wrapping_add(1);
        replacement.ino = replacement.ino.wrapping_add(1);
        fake.set_stat(AUDIT_PATH, replacement);

        let result = cleanup(
            &fake,
            &[CreatedObject {
                parent,
                name: "idle-suspend-audit.jsonl",
                path: AUDIT_PATH,
                kind: CreatedKind::RegularFile,
                identity: Some(original),
            }],
        );

        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeCleanup {
                path: AUDIT_PATH,
                errno: libc::EAGAIN
            })
        ));
        assert_eq!(
            fake.stat_for(AUDIT_PATH).unwrap().identity(),
            replacement.identity()
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn existing_fifo_metadata_open_is_nonblocking_and_no_follow() {
        let tmp = tempdir().unwrap();
        let fifo_path = tmp.path().join("candidate");
        let fifo_name = CString::new(fifo_path.to_str().unwrap()).unwrap();
        assert_eq!(
            unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) },
            0,
            "create FIFO"
        );

        let sys = LinuxSyscalls;
        let root = sys.open_root(tmp.path()).unwrap();
        let root_guard = DirFd(root);
        let fd = sys.open_existing_file_at(root_guard.0, "candidate").unwrap();
        let fd_guard = DirFd(fd);
        assert_eq!(
            sys.fstat(fd_guard.0).unwrap().object_type,
            ObjectType::Other
        );
    }

    #[test]
    fn provision_to_start_seam_calls_starter_once_after_success_only() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let identity = identity();
        let order = Rc::new(RefCell::new(Vec::new()));
        let provision_order = Rc::clone(&order);
        let start_order = Rc::clone(&order);

        provision_identity_then_start(
            &layout,
            &identity,
            move |_, _| {
                provision_order.borrow_mut().push("provision");
                Ok(())
            },
            move || {
                start_order.borrow_mut().push("start");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(&*order.borrow(), &["provision", "start"]);

        let started = Rc::new(RefCell::new(false));
        let started_by_starter = Rc::clone(&started);
        let result = provision_identity_then_start(
            &layout,
            &identity,
            |_, _| Err(ReleaseError::Config("provision failed".into())),
            move || {
                *started_by_starter.borrow_mut() = true;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(!*started.borrow());
    }

    #[test]
    fn root_identity_is_rejected_before_opening_the_trusted_root() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let identity = ApiRuntimeIdentity {
            user: "root".into(),
            group: "root".into(),
            uid: 0,
            gid: 0,
        };

        assert!(matches!(
            provision_api_runtime(&layout, &identity),
            Err(ReleaseError::Config(reason)) if reason.contains("non-root")
        ));
        assert!(!layout.api_state_dir().exists());
    }

    #[test]
    fn legacy_migration_copies_exact_bytes_and_preserves_legacy() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        let legacy_content = b"[workspace]\nname = \"legacy-ws\"\n\n[[projects]]\nname = \"p1\"\npath = \"/absolute/path/to/p1\"\n";

        fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_file(
            LEGACY_CONFIG_PATH,
            0,
            0,
            LEGACY_CONFIG_MODE,
            legacy_content,
        );

        let legacy_ino = fake.stat_for(LEGACY_CONFIG_PATH).unwrap().ino;

        provision_with(&layout, &identity, &fake).unwrap();

        let canonical_stat = fake.stat_for(CANONICAL_CONFIG_PATH).expect("canonical created");
        assert_eq!(
            (canonical_stat.object_type, canonical_stat.uid, canonical_stat.gid, canonical_stat.mode),
            (ObjectType::RegularFile, identity.uid, identity.gid, CONFIG_FILE_MODE)
        );
        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(&legacy_content[..])
        );

        let legacy_stat = fake.stat_for(LEGACY_CONFIG_PATH).unwrap();
        assert_eq!(legacy_stat.ino, legacy_ino);
        assert_eq!(
            (legacy_stat.uid, legacy_stat.gid, legacy_stat.mode),
            (0, 0, LEGACY_CONFIG_MODE)
        );
        assert_eq!(
            fake.content_for(LEGACY_CONFIG_PATH).as_deref(),
            Some(&legacy_content[..])
        );

        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());
    }

    #[test]
    fn legacy_migration_refuses_relative_project_paths_without_mutation() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        let legacy_content = b"[workspace]\nname = \"legacy-ws\"\n\n[[projects]]\nname = \"p1\"\npath = \"./relative/path\"\n";

        fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_file(
            LEGACY_CONFIG_PATH,
            0,
            0,
            LEGACY_CONFIG_MODE,
            legacy_content,
        );

        let result = provision_with(&layout, &identity, &fake);
        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeConfigInvalid {
                path: LEGACY_CONFIG_PATH,
                reason,
            }) if reason.contains("relative or traversing")
        ));

        assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
    }

    #[test]
    fn legacy_migration_refuses_traversing_project_paths_without_mutation() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        let legacy_content = b"[workspace]\nname = \"legacy-ws\"\n\n[[projects]]\nname = \"p1\"\npath = \"/var/projects/../other\"\n";

        fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_file(
            LEGACY_CONFIG_PATH,
            0,
            0,
            LEGACY_CONFIG_MODE,
            legacy_content,
        );

        let result = provision_with(&layout, &identity, &fake);
        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeConfigInvalid {
                path: LEGACY_CONFIG_PATH,
                reason,
            }) if reason.contains("relative or traversing")
        ));

        assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
    }

    #[test]
    fn legacy_migration_refuses_oversized_legacy_config() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        let oversized = vec![b'#'; (MAX_CONFIG_BYTES + 1) as usize];

        fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_file(
            LEGACY_CONFIG_PATH,
            0,
            0,
            LEGACY_CONFIG_MODE,
            &oversized,
        );

        let result = provision_with(&layout, &identity, &fake);
        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeConfigInvalid {
                path: LEGACY_CONFIG_PATH,
                reason,
            }) if reason.contains("exceeds maximum size")
        ));

        assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
    }

    #[test]
    fn legacy_migration_refuses_invalid_utf8_and_toml() {
        for (content, expected_reason) in [
            (b"\xff\xfe\x00invalid-utf8".to_vec(), "not valid UTF-8"),
            (b"invalid toml = ".to_vec(), "invalid TOML syntax"),
        ] {
            let tmp = tempdir().unwrap();
            let layout = Layout::with_root(tmp.path());
            let fake = FakeSyscalls::new();
            let identity = identity();

            fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
            fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
            fake.add_file(
                LEGACY_CONFIG_PATH,
                0,
                0,
                LEGACY_CONFIG_MODE,
                &content,
            );

            let result = provision_with(&layout, &identity, &fake);
            assert!(matches!(
                result,
                Err(ReleaseError::ApiRuntimeConfigInvalid {
                    path: LEGACY_CONFIG_PATH,
                    reason,
                }) if reason == expected_reason
            ));

            assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
        }
    }

    #[test]
    fn legacy_metadata_mismatches_refuse_without_mutation() {
        let legacy_content = b"[workspace]\nname = \"legacy-ws\"\n";

        // 1. Wrong mode on legacy file
        {
            let tmp = tempdir().unwrap();
            let layout = Layout::with_root(tmp.path());
            let fake = FakeSyscalls::new();
            let identity = identity();

            fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
            fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
            fake.add_file(
                LEGACY_CONFIG_PATH,
                0,
                0,
                0o600,
                legacy_content,
            );

            let result = provision_with(&layout, &identity, &fake);
            assert!(matches!(
                result,
                Err(ReleaseError::ApiRuntimeMetadataMismatch {
                    path: LEGACY_CONFIG_PATH,
                    ..
                })
            ));
            assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
        }

        // 2. Non-root ownership on /etc/dam-hopper
        {
            let tmp = tempdir().unwrap();
            let layout = Layout::with_root(tmp.path());
            let fake = FakeSyscalls::new();
            let identity = identity();

            fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
            fake.add_dir(API_ETC_PATH, 1000, 0, ROOT_DIR_MODE);
            fake.add_file(
                LEGACY_CONFIG_PATH,
                0,
                0,
                LEGACY_CONFIG_MODE,
                legacy_content,
            );

            let result = provision_with(&layout, &identity, &fake);
            assert!(matches!(
                result,
                Err(ReleaseError::ApiRuntimeMetadataMismatch {
                    path: API_ETC_PATH,
                    ..
                })
            ));
            assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
        }
    }

    #[test]
    fn canonical_precedence_over_legacy() {
        let (_tmp, layout, fake, identity) = provisioned_fake();

        let canonical_content = fake.content_for(CANONICAL_CONFIG_PATH).unwrap();
        assert_eq!(canonical_content, SEED_CONFIG_BYTES);

        let legacy_content = b"[workspace]\nname = \"ignored-legacy\"\n";
        fake.add_dir(ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_dir(API_ETC_PATH, 0, 0, ROOT_DIR_MODE);
        fake.add_file(
            LEGACY_CONFIG_PATH,
            0,
            0,
            LEGACY_CONFIG_MODE,
            legacy_content,
        );

        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());

        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(SEED_CONFIG_BYTES)
        );
        assert!(!fake.calls().iter().any(|c| c.path.contains("etc")));
    }

    #[test]
    fn canonical_invalid_content_refuses_without_mutation() {
        for (content, expected_reason) in [
            (vec![b'#'; (MAX_CONFIG_BYTES + 1) as usize], "exceeds maximum size of 65536 bytes"),
            (b"\xff\xfe\x00not-utf8".to_vec(), "not valid UTF-8"),
            (b"invalid toml = ".to_vec(), "invalid TOML syntax"),
        ] {
            let (_tmp, layout, fake, identity) = provisioned_fake();
            fake.set_file_content(CANONICAL_CONFIG_PATH, content);
            fake.clear_calls();

            let result = provision_with(&layout, &identity, &fake);
            assert!(matches!(
                result,
                Err(ReleaseError::ApiRuntimeConfigInvalid {
                    path: CANONICAL_CONFIG_PATH,
                    reason,
                }) if reason == expected_reason
            ));
            assert_no_mutation(&fake.calls());
        }
    }

    #[test]
    fn race_condition_on_rename_no_replace_preserves_winner_and_cleans_temp() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        let winner_content = b"[workspace]\nname = \"winner\"\n";
        fake.set_race_winner_on_rename(
            CANONICAL_CONFIG_PATH,
            identity.uid,
            identity.gid,
            CONFIG_FILE_MODE,
            winner_content,
        );

        let result = provision_with(&layout, &identity, &fake);
        assert!(result.is_err());

        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(&winner_content[..])
        );
        assert!(fake.stat_for(CONFIG_TEMP_PATH).is_none());
    }

    #[test]
    fn publication_failure_branches_clean_temp_before_rename() {
        for operation in ["write_all", "sync_file", "chown", "chmod"] {
            let tmp = tempdir().unwrap();
            let layout = Layout::with_root(tmp.path());
            let fake = FakeSyscalls::new();
            let identity = identity();

            fake.fail_on(operation, CONFIG_TEMP_PATH);

            let result = provision_with(&layout, &identity, &fake);
            assert!(result.is_err(), "operation {operation} should fail");

            assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_none());
            assert!(fake.stat_for(CONFIG_TEMP_PATH).is_none());
        }
    }

    #[test]
    fn unidentifiable_temp_creation_refuses_cleanup_and_retains_temp() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        fake.fail_on("fstat", CONFIG_TEMP_PATH);

        let result = provision_with(&layout, &identity, &fake);
        assert!(result.is_err());

        assert!(fake.stat_for(CONFIG_TEMP_PATH).is_some());
    }

    #[test]
    fn sync_dir_failure_preserves_published_canonical_config() {
        let tmp = tempdir().unwrap();
        let layout = Layout::with_root(tmp.path());
        let fake = FakeSyscalls::new();
        let identity = identity();

        fake.fail_on("sync_dir", API_STATE_PATH);

        let result = provision_with(&layout, &identity, &fake);
        assert!(result.is_err());

        assert!(fake.stat_for(CANONICAL_CONFIG_PATH).is_some());
        assert_eq!(
            fake.content_for(CANONICAL_CONFIG_PATH).as_deref(),
            Some(SEED_CONFIG_BYTES)
        );

        let fake2 = FakeSyscalls::new();
        fake2.add_dir(VAR_PATH, 0, 0, ROOT_DIR_MODE);
        fake2.add_dir(VAR_LIB_PATH, 0, 0, ROOT_DIR_MODE);
        fake2.add_dir(API_STATE_PATH, identity.uid, identity.gid, API_DIR_MODE);
        fake2.add_dir(API_DOT_CONFIG_PATH, identity.uid, identity.gid, API_DIR_MODE);
        fake2.add_dir(API_CONFIG_PATH, identity.uid, identity.gid, API_DIR_MODE);
        fake2.add_file(
            CANONICAL_CONFIG_PATH,
            identity.uid,
            identity.gid,
            CONFIG_FILE_MODE,
            SEED_CONFIG_BYTES,
        );
        fake2.add_file(
            AUDIT_PATH,
            identity.uid,
            identity.gid,
            AUDIT_FILE_MODE,
            b"",
        );
        provision_with(&layout, &identity, &fake2).unwrap();
        assert_no_mutation(&fake2.calls());
    }

    #[test]
    fn unpublished_temp_replacement_refuses_cleanup_and_retains_temp() {
        let _tmp = tempdir().unwrap();
        let fake = FakeSyscalls::new();
        let parent = fake.alloc_fd(API_STATE_PATH.to_string());
        let _fd = fake
            .create_file_at(parent, CONFIG_TEMP_NAME, CONFIG_FILE_MODE)
            .unwrap();
        let original_identity = fake.stat_for(CONFIG_TEMP_PATH).unwrap().identity();

        let mut replacement = fake.stat_for(CONFIG_TEMP_PATH).unwrap();
        replacement.ino = replacement.ino.wrapping_add(100);
        fake.set_stat(CONFIG_TEMP_PATH, replacement);

        let result = cleanup(
            &fake,
            &[CreatedObject {
                parent,
                name: CONFIG_TEMP_NAME,
                path: CONFIG_TEMP_PATH,
                kind: CreatedKind::UnpublishedTemp,
                identity: Some(original_identity),
            }],
        );

        assert!(matches!(
            result,
            Err(ReleaseError::ApiRuntimeCleanup {
                path: CONFIG_TEMP_PATH,
                errno: libc::EAGAIN,
            })
        ));
        assert!(fake.stat_for(CONFIG_TEMP_PATH).is_some());
    }
}
