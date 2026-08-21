# Terminal QA report — systemd system service

> Historical QA report from the superseded systemd planning sequence. Current acceptance status is maintained by the [successor revalidation plan](../260820-0912-revalidation-build-run-service/plan.md).

Date: 2026-08-19. Mode: read-only repository validation. Includes the final
rerun after development-port and handoff hardening fixes.

## Test results overview

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm build:server` | 0 | release backend build pass |
| `pnpm build` | 0 | production web build pass |
| `pnpm --filter @dam-hopper/ui test` | 0 | 173 files; 1,109 passed; 0 failed |
| `pnpm test` | 0 | 762 passed; 0 failed; 2 ignored; doc-tests 0 |
| `pnpm lint` | 0 | pass; no reported warnings |
| `cargo fmt --manifest-path server/Cargo.toml --check` | 0 | pass |
| `git -c safe.directory=... diff --check fa172856` | 0 | pass |
| extracted `docs/linux-systemd.md` bash blocks + `bash -n` | 0 | pass |

Backend detail: 706 unit, 12 auth, 4 browser-debug, 1 compatibility, 9 fs-mutate,
13 fs-sandbox, 6 fs-upload, 5 streaming, and 6 websocket tests passed; one
compatibility test and one unit test ignored. No failure.

## Static/documentation validation

- Isolated verifier: exit 0. Fresh `mktemp` root, copied `/usr/lib/systemd/system`
  definitions, `/usr/bin/true` placeholder, staged unit and required directories.
  Only unrelated missing dracut definitions were printed.
- Development endpoint guidance: pass. Root `dev` explicitly sets the Vite
  backend URL and host to `127.0.0.1:4801`; server dev/no-auth/watch scripts use
  the same port, while direct/legacy invocation remains documented on `4800`.
- `docs/linux-systemd.md`: 800 lines; extracted Bash blocks pass `bash -n`.
- Handoff assertions: pass. Service-user runtime/file access and ownership/mode
  checks, root-owned bin-dir checks, service-user token access, and cgroup
  mount/status handling are present.
- Direct `systemd-analyze verify deploy/systemd/dam-hopper.service`: exit 1,
  expected only: `Command /opt/dam-hopper/bin/dam-hopper-server is not executable:
  No such file or directory`.
- Scope forbidden-pattern scan: no matches (rg exit 1, expected).
- Trailing-whitespace scan, secret scan, tracked secret-filename scan: no matches
  (rg exit 1, expected).
- Explicitly reviewed untracked `plans/260817-1216-systemd-system-service/reports/03-verification-results.md`;
  it contains no secret/whitespace matches and correctly marks administrator
  evidence NOT RUN.

## Worktree and evidence boundary

Final status showed pre-existing modified files in docs/package guidance and the
phase-03 plan, plus untracked `.codegraph/` and verification reports. No existing
files were edited by this validation; temporary verifier roots remain under
`/tmp` as harmless disposable output. No coverage report was configured by the
requested commands, so coverage percentages are unavailable.

Administrator installation, enablement, runtime, live port 4800, journald,
restart, effective UID, and rollback checks: **NOT RUN**. No host systemd unit,
`/opt`, `/etc/systemd`, user SQLite/token state, or live service was touched.

## Concerns / unresolved questions

- Exact worktree cleanliness before this run was not available because the
  repository requires the per-command safe-directory override; final status is
  reported without attributing those changes to validation.
- Coverage thresholds and performance requirements were not supplied.
