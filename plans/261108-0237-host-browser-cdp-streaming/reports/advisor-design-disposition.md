# Advisor design consultation — dispositions

Planning-only consultation performed before authoring. Advisor reviewed conversation draft, not independently verified repository files. No implementation approval or runtime evidence.

| Advisor concern | Disposition / binding correction |
| --- | --- |
| Full chromiumoxide runtime unbounded queues | Accept. Parent primary-source follow-up confirms unbounded listener channel/VecDeque. Use maintained generated CDP types and narrow bounded WS actor, own process supervisor. Ignore unknown newer events/fields, fail required malformed responses. |
| Producer ACK vs viewer ACK, credit leakage | Accept. Prompt exact-once native ACK, separate per-viewer presented/discarded frame accounting, bounds2 outstanding+1pending; stop native producer at zero demand. Pacing not initial strategy; performance qualification may block release. |
| Raw Target filtering implies sandbox | Accept. Gateway grants whole owned principal-instance privilege. Separate process per principal is owner boundary; cooperative lease/network/UI file restrictions cannot constrain raw admin CDP. Research report is subordinate to selected architecture. |
| Logout wipe meaning needs decision | Interrupted clarification yielded no answer; user resumed. Preserve already-approved report's broader explicit-account-logout/reset wipe semantics as a stated assumption, NOT a newly confirmed answer. Warning about all sibling targets/viewers; passive expiry/remote revoke only attachment revocation. Optional final interview may revise assumption. |
| Decoded/expired logout claims cannot wipe | Accept. Fully evaluate live admin and request admission/CSRF, require confirmed expected profile epoch when managed state exists; migrate every active client path. Failure cannot report credentials cleared or permit dirty-profile relaunch. |
| Loopback vs pipe | Preserve approved loopback-port choice, not reopen transport without new requirement. Explicitly state ANY local process/user able to access loopback can bypass gateway. No local-user isolation claim; hostile local users require another OS/network design. Pipe not unplanned prerequisite. |
| Gateway/media auth mode unspecified | Accept. Purpose-bound one-use attachment tickets in subprotocol for browser media/control; raw CDP baseline uses Authorization header via existing Playwright CDP client and authenticated discovery. No fs media-cookie authority or account bearer query URL. Live auth/session/version/deadline/admin-role supervisor independent of stalled writer. |
| Windows early Job, Unix parent death, stale locks | Accept as explicit first-phase implementation proof/production-supervision tasks. Child tree exit before profile deletion; blocked orphan/lock recovery never guessed PID/time unlink. |
| Raw file/download privileges | Accept. UI denies unsupported file transfers/permissions by default with honest unavailable feedback; raw CDP privilege documented, not falsely filtered. No speculative transfer subsystem. |
| Multiple viewers competing resize | Accept. Only controller lease holder sets viewport; others letterbox; external CDP metric changes increment geometry epoch and fence input. |
| Artifact ownership affects extension consumers | Accept. Actor-bind all artifact records/endpoints while preserving HTTP DTO/independent extension workflow. Serialize shared store/API/tests writer; retain terminal incarnation atomic write. |
| Broad auth/input/gateway phase | Accept. Separate agent gateway phase and bounded input task, dedicated sequential integration owner. |
| Qualification vs completed evidence | Accept. All engine/Windows/zoom/static/session/performance gates are future implementation work, not claimed passes. Planning structural parser checks are distinct from runtime/browser qualification. |

## Gate status
Historical design advice below was superseded by completed authoring, independent initial+targeted review, and V1 user validation (no preselected logout choice). Final structural checks and Advisor corrections adopted, including Cancel focus/initial Enter/Escape guard. See [final receipt](final-validation.md); historical pending statements are not current gate status. Plan activation persistence unavailable (EVCRATE_SESSION_ID absent); selected absolute path carried explicitly.


## Verified loopback wording
Bounded source read: `plans/reports/brainstorm-261108-0138-host-browser-cdp-streaming.md:114`:
> Use an OS-assigned **loopback** Chromium debug port with a dedicated profile, not fixed/public 9223/9333. Only the authenticated gateway is remotely reachable. Same-account host agents are trusted and may access that local endpoint: this is **not** local-user isolation. Pipe-only CDP needs separate Linux/Windows transport qualification; not a prerequisite for this selected threat model.

Clarification: loopback does not authenticate local OS users. Any local process/account able to reach that listener may obtain equivalent browser authority. Shared-host deployments must disable Browser or provide a separately qualified OS/network isolation boundary. This is a limitation of the report-selected transport, not a new claim of user isolation.

## Superseding logout and gateway guards
- Preserve existing idempotent session/media-ticket revocation FIRST, regardless of wipe preconditions or older/native client capabilities.
- Only a fully evaluated live admin with destructive confirmation/expected profile epoch and request-admission checks authorizes wipe. Missing/stale preconditions still return logout success with credentials-retained/reset-required indication, not false wipe success or logout failure.
- All gateway discovery and WS requests carrying Origin require exact allowed Origin. Origin-less requests require header authentication; Phase01 must prove Playwright headers reach both surfaces.
- These clarifications were relayed to the plan author before terminal completion. Bounded tuning knobs are quality, dimensions and qualified everyNthFrame; final-static-frame correctness cannot be traded away.

## Unresolved questions
No answer received to interrupted logout question; broader existing approved meaning retained as assumption. Exact target engine/platform performance proof belongs to later implementation qualification and must not be waived by this planning consultation.
