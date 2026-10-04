# Acceptance checks — application integration, authenticity, cleanup, CI

## Contract
Planned checks, **not executed results**. Implementation complete only when all functional gates pass and a real human approves fresh local application evidence. A green capture-disabled CI run cannot satisfy the visual gate. Evidence belongs beside cases, never under plans.

## Proposed executable commands
Run from repository root unless explicitly noted. New scripts below are part of implementation, not currently available:

```bash
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui exec playwright test --list
pnpm --filter @dam-hopper/ui exec vitest list --config vitest.browser.config.ts
pnpm --filter @dam-hopper/ui exec vitest list --config vitest.advisor-routing.browser.config.ts
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e
CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e
CI=true pnpm --filter @dam-hopper/ui test:e2e
pnpm test:all
```

CI prerequisites: pnpm frozen-lockfile install; matching Chromium; compatible Docker/Podman build/runtime and current-source production app/auth-seed images + Mongo. Production Dockerfile supplies pinned Rust/web toolchains. Runner owns app/Mongo containers/network and data; no personal service reuse. Capture-disabled parity checked on default CI policy and explicit override.

## Application integration
| ID | Scenario | Required observation |
|---|---|---|
| A01 | List all runners | Three Playwright application specs only; no `.e2e.tsx` remains; no Playwright spec in Vitest unit/browser discovery; specialized advisor component suite still separately discovered. |
| A02 | Start an app case on a fresh fixture | Browser loads actual `apps/web` entry and normal `DamHopperApp` route tree. Shell navigation, connected fixture profile/project and production API/WS readiness visible. No createRoot component harness, page.setContent, DOM-generated shell, runtime frontend-store mutation or fulfilled app-API responses. Only documented persisted profile/session bootstrap allowed; no injected preferences/provider/AppState. |
| A03 | Normal authorization | Real authenticated admin/session through production middleware and real isolated AuthStore; unauthenticated protected request rejected, admin status observed before Advisor controls. Seeded auth setup explicitly not claimed as complete login/MFA coverage. No `--no-auth` or mock AuthService in application E2E. |
| A04 | Privacy | Settings selects Heavy Blur through app controls. Fixture document/project actually loaded underneath. Keyboard activation covers viewport and traps focus; coordinate pointer attempts, typing and navigation chords do not change underlying input/route/backend state. Wrong chord/Escape does not dismiss; original chord dismisses, restores interaction. Reload starts inactive. Screenshot captures actual masked app. |
| A05 | Advisor routing | Open Workspace Advisor → Configuration → Edit Routing. Backend/model/effort controls have usable dark-theme presentation. Change a nonduplicate route, save, assert returned/summarized revision. Separate API request and disk read see expected routes, changed revision, preserved non-route policy fields. Reload/reopen displays saved routes. No UI-only optimistic success. |
| A06 | Evaluations | Seed valid on-disk native evaluation documents. Navigate Workspace Advisor → Evaluations. Discover known descriptors; use real inspect/compare controls and validate seeded counts/provenance/result. Resize actual Advisor host to narrow legal width while full application stays visible; assert card/actions bounding boxes and overflow behavior at wide and narrow widths. No component container replacement or injected AppState. |
| A07 | Data isolation and repeatability | Run each spec independently, then all cases twice/reverse order. Every test starts with original policy/preferences/evaluations/project data, unique service ownership, new browser context and isolated database/filesystem; no changes leak across cases or to personal directories. No external model-provider request/credential use. |
| A08 | Useful component coverage | Existing targeted focus/owner/cancellation/browser-native regressions still run. Inventory accounts for 53 current browser files / 259 source-declared cases; totals are not executed pass counts. Retain useful component/utility behavior; remove only redundant/incidental touched assertions and misleading cross-scope captures. No mechanical application rewrite. |

## Evidence authenticity and review
| ID | Scenario | Required observation |
|---|---|---|
| E01 | Explicit local capture | All three real cases pass with `E2E_CAPTURE=1`; each produces decoded PNG at `e2e/<case>/screenshot.png`, dimensions equal recorded CSS viewport/DPR policy, shell and affected application state present. Extra named checkpoints when one image cannot prove the states/widths. |
| E02 | Provenance | `evidence.json` records case/checkpoint, run ID/command/time, HEAD + dirty-source fingerprint, seed digest, viewport/dock width, browser/version, route, outcome, cleanup and image hashes. Start/finish source identity identical. No hard-coded workstation paths or secret material. |
| E03 | Capture failures | In disposable checkout/output permissions, make the case output unwritable or force screenshot operation failure. Enabled run exits nonzero after normal assertions; no new passing/fresh record, no old approval silently retained. Restore permissions; enabled rerun succeeds. Invalid capture setting fails clearly. |
| E04 | Human visual review | Actual person opens every required new image, inspects application context, privacy coverage/frost, editor theme and narrow layout/actions. `review.md` names reviewer/time, matches run/source/image hashes, lists inspected checkpoints and accepts/rejects. Automation/agent cannot fabricate this signature; pending or rejection means visual gate not satisfied. |
| E05 | Negative authenticity checks | Old run, changed source fingerprint, changed image hash, missing checkpoint, component-only image or pending review cannot be reported accepted. Demonstrate validation in disposable artifacts; do not replace canonical evidence with fake/stale material. |
| E06 | Relevant source changes | Change relevant fixture/app source in a throwaway checkout; prior evidence marked stale. Regenerate after final source, inspect anew; approval never transferred automatically. Source edits during service/capture run invalidate provenance. |
| E07 | Artifact scope | Binary images only under case folders or ignored runner output, never plans. Primary evidence is complete viewport, no element clip/mask/synthetic HTML. Screenshots complement assertions; no blanket pixel baseline comparison requirement. |

## Owned service cleanup
Inventory fixture-owned PIDs/process groups, container IDs, loopback ports and temporary root **when created**; assert exit/removal after the runner exits. Check ownership identities, not just that an unrelated service answers a reused port. Never kill a process/container not created by this run.

| ID | Scenario | Required observation |
|---|---|---|
| L01 | Passing full suite | Actual app/backend and every PTY/model descendant exited; exact app+Mongo containers/private network removed, published listener closed, container HOME/XDG/database/workspace deleted with owned containers and host staging roots removed. Browser contexts/client wrappers close. Teardown error fails run. |
| L02 | Intentional assertion failure/timeout | Throwaway failure after all services ready, plus bounded test-timeout scenario. Same cleanup as L01; failure reported nonzero with redacted logs. No screenshot/image generation when capture disabled. |
| L03 | Partial startup failure | App exec early exit, missing SPA assets, Mongo unready, seed/auth failure and occupied explicitly requested published port; image build failure before service allocation. Fail within configured deadline; dispose all already-created containers/network/temp roots; no hang or attach to an unrelated occupied service. |
| L04 | Runner interruption | Send SIGINT and SIGTERM after services ready. Graceful stop followed by bounded escalation/reaping for owned descendants; container removed and temp root deleted. Runner interruption cannot produce fresh passing evidence. |
| L05 | Working directory/concurrency | Run package/root commands and two independent capture-disabled invocations concurrently. Unique roots/names/ports; no shared database/profile/policy; both clean up only their own resources. Capture-enabled writers for same canonical evidence are serialized/rejected, never last-writer-wins. |
| L06 | Personal-state guard | Poison inherited HOME/XDG, Mongo/API/provider config env and simulated managed-host config in controlled probes. App container never mounts host HOME or `/etc`; environment and reported effective Advisor home remain fixture-owned before domain operations. Parent sentinels unchanged; no application reads/writes personal configuration. Container client may use its normal engine configuration; never claim engine internals isolated by application HOME. |

SIGKILL/machine crash cannot execute JavaScript finally blocks. Document limit honestly; owned-resource IDs support targeted recovery, not global prune/pkill. Prefer stdin/parent-death-aware service ownership where feasible; acceptance guarantees normal exit, failure, startup failure and catchable cancellation, not impossible cleanup after host death.

## Capture-disabled CI
Use a **throwaway checksum/file-inventory harness**, removed after verification. Snapshot all colocated evidence/review files (bytes and mtimes) and image/video/archive files under clean runner output before run; compare afterward. Validate policy precedence through deterministic unit behavior tests plus real scenarios.

| ID | Scenario | Required observation |
|---|---|---|
| C01 | `CI=true`, capture unset | Same three cases/actions/assertions as local capture. No new or modified PNG/JPEG/WebP/video/trace image artifacts, no screenshot generation, all existing case evidence/reviews byte-and-mtime unchanged. Reports say skipped capture, not fresh evidence. |
| C02 | `CI=true E2E_CAPTURE=0` and local `E2E_CAPTURE=false` | Same parity/no-write guarantees. Capture-disabled run works with existing evidence read-only and absent canonical screenshot directories in disposable checkout. |
| C03 | Disabled failure | Force a functional application failure after readiness and a separate retained Vitest browser-component failure in a disposable probe. Neither generates automatic failure screenshot/video/image-containing trace or fresh record. Runs fail, services clean up, and assertion reports/redacted logs remain. Shared Node policy covers both component configs and Playwright. |
| C04 | Explicit precedence | `CI=true E2E_CAPTURE=1` in local CI simulation generates actual images and propagates capture errors; default local/unset CI captures; `CI=false`/`0` not misread as truthy CI. No unconditional case-level screenshot call remains. |
| C05 | Required CI job | PR gate runs both retained component tests and Playwright functional E2E; aggregate gate requires E2E success/cancellation/failure correctly. No required CI image-generation job. `test:all` includes application E2E in its existing capture-disabled process-group wrapper. |

## Inventory/workflow gaps
Publish source-backed suite matrix and priority-ranked integrated gaps: owner/profile switching, file/edit/search persistence, terminal continuity, Git mutations/publication, media capabilities/logout, notification navigation, settings/usage/host reconnect, mobile layout, Browser/extension/native host. Mark historical manual qualification separately from current executable app E2E. Only three journeys required now; gaps recorded, not silently treated as covered or expanded into wholesale implementation.

## Planning verification status
Repository configs, current three sources and current images inspected. No changed runtime, new specs, application services or acceptance scenarios executed during planning. All gates pending implementation. Unresolved questions: none blocking plan; named human reviewer must inspect fresh implementation evidence.
