use std::collections::HashMap;

use super::error::PluginError;
use super::limits::MAX_UI_DOCUMENT_BYTES;
use super::manifest::ManifestV1;
use super::package::InspectedEntry;

pub fn validate_inventory_match(
    manifest: &ManifestV1,
    entries: &HashMap<String, InspectedEntry>,
) -> Result<(), PluginError> {
    for inv in &manifest.inventory {
        let entry = entries.get(&inv.path).ok_or_else(|| {
            PluginError::invalid_input(format!(
                "Inventory entry '{}' not found in archive",
                inv.path
            ))
        })?;

        if entry.is_dir {
            return Err(PluginError::invalid_input(format!(
                "Inventory entry '{}' is a directory, regular file expected",
                inv.path
            )));
        }
        if entry.size != inv.size {
            return Err(PluginError::invalid_input(format!(
                "Inventory entry '{}' size mismatch: manifest has {}, archive has {}",
                inv.path, inv.size, entry.size
            )));
        }
        if entry.mode != (inv.mode & 0o777) {
            return Err(PluginError::invalid_input(format!(
                "Inventory entry '{}' mode mismatch: manifest has {:#o}, archive has {:#o}",
                inv.path, inv.mode, entry.mode
            )));
        }
        if entry.sha256.as_deref() != Some(&inv.sha256) {
            return Err(PluginError::invalid_input(format!(
                "Inventory entry '{}' SHA-256 mismatch: manifest has {}, archive has {:?}",
                inv.path, inv.sha256, entry.sha256
            )));
        }
    }

    for (path, entry) in entries {
        if path != "manifest.json"
            && !entry.is_dir
            && !manifest.inventory.iter().any(|i| &i.path == path)
        {
            return Err(PluginError::invalid_input(format!(
                "Undeclared archive entry '{}' not listed in manifest inventory",
                path
            )));
        }
    }

    Ok(())
}

pub fn validate_entrypoints(
    manifest: &ManifestV1,
    entries: &HashMap<String, InspectedEntry>,
) -> Result<(), PluginError> {
    let backend_entry = &manifest.entrypoints.backend.entry;
    let backend = entries.get(backend_entry).ok_or_else(|| {
        PluginError::invalid_input(format!(
            "Backend entrypoint '{backend_entry}' not found in archive"
        ))
    })?;
    if backend.is_dir {
        return Err(PluginError::invalid_input(format!(
            "Backend entrypoint '{backend_entry}' cannot be a directory"
        )));
    }
    if manifest.entrypoints.backend.runtime != "node" {
        return Err(PluginError::invalid_input(format!(
            "Unsupported backend runtime: '{}', expected 'node'",
            manifest.entrypoints.backend.runtime
        )));
    }

    if let Some(ui) = &manifest.entrypoints.ui {
        let ui_entry = entries.get(&ui.entry).ok_or_else(|| {
            PluginError::invalid_input(format!("UI entrypoint '{}' not found in archive", ui.entry))
        })?;
        if ui_entry.is_dir {
            return Err(PluginError::invalid_input(format!(
                "UI entrypoint '{}' cannot be a directory",
                ui.entry
            )));
        }
        if ui_entry.size > MAX_UI_DOCUMENT_BYTES {
            return Err(PluginError::invalid_input(format!(
                "UI entrypoint '{}' size ({}) exceeds limit ({MAX_UI_DOCUMENT_BYTES})",
                ui.entry, ui_entry.size
            )));
        }
    } else if let Some(nav) = &manifest.navigation {
        if !nav.is_empty() {
            return Err(PluginError::invalid_input(
                "Backend-only package cannot define navigation items",
            ));
        }
    }

    Ok(())
}
