# Research Report: Glanceable Host-Resource Panel UX

Research date: 2026-08-15

## Executive Summary

Use a two-tier panel: a small, stable “at a glance” strip first, followed by one compact disclosure for the remaining telemetry. Put the user’s requested decision signals in the strip: Memory used, CPU, selected/pinned filesystem usage with overall disk context in parentheses, all temperatures, and battery/power. Show each as label + numeric value + horizontal visual meter; keep units and timestamps explicit.

The key distinction is semantic: these are measurements in a bounded range, so native HTML `<meter>` is a better fit than `<progress>` (which communicates task completion). Pinning and filesystem selection are controls, separate from the meter itself. Missing or stale data must remain visibly and programmatically distinguishable from zero.

## Methodology

- Sources: W3C ARIA APG/WCAG and MDN HTML/ARIA references; checked 2026-08-15.
- Search terms: disclosure keyboard pattern, progressbar/meter semantics, status messages, dashboard chart labels.
- Scope: compact desktop/web monitoring UX; no implementation or product-specific visual audit.

## Key Findings and Recommendations

### 1. Information hierarchy

- Keep the first row limited to the requested metrics; order by operational urgency: Memory used, CPU, selected filesystem (overall disk in parentheses), temperatures, battery/power.
- Use a consistent metric card grammar: icon (decorative), short visible label, current number/unit, meter, and optional “updated N s ago” text. Avoid making color the only warning channel.
- Filesystem selection/pinning is preference state, not telemetry. Provide a clearly named control (“Choose filesystem”, “Pin metric”) adjacent to the metric; do not make clicking the meter toggle settings.
- Put all other telemetry in one “More host resources” disclosure rather than many nested accordions. Preserve the user’s open/closed and pin choices across refresh/session where feasible.
- At narrow widths, wrap cards into one column or a predictable grid; never shrink labels/numbers until unreadable. Allow the selected filesystem label to truncate visually but expose the full name to assistive technology.

### 2. Meter presentation

- Use percentage fill for CPU, memory used, filesystem used, and battery charge. Show the exact rounded percentage beside the bar; the bar is a scan aid, not the sole value.
- Use `<meter min="0" max="100" value="…">` for bounded measurements. MDN defines `<meter>` for a scalar value in a known range and distinguishes it from `<progress>`, which is for progress toward task completion: [MDN `<meter>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meter), [MDN meter role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/meter_role).
- For temperature, use a compact numeric value with unit and threshold state; a percent bar is misleading unless a meaningful bounded operating range is defined. Battery should include charging/discharging/AC state in text, not only a fill level.
- Configure low/high/optimum thresholds where product policy has meaningful boundaries; MDN documents these attributes for semantic range interpretation. Use text/icon plus color for warning/critical states.
- If custom SVG/CSS is necessary, replicate meter semantics (`aria-label`/`aria-labelledby`, min/max/now or `aria-valuetext`) and ensure the visible numeric value remains available. Native elements reduce recreated behavior.

### 3. Progressive disclosure and interaction

- The disclosure trigger must be a real button with a concise accessible name, `aria-expanded`, and optionally `aria-controls`; APG specifies Enter/Space toggling: [W3C APG Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
- Keep focus visible and predictable; all pin, select, and expand controls must be keyboard reachable and operable. APG explicitly requires keyboard operability for interactive components: [W3C APG Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).
- Use a separate pin button with pressed state (`aria-pressed`) and an accessible name that includes the metric (“Pin CPU metric”). Do not overload a generic icon-only control.
- Do not auto-expand on telemetry updates. If a critical alert occurs, expose a concise status update without stealing focus; avoid announcing every sampling tick.

### 4. Availability, staleness, and live updates

- “Unavailable” is not 0%: render a neutral empty/indeterminate visual, text such as “Memory — unavailable”, and retain the reason where useful (“permission denied”, “not reported”). Omit `value`/`aria-valuenow` when a meter is indeterminate rather than fabricating a number ([MDN progressbar semantics](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role)).
- Mark stale values with both text and visual treatment (“CPU 42% · stale 2m”) and preserve last-known value only when clearly labeled. Define a product freshness threshold per metric.
- Use a throttled, polite status/live region only for meaningful state transitions (unavailable, recovered, warning), not each sample. WCAG 2.2 requires status messages to be programmatically determinable without moving focus: [WCAG 2.2 SC 4.1.3](https://www.w3.org/TR/WCAG22/#status-messages).
- Include “Updated” metadata in the expanded detail for exact collection time/source. Consider a “refresh now” action only if collection latency or caching makes it useful.

### 5. Accessibility and responsive density

- Every meter needs an accessible name; prefer visible labels and `aria-labelledby` when custom markup is used ([W3C APG Names and Descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)).
- Do not put headings, buttons, or other semantic descendants inside an element with `role="meter"`/`role="progressbar"`; accessibility APIs treat descendants as presentational ([MDN progressbar](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role)). Keep label/value controls outside the meter element.
- Ensure contrast and non-color cues for threshold states; support forced colors and reduced motion. Prefer a static fill transition or honor `prefers-reduced-motion`.
- Maintain a sensible tab order: disclosure, filesystem chooser, pin controls, then details controls. Avoid a tab stop for purely decorative meters.

## Proposed information model

```text
Host resources
  Glance row: Memory used | CPU | Filesystem used (overall disk) | Temperatures | Battery/power
  [More host resources ▾]
    network, load averages, swap, per-core CPU, per-device disks, fan/sensor details, timestamps
```

## Decision guidance

- Default pinned metrics should be the requested five groups; user pinning changes order/visibility but never hides a critical unavailable/warning state.
- Treat storage as two related values: selected filesystem is the actionable meter; overall disk is supporting context in parentheses. Label both explicitly to prevent ambiguity.
- Keep sampling/render updates independent from preference state so refreshes do not reset expansion, selection, or pinning.

## Unresolved Questions

- What is the existing telemetry schema and freshness interval for each metric?
- Is “all temperatures” a fixed sensor set or dynamic sensor list, and what aggregation/threshold policy is expected?
- Should pinning persist per browser/device, per host, or per signed-in user?
- What are the intended warning thresholds for memory, CPU, storage, temperature, and battery?
