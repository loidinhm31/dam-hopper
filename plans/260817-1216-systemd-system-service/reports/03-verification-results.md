# Phase 03 Verification Results

> Historical report from the superseded systemd planning sequence. Current acceptance status is maintained by the [successor revalidation plan](../../260820-0912-revalidation-build-run-service/plan.md).

- Date: 2026-08-19
- Evidence status: repository checks and test gate recorded; administrator acceptance pending
- Execution boundary: non-privileged checkout validation only
- Service state: no systemd unit installed or started by this repository
- Review base: `fa172856`; tracked diff checked from that base through working tree; untracked report checked explicitly

## Repository evidence

| Check | Status | Result |
| --- | --- | --- |
| Unit field/invariant assertions | PASS | `User=loidinh`, explicit HOME/XDG/config/web/work paths, `127.0.0.1:4801`, production auth guard, journald, `Restart=on-failure`, and SIGTERM fields matched. |
| Unit syntax/static verification | PASS with checkout note | `systemd-analyze --root=<temporary-root> verify dam-hopper.service` succeeded with a placeholder executable. Direct checkout verification returned the expected missing `/opt/dam-hopper/bin/dam-hopper-server` diagnostic. |
| Release server build | PASS | `pnpm build:server` exited 0. |
| Production web build | PASS | `pnpm build` exited 0 and produced the packaged web build. |
| UI stale-profile/localStorage test suite | PASS | `pnpm --filter @dam-hopper/ui test`: 173 files, 1,109 tests passed, 0 failed. |
| Backend and PTY lifecycle test suite | PASS | `pnpm test`: 762 tests passed, 2 ignored, 0 failed; PTY disposal/shutdown cases passed. |
| Lint | PASS | `pnpm lint` exited 0. |
| Rust formatting | PASS | `cargo fmt --manifest-path server/Cargo.toml --check` exited 0; the repository has no root `Cargo.toml`. |
| Development endpoint alignment | PASS | Root Vite dev, Vite proxy, and `dev:server` scripts explicitly use loopback `127.0.0.1:4801`; direct/legacy binary invocation remains `4800`. README/CLAUDE guidance matches. |
| Administrator handoff guard review | PASS (static) | Bash syntax covers `loidinh` runtime-state access/ownership, root-owned installed assets, fail-closed cgroup inspection, and service-user token access; administrator execution remains NOT RUN. |
| Changed-file whitespace check | PASS | `git diff --check fa172856` returned no errors; the untracked report was checked for trailing whitespace separately. |
| Scope check | PASS | Changed paths are limited to the approved service asset, dev-script/docs alignment, docs/plans, UI same-origin migration, and server shutdown/PTy hardening. |
| Runtime forbidden-pattern scan | PASS | No newly added `sudo`, privilege helper, environment file, shell `ExecStart`, PID file, wildcard bind, or no-auth flag in runtime/deployment files. |
| Credential and secret filename scans | PASS | No private-key material, credential prefixes, `.env`, or private-key filenames in the reviewed change. |

The previous isolated Phase 01 report remains useful evidence for a manual
non-privileged `loidinh` process on `127.0.0.1:4801`; it is not evidence of an
installed system unit, root-owned `/opt` assets, journald, or system-manager
enablement.

### Isolated `systemd-analyze` setup

The passing isolated verifier used a temporary root with the expected unit
directory, working/configuration directories, web directory, and binary path. It
copied `deploy/systemd/dam-hopper.service` into the staged unit directory and
copied `/usr/bin/true` to the staged binary path as a placeholder, then ran:

```bash
verify_root="$(mktemp -d)"
trap 'rm -rf -- "$verify_root"' EXIT
install -d -m 0755 \
  "$verify_root/etc/systemd/system" \
  "$verify_root/home/loidinh/.config/dam-hopper" \
  "$verify_root/opt/dam-hopper/bin" \
  "$verify_root/opt/dam-hopper/web" \
  "$verify_root/usr/lib/systemd/system"
install -m 0755 /usr/bin/true \
  "$verify_root/opt/dam-hopper/bin/dam-hopper-server"
install -m 0644 deploy/systemd/dam-hopper.service \
  "$verify_root/etc/systemd/system/dam-hopper.service"
cp -a /usr/lib/systemd/system/. "$verify_root/usr/lib/systemd/system/"
systemd-analyze --root="$verify_root" verify dam-hopper.service
```

The temporary root and placeholder are verifier inputs only; this check does
not install the production binary or modify host systemd state. On the
verification host, the command exited 0 with only unrelated missing dracut unit
diagnostics from the copied host unit definitions.

## Reproducible scope and secret checks

Run from the repository root. The Git commands use the repository-specific safe
directory because this checkout is owned by a different host identity. Negative
scans are expected to produce no output.

```bash
git -c safe.directory=/home/loidinh/WS/dam-hopper-ws/systemd-system-service diff --name-only fa172856
git -c safe.directory=/home/loidinh/WS/dam-hopper-ws/systemd-system-service diff --check fa172856
git -c safe.directory=/home/loidinh/WS/dam-hopper-ws/systemd-system-service diff --unified=0 fa172856 -- server deploy apps/web packages/ui \
  | rg '^\+[^+].*(sudo|pkexec|doas|EnvironmentFile=|ExecStart=.*(/bin/)?(ba)?sh|PIDFile=|--no-auth|0\.0\.0\.0)'
rg -n '[[:blank:]]$' docs/linux-systemd.md docs/system-architecture.md \
  plans/260817-1216-systemd-system-service/reports/03-verification-results.md
rg -n --hidden --glob '!*.lock' \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})' \
  docs/linux-systemd.md docs/system-architecture.md \
  plans/260817-1216-systemd-system-service/reports/03-verification-results.md
git -c safe.directory=/home/loidinh/WS/dam-hopper-ws/systemd-system-service ls-files \
  | rg '(^|/)(\.env($|\.)|.*\.(pem|key|p12|pfx|jks)$)'
node -e 'JSON.parse(require("fs").readFileSync("package.json", "utf8"))'
```

The reviewed untracked report is covered by the explicit `rg` checks above and
by the documented path list; it is not silently treated as part of a Git diff.

## Administrator evidence

All rows below are **NOT RUN** in this checkout. They require an authenticated
administrator, an explicit `4800` ownership handoff, and isolated state for any
restart-failure exercise.

| Required evidence | Status | Safety boundary |
| --- | --- | --- |
| Root-owned unit, binary, web tree, marker, and expected modes | NOT RUN | Do not infer from repository ownership or a staged temporary root. |
| `User=loidinh`, effective UID, enablement, main PID, and cgroup | NOT RUN | Requires installed system-manager state. |
| Exact `127.0.0.1:4801` listener, health, unauthenticated rejection, authenticated success | NOT RUN | Do not read or record token values or response bodies. |
| Journald lifecycle output without secrets | NOT RUN | Requires the installed unit and redacted journal excerpts. |
| Normal SIGTERM, active-PTY disposal, child process-group cleanup | NOT RUN | Use a disposable terminal and bounded stop; never use live shared state. |
| Controlled `Restart=on-failure` behavior | NOT RUN | Use isolated config and SQLite files; do not crash the live service. |
| Marker-guarded rollback, listener closure, and preservation of user state | NOT RUN | Remove only verified first-install assets; never remove user config, token, or databases. |

## Handoff and unresolved question

The administrator must return redacted command output for the acceptance rows,
retain the evidence in an agreed location, and keep the architecture marked
planned/uninstalled until the evidence is reviewed. No accepting administrator
or evidence-retention location is currently specified.
