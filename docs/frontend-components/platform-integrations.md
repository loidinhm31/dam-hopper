# Platform Integrations

Shared host, browser-extension, and embedding contracts split from [Frontend Components](../frontend-components.md).

## Session Status Helpers

**Location:** `packages/ui/src/lib/session-status.ts`

**Purpose:** Centralize session lifecycle logic.

### SessionStatus Type

```ts
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";
```

## Cooperative Browser Debug Bridge

**Package:** `@dam-hopper/browser-bridge` (used by `apps/browser-extension`)

The extension content script runs inside a framed development target without
requiring target application changes. It has no DamHopper token, filesystem,
PTY, storage, or network capability. Its only task is to return a bounded,
semantic selection after a user click; returned text is preview data, never
HTML.

The host uses the exact `iframe.contentWindow` when parsing messages. It issues
a fresh nonce after every load/navigation or reconnect and accepts only request
IDs it created for that nonce. The extension and host fail closed on source,
exact-origin, nonce, request-ID, version, and schema mismatches; redirects and
opaque-origin frames are rejected.

Every DamHopper web build includes
`/browser-debug-extension/dam-hopper-browser-debug.zip`. In the client
browser, extract that download, open `chrome://extensions`, enable Developer
mode, select Load unpacked, and choose the extracted
`dam-hopper-browser-debug` folder. The target app does not install a package
or script.

The extension marks the parent and framed documents with a versioned DOM
presence marker for onboarding only. Bridge activation still requires an
allowed parent origin: loopback parents work by default; deployed parent
origins must be compiled into the archive with
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` as a comma-separated exact-origin
list. The extension download is intentionally a single setup-card action.

An existing `X-Frame-Options` or restrictive CSP header may still prevent
embedding; the Browser tool surfaces that load failure instead of weakening
browser framing policy.

Selection payloads are versioned semantic data only: bounded tag/role/name/text,
an allow-listed set of attributes, a bounded locator, and finite bounds. They
never contain HTML, input values, passwords/files, cookies, storage, or other
browser secrets. The bridge package is used by the browser extension; the
browser host provides the long-lived iframe owner, exact-origin navigation
policy, handshake/load-error UX, and CSP framing guidance.

## Related Documentation

- [System Architecture](../system-architecture.md)
- [Configuration Guide](../configuration-guide.md)

- [Native Browser Debug Support](../native-browser-debug-support.md)
- [Media Isolation and Encryption Architecture](../architecture/media-isolation-and-encryption.md)

## Shared design-system and embedding contract

`packages/ui` is the reusable surface exported as the app, styles, and API/lib
entry points. Hosts provide the transport and QueryClient bootstrap before
mounting `DamHopperApp`. Provider order is AppZoom → Encrypt →
AndroidChromeInputPolicy → Router, followed by guards, shortcuts, notifications,
and diagnostics.

Use semantic dark tokens from `index.css`, JetBrains Mono, safe-area/layout
utilities, and Radix wrappers for interactive primitives. Preserve keyboard
focus rings, live-region announcements, and 44px compact controls. `Encrypt`
stores owner-qualified, memory-only OPAQUE session material under
`profileId@generation:project`; same-named projects on two profiles never share
passphrases or AES keys. Prompts are queued with explicit profile/project
labels and exact-key duplicates join the existing request. Disabling encryption
or retiring a connection clears passphrases and zeroes mutable key buffers.
Encrypted writes use one captured `WsTransport` for OPAQUE, WebCrypto, and the
final filesystem operation, with freshness fences and no plaintext fallback.
Browser Debug keeps one host alive across shell changes; native geometry uses
raw rendered bounds and mirrored app zoom.
