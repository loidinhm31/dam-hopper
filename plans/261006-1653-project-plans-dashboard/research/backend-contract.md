# Backend contract — Project Plans dashboard

Planning only; no code or runtime qualification. Revised after validation interview 2026-10-06. The earlier automatic collection scan/card/256-watch proposal is superseded by folder-first, one-plan-at-a-time selection. [Frozen contracts](../contracts.md) are authoritative.

## Repository evidence retained
- `server/src/api/router.rs:467–494`: protected routes use existing auth; mount file APIs directly, not under optional workflow service.
- `server/src/state.rs:165–174`, `server/src/workspace_target.rs:30–35,198–212`: configured-project/registered-worktree resolution. Reuse existing workspace-context guard and target resolver, no caller-selected absolute root.
- `server/src/workflow/service.rs:20–27,151–165`: SQLite-backed workflow is separate; no import, migration, fake IDs or availability dependency.
- `server/src/fs/secure_path.rs:78–147,290–330`: Unix rooted nofollow operations exist, but current helper lacks bound-root/same-descriptor metadata and final open can block on FIFO. Non-Unix reader at513–541 checks path then reopens, insufficient against replacement.
- `server/src/api/ws.rs:1969–1987,2114–2169`: target resolution exists; generic reads detect/stat/reopen separately, full cap5MiB, ranges uncapped. Strict decisive reads require a narrow new mode.
- `server/src/fs/watcher.rs:90–97`: NonRecursive. `server/src/fs/mod.rs:184–205` uses target root as watcher root even for deeper filter. Repeated filter-only subscriptions cannot observe nested progress.
- `server/src/api/ws.rs:2883–2936,2976–2999`: subscriptions always compute tree snapshots; queue overflow emits FsOverflow/drop, receiver lag only warns. Event rename path/from already exists.
- `server/src/api/ws_protocol.rs:31–53`: FsSubTree/FsRead declarations; `ws.rs:1975–1979` supports root spelling `.`.
- `server/Cargo.toml:112,126–127`: chrono/serde_yaml_ng already available. No new runtime/parser dependency by default.
- Advisor fixture has frozen Pending inventory and five complete progress reconciliation rows; privacy fixture uses Current Status/Phase Summary/bold DONE. Existing editor-blame progress uses phase range01–07. Support defined grammar, not fixture-specific sentences.

## Revised API design
- `GET /api/plans/folders?project=...&worktreePath=...&path=plans/...`: default path plans. Return immediate eligible directory names/paths, current directory kind and navigation watchPaths. No recursive discovery, child-status probing or plan/progress byte reads.
- Probe only current directory's own regular plan.md marker without following it. Group opens another folder listing; plan opens selected read. Plan-kind response has no child listing. Hidden/utility/symlink components excluded; archive groups eligible.
- `GET /api/plans?project=...&worktreePath=...&planPath=plans/...`: selection required, no implicit bulk endpoint. Read only selected plan.md/progress.md complete snapshots and return one FilePlan.
- Missing plans root is labelled empty folder response; missing nonroot/selected membership404. Invalid targets/auth/permissions are not empty results. Reuse existing error envelope and exact codes in contracts.
- Both operations run bounded synchronous work through spawn_blocking; no AppState service field, DB/cache/status index/controller/telemetry addition.

## Resource and watch scope
- Immediate listing:5000 visited entries including skips;2MiB JSON; visibly incomplete when whole entries omitted. More than200 sibling plans remain browsable without status parsing.
- Relative paths:4KiB/32components including plans; no recursive depth traversal.
- Selected decisive content: at most2 full documents,64KiB each/128KiB aggregate. Full selected JSON over2MiB rejects413; never omit phases to appear complete.
- Parser bounds:128declared phases,4KiB metadata strings,512byte title/tag,32tags,64evidence links,32diagnostics,1KiB raw/messages, YAMLdepth16. See contracts for semantic-overflow handling.
- Watch only target root, requested ancestors/current directory, max33; frontend may add one evidence parent. No per-child/sibling watches. Concurrent registrations8, reconciliation passes3 then explicit degraded coverage.

## Safe reads and existing seams
- Pin approved target/root and revalidate workspace/root identity before publication. Do not retain config locks over I/O.
- Shared crate-private rooted enumeration/snapshot primitive. Unix openat/nofollow/nonblock then same-fd regular-file check, bounded bytes/descriptor metadata; detect in-place/named-entry change without per-request retries.
- Implement safe Windows native handles/reparse rejection, stable file identity and pinned ancestors. Preserve Unix/Windows builds. Runtime proof here is Linux; Windows runtime explicitly unqualified until exercised there, not Linux-only unsupported functionality.
- Reads preserve bytes/mtime/ctime; OS atime may change. Separate stable documents do not prove a writer transaction or durable completion.
- Existing REST /api/fs/read optional mode=plan-document and WS readMode preserve absent default. Strict full64KiB UTF-8/noNUL regular Markdown anywhere in captured target; no ranges/symlinks/writable fallback.
- Existing FsSubTree optional watchOnly uses narrowly added actual-directory helper. WatcherKey.root is validated requested directory, not target-root filter. Reuse nonrecursive manager; nodes:[] acknowledgement skips unused snapshots.
- Receiver lag/queue loss emit existing FsOverflow and release subscription. Frontend refetches/rebinds current selection, not entire project. No new event envelope/global recursive mode.

## Source/date authority
- plan.md supplies metadata/inventory. Progress presence exclusively supplies current report even when unreadable; absent progress labelled fallback. Captured status historical only; unknown/conflict never silent green.
- Exact token/table/prose normalization, phase matching/fraction and date aliases/precision remain frozen in contracts sections5–6. No checkbox/receipt/mtime/effort inference.
- Timeline displays selected plan only: explicit planned/actual ranges, milestones or Undated state. No cross-plan comparison/phase scheduling.

## Integration and future proof
- Proposed files: server/src/plans/{mod,dto,parser,scan}.rs and server/src/api/plans.rs. Existing router/lib/errors and fs/secure_path, fs/mod, api/fs, api/ws, api/ws_protocol changes narrowly as detailed in Phase02.
- Real temporary filesystem/worktree/auth cases must prove selected reads, no sibling-content load, source precedence, numeric limits, nofollow races/FIFO denial and root/config fencing.
- Actual-directory atomic rename, missing-root creation and loss recovery require real event smoke. Preserve default FS consumers and manual workflow.
- No builds/tests run in this research. Native platform and parser edges remain implementation risks; product choices resolved.
