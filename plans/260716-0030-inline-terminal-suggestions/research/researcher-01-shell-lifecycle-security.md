# Shell Lifecycle and Marker Security Research

Date: 2026-07-16  
Scope: desktop Inline Terminal Suggestions; lifecycle integration only

## Recommendation

Adopt supported-shell injection that emits OSC 633-compatible lifecycle markers plus a
Dam Hopper per-PTY-incarnation nonce. Suggestions are enabled only in verified `Editing`.
Unsupported, ambiguous, nested, remote, replayed, or invalid sessions fail closed to an
explicitly opened history picker.

Bare OSC markers are not a security boundary: any foreground process can emit terminal
sequences. Nonce validation limits accidental/child spoofing; malicious same-user code is
outside this portable design's defended boundary.

## Protocol Contract

| Sequence | Meaning | State effect |
|---|---|---|
| `A` | prompt starts | preparing; hidden |
| `B` | prompt ends/editing starts | `Editing` after verification |
| `E;<command>;<nonce>` | shell accepted exact command | validate/capture candidate |
| `C` | execution/output starts | immediately `Opaque` |
| `D;<exit>` | execution finished | wait for fresh `A -> B` |

Ideal order is `A, B, E, C, D`. OSC 633 `E` is preferable to reconstructed input because
it carries the exact command and optional nonce. OSC 133 lacks `E`/nonce and must not
authorize automatic history capture.

Primary sources:

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Windows Terminal OSC 133 integration](https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration)

## Password and Opaque-Input Boundary

`C`, not output silence, closes editing. From `C` until the next verified prompt, every
keystroke is opaque and bypasses suggestions/history.

- sudo/SSH/credential prompts, REPL input, and TUIs occur after `C`; never record them.
- a quiet running command remains opaque; no timeout can reopen suggestions.
- alternate buffer, shell change, parse error, disconnect, replay, or impossible transition
  resets to unverified.
- ordinary remote SSH prompts do not become editable without a future explicit protocol.
- commit history only from validated `E`, never outgoing PTY bytes or Enter.

## Shell Feasibility

| Shell | Integration | Main risk | Source |
|---|---|---|---|
| bash | `PROMPT_COMMAND`, prompt, guarded `DEBUG`/readline strategy | trap recursion/framework composition | [Bash variables](https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html), [trap](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html#index-trap) |
| zsh | `add-zsh-hook` `precmd`/`preexec`, prompt expansion | plugins reset/reorder hooks | [zsh hooks](https://zsh.sourceforge.io/Doc/Release/User-Contributions.html#Hook-Functions) |
| fish | `fish_prompt`, `fish_preexec`, `fish_postexec` | empty/error commands need prompt reset | [fish events](https://fishshell.com/docs/current/language.html#event-handlers) |
| PowerShell | prompt wrapper + proven PSReadLine strategy | singleton handlers/execution policy/version | [prompts](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_prompts?view=powershell-7.6), [PSReadLine](https://learn.microsoft.com/en-us/powershell/module/psreadline/set-psreadlineoption?view=powershell-7.6) |

Spike all four; ship only adapters that compose safely with user config and prompt frameworks.

## Parser and Spoofing Controls

State machine: `Unverified -> Prompt(A) -> Editing(B) -> Submitted(E+nonce) -> Opaque(C)
-> Finished(D) -> Prompt(A)`.

1. Mint cryptographically random nonce per PTY incarnation; remove it from child-visible
   exported environment after integration initialization.
2. Require nonce/generation on state-changing data; accept only legal transitions.
3. Bound payloads; parse across chunks with strict BEL/ST termination and escaping.
4. Malformed, duplicate, skipped, replayed, oversized, or wrong-nonce markers reset trust.
5. Respawn/restore mint new nonce; scrollback replay never restores live trust.
6. Never persist/log marker payloads, command content, or nonce.

Prefer server-side validation for shared authoritative session lifecycle. Preserve raw PTY
output and broadcast only typed capability/state events. A browser-only parser is simpler
but gives multiple attached clients independent trust state.

## Unsupported-Shell Fallback

- No silence heuristic, passive ghost, or automatic recording.
- Explicit history opens only by deliberate UI action; copy/use never executes.
- Expose quiet status: `rich`, `basic/no-capture`, `unsupported`, or `lost`.
- Lost integration requires a new handshake, never elapsed time.

## Likely Rust Touchpoints

- `server/src/pty/manager.rs`: command construction, child env, output parser feed, respawn.
- `server/src/pty/session.rs`: ephemeral capability/generation, never serializable nonce.
- `server/src/api/terminal.rs`: server-selected shell/capability.
- `server/src/persistence/restore.rs`: new generation and unverified restore.
- `server/src/api/ws.rs` / protocol: typed lifecycle events for attached clients.

`portable_pty::CommandBuilder` supports args/environment; inject beside existing command
construction, not terminal input handling: [CommandBuilder](https://docs.rs/portable-pty/latest/portable_pty/struct.CommandBuilder.html).

## Phase Dependencies

1. Security containment and protocol/state contract.
2. Shell adapter spike with pristine and framework-heavy profiles.
3. Launch injection, parser, typed lifecycle/capability event.
4. Suggestion/history controller consumes only `Editing` and validated `E`.
5. UX/geometry after safety gates pass.

## Principal Risks

- Prompt frameworks overwrite hooks or reorder markers.
- Bash DEBUG traps recurse; PowerShell handlers/policy reduce coverage.
- Same-user hostile code can imitate PTY output; nonce is defense-in-depth only.
- Replay/respawn/reparent may retain stale trust unless generation resets centrally.
- Multiline command encoding can corrupt boundaries without byte-exact escaping tests.

## Unresolved Questions

1. Accidental leakage only, or hostile local commands too?
2. Which shell/minimum-version matrix is required for v1?
3. May launch injection add args/environment by default, or require opt-in?
4. Should OSC 133 ever enable passive ghost, or remain decorations-only?
