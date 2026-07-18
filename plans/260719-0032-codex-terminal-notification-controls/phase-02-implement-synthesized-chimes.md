# Phase 02 — Implement selectable synthesized chimes

## Context Links

- [Scout report](../reports/scout-260719-0032-codex-terminal-notification-controls.md)
- [Current sound helper](../../packages/ui/src/lib/terminal-notification-sound.ts)
- [Sound tests](../../packages/ui/src/lib/terminal-notification-sound.test.ts)
- [Previous chime plan](../260716-0204-terminal-notification-sound/phase-01-implement-and-validate.md)

## Overview

- **Date:** 2026-07-19
- **Priority:** P2
- **Status:** Completed 2026-07-19 01:22 +0700
- **Goal:** Evolve the one-tone helper into a small, deterministic Web Audio pattern scheduler without adding audio files or dependencies.

## Key Insights

- The current Default sound is an 880 Hz sine oscillator, 0.32 seconds, at normalized selected volume through one reusable context.
- Web Notifications cannot select an OS/native popup sound. These controls govern DamHopper's best-effort in-app Web Audio only.
- Synthesized patterns are selected over sound files: no asset download/404/cache state, licensing, or new bundle/dependency cost; files remain a deferred product option if users later require custom timbre.

## Requirements

- Preserve the exact existing Default pattern as the compatibility baseline.
- Add Soft, Two-tone, and Urgent patterns using fixed frequencies, durations, offsets, and envelopes; no user-editable synthesis inputs.
- Apply volume uniformly to each note, preview the chosen pattern, reuse one context, and tolerate unavailable APIs, suspended contexts, autoplay rejection, and node failures as no-ops.
- Keep rapid notification behavior bounded: every created oscillator/gain disconnects after its scheduled end or a scheduling failure.

## Architecture

`play(pattern, volume) → reusable AudioContext → immutable pattern definition → schedule note(s) → gain envelope → destination → onended cleanup`.

Represent a pattern as typed note descriptors (`frequency`, `startOffset`, `duration`, optional waveform/envelope); map the four literal IDs exhaustively. Default remains one descriptor matching the existing implementation. This stays data-driven and avoids four duplicated scheduling branches.

## Related Code Files

- Modify: `packages/ui/src/lib/terminal-notification-sound.ts`.
- Modify tests: `packages/ui/src/lib/terminal-notification-sound.test.ts`.
- Create/delete: none; deliberately no `public/` or audio-asset files.

## Implementation Steps

1. Import/redeclare the shared pattern type without introducing a circular UI dependency; expose a typed default constant if that best preserves module boundaries.
2. Refactor scheduling from a single hard-coded oscillator into validated fixed pattern descriptors and a single note scheduler.
3. Retain Default's 880 Hz/0.32 second sine schedule and current volume normalization exactly.
4. Define Soft (lower/quieter short tone), Two-tone (two ordered notes), and Urgent (short repeated high-priority cadence) with stable constants; total durations remain short and bounded.
5. Change `TerminalNotificationSound.play` and `playTerminalNotificationSound` to accept pattern plus volume while keeping a backward-compatible default argument where useful for focused callers/tests.
6. Expand mocked-AudioContext tests for each descriptor schedule, volume zero, suspended resume, rejected resume, unavailable API, and cleanup on failures.

## Todo List

- [x] Add exhaustive fixed pattern map.
- [x] Preserve Default waveform/timing exactly.
- [x] Schedule and clean multi-note patterns safely.
- [x] Cover fallback and error paths with unit tests.

## Success Criteria

- The Default test remains semantically identical to the current sound test.
- Each non-default selection produces its intended fixed note sequence at the configured volume.
- No file fetch, asset URL, permission request, or new package is introduced.
- Unsupported, SSR, blocked-autoplay, zero-volume, and node-error paths do not throw or suppress notification delivery.

## Risk Assessment

- **Audio overlap/noise:** short fixed envelopes and existing channel switch limit output; do not add a queue or audio-rate limiter without a demonstrated need.
- **Mock brittleness:** assert schedule shape, not browser implementation details.
- **Context state race:** re-check `running` after `resume`, preserving current no-op behavior.

## Security Considerations

- Patterns are compile-time constants. No URL, blob, user data, terminal payload, or filesystem input reaches Web Audio.
- Failures remain silent and local; diagnostics must not record raw terminal content.

## Next Steps

Use the persisted pattern and channel preferences in the notification fan-out and settings form in Phase 03.
