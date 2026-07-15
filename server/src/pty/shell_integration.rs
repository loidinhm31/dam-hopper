//! Launch-only adapters for supported local interactive shells.

use std::{
    collections::HashMap,
    fs,
    io::Write,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use portable_pty::CommandBuilder;
use rand::{rngs::OsRng, RngCore};
use tempfile::{NamedTempFile, TempDir, TempPath};

use super::shell_lifecycle::ShellLifecycle;

#[derive(Debug, Clone, Copy)]
enum Shell {
    Zsh,
    Fish,
}

pub struct ShellIntegration {
    init_file: TempPath,
    init_dir: Option<TempDir>,
    shell: Shell,
    lifecycle: Arc<Mutex<ShellLifecycle>>,
}

impl ShellIntegration {
    pub fn prepare(command: &str, env: &HashMap<String, String>) -> Option<Self> {
        if !command.is_empty() {
            return None;
        }
        let shell = match env
            .get("SHELL")
            .map(String::as_str)
            .unwrap_or("/bin/bash")
            .rsplit('/')
            .next()?
        {
            "zsh" => Shell::Zsh,
            "fish" => Shell::Fish,
            _ => return None,
        };
        let asset = match shell {
            Shell::Zsh => include_str!("../../assets/shell-integration/zsh.zsh"),
            Shell::Fish => include_str!("../../assets/shell-integration/fish.fish"),
        };
        let mut file = NamedTempFile::new().ok()?;
        file.write_all(asset.as_bytes()).ok()?;
        let init_file = file.into_temp_path();
        let init_dir = if matches!(shell, Shell::Zsh) {
            let dir = TempDir::new().ok()?;
            let rc = format!(
                "[[ -f $HOME/.zshrc ]] && source $HOME/.zshrc\nsource '{}'\n",
                init_file.display()
            );
            fs::write(dir.path().join(".zshrc"), rc).ok()?;
            Some(dir)
        } else {
            None
        };
        let mut bytes = [0_u8; 24];
        OsRng.fill_bytes(&mut bytes);
        let mut generation = [0_u8; 8];
        OsRng.fill_bytes(&mut generation);
        Some(Self {
            init_file,
            init_dir,
            shell,
            lifecycle: Arc::new(Mutex::new(ShellLifecycle::new(
                URL_SAFE_NO_PAD.encode(bytes),
                u64::from_le_bytes(generation),
            ))),
        })
    }

    pub fn apply(&self, command: &mut CommandBuilder) {
        command.env(
            "DAM_HOPPER_SHELL_NONCE",
            self.lifecycle.lock().unwrap().nonce(),
        );
        match self.shell {
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
