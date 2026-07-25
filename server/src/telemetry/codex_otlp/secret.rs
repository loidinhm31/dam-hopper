use std::{fs::OpenOptions, io, path::PathBuf};

use rand::RngCore;

const SECRET_FILE: &str = "codex-otlp-token";

pub fn default_secret_path() -> io::Result<PathBuf> {
    dirs::config_dir()
        .map(|path| path.join("dam-hopper").join(SECRET_FILE))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "configuration directory unavailable",
            )
        })
}

pub fn load_or_create_secret(path: PathBuf) -> io::Result<String> {
    match read_secret(&path) {
        Ok(secret) if secret.len() == 64 && secret.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            return Ok(secret)
        }
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid collector token",
            ))
        }
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        Err(_) => {}
    }
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "collector token path has no parent",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let secret = hex::encode(bytes);
    #[cfg(unix)]
    {
        use std::{io::Write, os::unix::fs::OpenOptionsExt};
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(secret.as_bytes())?;
        file.sync_all()?;
    }
    #[cfg(not(unix))]
    std::fs::write(path, &secret)?;
    Ok(secret)
}

#[cfg(unix)]
fn read_secret(path: &std::path::Path) -> io::Result<String> {
    use std::{
        io::Read,
        os::unix::fs::{OpenOptionsExt, PermissionsExt},
    };
    let mut options = OpenOptions::new();
    options.read(true).custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "collector token must be a 0600 regular file",
        ));
    }
    let mut secret = String::with_capacity(64);
    file.read_to_string(&mut secret)?;
    Ok(secret)
}

#[cfg(not(unix))]
fn read_secret(path: &std::path::Path) -> io::Result<String> {
    std::fs::read_to_string(path)
}
