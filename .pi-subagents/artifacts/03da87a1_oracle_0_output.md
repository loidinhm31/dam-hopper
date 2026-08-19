Inherited decisions:
- Do not modify app/native code speculatively.
- Scope is `apps/native/src-tauri`; preserve existing uncommitted SSH-forwarding work.
- Establish loader attribution before pinning/upgrading Rust dependencies.
- Packaged WebView2 app working and VC runtime installed reduce likelihood of generic WebView2/VC++ failure.

Diagnosis:
- Confirmed dependency chain:
  - `apps/native/src-tauri/Cargo.toml`: direct `russh = "=0.62.5"`.
  - `apps/native/src-tauri/Cargo.lock`: `russh 0.62.5 -> pageant 0.2.1 -> windows 0.62.2`.
  - Same lockfile resolves `windows 0.61.3` through Tauri/WebView2.
- Two `windows` crate versions are compile-time bindings and normally coexist; this alone is not evidence of runtime ABI conflict.
- `STATUS_ENTRYPOINT_NOT_FOUND` occurs in Windows loader initialization, before Rust test enumeration. The missing entry point must be attributed to the exact loaded module/version.

Drift / contradiction check:
- Treating `windows 0.62.2` + `0.61.3` as the root cause would be unsupported and risks changing the SSH implementation unnecessarily.
- Existing modified/untracked native files must not be reset, cleaned, or included in diagnosis changes. No staged files found.

Recommendation:
1. **Capture an unambiguous failing executable and loader event**
   ```powershell
   cd G:\ws\sharing\dam-hopper\apps\native\src-tauri
   cargo test --lib -vv 2>&1 | Tee-Object ..\..\..\artifacts\native-lib-test-verbose.log
   ```
   Copy the emitted `Running ...\deps\<name>-<hash>.exe` path.

2. **Get Windows Error Reporting / loader evidence**
   - Open Event Viewer → Windows Logs → Application; find the event at the failure time.
   - Record faulting module path and event text.
   - Or use ProcMon (Sysinternals; Microsoft’s process/file/registry tracer): filter `Process Name is <test exe>` and capture `Load Image` operations plus `NAME NOT FOUND` / `PATH NOT FOUND`.
   - Prefer this over guessing from static imports.

3. **Inspect the exact test PE’s imports**
   ```powershell
   dumpbin /imports "<exact-test-exe>" | Select-String -Pattern `
     'ProcessPrng|WaitOnAddress|WakeByAddress|NtFlushBuffersFileEx|bcryptprimitives|api-ms-win|KERNEL32|ntdll'
   Get-Item "<exact-test-exe>" | Format-List FullName,Length,LastWriteTime
   ```
   `dumpbin` is Visual Studio’s PE inspection tool; it reports requested DLL exports, not whether Windows actually supplied them at launch.

4. **Non-code remediation first, conditional on attribution**
   - If loader evidence identifies a redirected/shim DLL, antivirus injection, app-compatibility layer, or non-System32 DLL: remove/disable that product or repair its installation; rerun the same command. Do not alter Cargo.
   - Verify OS component consistency:
     ```powershell
     DISM /Online /Cleanup-Image /RestoreHealth
     sfc /scannow
     ```
     Reboot after repairs. These repair Windows component store/system files; they do not modify repository code.
   - Compare a clean Windows 11 26200 x64 machine using the same Rust toolchain and lockfile. If clean host passes, this is machine state/interference, not a dependency-resolution bug.

5. **Only if attribution links the missing export to `pageant/windows 0.62.2`**
   - Create an isolated worktree/branch and test a **lockfile-only** dependency experiment. Preserve a copy of `Cargo.lock`; do not touch SSH code.
   - First inspect current upstream compatibility/release notes and use a minimal targeted `russh/pageant` version change only if it removes the import and preserves the required SSH behavior.
   - Accept dependency remedy only when all are true: reproducibly fixes original host; resulting PE no longer imports the absent export; `cargo test --lib` runs; SSH forwarding regression validation passes; clean-host test also passes.
   - Rollback: restore the original lockfile/version pins (`git restore --source=HEAD -- apps/native/src-tauri/Cargo.lock apps/native/src-tauri/Cargo.toml`) in the isolated worktree; never discard current worktree changes.

Likely causes ranked:
1. **Host loader/component corruption or interception** — strongest fit: startup-only entry-point failure despite APIs apparently expected on Windows 11 and packaged app working.
2. **Wrong DLL/image resolution or security/product injection** — ProcMon/Event Viewer can prove/refute quickly.
3. **A specific OS build/servicing regression for the requested export** — requires exact loader message and clean-host comparison.
4. **`pageant`/`windows 0.62.2` generated import incompatibility** — plausible because it is newly introduced by SSH work, but not proven; duplicate `windows` crate versions are not sufficient evidence.
5. **VC++ runtime/WebView2 issue** — low likelihood given installed runtime and successful packaged WebView2 app; error class also points to missing export rather than CRT DLL absence.

Risks:
- Static `dumpbin` output cannot identify which requested symbol caused the loader to abort.
- Testing with `cargo update` without a controlled lockfile can produce unrelated resolution changes.
- `api-ms-win-*` names may be API-set forwarders, so their apparent version is not proof that a system DLL is outdated.
- Windows Insider/build 26200 servicing state remains unverified.

Need from main agent:
- Exact failing test executable path, its full Windows loader/Event Viewer error text, and whether failure reproduces on a patched clean Windows 11 host.

Suggested execution prompt:
- No implementation handoff warranted; first perform the evidence collection above.