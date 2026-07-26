use std::{fs, path::Path};

use toml_edit::DocumentMut;

use crate::utils::atomic_write;

pub(crate) struct ConfigSnapshot(pub Option<String>);

pub(super) fn snapshot(path: &Path) -> Result<ConfigSnapshot, String> {
    read_raw(path).map(ConfigSnapshot)
}

pub(super) fn restore(path: &Path, snapshot: ConfigSnapshot) -> Result<(), String> {
    match snapshot.0 {
        Some(raw) => write_raw(path, &raw),
        None => remove_if_regular(path),
    }
}

pub(super) fn read_document(path: &Path) -> Result<DocumentMut, String> {
    match read_raw(path)? {
        Some(raw) if !raw.trim().is_empty() => raw
            .parse()
            .map_err(|_| "Codex config is malformed".to_string()),
        _ => Ok(DocumentMut::new()),
    }
}

pub(super) fn write_raw(path: &Path, raw: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Codex config path is invalid".to_string())?;
    safe_directory(parent)?;
    atomic_write(path, raw).map_err(|_| "Unable to write Codex config".to_string())
}

fn read_raw(path: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Unable to inspect Codex config".to_string()),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.file_type().is_file() => {
            return Err("Codex config must be a regular file".to_string());
        }
        Ok(_) => {}
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|_| "Unable to read Codex config".to_string())
}

fn remove_if_regular(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Unable to inspect Codex config".to_string()),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.file_type().is_file() => {
            Err("Codex config must be a regular file".to_string())
        }
        Ok(_) => fs::remove_file(path).map_err(|_| "Unable to restore Codex config".to_string()),
    }
}

fn safe_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| "Unable to inspect Codex config directory".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Codex config directory is unsafe".to_string());
        }
    } else {
        fs::create_dir_all(path)
            .map_err(|_| "Unable to create Codex config directory".to_string())?;
    }
    Ok(())
}
