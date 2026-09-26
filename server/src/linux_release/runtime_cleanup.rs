//! Retire only stopped, fixed IPC artifacts left by older shared RuntimeDirectory units.

use super::error::ReleaseError;
use super::layout::Layout;
use super::systemd::systemctl_show_property;
use std::ffi::CString;
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Component, Path};

const SOCKETS: [&str; 2] = ["plugin-runner.sock", "idle-suspend.sock"];
const ARTIFACTS: [(&str, libc::mode_t); 3] = [
    ("plugin-runner.sock", libc::S_IFSOCK),
    ("idle-suspend.sock", libc::S_IFSOCK),
    ("server.pid", libc::S_IFREG),
];

/// Called under the release transaction lock, after stopping all managed producers.
pub(crate) fn cleanup_stopped_plugin_runtime(layout: &Layout) -> Result<(), ReleaseError> {
    for unit in [
        "dam-hopper-api.service",
        "dam-hopper-plugin-runner.service",
        "dam-hopper-idle-suspend-helper.service",
        "dam-hopper-idle-suspend-helper.socket",
    ] {
        let loaded = systemctl_show_property(unit, "LoadState")?;
        if loaded == "not-found" {
            continue;
        }
        let active = systemctl_show_property(unit, "ActiveState")?;
        if !matches!(active.as_str(), "inactive" | "failed") {
            return Err(refusal(format!("{unit} is not stopped ({active})")));
        }
        if unit.ends_with(".service") && systemctl_show_property(unit, "MainPID")? != "0" {
            return Err(refusal(format!("{unit} still has a main process")));
        }
    }
    cleanup_runtime_directory(&layout.trusted_root().join("run/dam-hopper"))
}

fn refusal(reason: String) -> ReleaseError {
    ReleaseError::Config(format!("refusing runtime IPC cleanup: {reason}"))
}

fn io_error(error: io::Error) -> ReleaseError {
    ReleaseError::Io {
        action: "clean stopped plugin runtime",
        details: error.to_string(),
    }
}

/// Walk every component without following links, including the test layout prefix.
fn open_directory(path: &Path) -> Result<Option<OwnedFd>, ReleaseError> {
    if !path.is_absolute() {
        return Err(refusal("runtime directory must be absolute".into()));
    }
    let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let root = CString::new("/").unwrap();
    // SAFETY: valid NUL-terminated constant and no variadic creation mode required.
    let fd = unsafe { libc::open(root.as_ptr(), flags) };
    if fd < 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    // SAFETY: open returned a new owned descriptor.
    let mut current = unsafe { OwnedFd::from_raw_fd(fd) };
    for component in path.components() {
        let Component::Normal(name) = component else {
            if component == Component::RootDir {
                continue;
            }
            return Err(refusal("non-normal runtime path component".into()));
        };
        let name =
            CString::new(name.as_bytes()).map_err(|_| refusal("NUL in runtime path".into()))?;
        // SAFETY: current is live and name is NUL-terminated.
        let next = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if next < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(io_error(error));
        }
        // SAFETY: openat returned a new owned descriptor; previous component closes here.
        current = unsafe { OwnedFd::from_raw_fd(next) };
    }
    Ok(Some(current))
}

fn stat_at(dir: &OwnedFd, name: &CString) -> Result<Option<libc::stat>, ReleaseError> {
    // SAFETY: stat is a plain C output structure, initialized before inspection.
    let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
    // SAFETY: live directory descriptor, valid CString and writable stat pointer.
    if unsafe {
        libc::fstatat(
            dir.as_raw_fd(),
            name.as_ptr(),
            &mut stat,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } < 0
    {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(io_error(error));
    }
    Ok(Some(stat))
}

fn refuse_bound_sockets(runtime: &Path) -> Result<(), ReleaseError> {
    let table = fs::read_to_string("/proc/net/unix").map_err(io_error)?;
    let socket_paths = SOCKETS.map(|name| runtime.join(name));
    for line in table.lines().skip(1) {
        // Seven whitespace-separated fields precede the pathname. Keep embedded spaces.
        let mut remaining = line;
        for _ in 0..7 {
            remaining = remaining.trim_start();
            let end = remaining
                .find(char::is_whitespace)
                .unwrap_or(remaining.len());
            remaining = &remaining[end..];
        }
        let bound_path = Path::new(remaining.trim_start());
        if socket_paths.iter().any(|path| bound_path == path) {
            return Err(refusal(format!(
                "live Unix socket at {}",
                bound_path.display()
            )));
        }
    }
    Ok(())
}

fn cleanup_runtime_directory(runtime: &Path) -> Result<(), ReleaseError> {
    let Some(dir) = open_directory(runtime)? else {
        return Ok(());
    };
    refuse_bound_sockets(runtime)?;
    // Validate every artifact before removing any, preserving evidence on refusal.
    let mut artifacts = Vec::with_capacity(ARTIFACTS.len());
    for (name, kind) in ARTIFACTS {
        let name = CString::new(name).unwrap();
        if let Some(stat) = stat_at(&dir, &name)? {
            if stat.st_mode & libc::S_IFMT != kind {
                return Err(refusal(format!(
                    "unexpected file type at {}",
                    name.to_string_lossy()
                )));
            }
            artifacts.push((name, stat.st_dev, stat.st_ino));
        }
    }
    for (name, dev, ino) in artifacts {
        refuse_bound_sockets(runtime)?;
        let Some(current) = stat_at(&dir, &name)? else {
            continue;
        };
        if (current.st_dev, current.st_ino) != (dev, ino) {
            return Err(refusal(format!(
                "runtime artifact changed: {}",
                name.to_string_lossy()
            )));
        }
        // SAFETY: unlinkat acts only on this exact entry in the opened directory; no links followed.
        if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::os::unix::net::UnixListener;

    #[test]
    fn removes_stale_known_artifacts_without_touching_other_entries() {
        let temp = tempfile::tempdir().unwrap();
        for name in SOCKETS {
            drop(UnixListener::bind(temp.path().join(name)).unwrap());
        }
        fs::write(temp.path().join("server.pid"), "12345\n").unwrap();
        fs::write(temp.path().join("unrelated"), "keep").unwrap();
        cleanup_runtime_directory(temp.path()).unwrap();
        for (name, _) in ARTIFACTS {
            assert!(!temp.path().join(name).exists());
        }
        assert_eq!(
            fs::read_to_string(temp.path().join("unrelated")).unwrap(),
            "keep"
        );
        cleanup_runtime_directory(temp.path()).unwrap();
    }

    #[test]
    fn refuses_live_listener_and_preserves_pid() {
        let temp = tempfile::tempdir().unwrap();
        let socket = temp.path().join("plugin-runner.sock");
        let _listener = UnixListener::bind(&socket).unwrap();
        let pid = temp.path().join("server.pid");
        fs::write(&pid, "12345\n").unwrap();
        assert!(cleanup_runtime_directory(temp.path()).is_err());
        assert_eq!(fs::read_to_string(pid).unwrap(), "12345\n");
        assert!(socket.exists());
    }

    #[test]
    fn refuses_symlinks_and_unexpected_socket_path_file_types() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = temp.path().join("runtime");
        fs::create_dir(&runtime).unwrap();
        let outside = temp.path().join("outside");
        fs::write(&outside, "keep").unwrap();
        let socket = runtime.join("plugin-runner.sock");
        symlink(&outside, &socket).unwrap();
        assert!(cleanup_runtime_directory(&runtime).is_err());
        assert!(fs::symlink_metadata(&socket)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_file(&socket).unwrap();
        fs::write(&socket, "not a socket").unwrap();
        assert!(cleanup_runtime_directory(&runtime).is_err());
        assert_eq!(fs::read_to_string(&socket).unwrap(), "not a socket");
        let linked_runtime = temp.path().join("linked");
        symlink(&runtime, &linked_runtime).unwrap();
        assert!(cleanup_runtime_directory(&linked_runtime).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "keep");
    }
}
