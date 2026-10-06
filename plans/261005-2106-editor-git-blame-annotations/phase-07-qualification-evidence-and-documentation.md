# Phase 07 — Qualification, evidence and documentation

## Context links

- [Parent plan](./plan.md); [verification matrix](./verification.md); [contracts](./contracts.md); dependencies:01–06.
- [Testing guide](../../docs/testing.md); [capture policy](../../packages/ui/e2e/fixtures/capture-policy.ts); [capture evidence](../../packages/ui/e2e/fixtures/capture-evidence.ts).
- [Architecture design gate](../../docs/architecture/workbench-files-editor-and-git.md#planned-git-blame-annotation-contract).

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Certify consumer behavior with native/API, race, actual Monaco and full application evidence; update current documentation only after proof.

## Key Insights

- Repository has distinct Rust/jsdom/browser-component/application-E2E runners. Mocked Monaco/isolated harness evidence cannot certify Explorer→Git app integration.
- E2E uses built SPA, production server containers, real MongoDB, deterministic auth/storageState; no-auth is not the authenticated journey substitute.
- Existing seed tree is not a Git repo. This feature needs a scoped deterministic Git fixture, not assertions against fake history.
- Local visual captures + explicit human ACCEPTED/REJECTED review mandatory. Green CI does not provide human review.
- Root `pnpm check` includes native build and broad backend tests; do not hide unsupported platform qualification behind a green web check.

## Requirements

- Every agreed criterion mapped to executed behavior and exact evidence; no native/UI result claim from CLI-only probe.
- Preserve existing Git mutation protections, editor/source/read-only behavior and profile ownership.
- Demonstrate zero blame work while off, no feature-added periodic requests while focused, bounded workers/latest intents while typing/aborting, focus/manual external HEAD refresh and no source logging/storage.
- Update existing API/workbench/editor docs and changelog after final behavior known; no unsolicited version bump.
- Human review gate remains explicit when no reviewer is available.

## Architecture

```text
native fixtures -> API integration -> deterministic client races
  -> real Monaco geometry/input -> built full app journey
  -> local captures + human review -> documentation/current-contract cutover
```

No independent second E2E service stack, snapshot-copy tests, source-text assertions or mocks replacing real Git backend behavior.

## Related code files

Create proposed:

- `packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts`: full consumer journey, colocated evidence/review files under existing policy.
- `packages/ui/e2e/editor-git-blame/git-fixture.ts`: case-local deterministic repo seed helper using existing container engine APIs; no global seed default changes.

Modify existing only as needed:

- `packages/ui/e2e/fixtures/application-services.ts`, `application-data.ts`: narrow optional setup seam only if case-local container setup cannot use returned appContainerId safely. Preserve existing users.
- `packages/ui/e2e/fixtures/application-runtime.Dockerfile`: only if runtime Git binary truly absent; use existing production image packaging conventions, no alternate backend.
- `server/tests/git_blame_api.rs`, blame module regressions; client/hook/browser tests from prior phases for missed consumer boundaries.
- `docs/api/git.md`: actual new routes/DTOs/bounds/errors and read-only commit details vs editing snapshot distinction.
- `docs/architecture/workbench-files-editor-and-git.md`: replace planned section with exercised current contract and source/verification map only after implementation complete.
- `docs/frontend-components.md` or its existing editor child reference: toggle/current-buffer metadata/limitations/commit navigation.
- `docs/testing.md`: only necessary feature scenario/evidence commands, not new test architecture.
- `docs/CHANGELOG.md`: feature entry with honest qualification scope; no manifest version bump.

## Implementation Steps

1. Build deterministic case-local fixture in existing authenticated app container: Git main repo, two explicit authors/times/offsets, multiline commit body, code + Markdown/HTML source, nested repo, worktree, untracked/new files. Capture exact OIDs and baseline file/index/ref values.
2. For out-of-page navigation, preserve an old attributed line while adding >200 later commits. Use fixed timestamps/identities; no random history, external network or sleeping. Do not force UI to select fake commit metadata.
3. Initialize fixture using existing container-client helpers and appContainerId; verify production runtime has Git. Prefer case-local setup after fixture service starts with target refresh over altering every seed. If fixture lifecycle needs a hook, add optional typed setup used only by this case.
4. Run authenticated Explorer journey: open clean file, right-click line number, enable annotations, assert known author/date/hover, insert unsaved line, observe immediate stale removal then uncommitted row and unchanged neighboring authors, choose committed row's Show Commit in Git, inspect exact hash/body/files, return to intact dirty source.
5. Exercise already-open Git panel, old/filter-excluded hash, nested root and worktree/detached HEAD. Complete IDE, terminal-floating and compact variants with actual shell behavior—not direct component callback invocation.
6. Verify Markdown/HTML Edit/Split, Preview-paused requests and source/layout restoration. Resize actual source wrapper across639/640 and normal→compact→normal; include narrow Split on wide viewport. Observe bounded author-only column with date/full hover/focus metadata, public geometry and intact dirty bytes/cursor/scroll. Unsupported viewers perform no blame or fake reveal.
7. Test two authenticated app profiles with same project/path and distinct authors; controlled delayed response/reconnect only for transport timing, not fake backend attribution. Observe no cross-owner result/reveal/storage effect.
8. Capture full viewport key states through canonical helper: normal author/date, compact author-only with full metadata, uncommitted buffer, gutter/menu Refresh, Workspace Git full body, compact source/navigation and narrow Split on wide viewport. Include actual source/seed fingerprint/evidence manifest; never manufacture proof artifacts.
9. Run native/API + client regressions and browser/E2E commands from verification matrix after all implementation edits settle. Respect runner boundaries; no broad formatter mid-flight or unrelated source restyle.
10. Perform live full app browser smoke with real services: observe actual gutter alignment, menu opening/closing and Git navigation, not tests alone. Record exercised runtime/version/viewport; close browser and dispose temp services. If native host unavailable, explicitly state native runtime unverified while shared integration is delivered.
11. Measure representative normal/degraded file and long-history latency, rapid typing and repeated toggle. Record observations, no invented p95/SLA; concurrency never beyond2 and no growing backlog/cache. With unchanged file mtime and external HEAD change, exercise manual Refresh and window focus/visibility restoration separately; obtain fresh attribution without saves. Observe idle focused source over a controlled interval: no feature-added periodic root/blame requests. Confirm edit/in-app Git invalidation still refreshes and resize/menu focus adds no requests; account separately for unrelated existing Git observers.
12. Security checks: no source in URL/logs/localStorage/Query keys, safe traversal/symlink rejection, malicious author/message rendered text, stale-generation requests fail closed, HTTP abort retains native permit correctly, read-only details exposes no mutation eligibility shortcut.
13. Review implementation against contracts; update architecture/API/component docs/changelog to actual verified behavior. Remove temporary probes/scaffolds. Do not re-pin incidental wording tests; delete those rather than encoding implementation text.
14. Human reviews fresh local captures and records ACCEPTED/REJECTED in canonical review.md; if rejected, fix concrete UI issue and generate fresh evidence. Never generate ACCEPTED on behalf of absent human reviewer.
15. Mark implementation phases complete only with named acceptance evidence. Mark overall completion blocked if mandatory human review/platform prerequisite remains; do not label feature done from compile/tests alone.

## Todo list

- [ ] Deterministic authenticated Git/full-app fixture established.
- [ ] Core dirty-buffer→exact commit-body journey passes.
- [ ] All shell/source/profile/worktree/edge scenarios covered.
- [ ] Full/compact container transitions, full metadata, focus/manual external refresh and no feature-added polling verified.
- [ ] Native/API/client/browser/E2E gates exercised with exact results.
- [ ] Live browser surface inspected; fresh canonical captures produced.
- [ ] Bounds/privacy/no-write/performance checks recorded.
- [ ] Current docs/changelog updated to actual implementation; temporary probes removed.
- [ ] Human visual review accepted, or exact external blocker recorded.

## Success Criteria

- All acceptance IDs A01–A11 in matrix have exercised evidence and no silently dropped criterion.
- Full app inspection reaches exact old commit's **body**, even outside history/filter, preserves dirty bytes and original tab, and uses correct root/profile.
- Actual rendered gutter passes fold/scroll/zoom/resize/keyboard/right-click checks: author/date at normal width, author-only below640 with full hover/focus metadata,639/640 boundary and narrow Split on wide viewport; no overflow/oscillation/dirty-state loss.
- Source/worker/cache/request behavior bounded, privacy checks pass, focus/manual external refresh works and no feature-added periodic requests exist. Annotation inspection has no mutation controls; real history selection retains canonical eligible actions.
- Fresh local visual artifacts human-reviewed; CI assertion-only pass not conflated with local acceptance.
- Documentation describes shipped code, not a proposal; platform-specific unverified runtime explicitly named.

## Risk Assessment

- Container/Git/browser prerequisites absent: diagnose available local engines/channel/image config; do not replace app journey with mocked success. Record precise missing prerequisite after alternatives exhausted.
- Fixture >200 commit history slows test: narrow case-local file/history generation, deterministic and no network.
- Human reviewer unavailable: external gate, not automated bypass.
- Scope creep from perf data: optimize chosen full-file native path and scheduling; alternate engine/UI policy requires explicit user decision, not silent viewport-only blame.

## Security Considerations

- Synthetic fixture authors/data only; real Mongo/session auth isolated per test, secrets never committed.
- No-auth dev smoke only on loopback; full app authenticated tests remain real-auth.
- Plain text full message and tooltip content; no plugin/external-host link.

## Next steps

- Deliver completed implementation with concrete evidence and remaining qualification limitations. Commit/push only when requested.
- Unresolved questions: no product questions; execution prerequisites and mandatory human review remain future gates, not evidence already obtained.
