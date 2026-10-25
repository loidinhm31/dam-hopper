# Independent targeted plan follow-up

**Status: complete. F1–F4 and the Settings signature/ownership question are closed at plan-design level. No residual critical/high finding established on the assigned revised surfaces.** This is the one targeted follow-up, not implementation approval, a second whole-plan audit or native qualification.

Canonical overview: `G:/ws/sharing/dam-hopper/plans/261025-1157-android-terminal-agents-sidebar/plan.md`.
Prefixes: `P/` = its containing directory; `S/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `J/` = `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`.

## Inspected coverage and exclusions

- Dispositions: `P/reports/review-triage.md:1-20`, including coordinator's explicit removal of the planner-added older-version acceptance gate.
- Revised authored artifacts: `P/plan.md:1-61`; `P/contracts.md:1-302`; `P/phase-01-shared-contracts.md:1-66`; `P/phase-02-roster-and-local-filter.md:1-133`; `P/phase-03-native-sidebar.md:1-97`; `P/phase-04-retained-integration.md:1-216`; `P/phase-05-qualification-and-docs.md:1-159`. Truncated material admission/overlay/qualification statements read separately in full.
- Targeted fresh source reads: `S/core/transport/WsConnection.kt:42-105,198-224,393-416`; `S/features/terminal/AgentStatusReducer.kt:123-135,165-206,215-259,357-402,410-490`; `S/features/profiles/ProfileRepository.kt:16-29,127-159,252-278`; `S/core/ownership/ConnectionRegistry.kt:240-260`; `J/core/transport/ApiClientTest.kt:1-200`.
- Initial review's inspected root/search/modal/Settings/server endpoint evidence remains applicable; not rereviewed wholesale. In particular its evidence covers root shortcut/search coexistence, compiled Workbench Settings caller, and caller-selected terminal IDs. `design-evidence.md` and initial review left unchanged/read-only; revised contracts and triage are the correction authority.
- Excluded: unrelated-plan repair/closure audit, new architecture alternatives, whole-product review, environment setup, code execution, task-state or product/doc edits. Parent owns structural parser/path/DAG checks and final validation.

## Closure decisions

### F1 — Attachment alias: closed; high confidence

- Correction: runtime key now includes `attachmentIncarnation`, propagated through inventory/workspace snapshots/targets (`P/contracts.md:16-48,56-58`). Host lifetime allocation distinguishes replacement WsConnection objects even when generation and `sock-1` compare equal; old callbacks cannot publish, purge or upgrade targets. Logical display-cache identity remains separate.
- Propagation: Phase01 freeze/model acceptance (`P/phase-01-shared-contracts.md:24-28,47-54`); pure membership/cache tests (`P/phase-02-roster-and-local-filter.md:26-34,105-108`); actual runtime/activation/test ownership and same-value regressions (`P/phase-04-retained-integration.md:16-21,29-38,171-177,184-186,198-199`); current-server switch-back journey (`P/phase-05-qualification-and-docs.md:108-109`).
- Source feasibility: `S/core/transport/WsConnection.kt:49-50,100-101` confirms per-object sequence alias; `S/features/profiles/ProfileRepository.kt:147-158` creates new transport objects. The correction fences retained-host attachment authority without changing socket creation, wire identity or transport lifetime.
- Residual: implementing every capture/publication/retirement check and proving old-token rejection remain mandatory future tests, not completed behavior.

### F2 — Runtime/route atomicity: closed; high confidence in contract feasibility

- Correction: actual exclusion order is profile mutex -> registry admission -> try roster ReentrantLock -> try captured socket lifecycleMutex -> try reducer mutex (`P/contracts.md:249-270`). Typed BUSY/STALE results propagate without spin/retry; each try-admission unlocks in finally. Main is only the UI-write constraint, explicitly not the concurrency proof.
- The mutation table covers authoritative attachment map/token, registration/inventory/cache/request cancellation, private socket state and reducer binding/epoch/authority revision. `routeAuthorityRevision` changes under the reducer's actual mutex, not an async mirror (`P/contracts.md:102,255-269`). Checks occur before the mutation-only panel/session/flow/profile/receipt leaf; COMMITTING/COMMITTED cannot self-cancel or later be reclassified (`:272-280`). Future server changes remain outside the local guarantee, with required exact-screen demand retained.
- Producer/drain discipline is explicit: ordinary source locks release before roster publication; no new roster/socket/reducer exclusion spans drain; existing outer profile-held retirement is preserved, with no barrier/child profile/registry reentry or dependency (`P/contracts.md:261,274`; `P/phase-04-retained-integration.md:174-177,208`). This resolves the original unspecified local serialization rather than asserting that Main alone suffices.
- Source feasibility: registry explicitly permits try-lock-only independent gates inside its synchronous callback (`S/core/ownership/ConnectionRegistry.kt:240-250`). Existing socket mutation uses lifecycleMutex (`S/core/transport/WsConnection.kt:85-86,395-415`); reducer authority uses its private mutex (`S/features/terminal/AgentStatusReducer.kt:123-134,171-205,357-383`). A socket operation holding lifecycleMutex while awaiting registry can cause BUSY, not a blocking inversion, because final admission only tries that socket gate and immediately releases registry on contention.
- Ownership: reducer stamp/helper/tests belong to runtime task; WsConnection helper/test, profile transaction and mutation-only selection hooks to navigation task; ProjectTerminalState transfers sequentially to mount task (`P/phase-04-retained-integration.md:16-21,47-62,88-99,169,177,184-186`). Registry source needs no new edit. No concurrent writer or new dependency required.
- Residual: exact cancellation/persistence truthfulness, contention at each gate, producer exclusion and no-reentry/drain behavior require deterministic implementation tests. Closure is design-level feasibility, not a deadlock-freedom or compiled-code claim.

### F3 — Overlay/search/modal input authority: closed; high confidence

- Correction: complete root cover now names privacy, Settings, search, pending departure, actual terminal local modals/popups, sidebar popup and compact Agents (`P/contracts.md:284-290`). Local cover reporting is owner-qualified; disposal clears only its own source. Pinned input requires actual terminal focus plus existing eligibility.
- Minimal exclusivity prevents opening Agents through search/local modal/departure/Settings/privacy. Compact Agents consumes root search/panel/Projects shortcuts and route controls; legitimate group departure dialog and Settings/privacy replacement remain explicit exceptions. Source replacement precedes teardown, so closing/resizing one surface cannot transiently lift another's cover. Back/Escape addresses the actually rendered topmost surface, not lower Agents (`P/contracts.md:286-290`).
- Propagation: Phase01 popup callback (`P/phase-01-shared-contracts.md:28,50,54`); independent UI branch reports balanced popup visibility without input setters (`P/phase-03-native-sidebar.md:28,53,74,83`); Phase04 covers both root paths, local reports, shortcut suppression, focus/resize and real-host-state regressions (`P/phase-04-retained-integration.md:104-113,192-200`); actual device journey includes these overlap orders (`P/phase-05-qualification-and-docs.md:113`).
- Ownership: existing root/workspace/terminal files and narrow host helper are explicitly mount-owned; popup component files remain UI-owned and disjoint (`P/phase-04-retained-integration.md:88-99`; `P/phase-03-native-sidebar.md:15-18`). No general overlay framework or unrelated notification-policy repair is imported.
- Residual: gap-free effective cover, actual topmost platform dismissal, hardware/accessory/native IME suppression and focus restoration must be exercised after implementation; a duplicated test-side Boolean formula is expressly insufficient.

### F4 — Qualification setup: closed; high confidence

- Acceptance disposition is explicit and authorized by coordinator: the old-version gate was a planner-added requirement, not user scope (`P/reports/review-triage.md:13-14`). Revised plan separates real current-server MainActivity qualification from required controlled real-HTTP404 behavior; neither is presented as older-version compatibility (`P/contracts.md:104`; `P/phase-05-qualification-and-docs.md:23-28,49-55,98,114,141,154`). No mandatory unknown older artifact remains.
- Feasibility: existing `J/core/transport/ApiClientTest.kt:3,37-49,70-115,119-157` already uses an ephemeral JDK HttpServer, actual ApiClient requests, typed errors and delayed responses. New owned `TerminalAgentsHttpAvailabilityTest.kt` drives real ApiClient -> TerminalRepository -> existing reducer -> projector, including accepted200 then404/cache, superseded delayed404, non404 text independence and exact request counts. No product hook, method-return mock, dependency change or second snapshot requester is prescribed (`P/phase-04-retained-integration.md:126-150,201`).
- Deterministic same-ID setup now preflights both disposable servers, creates the same run-unique caller-selected ID, independently records metadata, and cleans only created instances whose current identity still matches (`P/phase-05-qualification-and-docs.md:26-28,108-109,115`). This matches the initial review's current REST endpoint evidence, not a hypothetical collision capability.
- Residual: real current servers, observed agents and actual API29/API33+/hardware coverage remain genuine implementation/qualification prerequisites. Controlled HTTP404 never substitutes for MainActivity or physical-device evidence.

### Settings signature/ownership question: closed; high confidence

- `initialHostSection = HostSettingsSection.USAGE` and `onHostSectionChanged = {}` are frozen optional defaults; dormant compiled Workbench caller intentionally retains prior behavior, while active root supplies explicit retained HOST/AGENTS values (`P/contracts.md:292`; `P/phase-01-shared-contracts.md:54`; `P/phase-04-retained-integration.md:112,194`).
- Thus no forced Workbench migration or additional allowed writable file is needed. Source A/target B isolation, queued mismatch blocking and captured origin remain specified; actual compiled compatibility stays a future check.

## Checks performed / not performed

Performed: bounded F1–F4/default correction propagation review across seven revised authored files; literal ownership/sequential-transfer inspection; targeted source comparison for actual mutexes/admission and existing HTTP test machinery. No new findings established in that scope.
Not performed: builds, compile/typecheck, tests, lint/format, structural parser execution, dependency installation, native/server/device runs, product/docs/plan/task-state edits, nested agents or new external research. Only this follow-up report written; initial report preserved.

## Unresolved questions / remaining gates

No unresolved design question from F1–F4 or the Settings defaults gap. Future implementation must satisfy the revised concurrency/overlay/HTTP/identity tests; no execution or qualification result is implied. Cross-plan writer release/W1–W3 disposition, parent structural checks, final validation and genuine runtime/device prerequisites remain pending under coordinator ownership, not waived by this review.
