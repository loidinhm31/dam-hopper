# Frontend Test Execution Report: PR #74 LSP Server Integration

## 1. Request and Authority
- **Operation:** `run frontend focus` (Procedure: `.omp/skills/test/references/code-validation.md`, principles: `test-principles.md`).
- **Scope:** PR #74 frontend semantic navigation components, stores, utilities, client runtime, and browser suites.
- **Authority:** Review-only testing; no source/test/CI modifications. No dependency installations. Throwaway fixtures only in `/tmp` (cleaned up after runs).

## 2. Test Execution Summary

| Check / Suite | Exact Invocation Command | Result | Duration | Counts / Output |
|---|---|---|---|---|
| Scoped Unit Suite | `pnpm --filter @dam-hopper/ui test src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/SettingsSemanticNavigationSection.test.tsx` | PASS | 5.23s | 7 files passed, 62 tests passed, 0 failed |
| Browser Baseline | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` | PASS | 11.55s | 1 file passed, 9 tests passed, 0 failed |
| Qualification Suite | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-threshold-qualification.browser.ts` | SKIPPED | 4.30s | 1 file skipped (requires `/qual-bootstrap/` live backend) |
| Probe F2 (Client Socket Loss) | `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f2.test.ts` | PASS | 1.84s | 1 test passed (diagnostic refs: `artifact://66`, `artifact://68`) |
| Probe F3 (Oversized Edit & Stale Incremental) | `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f3.test.ts` | PASS | 0.63s | 1 test passed (diagnostic ref: `artifact://71`) |
| Probe F4 (BOM TextDecoder Digest Mismatch) | `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f4.test.ts` | PASS | 1.00s | 1 test passed (diagnostic ref: `artifact://85`) |

## 3. Scoped Unit & Browser Baseline Observations
- **Unit Suite (62 passed):** All requested unit test files pass. However, unit boundaries rely on mocks: `MonacoHost.semantic.test.tsx` mocks `@monaco-editor/react` completely, bypassing real wrapper model lifecycle and `useUpdate` behavior; `semantic-client.test.ts` asserts rejection return code 0 on oversized edit without testing subsequent queries or incremental resync.
- **Browser Baseline (9 passed):** Headless Chromium via Playwright provider verifies Monaco 0.55.1 definition adapter and semantic manager register without crashes in an isolated page. It does not exercise clean reload unmounts or oversized sync boundaries.

## 4. Runtime Probes (Isolated Fake Transport Boundary)

### F2 — Isolated SemanticClient Socket Loss Recovery
- **Command:** `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f2.test.ts`
- **Setup:** `SemanticClient` from source with `MockWebSocket` completed handshake (`damHopper/attachTarget` -> `initialize` -> `initialized`) to `ready`. Invoked `client.forceSocketLoss()`.
- **Observation:** Client status immediately transitioned to `"disconnected"`. Advanced fake timers cumulatively across 1s, 5s, and 30s (36s total).
- **Result:** Exactly 1 `MockWebSocket` instance existed throughout; 0 internal reconnection attempts occurred, and status remained `"disconnected"`.
- **Evidence Precision:** Confirms internal absence of client-scheduled reconnection only. Whole-application absence of reconnect recovery remains an unexercised static caller chain (`EditorTabs.tsx:217-247` effect dependencies omit client status).

### F3 — Rejected Oversized Edit & Incremental Resync on Stale Wire Base
- **Command:** `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f3.test.ts`
- **Setup:** Document opened at wire version 1 (`initialContent`, 22 bytes, line 0 only). Policy: 1 MiB doc cap, 64 KiB sync threshold.
- **Observation:**
  1. Pasted 1.1 MiB padding: `notifyDidChange` returned `0` (`canAdmitOverlayBytes` rejection); 0 `didChange` messages sent; wire version remained 1.
  2. Navigation query: `client.getDefinition` transmitted `textDocument/definition` with `damHopperDocumentVersion: 1`, querying the initial snapshot.
  3. Trim edit: User trimmed padding down to 70 KiB (< 1 MiB, but >= 64 KiB threshold). Incremental `trimEdit` genuinely transformed the 1.1 MiB text to the 70 KiB document (range: lines 1..2, replacing 1.1 MiB with 70 KiB).
- **Result:** `notifyDidChange` bumped wire version to 2 and transmitted ONLY `trimEdit` as an incremental edit. Transmitting an incremental edit with `end.line = 2` against an obsolete version 1 base containing only line 0 establishes client transmission against a stale base and a concrete server divergence/rejection risk.

### F4 — BOM TextDecoder Digest Mismatch (Hash Inequality Only)
- **Command:** `pnpm --filter @dam-hopper/ui exec vitest run --dir /tmp /tmp/probe-f4.test.ts`
- **Setup:** `computeUtf8Sha256Hex` with `TextDecoder` and disk byte representations.
- **Observation:** Raw disk bytes prefixed with UTF-8 BOM (`0xef, 0xbb, 0xbf`) hash to $H_{\text{raw}}$. Frontend `TextDecoder("utf-8")` strips the leading BOM. `computeUtf8Sha256Hex(decodedText)` produces $H_{\text{stripped}} \neq H_{\text{raw}}$.
- **Evidence Precision:** Demonstrates runtime hash inequality between raw BOM bytes and TextDecoder-stripped text. Does not constitute an observed browser reveal failure. CRLF normalization in Monaco remains an unexercised static hypothesis.

## 5. UI & Full-App Qualifications
- **Status:** NOT EXERCISED.
- **Reason:** Existing services in `proc://` (`dam-hopper-web` and `dam-hopper-server`) were inactive. While isolated synthetic services were permissible under authority, full containerized application E2E was not launched.
- **Evidence Gap:** Visual proof of F1 clean reload model retention remains unobtained; evidence rests on the verified static code path (`MonacoHost.tsx:617` `keepCurrentModel`, `EditorTabs.tsx:646` unmount during loading, and `@monaco-editor/react` 4.7.0 initial-mount guard).

## 6. Repository State and Artifacts
- **Tracked Modifications:** None (`git status --porcelain` has 0 modified tracked files).
- **Diagnostic Artifact References:** `artifact://63` (initial probe), `artifact://66` (MockWebSocket.OPEN), `artifact://68` (initialize schema alias), `artifact://71` (notifyDidChange promise), `artifact://85` (DOM global).
- **Temporary Probes:** Cleaned up and removed from `/tmp`.
- **Untracked Reports:** Preserved 6 existing markdown reports in `plans/reports/`.
