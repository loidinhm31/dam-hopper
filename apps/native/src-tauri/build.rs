use std::{env, fs, path::PathBuf};

use tauri_build::{AppManifest, Attributes, WindowsAttributes};

const SSH_FORWARD_COMMANDS: &[&str] = include!("src/ssh_forward/command_names.in.rs");

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let bridge_asset = manifest_dir.join("../../../packages/browser-bridge/dist/index.iife.js");
    println!("cargo:rerun-if-changed={}", bridge_asset.display());
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("target operating system");
    let target_env = env::var("CARGO_CFG_TARGET_ENV").expect("target environment");
    let is_windows_msvc = target_os == "windows" && target_env == "msvc";
    if is_windows_msvc {
        // Unit-test executables do not receive Tauri's bin-only resource link.
        // Embed the Common Controls manifest in every MSVC executable instead.
        let app_manifest = manifest_dir.join("windows.manifest");
        println!("cargo:rerun-if-changed={}", app_manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            app_manifest.display()
        );
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("build output directory"));
    let embedded_asset = out_dir.join("browser-debug-bridge.iife.js");
    if !bridge_asset.is_file() {
        panic!(
            "missing browser bridge asset at {} — run `pnpm --filter @dam-hopper/browser-bridge build` first",
            bridge_asset.display()
        );
    }
    fs::copy(&bridge_asset, embedded_asset).expect("copy browser bridge asset");
    let mut attributes = Attributes::new();
    if is_windows_msvc {
        // The manifest is linked above so Tauri's bin-only resource does not
        // create a duplicate manifest when Cargo builds the app test binary.
        attributes = attributes.windows_attributes(WindowsAttributes::new_without_app_manifest());
    }
    let attributes = if target_os == "windows" {
        attributes.app_manifest(AppManifest::new().commands(SSH_FORWARD_COMMANDS))
    } else {
        attributes
    };

    tauri_build::try_build(attributes).expect("failed to generate Tauri application manifest");
}
