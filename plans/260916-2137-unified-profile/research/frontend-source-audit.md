# Frontend source audit

Date: 2026-09-16. Scope: documentation-only, focused read-only source audit. No tests, builds, services or application edits.

## Observed

- `packages/ui/src/api/transport.ts:86–130`: singleton transport/global generation. `query-client.ts:1–9`: hash reads active profile at hash time. Parent directly inspected both.
- `api/client.ts`: module-level transport import; `server-config.ts`: active-profile/default URL helpers, no autoConnect field yet. Scout inspected these source sections.
- `api/queries.ts:72–90,226–333`: Git/cache invalidation keys do not carry explicit profile+generation. `workflow-queries.ts`: global generation and cross-generation placeholder data.
- `hooks/use-sse.ts`: global type-keyed listener bus; envelope lacks profile/generation; target-unavailable handling uses unqualified resource identity. `use-sse-events.ts` subscribes by type only.
- `stores/editor.ts:45–80,247–248,281–380,560–650`: tab keys omit profile; persistence is metadata-only; transport is ambient; request counter does not supply ownership.
- `hooks/use-terminal-manager.ts`: raw-ID selection/openTabs/mounted/pins/pending/suppressed/stopped maps, singleton mutation dispatch and raw `session` deep links.

## Plan consequences

1. Freeze profile/auth plus owner refs first, then registry/API/query/event boundary; migrate every shipped-target/shared caller before that target enables simultaneous startup.
2. Keep stable editor/terminal refs separate from generation. Add endpoint/root binding and generation/revision checks through all async work.
3. Keep keep-alive host above route/mode content but qualify its maps before widening lifetime. Disconnect remains detach; durable remove stays explicit.
4. Move workflow cursors/placeholder/optimistic state to owner+generation; endpoint unsupported is a per-profile state, not empty shared history.

## Questions resolved after user validation

- Legacy editor/resource recovery was initially planned from the preplan; user instead chose forced fresh state. Drop old resource records, no backup/quarantine/restore. Preserve saved profile/auth/native/server state.
- Workflow ownership remains profile+generation, including event cursors/placeholders.
- Native unsupported remains an editable unsupported row with no fallback traffic.
- New frontend requires protocol-2 authenticated status before WS/features. Old server is upgrade-required, not partially usable. Scope is frontend profile ownership, not backend workspace redesign.

## Unresolved questions

None for design. Source may change before implementation; refresh references at Phase 00.
