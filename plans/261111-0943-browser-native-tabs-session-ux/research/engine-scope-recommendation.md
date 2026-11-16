# Browser engine research — combined scope recommendation

## Decision summary
**Recommend retaining Chrome and DamHopper's Rust CDP/media owners for the native-tabs UX plan.** If desired, evaluate agent-browser as an optional trusted automation CLI/MCP client, not as a rendering-engine replacement. Adoption is not yet qualified; no engine scope change or implementation authorized.

## What is running now
- Observed local dev Browser child: `/opt/google/chrome/chrome`, **Google Chrome 157.0.8103.38**, direct child of debug `dam-hopper-server`. Binary version command exited 0; no page/navigation/closure performed.
- Chrome supplies Blink/V8. DamHopper supplies custom Rust CDP actor, process/profile supervision, logical sessions, REST/raw gateway, BHJF video + PCM audio, input leases and React canvas UI. `chromiumoxide_cdp/types =0.9.1` supplies protocol types; it is not the rendering engine.
- This runtime observation is for the local dev server, not every configured remote server or the separate installed service.
- [Exact repository/runtime evidence](../reports/current-browser-engine.md).

## What the two projects establish
| Project | Confirmed source finding | Meaning for DamHopper |
|---|---|---|
| agent-browser | Rust CLI + daemon drives external Chrome over CDP; supports external CDP attach, snapshots/element refs and commands. Sampled version 0.42.0; browser/daemon source pinned at d129226078e0fc8ee5dec48fbc96a46df5d0aafd. | Automation ergonomics, not a new Chrome renderer or native tab UI. Attach is a plausible integration boundary, not a proven authenticated setup. |
| OpenMausBot | Agent-browser adapter exists, including `mcp --tools core --no-webmcp`; separate direct-CDP `ChromeEngine`/`omb-cdp` control backend is also wired. | The reported dependency is real, but it is not the entire browser architecture. Both inspected backends still use external Chrome. |
| OpenMausBot human viewing | Its LiveRouter exposes newer StreamV2 routes through direct-CDP backend; agent-browser branch uses legacy viewing. | Human UI/stream/session integration remains host-owned. This does not prove upstream agent-browser lacks other streaming features. |

Primary pinned evidence:
- [agent-browser browser manager](https://github.com/vercel-labs/agent-browser/blob/d129226078e0fc8ee5dec48fbc96a46df5d0aafd/cli/src/native/browser.rs), [daemon](https://github.com/vercel-labs/agent-browser/blob/d129226078e0fc8ee5dec48fbc96a46df5d0aafd/cli/src/native/daemon.rs).
- [OpenMausBot backend/viewer routers](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L55-L127), [viewer branch](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L299-L347), [CLI/MCP adapter](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L592-L635), [turn-scoped proxy wiring](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts#L333-L354).

## Can we extend the existing plan?
**Yes, as a separately gated optional automation integration; not as a drop-in engine swap.** Keep the five UX phases and user-set session/close/reopen/capacity decisions intact. Directly making agent-browser the process/profile/media owner would instead be a major architecture migration with new privacy/lifecycle obligations and no established UX benefit.

Recommended separation:
1. Native Browser UX remains implementable over current multi-target backend: horizontal tabs, per-tab address drafts, live reconnect, remembered addresses on explicit close/reopen.
2. Optional agent automation qualification follows independently or as an explicitly selected extra phase; it must not become a hidden dependency of the UX deliverable.
3. Full control-stack replacement, if still wanted, needs its own researched design and review. Neither existing core plan review nor these static research reports approve that migration.

## Minimum go/no-go requirements for optional integration
- Pin exact agent-browser binary/version/provenance and verify license notices before packaging/copying anything. OMB's exact packaged version was not fetched; old 0.36/0.37 workaround comments are not proof of current 0.42.0 bugs.
- Prove secure authenticated attachment to existing `/api/browser/cdp/ws`. Browser manager preserves a direct ws(s) URL but HTTP discovery strips the input path and probes root `/json/version`; our prefixed discovery cannot be assumed to work. Exact CLI header/subprotocol wiring remains unverified, so no copy-paste authenticated command is claimed.
- Preserve server-owned Chrome/profile/reset/containment. No concurrent profile reuse, cookie migration, browser download/autolaunch, direct unauthenticated DevTools/stream exposure or credential export. Verify attached-client disconnect does not close shared Chrome/pages; individual tab-close remains destructive.
- Explicit target correlation: CLI tab/element refs are not DamHopper logical session UUIDs. Never match by URL alone; never treat CLI named sessions as principal isolation.
- Qualify viewport changes, tab creation/closure/popups and current human stream/input/IME/audio/privacy behavior during agent actions. Current backend already accounts raw targets against shared caps and observes native destruction; raw client commands bypass REST creation-key workflow, not all supervision.
- Verify no unwanted state autosave/export; OMB's stateless attach configuration is useful evidence, not a guarantee for another binary version. Avoid putting tokens in process arguments/logs.
- Exercise role/Origin/revocation/reset/disconnect behavior, existing caps and no unintended Chrome/page creation. Record actual runtime results before declaring adoption supported.

Affected investigation boundaries: existing raw CDP gateway/auth, session/native-target observer, agent launch/tool configuration, profile/state-export policy and same-target human/agent coexistence checks. No changes to these files are authorized by this report.

## Evidence limits and delivery
- Two independent researchers, each five external fetches; reports are source research, not installed/runtime integration qualification. Source pin and sampled package/version evidence are distinguished in the detailed reports.
- Upstream stream wire/audio/interactive-input internals and exact CLI auth-header flags remain uninspected. OMB direct-CDP/panel internals and complete third-party license texts were not fetched. These block a ready-to-adopt/replacement plan, not the conclusion that the existing UI can stay on Chrome.
- Researcher overclaims were qualified during synthesis: uninspected features are unknown; OMB historical comments are not current vulnerability findings; Runtime.enable side effects are untested; engineering recommendations are not static facts.
- [agent-browser detailed assessment](agent-browser-replacement-assessment.md); [OpenMausBot detailed integration](openmausbot-agent-browser-integration.md).

Final user decision: `browser_scope = keep-ux`. Retain the reviewed native Browser UX plan; agent-browser/OpenMausBot research is informational, not an adoption or engine-replacement phase. [Final validation receipt](../reports/final-validation.md). No implementation or integration test performed.
