# Phase 04 — Documentation, Environment Examples, and Integrated Acceptance

Priority P2 · Status pending · Effort 2h

## Context and requirements
- [Overview and final decisions](./plan.md), [resolver](./phase-01-resolver-and-precedence-matrix.md), [startup](./phase-02-runtime-startup-wiring.md), [test scope](./phase-03-integration-and-failure-contract.md).
- Current documentation contradicts the new default in README, canonical auth environment guide, standards, codebase summary, deployment guide, Linux systemd guide, and auth architecture. Update shipped guidance together, not historical plan/report records.
- `deploy/server.env.example` currently enables Mongo by default through uncommented URI/database lines. A supposedly SQLite-default example must not continue to configure Mongo implicitly.
- Current `dam_hopper_config_dir()` uses XDG_CONFIG_HOME then home/.config; report's Windows APPDATA assertion is not implemented. Preserve resolver; do not introduce a platform-path feature through documentation.

## Task: document-backend-selection
Docs owner writes these existing files only:

| File | Required change |
| --- | --- |
| `README.md` | Rename authenticated-local subsection as appropriate; explain zero-Mongo default SQLite; explicit true optional override; preserve account-approval/MFA links and bypass warning |
| `docs/configuration/server-environment-auth.md` | Canonical complete precedence matrix, genuinely-unset vs malformed blank distinction, no implicit Mongo database-name default, explicit enforcement, error guidance, logs, independent state and unchanged key/path/approval runbooks |
| `docs/code-standards.md` | Replace Mongo-default/no-autodetection rule with approved config-only selection, never connection-failure fallback; preserve local-file/single-process/security policy |
| `docs/codebase-summary.md` | Reflect SQLite unconfigured default and automatic complete-Mongo choice; preserve service/adapter/security boundaries |
| `docs/architecture/authentication-state-and-cryptography.md` | Update config module map, startup sequence, explicit/default selection, single selected store, fatal connectivity check versus unchanged index warning, no-auth separation; preserve schema and existing crypto facts |
| `docs/deployment-guide.md` | Equal single-node production SQLite/Mongo recipes; Mongo no longer labeled global default; explicit false enforcement recommendation for Mongo operators; absolute private SQLite storage and mandatory MFA key |
| `docs/linux-systemd.md` | Align server.env examples/headings and operational limits; service-local persistent file, one process, no clustered/shared filesystem SQLite |
| `deploy/server.env.example` | Comment BOTH Mongo settings by default, document pairwise opt-in; optional explicit true for SQLite or explicit false for required Mongo; absolute SQLite path advice; retain mandatory MFA key placeholder and CORS |
| `docs/CHANGELOG.md` | Dated release note for changed default and malformed-config failure contract, no migration/fallback; only observed verification claims |

### Ordered steps
1. Read current target sections before edits; update auth architecture's proposed startup boundary first within this implementation phase, then reconcile other docs to the same final contract. No duplicate canonical matrix authority: full matrix lives in auth environment guide, other docs summarize/link it.
2. Explain automatic startup: only genuinely unset BOTH Mongo variables → SQLite; `MONGODB_URI=`/whitespace is an error rather than a way to choose default SQLite. Explicit true ignores any Mongo env. False enforces complete Mongo and fails otherwise. Driver validates malformed URI/connectivity; neither error falls back.
3. Show two production examples, each with valid externally provisioned MFA key: SQLite single-node without selector or Mongo variables, explicit private absolute path recommended; Mongo with BOTH nonblank values, optional false as an intentional enforcement safeguard. If switching an existing config to SQLite, explicitly true or remove BOTH Mongo assignments entirely, not leave blank lines/values.
4. Show exact default-vs-explicit SQLite log strings and selection reason. Document intentional compatibility behavior: configured Mongo unchanged, unconfigured development/production now opens SQLite (production only with valid key); blank Mongo values now rejected per coordinator refinement.
5. Preserve disabled registration, approval/admin promotion and mandatory TOTP flows; refer to canonical runbook rather than adding a second account-bootstrap procedure. Backend switch means independent identities and sessions, not data migration or loss of old store contents.
6. Preserve local-file single-server operational constraint; do not claim a new cross-process lock, cluster safety, network-filesystem detection or runtime ownership enforcement. Recommend Mongo for multi-node shared identities. Back up SQLite and its MFA key coherently using existing runbook; no novel migration/backup tooling.
7. Describe resolved default directory using actual config resolver, including XDG override, without repeating unsupported APPDATA claims as fact. Do not change global resolver or password hashing to match report inaccuracies.
8. Update changelog only after implementation result exists; distinguish authored tests from executed evidence. Do not increment version or change release manifests for this task.
9. Audit remaining live docs/example references to Mongo as unconditional default or unset/empty/false equivalence. Historical reports/plans remain untouched. If an additional active file needs edits, coordinator must explicitly extend allowed_files before edits; never silently broaden directory ownership.

### Compatibility and rollback documentation
- Recommend `DAM_HOPPER_LITE_MODE=false` to Mongo operators who must detect accidentally omitted configuration.
- No Mongo outage-triggered SQLite file or fresh account universe; no automatic state copy on switching.
- Stop process before binary rollback; retain auth.db and encryption key. Old binaries need explicit true to reopen SQLite; Mongo restart needs original pair and existing matching MFA key. Do not delete either backend or regenerate key to make startup succeed.

## Task: qualify-backend-selection
Verification-only; no product file ownership. Coordinator runs once after all implementation/test/docs edits and after required test skill policy is loaded. Workers do not independently run overlapping builds/suites. Record evidence in coordinator-owned reports under this selected plan; report creation/ownership is assigned separately, not an implicit writable-directory grant to this task.

Required integrated checks (commands are planned, NOT executed by plan author):
1. `cargo check --manifest-path server/Cargo.toml --bin dam-hopper-server`.
2. `cargo test --manifest-path server/Cargo.toml --lib auth::config::tests` and `cargo test --manifest-path server/Cargo.toml --bin dam-hopper-server`.
3. `cargo test --manifest-path server/Cargo.toml --test auth_backend_startup -- --test-threads=1` with isolated real Mongo service input specified by the new tests; list every matrix case and skipped/unexercised branch.
4. `cargo test --manifest-path server/Cargo.toml --test auth_lite_mode --test auth_no_auth --test auth_sqlite_store`.
5. `cargo test --manifest-path server/Cargo.toml` for server regression scope with isolated Mongo configured as required by existing fixtures. A skip-enabled zero exit is not evidence that Mongo tests executed.
6. `pnpm --filter @dam-hopper/ui test:e2e:typecheck`; `pnpm --filter @dam-hopper/ui test:e2e:probes`; `pnpm --filter @dam-hopper/ui test:e2e -- sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`. Required container engine/images and browser must be available; do not invent alternate mock qualification.
7. Inspect final docs against actual enum/error/startup log strings and run the repository's installed docs-link validator only if discovered/supported. Do not assume a missing command or install tooling.
8. Independent implementation review covers env precedence, credential redaction, Mongo ping vs index-warning distinction, bypass/key ordering, process isolation and historical-plan noninterference. Required source/doc drift reconciliation before acceptance.
9. Record real clean-default SQLite startup and restart, valid production key, complete Mongo startup, unreachable Mongo failure/no fallback, and no-auth bypass. Existing process integration/E2E evidence may supply these smoke outcomes if actual binary/real backend observables are recorded; no duplicate manual run solely for ceremony.

Failures block implementation acceptance; repair only within authorized scope, then collect fresh affected evidence. No skipped live Mongo or unexercised Windows behavior may be described as passed. Windows default-directory consistency requires source review; native-platform runtime claims require actual host evidence.

## Risks and ownership
- Avoid copy-paste examples leaving BOTH Mongo lines active in the advertised default SQLite recipe.
- Docs must distinguish fatal parse/connectivity from warning-only index initialization; neither implies fallback.
- Docs owner exclusively owns listed documentation/example files. Verification coordinator owns checks/review; no competing suites while edits are in flight.
- Rollback docs with source contract; preserve canonical links and account operations. No destructive Git actions, data deletion or commits authorized.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "document-backend-selection",
    "title": "Update canonical backend guidance, deployment examples and release notes",
    "blocked_by": ["cover-startup-contract", "audit-container-backends"],
    "allowed_files": ["README.md", "docs/configuration/server-environment-auth.md", "docs/code-standards.md", "docs/codebase-summary.md", "docs/architecture/authentication-state-and-cryptography.md", "docs/deployment-guide.md", "docs/linux-systemd.md", "deploy/server.env.example", "docs/CHANGELOG.md"],
    "constraints": ["Docs owner alone writes product docs; retain canonical account/key/backup runbooks and no-auth restrictions.", "Document coordinator refinements: set-blank Mongo is malformed, single-process is operational only, index errors retain warning policy.", "Preserve actual config-directory/cryptography behavior; no platform resolver, password hashing, version or manifest changes.", "No edits to historical plans/reports; additional writable files require coordinator scope revision."],
    "acceptance": ["All listed live guidance agrees on default SQLite, complete-Mongo automatic selection, explicit selector precedence and actionable errors.", "Default environment example no longer configures Mongo implicitly; both supported production recipes require valid MFA key.", "Independent datastores, no fallback/migration, one-process local-file limits and rollback enforcement are explicit.", "Changelog describes changed default without fabricated validation claims."],
    "verification": ["Coordinator compares docs/examples with final resolver cases and observed startup diagnostics.", "Coordinator checks relative links using an existing discovered repository validator or documents manual link inspection; does not invent a tool result."]
  },
  {
    "id": "qualify-backend-selection",
    "title": "Collect integrated resolver, runtime, datastore and documentation acceptance evidence",
    "blocked_by": ["document-backend-selection"],
    "allowed_files": [],
    "constraints": ["Verification-only task; coordinator separately owns evidence/report writes and required reviewer/tester orchestration.", "Run coherent checks only after all scoped edits; no fake backend success, silent skips or credentials in reports.", "Do not approve implementation with failed required gates; planning approval is not implementation or Git authorization."],
    "acceptance": ["Compile, matrix, real-binary SQLite/Mongo success/failure, bypass/key, restart and existing auth regressions have exact recorded outcomes.", "Container fixture/typecheck/journey and source/docs review outcomes identify all failures, skips, prerequisites and platform evidence limits.", "Every overview acceptance criterion maps to actual evidence; no SQLite fallback or unsupported runtime-lock claims remain."],
    "verification": ["Execute the exact scoped cargo and pnpm commands enumerated above and record exits, per-case outcomes and real service prerequisites.", "Require independent implementation review and source/docs drift reconciliation; acceptance blocked on unresolved severe findings or missing required runtime evidence."]
  }
]
```

- [ ] <!-- evcrate-task:document-backend-selection --> Update live docs, environment examples and changelog
- [ ] <!-- evcrate-task:qualify-backend-selection --> Collect integrated acceptance evidence

## Unresolved questions
None for product semantics after coordinator refinements. Independent plan review/final validation remain coordinator-owned pending gates; implementation/runtime checks above are future work, not planning-stage results.
