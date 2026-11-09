# Phase 08 selection failures — diagnosis

## Root cause

Both terminal-inventory HTTP doubles violate the real endpoint contract in **two** ways:

- `packages/ui/browser-tests/host-browser-selection.browser.tsx:177–192,334–349` returns `{ sessions: [...] }`; the wire body must be a top-level array.
- Both construct `new Response(JSON.stringify(...), { status: 200 })` without `Content-Type: application/json`. A string-body Response defaults to `text/plain;charset=UTF-8`.

Consequently `WsTransport` takes its text branch (`packages/ui/src/api/ws-transport.ts:3303–3305,3384`), so `BrowserApp.tsx:310–312` stores a **JSON string**, not an array, in `liveSessions`. If only Content-Type were corrected, it would instead store the still-invalid envelope object. If only the envelope were corrected, it would still store a string. Both defects need fixing.

Selection activation triggers inventory refresh (`BrowserApp.tsx:350–361`), then render calls `collectHostTerminalCandidates` (`:319–321`). Its `(liveSessions ?? []).map` (`packages/ui/src/browser-host/selection-controller.ts:302`) cannot handle either non-null string or envelope. The resulting React render error explains the first test's missing preview card (`host-browser-selection.browser.tsx:272`); the second test exposes the TypeError directly. These are one fixture-contract failure, not evidence of two independent CDP/selection defects.

## Verified contract / production code

- `server/src/api/terminal.rs:400–411,424` constructs `Vec<TerminalInventoryRowDto>` and returns `(headers, Json(rows))`: JSON array, not `{ sessions }`. Row metadata is flattened (`:357–366`); `incarnationExact` and `terminationState` are row properties. Headers include termination version, PTY epoch, and no-store (`:413–422`). This is source-level wire-contract verification, not a newly captured live response.
- `packages/ui/src/api/client.ts:3377–3378,4153`: `terminal.listDetailed()` is `Promise<SessionInfo[]>`; transport route is `GET /api/terminal/detailed` (`ws-transport.ts:769–770`). With real JSON Content-Type, its generic return is parsed JSON unchanged (`:3382`).
- `BrowserApp.tsx:310` correctly calls **`getApi(owner).terminal.listDetailed()`**. Do not revert to `sessions.listDetailed()` or change the server to match the double.
- Only **`terminal.listDetailedObservation()`** wraps decoded wire rows client-side as `{ sessions, termination }` (`ws-transport.ts:3351–3358`). That wrapper is not the HTTP payload and is not interchangeable with `listDetailed()`.
- Candidate collection is null-safe, not shape-safe: both the map (`selection-controller.ts:302`) and later iteration (`:369`) assume arrays. BrowserApp's fetch try/catch cannot catch a later render exception.

## Minimal safe repair instructions

Replace **both terminal response blocks**, keeping row fields unchanged, with:

```ts
return Response.json([
  {
    id: "shell:alpha",
    incarnation: 42,
    incarnationExact: "42",
    alive: true,
    title: "Shell Alpha",
  },
]);
```

`Response.json` fixes both body shape and MIME type. No production change is required to repair these fixtures. Do not increase waits, suppress render errors, or teach the client to accept the incorrect envelope.

Optional separate defensive change: reject non-array, non-null inventory at the beginning of `collectHostTerminalCandidates` with `return []`, before **both** array operations. Guarding only `.map` leaves the later loop unsafe. Treating invalid inventory as merely an empty array and continuing through windows is not equivalent to fail-closed behavior: `:339–352` can mark a window ready using cached incarnation without a live row. Preserve existing semantics unless that policy is deliberately changed. Switching to the observation API requires explicitly selecting `.sessions`; it does not correct these fixtures.

## All 10 existing ESLint warnings

Inspected original tester ESLint output (exit 0, 0 errors, 10 warnings) and corresponding source; no lint rerun.

Paths below relative to `packages/ui/src/`.

| Location | Count | Finding / minimal instruction |
|---|---:|---|
| `api/auth-client.test.ts:15:3` | 1 | Unused `AUTH_ERROR_CODES` import; remove import entry. |
| `api/auth-client.ts:12:8` | 1 | Unused `LoginChallengeResponse` type import; remove entry (existing wildcard export remains). |
| `browser-host/stream-controller.ts:14:8` | 1 | Unused `DiscardReason` type import; remove entry. |
| `components/organisms/ServerProfilesDialog.tsx:539:10` | 1 | Unused `revision` value; use `const [, setRevision] = useState(0)`. Keep setter/state: `:612` uses it to force refresh. |
| `components/organisms/ServerSettingsDialog.test.tsx:575:36` | 1 | Unused `_url` parameter. Omit implementation parameter but retain a typed `vi.fn<(url: string \| URL \| Request) => Promise<Response>>`; downstream `mock.calls` destructures the URL (`:582`). |
| `browser-host/selection-controller.ts:500:6,504:5` | 2 | Missing effect dependency `owner`; complex `String(navigationRevision)` dependency. Use a stable owner dependency, or reconstruct the required owner from primitive profile/generation dependencies inside the effect. Hoist normalized navigation revision to a named primitive and depend on it. Do not add an unstable owner object and accidentally invalidate selections every render. |
| `hooks/use-browser-debug.ts:103:9` | 3 | Fallback owner object may be recreated each render, destabilizing callbacks with dependency arrays at `:250,266,348`. Memoize owner initialization using its actual inputs (`options?.owner`, `snap?.owner`, `profileId`). Do not remove owner dependencies. |

These warnings are separate from the observed non-array failure. Hook warnings merit identity/dependency fixes, not suppression.

## Evidence and handoff

Read-only source diagnosis plus original `Phase08Tester` browser/lint outputs (`agent://Phase08Tester`, underlying recorded tool results). Original browser run: 14 passed, 2 failed, 1 unhandled error. No source/test files edited; no tests, lint, build, or live HTTP request executed during diagnosis.

After repair, main/tester should run:

```sh
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/host-browser-selection.browser.tsx
```

If hook/import cleanup is applied, also run UI typecheck and the same modified-file ESLint selection used by Phase08Tester. No passing repair verification claimed.

## Unresolved questions

None blocking this diagnosis or minimal fixture repair.
