# Repository evidence — session changes planning

Status: local evidence collected 2026-10-30; planning only. Native-user `plan/parallel`; selected canonical plan `/home/loidinh/WS/dam-hopper/plans/261030-1215-session-changes-panel/plan.md`. No take caller; coordinator owns review and prompt-mode optional validation. No active plan existed. Installed active-plan setter returned `EVCRATE_SESSION_ID not set`; activation did not persist. Carry explicit path in every handoff.

## Scope and evidence reuse
- Scope authority: `plans/reports/design-261030-0043-session-changes-panel.md` (approved design, not implementation). Retain all eight acceptance criteria and non-goals.
- README.md:3-29,49-70 establishes Rust/React shared web/Tauri hosts and loopback-only dev commands.
- No external research needed: current local DamHopper and installed OMP source can establish compatibility seams. Scouts cover independent lifecycle and UI boundaries. No network/model requests or dependency installation authorized.
- Architecture gate: conventional `docs/architecture.md` / root `ARCHITECTURE.md` are absent from supplied repository navigation; actual architecture authority is README-linked `docs/system-architecture.md`, with domain documents under `docs/architecture/`. Read overview in full, relevant backend/ownership/security sections especially 71-90,129-135,225-234,353-360. Intended additions belong in selected plan contracts; live architecture documentation remains unchanged until implementation qualification, avoiding false deployed claims. No architecture exemption for this structural feature.

## Backend/storage contracts inspected
- `server/src/state.rs:32-140,163-175`: AppState owns shared services; canonical target resolver; existing agent-status runtime and bounded blame semaphore/cache. Async work must release synchronous locks and revalidate ownership on publication.
- `server/src/api/git_diff.rs:23-46,63-68,92-118`: current Git diff APIs resolve configured project/worktree then one Git root in spawn_blocking. These compare HEAD/index; do not relabel them as session baselines.
- `server/src/git/mod.rs:1-23,65-68`: separate Git domain modules and canonical VCS-root helpers.
- `server/src/git/vcs_roots.rs:31-36,141-173`: root IDs are validated and canonical containment enforced. One selected root, never aggregate `*`; untrusted extension cwd grants no authority.
- `server/src/fs/mod.rs:15`: crate-private secure_path available for reuse without export expansion.
- `server/src/fs/secure_path.rs:61-88,553-680,1405-1463`: `read_regular_snapshot(root, relative, max_bytes)` uses pinned directory handles, no-follow final opens, bounded regular-file read, descriptor/named-entry/ancestor identity and timestamp rechecks; Unix and Windows paths exist. Read failure/instability is explicit. Do not use weaker pathname-only helpers or follow links. Read-time coherence is not an atomic whole-repository snapshot.
- `server/src/browser_debug/store.rs:20-53`: existing server-lifetime `Arc<TempDir>` private artifact pattern; terminal/incarnation-scoped metadata. Reuse pattern, not browser-debug data model or its TTL.
- `server/Cargo.toml:43-48,106-107,125-131,151-155`: Tokio, git2, ignore, tempfile, sha2/libc already installed. No new daemon, runtime, feature flag, DB schema or dependency presumed necessary.
- `server/src/api/mod.rs:1-50`: API modules separate from router registration. Keep new session-review handler/domain separate from destructive Git actions.
- `docs/code-standards.md:20-44,112-119,127-149`: profile/generation fences, bounds, secret-free logs, semantic-only status and four distinct verification layers.

## Measured repository-size evidence
Executed read-only `git ls-files -z --cached --others --exclude-standard`; deduplicated names; lstat regular files without following links. Result before plan authoring: 4,019 eligible paths; 4,018 regular files; 51,778,033 total bytes (~49.4 MiB); maximum 307,816 bytes; zero files over 1 MiB or 2 MiB; zero symlinks; one missing tracked path. Current branch `main` observed via `git branch --show-current`.

This is size evidence, not capture latency, heap profiling, binary classification or delivered snapshot proof. Proposed bounded starting point for planner: 10,000 manifest paths, 2 MiB raw file admission, 128 MiB per-baseline captured content, 512 MiB global accounted snapshot/current content, max 32 retained tracking records, two global scan permits and one scan per tracking identity. Exact comparison/text/response limits and cooperative deadlines must be settled in contracts; saturation must be explicit, never evict or silently rebaseline an existing original. No performance SLA inferred from size measurement.

## Related plans
- `plans/261019-1505-git-conflict-resolver/plan.md:16-36,42-55,194`: qualification still open; shared AppState/router/Git infrastructure, workspace panel stacking, Monaco and docs can overlap. Serialization constraint, not a prerequisite on its unfinished release qualification. Do not borrow conflict resolver's known unqualified model URI/draft behavior. Do not edit that plan.
- Android-native work explicitly out of scope. Its terminal plans do not authorize Android UI changes. Other plan overlap findings from UI scout must be merged before authoring.

## Checks performed / not performed
Performed source/document inspection, repository-size measurement and active-plan setter invocation. No feature code, compile/tests, browser/Tauri launch, model turn or live session-review scenario executed. Future verification must be specified as planned, not passed.

## Unresolved questions
Await independent local scout results for exact OMP await/error ordering, private handshake authentication and UI integration surface. No unresolved product choice in approved design.
