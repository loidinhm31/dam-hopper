# Linux service re-audit

Date: 2026-10-11. User requested renewed service audit during plan validation.
Scope: repository and current local host, read-only. No stop/disable/remove/install/restart applied.
External OMP/Evcrate tooling is implemented in another project; excluded from DamHopper removal.

## Installed unit evidence
Observed via `systemctl list-unit-files 'dam-hopper*' '*advisor*' --no-pager` and `list-units --all`.

| Unit | Enablement | Observed state | Treatment |
|---|---|---|---|
| dam-hopper-api.service | enabled | active/running | Keep; coordinated deployment of rebuilt server |
| dam-hopper-web.service | enabled | active/running | Keep; coordinated deployment of rebuilt SPA |
| dam-hopper-idle-suspend-helper.service | enabled | active/running | Keep unchanged |
| dam-hopper-recovery.service | enabled | inactive/dead | Keep release recovery |
| dam-hopper-plugin-runner.service | enabled | inactive/dead | Obsolete installed unit; guarded operator cleanup gate |
| dam-hopper-idle-suspend-helper.socket | disabled | Not listed among loaded services queried | Keep unrelated helper socket support |

No dedicated unit matching `*advisor*` appeared in these system-level queries. This is not a scan of every user's systemd manager or every process.

## Installed obsolete runner
Read `/etc/systemd/system/dam-hopper-plugin-runner.service`.
- `PartOf=dam-hopper-api.service` (line5); reverse dependencies include API and multi-user.target.
- Runs as `dam-hopper-plugin-runner`, group `dam-hopper-plugins` (lines10-12).
- Uses `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf` (line15).
- ExecStart pins runner and bundled Node to `/opt/dam-hopper/releases/v0.8.4/both/bin/` (line29).
- Durable state `/var/lib/dam-hopper-plugin-runner` (lines19-24).
- Enabled means it remains configured for activation even though currently dead; source removal alone does not remove this installed unit.

## Current API/helper independence
Read installed API and helper units after systemctl reported their FragmentPath.
- API ExecStart/manager uses v0.12.0, HOME=/var/lib/dam-hopper, ordinary server config and runtime tmpfiles.
- Helper ExecStart uses v0.12.0 and shared idle-suspend socket, PID enrollment and audit path.
- Neither unit references `dam-hopper-plugins` or plugin-runner tmpfiles.
- API systemctl Requires/Wants/BindsTo/After has no direct requirement on runner; runner's PartOf relation is opposite-direction lifecycle linkage, not evidence API needs runner.
- Do not remove API/web/helper/recovery services to remove Advisor.

## Repository evidence
- `deploy/systemd/dam-hopper-api.service.in:24`: native server binary, no Advisor-specific unit.
- `deploy/systemd/dam-hopper-web.service.in:10`: dedicated static host, no Advisor-specific unit.
- `server/src/linux_release/constants.rs:77-82`: managed units are API/web/recovery/helper; runner excluded.
- Remaining runner symbols in manifest validation, stage/rollback rejection and runtime cleanup serve legacy release recognition/safe cleanup; not live native Advisor execution. Preserve unless a separately approved legacy-migration retirement changes that contract.
- `deploy/remove-plugin-platform.sh`: existing cleanup mechanism, default dry-run, explicit system/user scope, deployment lock and allowlist on apply.
- `tests/deploy/linux-release-remove-plugin-platform.sh`: user-data and shared IPC preservation regression coverage.

## Exercised dry run and limitation
Ran `bash deploy/remove-plugin-platform.sh --scope system`, without --apply.
Observed: would disable enabled runner and remove installed unit, multi-user.target enablement symlink, and `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`.
Exit1 after these observations; no success/complete cleanup claim.
`namei -l /var/lib/dam-hopper-plugin-runner` shows mode0700 owned by runner account/group.
[INFERENCE] Dry-run exits at script's state-directory `find ... | wc -l` under set-e/pipefail (line253), because current user cannot traverse owner-only state and stderr is suppressed. Privileged dry-run required for complete inspection; do not weaken permissions or suppress the failure.
No destructive command was executed. No service changes authorized by the audit request.

## Deployment action items
1. Build/qualify Advisor-free UI/server; deploy together through normal release manager. Retain current unrelated units.
2. As an authorized operator, run privileged dry-run of existing script and inspect exact allowlisted state; establish that no legacy client/service consumes it.
3. Obtain explicit approval before `--apply`; preserve account by default (no --purge-account), external ~/.evcrate data, release archives and shared IPC.
4. If approved, existing guarded cleanup disables/removes obsolete runner artifacts under deployment lock and reloads systemd. Verify runner unit/enablement absence and API/web/helper health, without logging secrets or personal data.
5. This is an installed-host action, not repository file deletion or removal of external tooling. No new cleanup script or Advisor-retirement product docs.

## Unresolved gates
Privileged full inspection and destructive cleanup approval are not performed. Source plan remains pending; this audit does not authorize deployment.
