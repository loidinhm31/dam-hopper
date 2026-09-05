//! Minimal line-by-line parser for systemd unit files.

use super::error::ReleaseError;
use std::collections::HashMap;

/// Parsed systemd unit file representation.
#[derive(Debug, Default)]
pub struct ParsedUnit {
    pub sections: HashMap<String, Vec<(String, String)>>,
}

impl ParsedUnit {
    pub fn parse(content: &str) -> Result<Self, ReleaseError> {
        let mut sections: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut current_section = String::new();

        for (idx, line) in content.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }

            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
                sections.entry(current_section.clone()).or_default();
                continue;
            }

            if current_section.is_empty() {
                return Err(ReleaseError::UnitPolicyViolation {
                    unit: "unknown".into(),
                    reason: format!("directive on line {line_num} outside of any section"),
                });
            }

            if let Some((k, v)) = trimmed.split_once('=') {
                sections
                    .entry(current_section.clone())
                    .or_default()
                    .push((k.trim().to_string(), v.trim().to_string()));
            }
        }

        Ok(Self { sections })
    }

    pub fn get_value(&self, section: &str, key: &str) -> Option<&str> {
        self.sections
            .get(section)?
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    pub fn get_all_values(&self, section: &str, key: &str) -> Vec<&str> {
        self.sections
            .get(section)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|(k, _)| k == key)
                    .map(|(_, v)| v.as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn has_coupling(&self, forbidden_keyword: &str) -> bool {
        let coupling_keys = [
            "Requires",
            "PartOf",
            "BindsTo",
            "ConsistsOf",
            "Wants",
            "After",
            "Before",
        ];
        for entries in self.sections.values() {
            for (k, v) in entries {
                if coupling_keys.contains(&k.as_str()) && v.contains(forbidden_keyword) {
                    return true;
                }
            }
        }
        false
    }
}
