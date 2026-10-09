# Research: Radix Dialog & WCAG Keyboard/Focus/Target Constraints

Date: 2026-10-09
Topic: Radix DialogContent keydown stopPropagation, explicit close autofocus, and WCAG target sizes.

## 1. Primary Sources Consulted
1. Radix UI Primitives — Dialog: https://www.radix-ui.com/primitives/docs/components/dialog
2. W3C WAI-ARIA Authoring Practices Guide (APG) — Dialog (Modal) Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

## 2. Keydown Event Propagation & Radix Dialog Dismissal
- **Mechanism & Contract**: Radix `DialogContent` integrates `DismissableLayer` and `FocusScope`. Native `Escape` capture operates directly within Radix's layer, properly closing the dialog and returning focus to the opener.
- **Intentional Shortcut Isolation**: Calling `stopPropagation()` on `DialogContent` keydown prevents modal keystrokes from leaking into background application listeners (e.g. active terminal sessions or window chords). In modal UI, this event isolation is an intended contract, not a defect.
- **Conditional Risks**:
  - Nested layers: If nested dialogs/popovers or compound menus are hosted within the modal, stopping propagation indiscriminately at the child boundary can prevent ancestor layer handlers from observing dismissal events if not using Radix layer branches.
  - Escape customization: If custom Escape cancellation is required, prefer Radix's explicit `onEscapeKeyDown={(e) => ...}` prop rather than manual keydown interception.

## 3. Focus Management & Close Autofocus
- **Radix Default Behavior**:
  - `onOpenAutoFocus`: moves focus to first focusable element inside dialog on open (preventable via `event.preventDefault()`).
  - `onCloseAutoFocus`: returns focus to `Dialog.Trigger` upon close (preventable via `event.preventDefault()`).
- **WAI-ARIA APG Requirements**:
  - Focus MUST return to invoking element on close unless:
    1. Invoking element no longer exists (must focus logical next element in flow to prevent focus dropping to `body`).
    2. Workflow explicitly moves to a subsequent step/element (e.g. selected newly opened tab/pane).
- **Explicit Close Autofocus Risks**:
  - If manual `.focus()` is called on close without calling `event.preventDefault()` inside `onCloseAutoFocus`, Radix default trigger restoration races custom focus, resulting in focus thrashing or focus staying on trigger.
  - If explicit focus target is null, disabled, or unmounted, focus is lost to `document.body` (violating WCAG 2.4.3 Focus Order).
- **Review Constraint & Minimal Fix**:
  - When redirecting focus on close: MUST use `onCloseAutoFocus={(e) => { e.preventDefault(); targetRef.current?.focus(); }}`.
  - Always guard target: verify candidate element is non-null, connected to DOM, and focusable before calling `.focus()`. Provide fallback to trigger or container if target missing.

## 4. WCAG Target Size & Keyboard Constraints
- **Target Size Norms**:
  - **WCAG 2.2 SC 2.5.8 (Level AA)**: Target size MUST be at least 24×24 CSS px, OR meet spacing clearance (24px circle without overlapping adjacent targets).
  - **WCAG 2.1/2.2 SC 2.5.5 (Level AAA)**: Target size 44×44 CSS px (also mobile HIG guideline).
  - **Evaluation for Compact Navigator**:
    - Mandating 44px controls satisfies AAA (SC 2.5.5), but exceeds AA baseline.
    - If UI space is constrained in a compact desktop navigator, 24×24px with adequate padding/spacing passes Level AA.
- **Keyboard Trapping & Navigation**:
  - **WCAG 2.1.1 (Keyboard)**: All compact navigator actions must be keyboard accessible (Tab, Enter, Escape).
  - **WCAG 2.1.2 (No Keyboard Trap)**: Focus must trap inside dialog while open, and Escape or Close button must release focus cleanly.
  - **WCAG 2.4.3 (Focus Order)**: Order of traversal must be logical; exit focus cannot drop to `<body>`.

## 5. Actionable Review Checklist for PR #52
1. **Keydown Handling**: Verify keydown `stopPropagation()` serves intentional modal shortcut isolation and does not interfere with nested layer branches or custom `onEscapeKeyDown` handlers.
2. **Close Autofocus**: If custom focus is applied upon close, verify `onCloseAutoFocus` calls `event.preventDefault()` to prevent Radix from forcing focus back to the trigger.
3. **Focus Target Guard**: Verify that if the target element was unmounted or replaced during navigation, a fallback target exists.
4. **Target Sizing**: Verify whether 44px requirement is intentional for AAA or whether 24px + spacing meets AA requirements for compact design.

## 6. Unresolved Questions
- Does closing the compact navigator unmount the opening trigger (e.g. switching active sidebar pane)?
- Is PR #52 strictly targeting WCAG Level AA (24px min) or Level AAA / mobile touch standards (44px min)?
