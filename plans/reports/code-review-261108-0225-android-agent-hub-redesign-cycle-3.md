# Android Agent Hub — Final Code Review Cycle 3

## Score: 5/10

**Disposition: changes requested.** Improvements are present, but seven original critical invariants remain incomplete. Final review cycle does not imply release approval.

## Scope and evidence

Static review of C-01–C-08, production callers, canonical document ownership, reconnect/save authority, notification routing, privacy/input boundaries, and the seven previous warnings. Read README, PDR, code standards, published development rules/code-review skill, redesign overview and C1–C10 contracts; inspected relevant production/test excerpts. Not a full repository security audit.

Paths below are relative to `native/android-app/`:
- `common/` = `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`
- `android/` = `androidApp/src/main/kotlin/dev/damhopper/nativeapp/`

No builds, tests, lint, live-server or device checks executed: integrated verification belongs to Main under the assignment's ownership constraints. Findings describe inspected source, not reproduced device behavior. No production, plan or task-state edits; this report is the only added file. Coverage percentages unavailable.

## Fix reassessment

| Finding | Cycle 3 source assessment |
|---|---|
| C-01 Hub integration | **Partial:** inventory now renders, but terminal row selection does not route its workspace/profile; workspace Files/Editor remain unavailable without a project. |
| C-02 canonical identity | **Partial:** both reload branches install response identity and reject a changed canonical key; initial editable admission still accepts missing/invalid identity. |
| C-03 reconnect authority | **Incomplete:** owner equality guards exist; production owners still omit workspace epoch/root, and rebind restores authority without fresh document authorization. |
| C-04 disposal/detach | **Partial:** same-widget stale-token detach now returns before widget mutation; clean old-view disposal improved. Final discard still has no deferred disposal intent. |
| C-05 privacy/input | **Partial:** editor session gate now incorporates suspension; terminal dialogs are omitted under cover. Dirty-departure dialogs remain separate unmasked windows. |
| C-06 exact worktree | **Addressed in inspected source:** exact project/worktree session filter and both visible creation payloads retained. Runtime not exercised. |
| C-07 notifications | **Partial:** live socket/agent checks present; authoritative inventory remains pre-consent only and exact route incarnation is still dropped. |
| C-08 target commits | **Partial:** named Hub actions now defer store mutation until consent; all three production revalidators merely require some current connection. |

## Critical Issues (7): MUST FIX

### C-01 — Rendered Hub actions still do not implement the active Hub contract
- Evidence: `common/ui/screens/DamHopperMobileApp.kt:840-871,1165-1206,1231,1249`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1192-1201,1921-1928,1989-2018`; `common/features/workspace/AgentHubModels.kt:17-29`.
- Clicking a rendered terminal only updates `activeSessionId` and searches an owner using the **already selected project**. It never selects the row's project/worktree/profile. From the project-null Hub, owner lookup immediately returns null and the root continues rendering the Hub; a cross-profile row can instead select an equal raw ID in the old visible owner. Free-terminal rows have no independent profile qualification.
- Files and Editor still open the project picker when no project is selected; Editor dispatches `OpenFiles`, not Editor. The Terminal capability tab dispatches remote creation rather than switching capability. Selecting a project replaces the inventory root with the previous workspace screen.
- Correction: route captured qualified rows through existing verified activation; retain a usable workspace-scoped Files/Editor stage and distinguish capability selection from explicit creation. Do not substitute the project picker for workspace access. **C1/C2/C4/C8; confidence high.**

### C-02 — Editable reads still manufacture identity when the server identity is absent
- Evidence: `common/features/editor/EditorContentLoader.kt:77-100`; `EditorTabsState.kt:345-362,393-425`; `EditorRepository.kt:115-146`.
- `loadFullText` publishes editable success with null/invalid `fileIdentity`. `resolveCanonicalKey` then builds a target/path fallback with guessed epoch zero. Save admission does not require a qualified baseline. Aliases can therefore edit separate buffers for the same file, and unsupported identity responses receive write authority rather than failing closed.
- The reload identity assignments at `EditorTabsState.kt:1222-1223,1274-1275` are real improvements, but do not repair first admission.
- Correction: validate same-response workspace ID, epoch and canonical path before editable publication; reject or explicitly downgrade unsupported reads to read-only. Never manufacture editable canonical identity. **C4; confidence high.**

### C-03 — Reconnection still reauthorizes retained dirty documents without fresh identity
- Evidence: `common/ui/screens/DamHopperMobileApp.kt:367-373`; `common/features/workspace/ProjectWorkspaceState.kt:287-325`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1562-1590`.
- Root-created owners omit authoritative workspace root/epoch. Rebinding repositories to the same nullable owner immediately clears `_isAuthorityRetired`, without reading and matching each retained document's canonical baseline. An endpoint/account that now serves a changed workspace can regain save authority over old dirty buffers. Updating stale flags or comparing equally incomplete owners does not authorize the document; mtime CAS is not identity authorization.
- Correction: capture authoritative workspace identity and keep document write authority revoked until a fresh authorized read matches its original canonical identity. Preserve dirty content/undo on mismatch. **C4; confidence high.**

### C-04 — Explicit discard still does not settle exact-document disposal
- Evidence: `common/features/editor/EditorTabsState.kt:170-212,697-735,782-793`; `android/platform/editor/AndroidEditorDocument.kt:78-82,103-117`; `AndroidEditorSurface.kt:98-108`.
- `pruneDocument(forceDiscard=true)` removes an alias-free document from the registry, but closes it only when `canDispose`; native `canDispose` always rejects dirty documents. The surface's later release uses the same predicate, so a discarded dirty document never receives deterministic `close()` even after its final view disappears.
- `closeAll(forceDiscard=true)` retains a mounted dirty document because it still has a view; subsequent surface release neither clears dirty state nor remembers discard/prunes the registry. Reopening can recover content that was meant to be discarded. Dirty old documents replaced by forced reload have the same settlement gap.
- Correction: retain exact-document disposal ownership and explicit final-discard authorization through view/save settlement; close once when safe without affecting surviving aliases. The same-widget stale-token early return at `AndroidEditorDocument.kt:559-563` is addressed. **C4; confidence high.**

### C-05 — Dirty-departure windows remain outside privacy masking
- Evidence: `common/ui/screens/ProjectWorkspaceScreen.kt:471-475,554-568`; `common/ui/screens/DamHopperMobileApp.kt:534-549,998`; `common/ui/screens/ProjectTerminalScreen.kt:1742-1743`.
- Terminal dialogs and the project picker now have cover guards. Both departure `AlertDialog` branches still mount unconditionally in separate windows, including a private file path in the tab-close prompt. The in-content Cognito overlay cannot cover that window or intercept its controls.
- Correction: omit or independently mask every separate dialog window while privacy is active, retaining pending intent for restoration and blocking its actions. Do not suppress the departure dialog merely because the dialog itself suspends ordinary editor input. Session input suspension at `ProjectWorkspaceState.kt:465-482` is now present. **C7/C8; confidence high for source gap; device behavior unexecuted.**

### C-07 — Notification commit still relies on cached authority after consent
- Evidence: `android/platform/workspace/NativeWorkspaceViewModel.kt:790-847,2082-2125`; `common/ui/flow/AppFlowNavigation.kt:309-339,417-424`.
- The authoritative `listDetailed()` fetch occurs before dirty-departure consent. The later callback only rereads cached reducer state, not fresh server terminal existence/alive/project/worktree authority. A terminal exit or reassignment during consent can therefore commit the old route.
- `routeToTerminal` explicitly passes `required=null`, dropping the resolved incarnation even though existing verified-route machinery can preserve it. ID reuse/restart is not carried into exact terminal selection/attachment.
- Correction: after consent, perform fresh authoritative resolution and owner/socket/account/agent revalidation, then commit the captured exact incarnation via existing verified routing. **C7; confidence high.**

### C-08 — Post-consent target validation still accepts replacement connections/accounts
- Evidence: `android/platform/workspace/NativeWorkspaceViewModel.kt:1877-1907`; `common/ui/screens/DamHopperMobileApp.kt:1004-1026`; `common/ui/flow/AppFlowNavigation.kt:366-409`.
- `SelectProjectTarget`, `OpenZeroSessionProject` and the picker correctly defer `targetStore` mutation now. However, their callbacks only check `getCurrentConnection(profileId) != null`. A reconnect, endpoint edit or different authenticated account during consent still passes; no captured generation/endpoint/account or target authority is compared.
- Correction: capture exact connection and authenticated logical owner when the request starts; reject any changed owner after consent and before the atomic flow/store commit. Cancelled/busy/stale attempts must leave both selections unchanged. **C2/C8; confidence high.**

## Warnings (7): SHOULD FIX

1. **Duplicate unqualified Hub state.** `android/platform/workspace/NativeWorkspaceViewModel.kt:1176-1201,1288-1319,1957-1970`; `common/features/workspace/AgentHubModels.kt:17-29,54-55`. Pin/hidden sets and pruning use raw IDs across profiles/incarnations; owner lookup falls back to any workspace in a profile. Reuse exact retained qualified presentation state; one server losing an ID must not unpin/hide another server's equal ID.
2. **Uncertain-create gaps unchanged.** `common/features/terminal/TerminalRepository.kt:109-145`; `TerminalModels.kt:213-220`. Intent IDs are timestamps despite UUID contract; free-terminal uncertainty does not block a different-ID replacement; persisted authority lacks endpoint/account; all 4xx clear uncertainty. Persist a UUID/exact logical owner and settle only definitive original success/refusal, not ambiguous timeout/proxy outcomes.
3. **Termination support still inferred.** `common/features/terminal/TerminalRepository.kt:47-61`; `TerminalPresentationPolicy.kt:124-129`. Inventory decoding ignores advertised termination version; valid-looking epoch/incarnation enables End Session. Require `X-DamHopper-Termination-Version: 1` and fresh matching inventory; retain local Close View when unsupported.
4. **Command rename/delete still resurrects originals.** `common/features/settings/RemoteConfigEditor.kt:544-548,687-693`. Overlaying current commands on the original map preserves removed/renamed represented names. Remove represented original keys before merging edited rows; preserve only genuinely unrepresented data.
5. **Duplicate upload selectors remain.** `common/features/files/TransferCoordinator.kt:68-76`. `FsUploadBegin` still sends nested target plus flat project/worktree. Remove duplicate flat selectors and assert exact serialized cutover shape. C3 requires this even if today's server accepts it.
6. **Repeated full-document allocations remain.** `common/features/editor/EditorSession.kt:28-31`; `EditorTabSaveCoordinator.kt:23-31`; `EditorTabsState.kt:261-304,1224-1250`. Reading mtime serializes the document after save already captured it; tier replacement reconstructs sessions through both the registry listener and the caller. Use snapshot mtime/O(1) baseline and a single replacement publication path.
7. **Qualification/docs still overclaim or describe the old product.** `plans/261107-0305-android-agent-hub-redesign/reports/live-api-qualification.md:3-27` calls mock/unit/oracle checks disposable runtime verification while deferring real isolated multi-server execution. `docs/code-standards.md:16,65` and `docs/project-overview-pdr.md:7,45` still describe the replaced linear flow. Correct evidence labels and update approved product docs/changelog; retain the honest blocked-device gate in `device-visual-qualification.md:3,17-25`. Do not infer release readiness.

## Suggestions (2): NICE TO HAVE

1. Strengthen production-boundary regressions: rendered fleet row activation across profiles/equal IDs; workspace Files/Editor without project; null identity; identity-bearing same/tier-changing reload; mounted final discard and dirty replacement; same-widget/new-token detach; terminal reassignment during notification consent; owner replacement during target consent. Existing inspected tests often assert helper equality, direct callbacks or tab count rather than these end-to-end effects (`EditorTabsStateTest.kt:151-153,647-727`; `AgentHubLifecycleTest.kt:260-297`; `AndroidEditorDocumentTest.kt:182-216`).
2. Once correctness is restored, separate the large ViewModel/root/terminal screen along existing owner and presentation boundaries. Do not add another coordinator/runtime to hide duplicated state.

## Positive observations and invariant conclusion

- C-06 remains source-correct: `ProjectTerminalScreen.kt:511-520,723-738,1628-1635,1752-1755` preserves exact project/worktree selection and creation.
- Canonical response identity is now installed on both reload branches; identity changes are refused rather than silently rekeyed.
- Same-widget stale-token detach now exits before focus/release mutation; clean detached documents can close.
- Editor session suspension and terminal-dialog cover guards are real improvements; named Hub target actions no longer mutate the shared store before consent.

C1/C2 active Hub and qualified ownership, C3 serializer/capability compliance, C4 identity/rebind/disposal, C5 config reconciliation, C6 uncertain-create handling, C7 privacy/notification fencing and C8 guarded target admission still have the above gaps. Historical C9 wave compliance not re-audited. C10 runtime/device release gates remain unproven by this review.

## Unresolved evidence

No reviewer-executed build/test/lint or live/device reproduction. Main owns final shared/Android compilation, focused regressions and integrated checks; isolated runtime and physical-device IME/hardware-key/TalkBack/privacy journeys remain distinct required gates. No unresolved product-design question blocks the corrections.
