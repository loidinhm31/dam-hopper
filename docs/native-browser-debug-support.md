# Native Browser Debug support

The native Browser Debug host is a least-privileged Tauri child WebView. The
target receives only the document-start bridge and a narrow relay; it does not
receive Tauri commands, filesystem access, shell access, opener access, or
generic IPC capabilities. The existing web iframe adapter remains the
fallback and rollback path.

The native v1 relay advertises picker and navigation only. Console forwarding
remains disabled until it has an isolated transport that cannot feed back into
the WebView IPC channel.

## Support matrix

| Capability                                                 | Windows v1                       | Linux artifact                  | macOS    |
| ---------------------------------------------------------- | -------------------------------- | ------------------------------- | -------- |
| Child-WebView lifecycle and geometry                       | Verified on WebView2             | Implemented; runtime unverified | Deferred |
| Document-start bridge in top and same-origin nested frames | Verified on WebView2             | Implemented; runtime unverified | Deferred |
| Relay security negatives                                   | Runtime evidence plus unit tests | Unit tests plus Linux build     | Deferred |
| Packaged application                                       | Required smoke gate              | `.deb`/`.rpm` build gate only   | Deferred |

Only Windows carries a v1 runtime support claim. Linux has a WebKitGTK relay
implementation and keeps viewport rendering/resizing available even if the
relay cannot be installed, but a successful compile or package does not imply
runtime verification on every desktop distribution.

Viewport controls are available in both native app shells and ordinary web
hosting. Android uses the stable iframe adapter inside the native shell because
Tauri's child-WebView commands are desktop-only, so the same persisted
responsive/custom controls remain available without claiming a native child
WebView there. Keyboard shortcuts are not used for viewport resizing.

## Windows gate

Install dependencies, then run:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @dam-hopper/native tauri:probe
```

Record the WebView2 Evergreen Runtime version and verify the release-gate
checks enforced by `smoke-browser-debug.mjs`:
`lifecycle`, `documentStartTopFrame`, `documentStartNestedFrame`,
`relayAccepted`, `relayRejected`, `navigationPolicy`, `popupDenied`,
`downloadDenied`, `profileIsolation`, and `rollback`. During the same manual
gate, also exercise redirects, history/reload, native console rejection,
picker, storage clear, teardown/recovery, malformed or stale relay messages,
denied permission/client-certificate/password-manager flows, profile switch,
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
WebKitGTK development packages from the workflow. The native child and relay
are implemented, but runtime behavior remains unverified on the supported
distribution matrix. AppImage support and Linux runtime verification need a
later plan. macOS is intentionally absent from v1 packaging and support claims.

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
- On Windows, keep popups, downloads, permissions, client certificates, and
  password managers disabled through the explicit WebView2 deny hooks. Linux
  has no runtime-verified equivalent permission policy yet and must not claim
  those denials until its WebKitGTK policy hook is verified.
