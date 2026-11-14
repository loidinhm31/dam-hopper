# Coordinator design dispositions

Status: planning decisions from user scope + direct source inspection; no implementation or visual approval.

## Accepted mobile direction
- Agent Hub is main authenticated product; keep secure Profile Login gate. Projects become a picker/navigator inside Hub, not a mandatory intermediate landing. Keep Settings and Notifications as globally discoverable inline actions with exact return origin.
- Terminal, Files, Editor and focused Git are nested Hub capabilities. Single content stage; phone modal navigator, width-admitted collapsible navigation rail on large devices. No OS desktops/windows/dock/Recipes runtime. Existing focused-root non-core screens stay unmounted; this does not authorize deleting unrelated feature implementations.
- Reuse native KMP/Compose, terminal VT/Sora editor, awaited retirement, settings preference/admin target separation and bounded notification reducer/feed. No WebView/local PTY/Git/AI or new runtime/scheduler/flags.
- Preserve explicit mobile accessory controls, retained controllers and hidden-surface input gating; normal presentation switches do not create/kill PTYs.

## Corrections overriding designer proposals
1. `android-ui-ux-design.md:63` proposes **Launch Again** on unresolved create. Reject for this plan: the server's repeated terminal ID may kill/replace; no same-attempt retry/replacement/reset/TTL or duplicate-risk override. Pending/unknown launch remains retained and blocks a replacement until exact original success or authoritative proof the original cannot still succeed. Fresh empty inventory alone and local cancellation/retirement are not server proof. Expose Check status and explanation, not a misleading clear/retry button. Independently requested new sessions remain distinct explicit intents, not recovery of the unknown attempt.
2. `android-ui-ux-design.md:59` uses older `(owner,path,tabIncarnation)` as canonical file identity. Do not freeze this as the new canonical identity: current server filesystem identity/epoch/target evidence governs. Retain tab incarnation separately; aliases/routes must not create competing dirty documents or silently rebind baseline ownership. Exact implementation awaits API/Android evidence.
3. `android-ui-ux-design.md:84` proposes blanket read-only administration for no-auth dev servers. Reject unsupported policy: the user's local development API is explicitly in scope; honor actual server capability/ownership and transport policy. No-auth dev indication is a security notice, not fabricated capability denial.
4. `android-ui-ux-design.md:34,94` mixes formula-based visible-row acceptance with fixed 12/6 row requirements. Use measured viewport/insets/chrome/font/IME formula and reference captures; no impossible fixed row guarantee on arbitrarily short landscape/large-font devices. Collapse optional controls without hiding direct capability navigation or leaking input; if display cannot fit, honest constrained presentation, no forced font reduction.
5. Width admission is actual available space, not device label: one 280dp rail only when resulting stage >=360dp; never simultaneous Projects and Files rails. Fold hinge/insets must be subtracted before admission.
6. Designer Q3 about non-core panels is already answered by current user focus. Preserve them outside active root; no new feature parity obligation, no interview asking permission to omit an OS the user excluded.

## Validation topics retained
- Optional final validation after independent review: direct-to-Hub and adaptive navigation changes versus previous Android row-only contracts; navigator across already-connected profiles versus current profile only. Recommendations: direct-to-Hub/adaptive navigation, all already-connected profiles with no automatic connection or keepalive. No take caller; this route owns one final validation receipt.

## Unresolved questions
- Two optional product confirmations above; API/Android evidence must settle implementation contracts before phase authoring.
