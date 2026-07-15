# Shell lifecycle and marker security research

Date: 2026-07-16  
Scope: desktop Inline Terminal Suggestions; lifecycle integration only

## Recommendation

Adopt shell injection for bash, zsh, fish, and PowerShell, emitting OSC 633-compatible
lifecycle markers plus a Dam Hopper per-session nonce extension. Suggestions are enabled
only in a verified `Editing` state. Anything unsupported, ambiguous, nested, remote, or
out of sequence fails closed to an explicitly opened history picker.

Do not treat bare OSC 133/633 as a security boundary. Any foreground process can write
terminal escape sequences. The protocol is semantic metadata; nonce validation limits
accidental/child spoofing, while a same-user malicious process remains outside the
defended boundary.

## Protocol semantics

Official sequence meanings are consistent across FinalTerm-style OSC 133 and VS Code's
extended OSC 633:

| Sequence | Meaning | Suggestion state |
|---|---|---|
| `A` | prompt starts | preparing; still hidden |
| `B` | prompt ends / command-line editing starts | `Editing`, if verified |
| `E;<commandline>;<nonce>` | exact command interpreted by shell | verify/capture candidate history |
| `C` | pre-execution / output starts | immediately `Executing`; suppress input capture |
| `D;<exitcode>` | execution finished | not editable until next verified `A` then `B` |

OSC 633 `E` is materially better than reconstructing input: it carries the exact shell
command and supports an optional nonce specifically intended to prevent command spoofing.
VS Code calls the ideal order `A, B, E, C, D`; OSC 133 lacks `E` and nonce, so it should
be accepted only as reduced-quality metadata, never for automatic history capture.

Sources:

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Windows Terminal shell integration / OSC 133](https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration)

## Password and opaque-input boundary

The safety boundary is `C`, not output silence. Once the shell accepts a command, emit
nonce-validated `E`, then `C` before it executes. From `C` until a valid completion/prompt
transition, every keystroke is opaque and must bypass suggestions/history.

Consequences:

- `sudo`, `ssh`, credential prompts, REPL input, and interactive programs occur after
  `C`; their typed input is never recorded.
- A quiet long-running command remains `Executing`; no timeout may reopen suggestions.
- Alternate-screen entry, shell change, marker parse error, disconnect, replay attach,
  or impossible transition forces `Unknown/Disabled`.
- A remote prompt over ordinary `ssh` does not become editable merely because it looks
  like a prompt. Remote integration needs an explicit future protocol; Phase 1 stays off.
- History is committed only from a validated `E`, never from outgoing PTY bytes or `Enter`.

## Shell feasibility

### bash — feasible, highest compatibility risk

Use `PROMPT_COMMAND` to publish completion/prompt-start and a carefully chained `DEBUG`
trap or readline-aware wrapper for pre-execution. `B` can be embedded at the end of PS1.
Bash documents `PROMPT_COMMAND` as executed before each primary prompt and `DEBUG` as
running before simple/compound commands; the latter means recursion/internal-command
guards are mandatory. Preserve array/string `PROMPT_COMMAND`, existing traps, `set -T`,
and prompt framework behavior. Prefer adapting a proven integration script over a new
hook design.

- [GNU Bash variables (`PROMPT_COMMAND`)](https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html)
- [GNU Bash `trap` semantics](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html#index-trap)

### zsh — feasible, strong hooks

Register via `add-zsh-hook`: `precmd` for completion/prompt lifecycle and `preexec` for
exact submitted command/pre-execution. Emit `B` through prompt expansion. Hooks compose
better than overwriting user functions, but prompt/plugin reset and nested shells need
tests.

- [zsh hook functions](https://zsh.sourceforge.io/Doc/Release/User-Contributions.html#Hook-Functions)

### fish — feasible, cleanest lifecycle

Fish exposes `fish_prompt`, `fish_preexec`, and `fish_postexec`; `fish_preexec` receives
the command line and fires immediately before an interactive command, while `postexec`
fires afterward. Syntax errors have `fish_posterror`; empty commands do not trigger
pre/postexec, so prompt events must reset the state without inventing a submission.

- [fish event handlers](https://fishshell.com/docs/current/language.html#event-handlers)

### PowerShell — feasible, execution-policy/handler risk

Wrap the user `prompt` function without replacing its visible result; it reliably marks
readiness. Use the same PSReadLine integration strategy proven by VS Code for accepted
command/pre-execution rather than inferring from Enter. PSReadLine exposes command
validation and history callbacks, but replacing a user's singleton handler may conflict;
exact composition/version support needs a spike. Script injection can also be blocked by
PowerShell execution policy.

- [PowerShell prompt function](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_prompts?view=powershell-7.6)
- [PSReadLine options and handlers](https://learn.microsoft.com/en-us/powershell/module/psreadline/set-psreadlineoption?view=powershell-7.6)

## Marker parser and spoofing controls

Use a tiny explicit state machine, not regex over retained output:

`Unverified -> Prompt(A) -> Editing(B) -> Submitted(E+nonce) -> Executing(C) -> Finished(D) -> Prompt(A)`

Required controls:

1. Generate a cryptographically random nonce per PTY incarnation; inject it once, copy
   into shell-local state, then unset/export-remove it before user commands run.
2. Require nonce on `E` and preferably a Dam Hopper extension on every state-changing
   marker. Unknown OSC properties remain ignorable by other terminals.
3. Accept only bounded payloads and legal transitions; duplicate, skipped, oversized,
   malformed, replayed, or wrong-nonce markers force `Unverified` until a fresh handshake.
4. Invalidate nonce on respawn/recreate/restore. Never trust scrollback replay as live
   lifecycle: attach starts unverified and waits for a fresh marker handshake.
5. Parse OSC incrementally across PTY chunks with strict BEL/ST termination and length
   caps. Do not persist marker payloads or log command/nonce values.
6. Treat alternate-buffer activation as immediate suppression even with valid lifecycle.
7. Do not strip arbitrary OSC in the browser. Register a narrow xterm OSC 633 handler;
   keep lifecycle state outside history/search code and expose only typed events.

Nonce is defense-in-depth, not isolation: a hostile same-user process may inspect parent
state or deliberately imitate terminal output. Stronger assurance requires an out-of-band
shell-to-server channel, which is substantially less portable and YAGNI for this local
desktop feature. Document the trust model.

## Unsupported-shell fallback

- No silence heuristic and no automatic recording.
- Passive ghost hidden.
- Explicit history mode remains available only through deliberate UI invocation; it may
  copy or insert text but cannot execute.
- Surface integration status (`rich`, `basic/no-capture`, `unsupported`, `lost`) in terminal
  details, not as recurring toast noise.
- Shell/subshell/SSH transitions that lose markers downgrade immediately; recovery needs a
  new valid handshake, not elapsed time.

## Likely Rust PTY launch touchpoints

- `server/src/pty/manager.rs`: `PtySessionManager::create`, `build_command`,
  `apply_child_env`; select/inject the supported-shell script and nonce before spawn.
- `server/src/pty/manager.rs` supervisor respawn path: mint a new nonce and rebuild
  integration; never reuse creation-time trust state.
- `server/src/pty/session.rs`: `PtyCreateOpts`/`RespawnOpts` and session metadata may carry
  integration capability, but never expose nonce through serializable `SessionMeta`.
- `server/src/api/terminal.rs`: creation request boundary; server decides actual shell and
  capability rather than trusting a client claim.
- `server/src/persistence/restore.rs`: restored shell sessions start unverified and receive
  a new integration generation.
- `server/src/api/ws.rs` and PTY event sink: only needed if lifecycle is server-parsed and
  broadcast as typed events. Prefer browser xterm parsing for Phase 1 unless multiple
  clients must share authoritative lifecycle; it avoids modifying the raw PTY pipeline.

`portable_pty::CommandBuilder` already supports command arguments/environment, so launch
injection belongs beside existing command construction, not in terminal input handling:
[portable-pty CommandBuilder](https://docs.rs/portable-pty/latest/portable_pty/struct.CommandBuilder.html).

## Phase dependencies

1. **Security foundation:** protocol/state model, nonce lifecycle, trust statement, parser
   fuzz/unit tests, replay/respawn/alternate-buffer invalidation.
2. **Shell spike:** bash/zsh/fish/pwsh scripts against pristine and framework-heavy rc
   files; prove exact command and ordering before UI work.
3. **Integration:** launch detection/injection, typed lifecycle adapter, capability status.
4. **Suggestion/history:** only consume `Editing` and validated `E`; unsupported fallback.
5. **UX/geometry:** cursor ghost and explicit picker after safety gates pass.

## Principal risks

- Existing prompt frameworks overwrite hooks or reorder markers.
- Bash DEBUG traps can fire for integration internals and compound commands.
- PowerShell handler composition/version/execution policy reduces coverage.
- Marker spoofing is not preventable against malicious same-user code over one PTY.
- Replay, process respawn, or terminal reparent can accidentally retain stale trust.
- Exact multiline command encoding/decoding can corrupt boundaries if OSC 633 escaping is
  not implemented byte-for-byte.

## Unresolved questions

1. Is threat scope accidental leakage only, or hostile local commands too? The latter
   requires evaluating an out-of-band authenticated channel.
2. Must multiple attached browsers share one authoritative lifecycle state? If yes, parse
   on the Rust side; otherwise xterm-side parsing is simpler.
3. Which minimum shell versions and Windows PowerShell vs PowerShell 7 are supported?
4. May launch injection add shell arguments/environment, or must user profiles opt in?
5. Should OSC 133 ever enable passive ghost in `basic` mode, or remain decorations-only?
