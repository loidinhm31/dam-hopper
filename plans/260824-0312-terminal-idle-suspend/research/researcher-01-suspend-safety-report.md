# Research Report: Safe idle-triggered Linux suspend

Timestamp: 2026-08-24 (Asia/Ho_Chi_Minh)

## Executive summary

`rtcwake -m mem -s N` programs an RTC alarm for N seconds from now, then requests
Linux suspend-to-RAM (ACPI S3 where supported). It is host-wide: every process and
terminal is suspended, and the command cannot atomically prove that no new terminal
started after the UI's observation. The server therefore needs a final, serialized
recheck immediately before handing off to a privileged helper.

Recommend a small root-owned systemd service/helper exposing one fixed operation
(validated seconds, no shell, no arbitrary arguments), invoked by the server through
a narrowly scoped Unix socket or systemd D-Bus/logind API. Prefer logind's `Suspend()`
when the configured wake deadline can be managed separately; use `rtcwake` only when
RTC wake is a hard requirement and the host passes preflight. Never grant the web
server unrestricted `sudo rtcwake`.

## Key findings

1. `-s` is relative seconds; `-m mem` means suspend-to-RAM. `rtcwake` also supports
   `-n/--dry-run`, `show`, and `disable`; alarm/suspend behavior depends on RTC and
   platform support ([rtcwake(8)](https://man7.org/linux/man-pages/man8/rtcwake.8.html)).
2. RTC capability is not universal: RTC hardware may lack an IRQ/alarm, and some PC
   RTCs have a limited maximum future alarm window ([Linux RTC docs](https://docs.kernel.org/admin-guide/rtc.html)).
3. `mem` is not one fixed implementation. Kernel-supported states are visible in
   `/sys/power/state` and the selected suspend variant in `/sys/power/mem_sleep`;
   systemd can try configured states and abort if none work
   ([systemd-sleep.conf(5)](https://man7.org/linux/man-pages/man5/systemd-sleep.conf.5.html),
   [kernel sleep states](https://dri.freedesktop.org/docs/drm/admin-guide/pm/sleep-states.html)).
4. logind has `CanSuspend()` for support/authorization and `Suspend()` for the
   operation. Calls can be denied/challenged and may honor active inhibitors;
   `PrepareForSleep(true/false)` signals provide lifecycle observability
   ([logind API](https://wiki.freedesktop.org/www/Software/systemd/logind/)).
5. A sleep inhibitor can block or delay suspend. Delay inhibitors are bounded by
   `InhibitDelayMaxSec` (default 5 seconds); block inhibitors can prevent the request
   unless an explicitly privileged override is used ([systemd-inhibit](https://www.freedesktop.org/software/systemd/man/250/systemd-inhibit.html)).
6. polkit is the intended authorization boundary for privileged mechanisms. Rules are
   administrator-owned under `/etc/polkit-1/rules.d`; avoid shipping a broad rule or
   allowing arbitrary user-controlled action details ([polkit manual](https://polkit.pages.freedesktop.org/polkit/polkit.8.html)).
7. A server-side count of “running terminals” is not sufficient by itself: a terminal
   can be created between count and suspend, a websocket can disconnect while its PTY
   remains alive, and a PTY can exit without a clean websocket close.
8. RTC alarm programming and suspend should be treated as a single pending operation
   with an idempotent request ID. Cancellation before helper handoff is reliable;
   cancellation after alarm programming/suspend entry is not guaranteed. On cancel,
   invalidate the request, re-read terminal state, and disable/replace the alarm only
   if the helper reports it is still pending.

## Recommended state machine

`IdleObserved -> Arming -> FinalRecheck -> HandedOff | Cancelled | Failed`

Maintain the terminal registry in one server-owned synchronized state. Every terminal
create/start, PTY exit, and terminal teardown increments a generation counter. The
arming request captures that generation, waits a short configurable grace period,
then under the same lock verifies: (a) terminal count is zero, (b) generation is
unchanged, (c) no active websocket/PTY cleanup is pending, and (d) host preflight
still passes. Release the lock only after atomically marking the request `HandedOff`;
the helper must revalidate its request token and reject stale/cancelled requests.

After handoff, emit structured events (`suspend_requested`, `suspend_rejected`,
`suspend_entering`, `suspend_resumed`) with request ID, terminal generation, delay,
helper exit status, and sanitized error. Do not log command-line secrets (there
should be none). On resume, rebuild terminal/PTY state and expose that the host may
have suspended; do not assume websocket continuity.

## Practical options

| Option | Benefit | Cost/risk | Recommendation |
|---|---|---|---|
| `rtcwake` via unrestricted sudo | Fast to prototype | Shell/argument escalation, race, RTC/platform failures | Reject |
| Fixed root-owned helper + Unix socket/systemd activation | Small API, exact allowlist, audit-friendly | Packaging/configuration work | Preferred for this feature |
| logind D-Bus `Suspend()` + separate wake scheduler | Native auth/inhibitors, clear signals | Wake scheduling is separate; RTC still needs capability | Preferred if wake deadline is optional |
| Server-owned systemd unit with `ExecStart=rtcwake` | Good journald lifecycle | Still needs a safe request API and validation | Viable implementation detail |

## Safety defaults and preflight

- Feature disabled by default; require explicit host configuration and an upper bound
  (for example 24 hours) on seconds. Reject zero, negative, overflow, and non-integer input.
- Require an explicit “allow host suspend” setting and a dry-run/support check at
  startup or before each request. Check `rtcwake --list-modes`, RTC device/alarm
  availability, `/sys/power/state`, and logind `CanSuspend()` where applicable.
- Refuse if any terminal is running, starting, stopping, reconnecting, or has unknown
  state. Add a conservative grace period and make cancellation win over arming.
- Do not bypass inhibitors by default. Surface the inhibitor owner/reason and fail
  closed; an administrator-only override should be separate and auditable.
- Run helper as root (or a dedicated narrowly privileged service), with fixed argv,
  absolute executable path, sanitized environment, timeout, `NoNewPrivileges` where
  compatible, and systemd hardening. The unprivileged server gets only the specific
  D-Bus/socket permission, never generic sudo access.
- Treat suspend failure, wake-alarm failure, and post-resume inconsistency as normal
  reported states; never retry in a loop. Require operator-visible audit logs.

## Unresolved questions

- Should the product support wake-at-deadline when RTC is unavailable, or fail closed?
- Does the deployment already run as a system service with logind/polkit access, and
  can administrators install a root-owned helper/unit?
- Is the requested timer always relative seconds, or should an absolute wall-clock
  deadline (with clock-change handling) be supported?
- Must existing PTYs survive resume, or should all terminals be treated as stale and
  recreated after wake?
