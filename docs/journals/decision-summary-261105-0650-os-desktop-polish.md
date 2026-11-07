# DamHopper OS desktop polish — approved design

- **Mode:** decision-summary
- **Problem & outcome:** Review and design five post-redesign DamHopper OS polish requests: keyboard shortcuts, theme icons, app pinning, floating dock appearance, and desktop context menu with optional custom pointer.
- **Key decisions & trade-offs:** Shared Open/Focus action executor for all 17 apps with opt-in bindings; resolve remap/unbind/input precedence while preserving owner/generation fences; Lucide theme SVGs; ordered pins plus running apps with permanent launcher; pin/unpin without closing apps; explicit New Window without Close/Kill scope; inset left dock with configurable padding/gap/outer spacing/radius and work-area-aware maximize; wallpaper-only coordinated context menu; optional native CSS cursor with system default (no overlay or iframe control). Reuse existing preference-source config round-trips; keep pins browser-local. Bounded OS polish chosen over cosmetic-only or full macOS clone.
- **Design status:** **Approved** (user explicitly selected "Approve this design"). Referenced design report: [plans/reports/brainstorm-261105-0650-os-desktop-polish.md](../../plans/reports/brainstorm-261105-0650-os-desktop-polish.md).
- **Planning consent & result:** Explicitly deferred by user; central plan router not invoked. Plan path: **None** (existing redesign plan is context, not a new plan result). Implementation: unauthorized and not performed.
- **Validation & limits:** Grounded in completed read-only source inspection and isolated localhost:5173 browser inspection (observed palette/settings shortcut behavior, lack of search trigger from Settings, absence of dock/desktop DOM menus). No implementation, builds, lint, or automated tests executed; prior release/human gates remain unclosed.
- **Next step:** Separately authorized central-router planning from the approved design; no implementation authorized.
- **Unresolved questions:** None for the approved design.
