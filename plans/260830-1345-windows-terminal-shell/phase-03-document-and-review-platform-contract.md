# Phase 03 — Document and Review Platform Contract

## Context links

- Parent: [plan.md](./plan.md)
- Dependencies: [Phase 01](./phase-01-implement-windows-pty-contract.md), [Phase 02](./phase-02-verify-windows-terminal-regression.md)
- Public API: [`docs/api-reference.md:1170-1201`](../../docs/api-reference.md#terminals)
- Architecture gate: [`docs/system-architecture.md:293-316,1717-1739`](../../docs/system-architecture.md)
- Standards: [`docs/code-standards.md`](../../docs/code-standards.md)
- Locked scope: [preflight contract](../reports/preflight-260830-1345-windows-terminal-shell.md)

## Overview

- Date: 2026-08-30
- Description: Publish the smallest platform contract, reconcile architecture with implementation, and complete a release-focused side-effect review.
- Priority: P1
- Implementation status: Complete — conditional release approval
- Review status: Complete — release gates open
- Owner: Docs/release owner; owns `docs/api-reference.md`, architecture reconciliation, contract checklist, and final evidence audit.

## Key Insights

- Request/response JSON does not change, but `command` and omitted free-terminal `cwd` have platform-specific observable behavior and belong in API docs.
- Architecture text was updated before planning: shared command construction, Windows cwd/argv, and Unix-only integration are already the design source.
- No Mermaid edit is needed. The existing lifecycle state diagram remains correct because unsupported Windows shells stay `Unverified`.
- Product-grade closure requires checking negative space: auth, target containment, env, metadata, diagnostics, frontend, and Unix behavior.

## Requirements

1. Update only the terminal creation prose in `docs/api-reference.md`; preserve schema examples and idempotency/target text.
2. State exact Windows behavior without promising Git Bash, WSL, PowerShell, executable discovery, or quoting beyond cmd semantics.
3. State Unix behavior is unchanged, including existing free-terminal fallback and shell selection.
4. Reconcile implementation with the already-updated architecture text; fix code if implementation drift is unintended, docs only if design intentionally changed.
5. Complete every side-effect checklist item against diff and observed Phase 02 evidence.
6. No changelog unless the repository's established release process requires one for this bug fix; do not create a new documentation file.

## Architecture

### Accepted design

- API handler owns platform cwd default for untargeted sessions.
- PTY manager owns one platform command builder consumed by create and respawn.
- Shell-integration resolver owns the Windows unsupported boundary.
- portable-pty remains the process/PTY implementation.
- Session metadata retains the client-requested command (`"bash"`), while the builder selects native Windows `cmd.exe`; no schema migration or restore rewrite.

### Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Discover Git Bash/WSL/real Bash | Availability and quoting become nondeterministic; outside locked product contract |
| Add PowerShell policy | New shell/security/quoting contract; not needed for 500 |
| Use `/K <command>` | Turns one-shot commands into persistent interactive shells |
| Add `/D` opportunistically | Changes AutoRun behavior beyond preflight; evaluate separately if product requests it |
| Expand Windows env allowlist | Unproven root cause; sensitive launch-policy change |
| Frontend maps `bash` to `cmd.exe` | Duplicates platform policy and does not fix server/API callers |
| Separate create/respawn builders | Recreates the defect class |
| PTY abstraction/redesign | No need; portable-pty already supports native Windows PTY |

## Related code files

- Modify `docs/api-reference.md:1170-1201` — add concise cwd and command platform semantics under POST `/api/terminal`.
- Already modified at architecture gate: `docs/system-architecture.md:293-297` — Unix adapter scope; `:1717-1739` — shared builder and Windows contract.
- Review implementation: `server/src/api/terminal.rs:147-208`; `server/src/pty/manager.rs:1050-1055,3180-3317,3545-3604`; `server/src/pty/shell_integration.rs:58-167`.
- Review regressions: `server/src/api/tests.rs:3519-3747` and adjacent added tests; helper tests in the three implementation modules.
- Intentionally no change: frontend/TypeScript, auth/router/error modules, `PtyCreateOpts`/`RespawnOpts` schema, persistence database, env constants, Cargo dependencies.

## Implementation Steps

1. **Update terminal API prose.** Immediately after the request body/target rules, add a compact platform note:
   - For free terminals with omitted `cwd`, Windows chooses an existing user home then server current directory; Unix retains `HOME` then `/tmp`.
   - On Windows, empty or exact `bash` is an interactive shell-selector request and launches native `cmd.exe` without arguments. Other command strings execute as `cmd.exe /C <command>`.
   - Unix shell selection and command execution remain unchanged. Windows does not provide Unix shell lifecycle integration, so lifecycle-dependent suggestions/history stay unverified.
   - Do not change body/response JSON or imply real Bash discovery.
2. **Run architecture Gate 2 after implementation.** Compare source behavior and tests with `docs/system-architecture.md` bullets. If source diverged accidentally, fix source and rerun affected Phase 02 gates. Update architecture text only for an intentional, reviewed contract change.
3. **Complete the side-effect review checklist below.** Each checked item needs a diff location or Phase 02 evidence reference; unchecked hard items block completion.
4. **Audit evidence language.** Report only commands actually run, their platform, and observed result. Label unavailable Linux proof as blocking rather than inferred.
5. Mark implementation/review slices complete conditionally, while keeping unavailable release gates open. Do not mark the plan green or claim unrun criteria passed.

## Todo list

- [x] Add concise Windows/Unix note to terminal POST docs.
- [x] Preserve API schema, target, and idempotency prose.
- [x] Reconcile implementation against architecture Gate 2.
- [x] Complete side-effect checklist with observed evidence; retain unavailable gates unchecked.
- [x] Confirm rejected alternatives did not enter diff.
- [x] Audit verification claims for platform and actual execution.
- [x] Update plan statuses to conditional finalization without claiming hard gates passed.

## Side-effect review checklist

### Public/API boundaries

- [x] Request and response schemas unchanged; `command`, `cwd`, project, and worktree fields retain names/types.
- [x] Route and existing authentication middleware unchanged; no bypass/test hook in production.
- [x] Existing HTTP mapping remains: only early Windows no-valid-cwd failure is the same generic PTY/server error class.
- [x] Target/worktree resolution, canonical containment, and explicit cwd validation unchanged.
- [x] Untargeted explicit cwd remains passed through exactly as before.

### PTY lifecycle and state

- [x] Initial create and automatic respawn call the same `build_command` symbol.
- [x] `RespawnOpts` retains original command/cwd/env; no new persisted or public field.
- [x] Windows `""` and `"bash"` produce bare `cmd.exe`; other strings produce exactly `/C` plus one unchanged argument.
- [x] No `/D`, `/K`, PowerShell, Git Bash, WSL, executable probing, or frontend mapping added.
- [x] Windows `ShellIntegration::prepare` returns `None`; no `--rcfile`, `-i`, init script, nonce, or lifecycle capability.
- [x] Windows lifecycle remains `Unverified`; client suggestions/history therefore fail closed through existing behavior.
- [x] Reader, writer, resize, kill/remove, tombstone, persistence, restart counts, target-loss handling, and concurrency gates unchanged.

### Unix preservation

- [x] Non-Windows omitted free cwd still uses process `HOME`, otherwise literal `/tmp` (source-preservation review; no Linux execution claim).
- [x] Explicit Bash and empty interactive shell executable selection unchanged (source-preservation review; no Linux execution claim).
- [x] Noninteractive command remains `/bin/sh -c <original command>` (source-preservation review; no Linux execution claim).
- [x] Bash/zsh/fish adapters, args, temp assets, nonce, and lifecycle parser behavior unchanged (source-preservation review; no Linux execution claim).
- [ ] Unix-focused and full Linux server-suite evidence obtained on a Unix runner/CI — release gate open.

### Environment, diagnostics, security

- [x] `SAFE_BASELINE_ENV_VARS`, `apply_child_env`, request-env precedence, and env-file loading unchanged.
- [x] No environment value, auth secret, cwd detail, or new raw command is logged.
- [x] Existing `terminal.spawn_failed` diagnostic remains sanitized.
- [x] No dependency, config, permission, auth, database, migration, or network-listener change.

### Verification and cleanup

- [x] Focused Windows unit tests passed.
- [x] Focused authenticated Windows API regressions passed.
- [x] Actual Windows dev-mode smoke proved create → input/output → remove and one-shot output.
- [x] Windows format/check passed; full server suite is not green (641/667 passed, 26 unrelated path/CRLF/POSIX fixture failures) — release gate open.
- [ ] Linux focused/full-suite evidence obtained — release gate open.
- [x] Test/smoke sessions and server process cleaned up; no temporary source artifacts.
- [x] API and architecture docs match observed implementation, with no fabricated results.

## Conditional Release Gates

- Linux focused/full-suite validation remains open; no Unix runner/CI evidence is available.
- Authenticated MongoDB smoke remains open because `MONGODB_URI` and `MONGODB_DATABASE` were unset. A raw signing-secret request returned 401 and is not authenticated MongoDB evidence.
- Windows full-suite baseline remains open: 641/667 passed, with 26 unrelated path/CRLF/POSIX fixture failures.
- Therefore this phase is conditionally finalized, not green; release closure requires all three gates above.

## Success Criteria

- API reference documents exact platform behavior in a few durable paragraphs.
- Architecture and code agree on cwd precedence, argv, shared construction, and integration boundary.
- Every available side-effect item is checked with source/evidence; Linux execution gate remains explicitly unchecked.
- Diff remains server-side plus focused tests/docs; no prohibited alternative or unrelated cleanup.
- Final report distinguishes observed Windows evidence, unavailable Linux/CI and MongoDB evidence, and the 26-failure Windows baseline.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Docs imply real Bash on Windows | Wrong client/product expectations | Explicit selector-to-native-cmd wording and rejected discovery note |
| Architecture says shared path but code drifts | Restart-only failures return | Gate 2 symbol review and checklist |
| Checklist becomes ceremonial | Hidden boundary regression | Require diff/evidence reference per checked item |
| Linux proof omitted | Hard acceptance silently weakened | Keep phase/plan pending until Unix evidence exists |
| Over-document cmd quoting/security | Promise broader policy | State only argv dispatch; defer shell-language policy |

## Security Considerations

- Documentation must not normalize unauthenticated terminal creation; route remains protected.
- Avoid examples with destructive commands, secrets, or shell metacharacter edge cases.
- Do not claim `/C` sanitizes command content; it selects the native command interpreter for already-authorized terminal commands.
- Preserve fail-closed lifecycle wording for unsupported Windows shells.
- Side-effect review must verify target containment and secret-safe diagnostics, not only happy-path spawn.

## Next steps

After evidence-backed completion, implementation owner updates `plan.md` and phase statuses, then follows normal review/merge flow. Unresolved questions: whether the original browser request omitted cwd/HOME remains unobservable but non-blocking; real Bash/WSL support is intentionally a separate product decision, not follow-up scope for this plan.
