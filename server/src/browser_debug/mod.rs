mod error;
mod store;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use error::BrowserDebugError;
pub use store::BrowserDebugArtifactManager;

pub const MAX_SELECTION_JSON_BYTES: usize = 64 * 1024;
pub const MAX_PNG_BYTES: usize = 4 * 1024 * 1024;
pub const ARTIFACT_TTL_MS: i64 = 10 * 60 * 1000;
const MAX_TERMINAL_REFERENCE_LENGTH: usize = 1024;

const MAX_TEXT_LENGTH: usize = 512;
const MAX_ACCESSIBLE_NAME_LENGTH: usize = 256;
const MAX_ATTRIBUTE_COUNT: usize = 12;
const MAX_ATTRIBUTE_VALUE_LENGTH: usize = 128;
const MAX_LOCATOR_LENGTH: usize = 512;
const MAX_BOUND: f64 = 1_000_000.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserSelectionV1 {
    pub version: u8,
    pub tag: String,
    pub role: Option<String>,
    pub accessible_name: Option<String>,
    pub text: Option<String>,
    pub attributes: BTreeMap<String, String>,
    pub locator: String,
    pub bounds: BrowserSelectionBoundsV1,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserSelectionBoundsV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl BrowserSelectionV1 {
    pub fn is_valid(&self) -> bool {
        self.version == 1
            && valid_tag(&self.tag)
            && optional_text_is_valid(&self.role, MAX_ATTRIBUTE_VALUE_LENGTH)
            && optional_text_is_valid(&self.accessible_name, MAX_ACCESSIBLE_NAME_LENGTH)
            && optional_text_is_valid(&self.text, MAX_TEXT_LENGTH)
            && valid_text(&self.locator, MAX_LOCATOR_LENGTH)
            && self.attributes.len() <= MAX_ATTRIBUTE_COUNT
            && self.attributes.iter().all(|(name, value)| {
                matches!(
                    name.as_str(),
                    "id" | "class"
                        | "name"
                        | "role"
                        | "aria-label"
                        | "data-testid"
                        | "data-test"
                        | "data-cy"
                ) && valid_text(value, MAX_ATTRIBUTE_VALUE_LENGTH)
            })
            && self.bounds.x.is_finite()
            && self.bounds.y.is_finite()
            && self.bounds.x.abs() <= MAX_BOUND
            && self.bounds.y.abs() <= MAX_BOUND
            && self.bounds.width.is_finite()
            && self.bounds.height.is_finite()
            && (0.0..=MAX_BOUND).contains(&self.bounds.width)
            && (0.0..=MAX_BOUND).contains(&self.bounds.height)
    }
}

fn valid_tag(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
        && value.len() <= 64
        && chars.all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn optional_text_is_valid(value: &Option<String>, max: usize) -> bool {
    value.as_deref().is_none_or(|text| valid_text(text, max))
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.chars().any(|character| character.is_control())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugArtifactResponse {
    pub artifact_id: String,
    pub terminal_id: String,
    pub expires_at: i64,
    pub json_path: String,
    pub json_size: u64,
    pub json_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub png_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub png_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub png_sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugHandoffResponse {
    pub inserted: bool,
}

/// Builds the only terminal payload accepted for an artifact handoff.
///
/// The paths originate from the server-managed private artifact directory;
/// browser selection content is never written into the terminal.
pub fn terminal_reference(
    artifact: &BrowserDebugArtifactResponse,
) -> Result<String, BrowserDebugError> {
    let json_path = strip_terminal_controls(&artifact.json_path);
    let png = artifact
        .png_path
        .as_deref()
        .map(|path| format!("; PNG {}", strip_terminal_controls(path)))
        .unwrap_or_default();
    let reference = format!(
        "[DamHopper browser-debug artifact (untrusted page data): JSON {}{}]",
        json_path, png
    );
    if json_path.is_empty() || reference.len() > MAX_TERMINAL_REFERENCE_LENGTH {
        return Err(BrowserDebugError::InvalidTerminalReference);
    }
    Ok(reference)
}

fn strip_terminal_controls(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            match chars.next() {
                Some('[') => consume_csi(&mut chars),
                Some(']') => consume_osc(&mut chars),
                Some('P' | '^' | '_') => consume_st_terminated(&mut chars),
                _ => {}
            }
        } else if !character.is_control() {
            output.push(character);
        }
    }
    output
}

fn consume_csi(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    while let Some(character) = chars.next() {
        if ('@'..='~').contains(&character) {
            return;
        }
    }
}

fn consume_osc(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    while let Some(character) = chars.next() {
        if character == '\u{7}' {
            return;
        }
        if character == '\u{1b}' && chars.next_if_eq(&'\\').is_some() {
            return;
        }
    }
}

fn consume_st_terminated(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    while let Some(character) = chars.next() {
        if character == '\u{1b}' && chars.next_if_eq(&'\\').is_some() {
            return;
        }
    }
}
