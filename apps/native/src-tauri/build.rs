use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let bridge_asset = manifest_dir.join("../../../packages/browser-bridge/dist/index.iife.js");
    println!("cargo:rerun-if-changed={}", bridge_asset.display());
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("build output directory"));
    let embedded_asset = out_dir.join("browser-debug-bridge.iife.js");
    if !bridge_asset.is_file() {
        panic!(
            "missing browser bridge asset at {} — run `pnpm --filter @dam-hopper/browser-bridge build` first",
            bridge_asset.display()
        );
    }
    fs::copy(&bridge_asset, embedded_asset).expect("copy browser bridge asset");
    tauri_build::build()
}
