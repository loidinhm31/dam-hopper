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

const VAR_PATH: &str = "/var";
const VAR_LIB_PATH: &str = "/var/lib";
const API_STATE_PATH: &str = "/var/lib/dam-hopper";
const API_DOT_CONFIG_PATH: &str = "/var/lib/dam-hopper/.config";
const API_CONFIG_PATH: &str = "/var/lib/dam-hopper/.config/dam-hopper";
const ETC_PATH: &str = "/etc";
const API_ETC_PATH: &str = "/etc/dam-hopper";
const AUDIT_PATH: &str = "/etc/dam-hopper/idle-suspend-audit.jsonl";

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
        let name = Self::c_name(&root.to_string_lossy())?;
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
                    | libc::O_APPEND
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
            CreatedKind::RegularFile if current.object_type != ObjectType::RegularFile => {
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
            CreatedKind::RegularFile => 0,
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

fn ensure_dir<S: RuntimeSyscalls>(
    sys: &S,
    parent: RawFd,
    name: &'static str,
    path: &'static str,
    uid: u32,
    gid: u32,
    mode: u32,
    created: &mut Vec<CreatedObject>,
) -> Result<DirFd, ReleaseError> {
    let expected = (ObjectType::Directory, uid, gid, mode);
    let mut created_index = None;
    let fd = match sys.stat_at(parent, name) {
        Ok(stat) => {
            validate(path, stat, expected)?;
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
                .map_err(|e| io_error(path, "open audit file", e))?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let fd = sys
                .create_file_at(parent, name, mode)
                .map_err(|e| io_error(path, "create audit file", e))?;
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
        Err(error) => return Err(io_error(path, "inspect audit file", error)),
    };
    let guard = DirFd(fd);
    if let Some(index) = created_index {
        let stat = sys
            .fstat(guard.0)
            .map_err(|e| io_error(path, "identify created audit file", e))?;
        created[index].identity = Some(stat.identity());
        sys.chown(guard.0, uid, gid)
            .map_err(|e| io_error(path, "set audit ownership", e))?;
        sys.chmod(guard.0, mode)
            .map_err(|e| io_error(path, "set audit mode", e))?;
    }
    let stat = sys
        .fstat(guard.0)
        .map_err(|e| io_error(path, "verify audit file", e))?;
    validate(path, stat, expected)?;
    // Closing is intentionally immediate: the provisioner never writes audit data.
    drop(guard);
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
        let var = ensure_dir(sys, root_guard.0, "var", VAR_PATH, 0, 0, ROOT_DIR_MODE, &mut created)?;
        let var_fd = var.0;
        dir_guards.push(var);
        let var_lib = ensure_dir(sys, var_fd, "lib", VAR_LIB_PATH, 0, 0, ROOT_DIR_MODE, &mut created)?;
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
            &mut created,
        )?;
        dir_guards.push(config);

        let etc = ensure_dir(sys, root_guard.0, "etc", ETC_PATH, 0, 0, ROOT_DIR_MODE, &mut created)?;
        let etc_fd = etc.0;
        dir_guards.push(etc);
        let api_etc = ensure_dir(
            sys,
            etc_fd,
            "dam-hopper",
            API_ETC_PATH,
            0,
            0,
            ROOT_DIR_MODE,
            &mut created,
        )?;
        let api_etc_fd = api_etc.0;
        dir_guards.push(api_etc);
        ensure_file(
            sys,
            api_etc_fd,
            "idle-suspend-audit.jsonl",
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
    const MANAGED_PATHS: [&str; 8] = [
        VAR_PATH,
        VAR_LIB_PATH,
        API_STATE_PATH,
        API_DOT_CONFIG_PATH,
        API_CONFIG_PATH,
        ETC_PATH,
        API_ETC_PATH,
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
        fd_paths: RefCell<HashMap<RawFd, String>>,
        next_fd: Cell<RawFd>,
        next_ino: Cell<u64>,
        calls: RefCell<Vec<FakeCall>>,
        failures: RefCell<Vec<Failure>>,
    }

    impl FakeSyscalls {
        fn new() -> Self {
            let mut fd_paths = HashMap::new();
            fd_paths.insert(ROOT_FD, "/".to_string());
            Self {
                entries: RefCell::new(HashMap::new()),
                fd_paths: RefCell::new(fd_paths),
                next_fd: Cell::new(ROOT_FD + 1),
                next_ino: Cell::new(1),
                calls: RefCell::new(Vec::new()),
                failures: RefCell::new(Vec::new()),
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
            Ok(self.alloc_fd(path))
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
                    "mkdirat" | "create_file_at" | "chown" | "chmod" | "unlinkat"
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
            (ETC_PATH, ObjectType::Directory, 0, 0, ROOT_DIR_MODE),
            (API_ETC_PATH, ObjectType::Directory, 0, 0, ROOT_DIR_MODE),
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

        fake.clear_calls();
        provision_with(&layout, &identity, &fake).unwrap();
        assert_no_mutation(&fake.calls());
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
        for object_type in [ObjectType::Symlink, ObjectType::Other] {
            let (_tmp, layout, fake, identity) = provisioned_fake();
            let mut invalid = fake.stat_for(AUDIT_PATH).unwrap();
            invalid.object_type = object_type;
            fake.set_stat(AUDIT_PATH, invalid);
            fake.clear_calls();

            let result = provision_with(&layout, &identity, &fake);
            assert!(matches!(
                result,
                Err(ReleaseError::ApiRuntimeMetadataMismatch {
                    path: AUDIT_PATH,
                    ..
                })
            ));
            assert_no_mutation(&fake.calls());
        }
    }

    #[test]
    fn operator_repair_followed_by_rerun_succeeds_without_repairing_metadata() {
        let (_tmp, layout, fake, identity) = provisioned_fake();
        let valid = fake.stat_for(API_STATE_PATH).unwrap();
        let mut invalid = valid;
        invalid.mode = 0o755;
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
    fn each_post_creation_failure_removes_only_call_created_objects() {
        for path in MANAGED_PATHS {
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
        let parent = fake.fd_for(API_ETC_PATH);
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
        let parent = fake.fd_for(API_ETC_PATH);
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
}
