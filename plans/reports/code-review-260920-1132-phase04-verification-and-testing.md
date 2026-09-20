# Code Review Report — Multi-profile Host Resources Phase 04: Verification and Testing

## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/browser-tests/host-resource-monitoring.browser.tsx`
  - `plans/260920-0137-multi-profile-host-resources/phase-04-verification-and-testing.md`
  - Reference files: `packages/ui/src/hooks/use-multi-host-resources.test.tsx`, `packages/ui/src/hooks/use-host-resource-alert-presentation.test.tsx`, `packages/ui/src/lib/host-resource-state.test.ts`, `packages/ui/src/components/organisms/HostResourceFleetCard.test.tsx`, `packages/ui/src/components/organisms/HostResourceFleetDeck.test.tsx`, `packages/ui/src/components/organisms/HostResourcePopover.test.tsx`, `docs/system-architecture.md`
- Lines of code analyzed: ~2,500 LOC (~750 LOC diff in browser test)
- Review focus: Phase 04 Multi-profile Host Resources watch verification, Chromium browser testing, security, accessibility, and tiered polling invariants.
- Updated plans: `plans/260920-0137-multi-profile-host-resources/phase-04-verification-and-testing.md`

### Score
**9.5 / 10**

### Overall Assessment
The Phase 04 verification changes in `packages/ui/browser-tests/host-resource-monitoring.browser.tsx` demonstrate exceptional test engineering. Rather than duplicating harnesses, the existing Chromium suite was cleanly extended with multi-profile mock scaffolding and 5 robust end-to-end tests covering view switching, tiered polling gating, independent per-profile unread state, responsive viewports (320x700 mobile and 1280x800 desktop), accessibility (contrast, target sizes, focus trap/restoration), and security (XSS escaping and offline action exclusion). All 14 preexisting single-profile browser tests remain intact and pass without regressions.

---

### Critical Issues (MUST FIX)
None.

---

### Warnings (SHOULD FIX)

1. **State mutation outside `act` in disconnect simulation**
   - **Location**: `packages/ui/browser-tests/host-resource-monitoring.browser.tsx:1504-1507`
   - **Details**:
     ```ts
     await act(async () => {
       useWorkbenchSelectionsStore.setState({ settingsProfileId: "refresh" });
       await nextAnimationFrame();
     });
     useWorkbenchSelectionsStore.setState({ settingsProfileId: null });
     ```
     `settingsProfileId: null` is set outside `act()`. While Vitest/Chromium currently passes without warning, setting reactive store state outside `act` can cause unbatched render warnings in stricter React environments.
   - **Recommendation**: Wrap cleanup inside `act`:
     ```ts
     await act(async () => {
       useWorkbenchSelectionsStore.setState({ settingsProfileId: null });
     });
     ```

---

### Suggestions (NICE TO HAVE)

1. **Clarify contrast ratio threshold categorization**
   - **Location**: `packages/ui/browser-tests/host-resource-monitoring.browser.tsx:528-542`
   - **Details**: `assertNormalTextContrast` relaxes contrast threshold to `3.0:1` for elements matching `.text-muted`, `text-[10px]`, `text-[11px]`, or `role="status"`. While compliant with WCAG 2.1 SC 1.4.11 for UI components and badges, an explanatory code comment clarifies intentional divergence from 4.5:1 body text.
2. **Document pill target size expectations**
   - **Location**: `packages/ui/browser-tests/host-resource-monitoring.browser.tsx:1738-1743`
   - **Details**: Action buttons (`trigger`, `closeBtn`, `inspectAlpha`) assert 44x44 minimum size, while toolbar pills assert height >= 24px. Documenting the WCAG 2.5.8 inline/pill exception will assist future maintenance.

---

### Positive Observations

- **Zero Regression on Single-Profile**: All 14 prior single-profile Chromium tests pass unchanged via default `null` fallback in the mock.
- **Tiered Polling Invariant Defended**: Strict assertions verify `useHostMetrics` is disabled in Fleet Deck, enabled only for active connected drilldowns, switches target owner upon profile switch, and immediately disables upon disconnect or modal close.
- **Robust Security Proof**: Explicit validation that untrusted markup (`<script>`, `<img onerror>`) is escaped and renders strictly as text nodes without DOM injection, and that offline hosts expose no action controls.
- **Unread Bucket Isolation**: Proves that opening Fleet Deck clears 0 unreads, inspecting Profile A clears Profile A unreads only, and Profile B unreads remain intact.
- **Focus & A11y Verification**: Real browser keyboard navigation (`Enter` on pill, `Escape` to close) with verification that focus returns to the popover trigger button.

---

### Recommended Actions

1. Wrap the trailing `useWorkbenchSelectionsStore.setState({ settingsProfileId: null })` inside an `act` block during the next integration pass.
2. Maintain the focused Vitest unit and browser commands as the durable regression gate for host resource monitoring.

---

### Metrics & Validation Results

- **Unit & Component Tests**:
  - Command: `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-multi-host-resources.test.tsx src/hooks/use-host-resource-alert-presentation.test.tsx src/lib/host-resource-state.test.ts src/components/organisms/HostResourceFleetCard.test.tsx src/components/organisms/HostResourceFleetDeck.test.tsx src/components/organisms/HostResourcePopover.test.tsx`
  - Result: **6 test files passed, 83 tests passed (0 failed)** in 962 ms.
- **Browser Chromium Tests**:
  - Command: `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/host-resource-monitoring.browser.tsx`
  - Result: **1 test file passed, 19 tests passed (0 failed)** in 3.95 s.
- **Type Checking**:
  - Command: `pnpm --filter @dam-hopper/ui exec tsc --noEmit`
  - Result: **0 errors**, clean exit.
- **Task Completeness**: 10/10 todos in `phase-04-verification-and-testing.md` completed.

---

### Unresolved Questions

None.
