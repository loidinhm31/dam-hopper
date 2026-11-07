# OS session management and interactions — approved design

- **Mode:** decision-summary
- **Problem & outcome:** Addresses seven OS concerns: terminal accumulation on UI close, opaque Recipe host/project inputs, ineffective Hub Review, missing central session/harness navigation with side-by-side terminal, inconsistent outside-click/Escape dismissal, exact float stacking, and absent double-click tile/float transitions.
- **Key decisions & trade-offs:** Terminal close button prompts Close view / End session / Cancel; central Hub provides an all-session inventory and opens an adjacent ordinary terminal pane rather than an embedded second renderer; canonical source-desktop/context selectors for Recipes; capability-qualified Review with protected-data retirement; coordinated transient layer dismissal; new-float 28px cascade; title-bar background double-click tile/float toggle; narrow server atomic identity termination guard for safe destruction. Prompt interaction cost and server guard chosen for process safety.
- **Design status:** **Approved** (explicitly by user in conversation). Referenced report: [plans/reports/brainstorm-261104-1231-os-session-management-and-interactions.md](../../plans/reports/brainstorm-261104-1231-os-session-management-and-interactions.md).
- **Planning consent & result:** User explicitly chose "Defer planning". Planning router: NOT INVOKED. Implementation plan path: NONE. Implementation: NOT PERFORMED/AUTHORIZED.
- **Evidence & scope limits:** Grounded in read-only source research and completed scouts; no tests, builds, or runtime verification performed. Full Recipe execution and layout restoration remain excluded and unresolved.
- **Next step:** Retain approved design report; await explicit later planning request.
