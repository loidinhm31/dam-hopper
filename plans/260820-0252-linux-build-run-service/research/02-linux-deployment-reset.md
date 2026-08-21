# Research index: Linux deployment and reset

Historical research index for a superseded predecessor plan. Current acceptance
status is maintained by `../../260820-0912-revalidation-build-run-service/`.

Full evidence: [linux-deployment-reset](../../reports/researcher-260820-0252-linux-deployment-reset.md).

Key constraints: systemd owns `/opt/dam-hopper` and runs the user-owned server
on loopback `4801`; legacy nohup uses `4800`; different ports do not make
shared SQLite access safe. Reset must stop/disable both owners, verify process,
listener, and database absence, quarantine only marker-verified deployment
assets, preserve runtime state, and leave unrelated Docker containers alone.
