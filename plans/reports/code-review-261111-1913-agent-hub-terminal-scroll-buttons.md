## Code Review Summary

### Scope
- Reviewed all six assigned files (~1,640 lines), their implementation diff, ownership key encoding, Hub attach gate, and TerminalPanel registration/cleanup callers.
- Files: `packages/ui/src/lib/terminal-registry.ts`, `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`, `packages/ui/src/components/organisms/PaneContainer.tsx`, their two assigned unit test files, and `packages/ui/browser-tests/terminal-scroll-buttons.browser.tsx`.
- Standards: `README.md`, `docs/project-overview-pdr.md`, `docs/code-standards.md`, published development rules and code-review skill.
- Updated plans: none supplied; implementation unchanged. No TODO/FIXME/HACK/XXX markers found in assigned files.
- Static review only. No build, lint, unit, or browser checks executed; execution remains with Main. Failure scenarios below are [INFERENCE] from inspected control flow, not runtime reproductions.

### Overall Assessment
Changes implement resolver injection correctly, but registry fallback broadens access beyond the requested fix and violates fail-closed ownership. Changes requested before acceptance.

### Critical Issues
None identified within inspected scope.

### High Priority Findings
**H1 — Qualified lookup can return another profile or terminal lifecycle.**
- Evidence: `terminal-registry.ts:116-136`, especially raw-ID fallbacks at 122, 133, 136 and full-target downgrade at 127-132.
- [INFERENCE] Register only `{profileId: "a", id: "same"}`. Looking up `{profileId: "b", id: "same"}` or `'["b","same"]'` misses its qualified key, then returns profile A's raw alias. A full `TerminalTarget` with the wrong generation, epoch, or incarnation similarly resolves through its two-field alias to a different lifecycle.
- Impact: `getTerminal`/`hasTerminal` falsely authorize availability; callers may focus, attach, scroll, or configure a different terminal. Hub's exact-target gate calls `getTerminal(target)` (`use-hub-terminal-attach-gate.ts:245-255`), so resolver injection does not preserve lifecycle fencing with these fallbacks.
- Contract: `docs/project-overview-pdr.md:59-64`; `docs/code-standards.md:22-25` require owner isolation and stale-owner failure, not raw-ID substitution.
- Correction: full targets must resolve only their complete key. Two-field qualified references may resolve their exact profile-qualified alias, never an unchecked raw alias. Keep raw lookup only for explicitly unqualified inputs; avoid dropping extra identity fields through permissive parsing.
- Required regression cases: absent profile with a matching ID elsewhere; wrong generation/epoch/incarnation; equal IDs across profiles. Confidence: high.

### Medium Priority Improvements
**M1 — Removing a newly supported alias leaves the canonical entry registered.**
- Evidence: `terminal-registry.ts:65-70,151-174`; new test only removes by full target (`terminal-registry.test.ts:92-98`).
- [INFERENCE] `registerTerminal(target, ...)`, then `removeTerminal(terminalKey(ref))` or `removeTerminal(ref)` deletes the two-field and raw aliases but never the original five-field target key. `getTerminal(target)` and its string key still return the removed entry, and the availability snapshot retains it.
- Impact: asymmetric public registry lifecycle; stale/disposed entries remain discoverable when cleanup uses a supported alias. Normal TerminalPanel cleanup currently removes its canonical key first (`TerminalPanel.tsx:1518-1522`), so this is not a claim that every normal unmount leaks.
- Correction: retain canonical registration identity or remove all keys belonging to the resolved entry, preserving other entries by identity checks. Test removal by full target, qualified string, reference, and raw ID, plus replacement-entry preservation. Confidence: high.

**M2 — New browser regression does not exercise Agent Hub interaction or its resolver wiring.**
- Evidence: `terminal-scroll-buttons.browser.tsx:315-347` mounts only `TerminalScrollButtons`, uses stub terminal methods, and activates with DOM `.click()`. The custom-resolver unit test only checks jump-to-top (`TerminalScrollButtons.test.tsx:122-153`).
- Impact: test cannot catch a missing `PaneContainer` resolver prop, claim denial, overlay/hit-testing obstruction, or trusted pointer handling in the reported Hub context. Existing generic trusted-pointer coverage at browser lines 139-175 does not mount the Hub path.
- Correction: add a bounded PaneContainer/Hub browser integration case using the gate resolver and trusted `userEvent.click`, checking all four actions and no action when the gate returns undefined. Keep the current unit-level qualified-key test. Confidence: high.

### Low Priority Suggestions
**L1 — Lossy DOM ID sanitization creates collisions.**
- Evidence: `TerminalScrollButtons.tsx:71-72,150-156`.
- [INFERENCE] IDs containing `:` and `-` in the same position map to the same controls ID; distinct terminals across simultaneously mounted windows can produce duplicate IDs and ambiguous `aria-controls` references.
- Correction: use React `useId()` for per-instance linkage, rather than lossy resource-key sanitization. Quotes/brackets themselves do not require removal from HTML IDs when assigned through React. Confidence: high.

### Positive Observations
- Resolver is evaluated at action time; an explicitly supplied resolver returning undefined does not fall back to the registry (`TerminalScrollButtons.tsx:73,165-214`).
- PaneContainer passes its existing resolver rather than duplicating gate logic (`PaneContainer.tsx:122-130,529-534`).
- Listener cleanup, keyboard semantics, focus prevention, and all four scroll actions remain structurally intact.
- Full-target removal identity-checks the new alias before deleting it, preserving a replacement alias in that specific path.

### Recommended Actions
1. Fix H1; add negative ownership/lifecycle tests.
2. Make alias removal symmetric and test replacement preservation.
3. Add trusted Hub/PaneContainer interaction coverage; use per-instance accessible IDs.
4. Main: run UI typecheck, targeted registry/scroll-controls/PaneContainer/Hub-gate unit tests, then targeted Chromium scroll-controls integration tests.

### Metrics
- Type coverage / test coverage: not measured.
- Linting issues: not measured; no lint executed.
- Findings: 1 high, 2 medium, 1 low.

### Unresolved Questions
None; runtime validation evidence remains outstanding.
