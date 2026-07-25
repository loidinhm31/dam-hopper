use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::{
    privacy::{HmacDigest, TelemetryHmacKey},
    types::{CaptureQuality, SafeIdentifier},
};

pub const COMMAND_HMAC_DOMAIN: &[u8] = b"cmd:v1";
const MAX_COMMAND_BYTES: usize = 8 * 1024;
const MAX_ARGUMENTS: usize = 64;
const UNAVAILABLE_INPUT: &[u8] = b"<unavailable>";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedCommand {
    pub category: SafeIdentifier,
    pub executable: Option<SafeIdentifier>,
    /// Number of arguments after the executable, capped at 64.
    pub argument_count: u16,
    pub fingerprint: HmacDigest,
    pub capture_quality: CaptureQuality,
}

pub struct CommandClassifier {
    key: Arc<TelemetryHmacKey>,
}

impl CommandClassifier {
    pub fn new(key: Arc<TelemetryHmacKey>) -> Self {
        Self { key }
    }

    pub fn normalize(&self, command: &str) -> NormalizedCommand {
        normalize_with_key(command, &self.key)
    }
}

pub fn normalize_command(command: &str, key: &TelemetryHmacKey) -> NormalizedCommand {
    normalize_with_key(command, key)
}

fn normalize_with_key(command: &str, key: &TelemetryHmacKey) -> NormalizedCommand {
    let parsed = parse_simple_command(command);
    let fingerprint = key.digest(
        COMMAND_HMAC_DOMAIN,
        &[parsed
            .as_ref()
            .map_or(UNAVAILABLE_INPUT, |parsed| parsed.canonical.as_bytes())],
    );

    let Some(parsed) = parsed else {
        return unavailable(fingerprint);
    };

    let (category, allowed) = allowlisted_command(&parsed.executable, &parsed.arguments);
    let quality = if allowed && !parsed.argument_overflow {
        CaptureQuality::Rich
    } else if allowed || !parsed.executable.is_empty() {
        CaptureQuality::Partial
    } else {
        CaptureQuality::Unavailable
    };

    NormalizedCommand {
        category: SafeIdentifier::new(category).expect("static telemetry category is safe"),
        executable: allowed.then(|| {
            SafeIdentifier::new(parsed.executable).expect("allowlisted executable is safe")
        }),
        argument_count: parsed.arguments.len().min(MAX_ARGUMENTS) as u16,
        fingerprint,
        capture_quality: quality,
    }
}

struct ParsedCommand {
    canonical: String,
    executable: String,
    arguments: Vec<String>,
    argument_overflow: bool,
}

fn parse_simple_command(command: &str) -> Option<ParsedCommand> {
    if command.is_empty() || command.len() > MAX_COMMAND_BYTES || !command.is_ascii() {
        return None;
    }
    let tokens: Vec<&str> = command.split_ascii_whitespace().collect();
    if tokens.is_empty() || tokens.iter().any(|token| !simple_token(token)) {
        return None;
    }
    let canonical = tokens.join(" ");
    let executable = tokens[0].to_string();
    let arguments = tokens[1..]
        .iter()
        .map(|token| (*token).to_string())
        .collect();
    Some(ParsedCommand {
        canonical,
        executable,
        arguments,
        argument_overflow: tokens.len().saturating_sub(1) > MAX_ARGUMENTS,
    })
}

fn simple_token(token: &str) -> bool {
    !token.is_empty()
        && token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !b";|&<>`$\\'\"(){}[]*?!~#".contains(&byte))
}

fn allowlisted_command(executable: &str, arguments: &[String]) -> (&'static str, bool) {
    let first = arguments.first().map(String::as_str);
    let category = match executable {
        "git" => "git",
        "cargo" if matches!(first, Some("test")) => "test",
        "cargo" => "build",
        "mvn" | "gradle" | "make" | "cmake" | "go" => "build",
        "npm" | "pnpm" | "yarn" | "bun" if matches!(first, Some("test")) => "test",
        "npm" | "pnpm" | "yarn" | "bun" if matches!(first, Some("run" | "start" | "dev")) => {
            "dev-server"
        }
        "npm" | "pnpm" | "yarn" | "bun" => "package",
        "pytest" | "jest" | "vitest" => "test",
        "ls" | "cd" | "pwd" | "cat" | "cp" | "mv" | "mkdir" | "rm" | "find" | "grep" | "rg" => {
            "filesystem"
        }
        "curl" | "wget" | "ssh" => "network",
        "claude" | "codex" => "agent",
        _ => return ("other", false),
    };
    (category, true)
}

fn unavailable(fingerprint: HmacDigest) -> NormalizedCommand {
    NormalizedCommand {
        category: SafeIdentifier::new("other").unwrap(),
        executable: None,
        argument_count: 0,
        fingerprint,
        capture_quality: CaptureQuality::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::privacy::load_or_create_hmac_key;

    fn classifier() -> (tempfile::TempDir, CommandClassifier) {
        let directory = tempfile::tempdir().unwrap();
        let key = Arc::new(load_or_create_hmac_key(&directory.path().join("key")).unwrap());
        (directory, CommandClassifier::new(key))
    }

    #[test]
    fn allowlist_and_argument_count_are_bounded() {
        let (_directory, classifier) = classifier();
        let normalized = classifier.normalize("  git   status --short ");
        assert_eq!(normalized.category.as_str(), "git");
        assert_eq!(normalized.executable.as_ref().unwrap().as_str(), "git");
        assert_eq!(normalized.argument_count, 2);
        assert_eq!(normalized.capture_quality, CaptureQuality::Rich);
    }

    #[test]
    fn unsupported_and_shell_syntax_fail_closed() {
        let (_directory, classifier) = classifier();
        let unsupported = classifier.normalize("custom-tool input");
        assert_eq!(unsupported.capture_quality, CaptureQuality::Partial);
        assert_eq!(unsupported.category.as_str(), "other");
        assert!(unsupported.executable.is_none());
        assert_eq!(
            classifier
                .normalize("git status; cat secret")
                .capture_quality,
            CaptureQuality::Unavailable
        );
    }

    #[test]
    fn fingerprints_are_deterministic_and_domain_separated() {
        let (_directory, classifier) = classifier();
        let first = classifier.normalize("git status").fingerprint;
        assert_eq!(first, classifier.normalize("git   status").fingerprint);
        assert_ne!(first, classifier.normalize("git log").fingerprint);
        assert_ne!(first, classifier.key.digest(b"agent:v1", &[b"git status"]));
    }

    #[test]
    fn result_debug_and_serde_contain_no_raw_command() {
        let (_directory, classifier) = classifier();
        let normalized = classifier.normalize("git status fixture-secret");
        let debug = format!("{normalized:?}");
        let json = serde_json::to_string(&normalized).unwrap();
        assert!(!debug.contains("fixture-secret"));
        assert!(!json.contains("fixture-secret"));
        assert!(!json.contains("command"));
    }
}
