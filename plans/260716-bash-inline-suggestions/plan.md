---
title: "Bash Inline Terminal Suggestions"
description: "Add Bash lifecycle hook support for inline terminal suggestions while preserving zsh/fish behavior."
status: DONE
priority: P2
effort: 10h
branch: main
tags: [feature, backend, terminal, testing, docs]
created: 2026-07-16
updated: 2026-07-16 18:29:09 +0700
---

# Bash Inline Terminal Suggestions

## Overview

Add Bash support to the existing server-validated terminal lifecycle used by inline suggestions. Keep the current fail-closed client contract, zsh/fish behavior, shortcuts, default shell choice, and WebSocket schema unchanged.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Bash lifecycle support | DONE | 100% | 10h | [phase-01-bash-lifecycle-support.md](./phase-01-bash-lifecycle-support.md) |

## Scope

- In: Bash adapter selection, Bash lifecycle hook asset, server tests, docs updates, manual real-shell checks.
- Out: client shortcuts, default shell changes, new WS event schema, PowerShell, SSH/subshell support, terminal-byte command inference.

## Acceptance Summary

- Empty local interactive Bash sessions emit validated `A/B/E/C/D` lifecycle markers.
- Markers are stripped from terminal output and scrollback.
- Exact submitted command reaches existing `terminal:lifecycle` `submitted` event.
- zsh/fish behavior remains unchanged.
- Unsupported or ambiguous Bash states fail closed.

## Progress Notes

- Bash lifecycle support completed and marked DONE at 2026-07-16 18:29:09 +0700.
- Remaining work, if any, is limited to manual release validation already tracked elsewhere.

## Open Questions

- None. Scalar and array `PROMPT_COMMAND` are supported; existing `DEBUG` traps fail closed without replacement.
