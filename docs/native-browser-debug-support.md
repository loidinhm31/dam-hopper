# Native Browser Debug support

The native Browser Debug host is a least-privileged Tauri child WebView. The
target receives only the document-start bridge and a narrow relay; it does not
receive Tauri commands, filesystem access, shell access, opener access, or
generic IPC capabilities. The existing web iframe adapter remains the
fallback and rollback path.

## Support matrix

| Capability                                                 | Windows v1                       | Linux artifact                | macOS    |
| ---------------------------------------------------------- | -------------------------------- | ----------------------------- | -------- |
| Child-WebView lifecycle and geometry                       | Verified on WebView2             | Build-only, unverified        | Deferred |
| Document-start bridge in top and same-origin nested frames | Verified on WebView2             | Build-only, unverified        | Deferred |
| Relay security negatives                                   | Runtime evidence plus unit tests | Unit tests only               | Deferred |
| Packaged application                                       | Required smoke gate              | `.deb`/`.rpm` build gate only | Deferred |

Only Windows carries a v1 support claim. A successful Linux compile or package
does not imply WebKitGTK runtime support.

## Windows gate

Install dependencies, then run:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @dam-hopper/native tauri:probe
```

Record the WebView2 Evergreen Runtime version and verify lifecycle, geometry,
document-start ordering, top/nested-frame relay, redirects, history/reload,
console, picker, storage clear, teardown/recovery, malformed or stale relay
messages, denied navigation/popup/download/permission flows, profile switch,
server disconnect, and application shutdown. Store the result as JSON with
`platform`, `webview2Version`, `commitSha`, `artifactSha256`, and the `checks`
object, then run:

```powershell
$env:DAM_HOPPER_NATIVE_SMOKE_EVIDENCE = "artifacts/native-browser-debug/windows-evidence.json"
pnpm --filter @dam-hopper/native smoke:evidence
```

The evidence validator requires every release-gate check to be explicitly true;
missing or unbound evidence is not treated as a warning. Capture the artifact
hash with `Get-FileHash path\\to\\installer.exe -Algorithm SHA256`. The rollback
flag is evaluated at build time; changing the environment after an installed
bundle is built has no effect.

The deterministic HTML fixture is CI-only and is not copied into the shipped
native application assets.

## Linux and macOS

Linux CI builds the desktop application and `.deb`/`.rpm` artifacts with the
WebKitGTK development packages from the workflow. Runtime behavior remains
unverified, and the UI labels the native host experimental. AppImage support
and Linux engine verification need a later plan. macOS is intentionally absent
from v1 packaging and support claims.

## Rollback

Set `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG=0` when building the native client.
The native host is then not constructed, the Browser tool uses the existing web
iframe adapter, and terminal behavior remains available. This is the preferred
rollback for a native runtime or target-server failure; it does not broaden
the native navigation policy.

## Release security checklist

- Inspect the generated Tauri ACL and capability manifests; the remote child
  target must not inherit application commands.
- Confirm bridge assets are embedded from the built, pinned
  `packages/browser-bridge` output.
- Confirm diagnostics do not contain page content, server tokens, cookies,
  storage, or raw relay payloads.
- Keep popups, downloads, permissions, client certificates, and password
  managers disabled in v1.
