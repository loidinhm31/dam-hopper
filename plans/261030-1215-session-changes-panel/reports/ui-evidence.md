# UI/transport evidence

Status: complete local read-only scout `UiReviewEvidence`; terminal result collected. Parent verified TabBar:250-334, query-client:1-44, DiffViewer:180-235,600-640 and reference E2E:1-138. No builds/tests/browser execution.

## Existing seams
- `packages/ui/src/components/organisms/TabBar.tsx:281-330`: active-pane controls beside TerminalCommitStatusChip and split buttons; header is h-8 (:229), so compact 44px touch access needs existing accessory controls, not blindly expanding all desktop tabs.
- `TerminalPanel.tsx:156-221,438-615`: effectiveTerminalRef, registration key and incarnation tracking. Keep xterm lifetime unchanged; `TerminalKeepAliveHost.tsx:22-85` owns persistent mount.
- `TerminalAccessoryControls.tsx:18-35`: compact action seam, to be wired only by sequential integration owner.
- `api/ownership.ts:5-25,95-145`: ConnectionRef / TerminalRef / TerminalInstanceRef and terminalKey already exist. Add feature types separately; do not expand global ownership types unnecessarily.
- `api/query-client.ts:5-44`: profileQueryKey and profileGitQueryKey include profile/generation and target. Feature-specific query module should reuse these primitives, capture actual owner-bound client, recheck after await.
- `stores/agent-status.ts:223-233`: terminal row exposes agentSessionId, state and turn identity. Turn-end/idle is a refresh hint, not capture readiness or proof of task success. Do not use attentionRevision as generic settled-turn revision.
- `DiffViewer.tsx:124-135,310-335,410-440,610-637`: existing viewer owns HEAD/commit Git queries, editable/save/hunk-discard paths. Cannot safely reuse merely by relabelling. New capability-free session viewer may reuse Monaco rendering/model-disposal patterns; no imported Git mutation hooks.
- `DiffViewer.tsx:205-223`: keep-current-model and deferred disposal avoids model-reset crash; feature must own uniquely scoped model URIs, disposal on owner/file/revision change and bounded payloads.
- `GitLocalChanges.tsx:21-65` / `ChangedFilesList.tsx:343-410`: staging/discard/commit-bound, not suitable as new feature authority. Keep existing HEAD views unchanged.

## Recommended future ownership boundaries
- Contract owner first: feature-only TS/Rust DTOs, endpoint/state/revision specification.
- Client owner: new api/session-changes-client.ts, session-changes-queries.ts and tests; use captured ApiClient rather than adding mandatory transport operations unless source requires them.
- UI owner after client contract: SessionChangesPanel, SessionChangedFilesList and ReadonlyMonacoDiffViewer plus focused browser coverage.
- Sole integration owner later: TabBar, TerminalAccessoryControls, actual parent callback/host path, stacking/input arbitration. Exact parents must be settled during authoring from current imports.
- Do not modify existing DiffViewer/GitLocalChanges or global ownership.ts simply to support this read-only surface.

## Verification harness
- `packages/ui/vitest.browser.config.ts`; `packages/ui/browser-tests/agent-status-bridge.browser.tsx`, `terminal-floating-panels.browser.tsx`, `git-conflict-resolver.browser.tsx` are reference patterns.
- `packages/ui/e2e/fixtures/application-services.ts`, `application-fixture.ts`, `capture-evidence.ts`, `capture-png-validator.ts`, `capture-source-fingerprint.ts` own real services and visual provenance.
- `packages/ui/e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts:29-35` explicitly says fixture has shells, not provisioned harnesses. It proves navigation/PTY continuity, NOT installed OMP integration. Required live OMP journey needs actual pinned OMP installation and controlled model/tool turn; fabricated status frames alone cannot satisfy it.
- Existing commands: `pnpm --filter @dam-hopper/ui test:browser`, `pnpm --filter @dam-hopper/ui test:e2e`; use focused file arguments after checking manifests.
- New case under packages/ui/e2e/session-changes-review with full viewport captures/evidence.json/review.md. CI functional assertions remain active with capture disabled; human ACCEPTED/REJECTED is never synthesized.
- Tauri shares UI/Monaco workers; no new native bridge. Actual native host runtime remains a qualification check, not inferred from web tests. Android-native UI excluded; Android Chrome read-only input policy remains relevant.

## Unresolved questions
No product question. Authoring must settle exact cross-shell host ownership and actual managed-OMP journey provisioning; component/static evidence cannot substitute for runtime acceptance.
