# SQLite default backend selection — approved design

- **Mode:** decision-summary
- **Problem/outcome:** Unconfigured server startup defaults to SQLite while preserving MongoDB selection when configured; SQLite qualified for both development and single-node production.
- **Key decisions:** Precedence contract: `DAM_HOPPER_LITE_MODE=true/1` forces SQLite; `false/0` enforces valid Mongo; unset/blank selector selects Mongo when both `MONGODB_URI` and `MONGODB_DATABASE` are set/nonblank, defaults to SQLite only when both are strictly unset, and fails actionably on set-blank/partial config. Bounded startup Mongo ping fails unreachable servers early without altering post-connectivity index-init warning policy.
- **Constraints/trade-offs:** Operational local-storage constraint: one server process per local SQLite file (never shared/network storage; no runtime lock additions). Independent stores; no live sync.
- **Design status:** **Approved** by explicit user choice. See the [approved design report](../../plans/reports/brainstorm-261028-2330-sqlite-default-backend-selection.md).
- **Planning consent & router outcome:** Explicit user planning consent granted. Disclose accurately: central router command `/evc-cmd-plan` was not directly invokable in harness; draft implementation plan authored by `evc-planner` at [plans/261028-2330-sqlite-default-backend-selection/plan.md](../../plans/261028-2330-sqlite-default-backend-selection/plan.md).
- **Risks and next step:** Operational risk of accidental SQLite default if Mongo env drops (mitigated by startup log 'Authentication backend: SQLite (default — MONGODB_URI not set)' and explicit `DAM_HOPPER_LITE_MODE=false`). Next step: formal plan review and validation before implementation.
