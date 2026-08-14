Turn budget wrap-up was requested after 8 assistant turns (soft limit 8, grace 2). Process-mode live steering is unavailable, so the child was warned at launch to wrap up by this budget. Output may be partial.

**Finding — blocker:** `apps/native/src-tauri/target/debug/deps/dam_hopper_native_lib-a4811109c7d9f3ba.exe` fails before test enumeration: `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`. `cargo test --no-run` succeeds, so compile/link complete; assertions never execute.

**Dependency delta implicated:** `apps/native/src-tauri/Cargo.toml:31` adds `russh = 0.62.5`; lock resolves `pageant 0.2.1 → windows 0.62.2`, alongside Tauri/WebView2’s `windows 0.61.3` and `windows-sys 0.61.2`. This is correlation, not a proven missing export.

**Runtime evidence:** Windows 11 Pro build `26200`, x64; VC runtime `v14.51.36231.00` installed; WebView2 `150.0.4078.105` works in the packaged app (`artifacts/native-browser-debug/windows-evidence.json`). No relevant Application/WER event identifying DLL/export was found.

**Exact missing evidence / safe next action:** capture the failing PE import pair (**DLL + symbol**) with a PE reader or correctly invoked `dumpbin /imports`, then verify it against the loaded DLL (Process Monitor or loader snaps). Do not change Cargo versions until that pair is known. Minimal safe remediation is to update/remove only the dependency that imports that verified unavailable export, or use a Windows-supported API fallback in that dependency; rebuild from a clean `apps/native/src-tauri/target`.

Unresolved questions:
- Which DLL/export is missing; current evidence does not identify it.
- Whether `pageant/windows 0.62.2` is the source versus another test-only linked path.