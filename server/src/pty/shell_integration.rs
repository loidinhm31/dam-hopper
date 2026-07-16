//! Launch-only adapters for supported local interactive shells.

use std::{
    collections::HashMap,
    fs,
    io::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use portable_pty::CommandBuilder;
use rand::{rngs::OsRng, RngCore};
use tempfile::{NamedTempFile, TempDir, TempPath};

use super::shell_lifecycle::ShellLifecycle;

static NEXT_LIFECYCLE_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy)]
enum Shell {
    Bash,
    Zsh,
    Fish,
}

pub(super) fn interactive_shell_executable(
    command: &str,
    env: &HashMap<String, String>,
) -> Option<String> {
    let configured_shell = env
        .get("SHELL")
        .filter(|shell| shell.starts_with('/'))
        .cloned()
        .unwrap_or_else(|| "/bin/bash".to_string());

    if command.is_empty() {
        return Some(configured_shell);
    }
    if command == "bash" {
        return Some(
            configured_shell
                .rsplit('/')
                .next()
                .is_some_and(|name| name == "bash")
                .then_some(configured_shell)
                .unwrap_or_else(|| "/bin/bash".to_string()),
        );
    }
    None
}

pub struct ShellIntegration {
    init_file: TempPath,
    init_dir: Option<TempDir>,
    shell: Shell,
    lifecycle: Arc<Mutex<ShellLifecycle>>,
}

impl ShellIntegration {
    pub fn prepare(command: &str, env: &HashMap<String, String>) -> Option<Self> {
        let executable = interactive_shell_executable(command, env)?;
        let shell = match executable.as_str().rsplit('/').next()? {
            "zsh" => Shell::Zsh,
            "fish" => Shell::Fish,
            "bash" => Shell::Bash,
            _ => return None,
        };
        let asset = match shell {
            Shell::Bash => include_str!("../../assets/shell-integration/bash.sh"),
            Shell::Zsh => include_str!("../../assets/shell-integration/zsh.zsh"),
            Shell::Fish => include_str!("../../assets/shell-integration/fish.fish"),
        };
        let mut asset_file = NamedTempFile::new().ok()?;
        asset_file.write_all(asset.as_bytes()).ok()?;
        let asset_path = asset_file.into_temp_path();
        let init_dir = if matches!(shell, Shell::Zsh) {
            let dir = TempDir::new().ok()?;
            let rc = format!(
                "[[ -f \"$HOME/.zshrc\" ]] && source \"$HOME/.zshrc\"\nsource '{}'\n",
                asset_path.display()
            );
            fs::write(dir.path().join(".zshrc"), rc).ok()?;
            Some(dir)
        } else {
            None
        };
        let init_file = if matches!(shell, Shell::Bash) {
            let mut wrapper = NamedTempFile::new().ok()?;
            let rc = format!(
                "[[ -f \"$HOME/.bashrc\" ]] && source \"$HOME/.bashrc\"\n{}\n",
                asset
            );
            wrapper.write_all(rc.as_bytes()).ok()?;
            wrapper.into_temp_path()
        } else {
            asset_path
        };
        let mut bytes = [0_u8; 24];
        OsRng.fill_bytes(&mut bytes);
        Some(Self {
            init_file,
            init_dir,
            shell,
            lifecycle: Arc::new(Mutex::new(ShellLifecycle::new(
                URL_SAFE_NO_PAD.encode(bytes),
                NEXT_LIFECYCLE_GENERATION.fetch_add(1, Ordering::Relaxed),
            ))),
        })
    }

    pub fn apply(&self, command: &mut CommandBuilder) {
        command.env(
            "DAM_HOPPER_SHELL_NONCE",
            self.lifecycle.lock().unwrap().nonce(),
        );
        match self.shell {
            Shell::Bash => {
                command.arg("--rcfile");
                command.arg(&self.init_file);
                command.arg("-i");
            }
            Shell::Zsh => {
                command.arg("-i");
                command.env("ZDOTDIR", self.init_dir.as_ref().unwrap().path());
            }
            Shell::Fish => {
                command.arg("--init-command");
                command.arg(format!("source '{}'", self.init_file.display()));
            }
        }
    }

    pub fn lifecycle(&self) -> Arc<Mutex<ShellLifecycle>> {
        Arc::clone(&self.lifecycle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, Stdio};

    #[cfg(unix)]
    fn run_bash(integration: &ShellIntegration, home: &Path, input: &[u8]) -> std::process::Output {
        let nonce = integration.lifecycle.lock().unwrap().nonce().to_owned();
        let mut child = Command::new("/bin/bash")
            .args(["--noprofile", "--rcfile"])
            .arg(&integration.init_file)
            .arg("-i")
            .env_clear()
            .env("DAM_HOPPER_SHELL_NONCE", nonce)
            .env("HOME", home)
            .env("PATH", "/usr/bin:/bin")
            .env("SHELL", "/bin/bash")
            .env("TERM", "dumb")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn bash");

        child
            .stdin
            .take()
            .expect("bash stdin")
            .write_all(input)
            .expect("write bash commands");
        child.wait_with_output().expect("wait for bash")
    }

    #[cfg(unix)]
    fn lifecycle_events(
        integration: &ShellIntegration,
        output: &std::process::Output,
    ) -> Vec<super::super::shell_lifecycle::LifecycleEvent> {
        let mut bytes = output.stdout.clone();
        bytes.extend_from_slice(&output.stderr);
        integration.lifecycle.lock().unwrap().feed(&bytes)
    }

    #[cfg(unix)]
    #[test]
    fn bash_emits_validated_lifecycle_for_simple_command() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        let output = run_bash(&integration, home.path(), b"echo bash-inline-test\nexit\n");
        let events = lifecycle_events(&integration, &output);

        assert!(
            events.iter().any(|event| {
                event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                    && event.command.as_deref() == Some("echo bash-inline-test")
            }),
            "stdout: {:?}\nstderr: {:?}\nevents: {events:?}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        assert!(!output.stdout.windows(5).any(|window| window == b"633;"));
    }

    #[cfg(unix)]
    #[test]
    fn bash_disables_adapter_without_replacing_existing_debug_trap() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        fs::write(
            home.path().join(".bashrc"),
            "trap 'printf user-debug\\n' DEBUG\n",
        )
        .expect("write bashrc");

        let output = run_bash(&integration, home.path(), b"echo retained-trap\nexit\n");
        let mut combined = output.stdout.clone();
        combined.extend_from_slice(&output.stderr);
        assert!(String::from_utf8_lossy(&combined).contains("user-debug"));
        assert!(!combined.windows(5).any(|window| window == b"633;"));
        assert!(lifecycle_events(&integration, &output).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn bash_preserves_scalar_and_array_prompt_hooks() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        for (hook, output_text) in [
            ("PROMPT_COMMAND='printf scalar-hook\\n'\n", "scalar-hook"),
            ("PROMPT_COMMAND=('printf array-hook\\n')\n", "array-hook"),
        ] {
            let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
            let home = tempfile::tempdir().expect("temporary home");
            fs::write(home.path().join(".bashrc"), hook).expect("write bashrc");
            let output = run_bash(&integration, home.path(), b"echo hook-test\nexit\n");
            let mut combined = output.stdout.clone();
            combined.extend_from_slice(&output.stderr);
            assert!(String::from_utf8_lossy(&combined).contains(output_text));
            assert!(lifecycle_events(&integration, &output).iter().any(|event| {
                event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                    && event.command.as_deref() == Some("echo hook-test")
            }));
        }
    }

    #[cfg(unix)]
    #[test]
    fn bash_ignores_ps0_helpers_before_capturing_the_user_command() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        fs::write(
            home.path().join(".bashrc"),
            "__test_ps0_helper() { :; }\nPS0='$(__test_ps0_helper)'\n",
        )
        .expect("write bashrc");

        let output = run_bash(
            &integration,
            home.path(),
            b"echo command-after-ps0-helper\nexit\n",
        );
        let events = lifecycle_events(&integration, &output);

        assert!(
            events.iter().any(|event| {
                event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                    && event.command.as_deref() == Some("echo command-after-ps0-helper")
            }),
            "stdout: {:?}\nstderr: {:?}\nevents: {events:?}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    #[cfg(unix)]
    #[test]
    fn bash_emits_simple_command_with_a_full_stifled_history_list() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        fs::write(home.path().join(".bashrc"), "HISTSIZE=2\n").expect("write bashrc");
        fs::write(
            home.path().join(".bash_history"),
            "first-preloaded-command\nsecond-preloaded-command\nthird-preloaded-command\n",
        )
        .expect("write bash history");

        let output = run_bash(
            &integration,
            home.path(),
            b"echo command-after-full-history\nexit\n",
        );
        let events = lifecycle_events(&integration, &output);

        assert!(
            events.iter().any(|event| {
                event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                    && event.command.as_deref() == Some("echo command-after-full-history")
            }),
            "stdout: {:?}\nstderr: {:?}\nevents: {events:?}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    #[cfg(unix)]
    #[test]
    fn bash_abandons_ambiguous_command_without_marker_leakage() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        let output = run_bash(&integration, home.path(), b"echo one; echo two\nexit\n");
        let mut combined = output.stdout.clone();
        combined.extend_from_slice(&output.stderr);
        let events = lifecycle_events(&integration, &output);

        assert!(!combined.windows(5).any(|window| window == b"633;"));
        assert!(!events.iter().any(|event| {
            event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                && event.command.as_deref() == Some("echo one; echo two")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn bash_normalizes_leading_whitespace_in_simple_command() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        let integration = ShellIntegration::prepare("", &env).expect("bash adapter");
        let home = tempfile::tempdir().expect("temporary home");
        let output = run_bash(&integration, home.path(), b"  echo leading-space\nexit\n");
        let events = lifecycle_events(&integration, &output);

        assert!(events.iter().any(|event| {
            event.state == super::super::shell_lifecycle::LifecycleState::Submitted
                && event.command.as_deref() == Some("echo leading-space")
        }));
    }

    #[test]
    fn lifecycle_generations_are_monotonic() {
        let env = HashMap::from([("SHELL".into(), "/bin/zsh".into())]);
        let first = ShellIntegration::prepare("", &env)
            .unwrap()
            .lifecycle()
            .lock()
            .unwrap()
            .generation();
        let second = ShellIntegration::prepare("", &env)
            .unwrap()
            .lifecycle()
            .lock()
            .unwrap()
            .generation();

        assert!(second > first);
    }

    #[test]
    fn selects_bash_for_default_and_explicit_interactive_sessions() {
        let env = HashMap::from([("SHELL".into(), "/bin/bash".into())]);
        assert!(ShellIntegration::prepare("", &env).is_some());
        assert!(ShellIntegration::prepare("bash", &env).is_some());
        assert!(ShellIntegration::prepare("echo hi", &env).is_none());

        let alternate = HashMap::from([("SHELL".into(), "/usr/bin/bash".into())]);
        assert_eq!(
            interactive_shell_executable("bash", &alternate).as_deref(),
            Some("/usr/bin/bash")
        );
    }

    #[test]
    fn preserves_existing_shell_adapters() {
        for shell in ["zsh", "fish"] {
            let env = HashMap::from([("SHELL".into(), format!("/bin/{shell}"))]);
            assert!(ShellIntegration::prepare("", &env).is_some(), "{shell}");
        }
    }
}
