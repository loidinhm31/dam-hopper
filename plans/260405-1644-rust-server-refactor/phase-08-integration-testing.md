# Phase 08: Integration Testing + Migration Validation

## Context
- Parent: [plan.md](./plan.md)
- Depends on: Phases 1-7

## Overview
- **Priority**: P1
- **Status**: Pending
- **Effort**: 8h

Validate that Rust server + React web produce identical behavior to current Node stack.

## Requirements

- API compatibility test suite: hit every endpoint, compare responses
- WebSocket test: terminal create → write → read → kill lifecycle
- Git operation tests against real repos
- Agent store tests with real filesystem operations
- Side-by-side comparison: run both servers, diff responses
- Performance baseline: measure response times vs Node server

## Implementation Steps

1. Create test workspace with known `dev-hub.toml` + sample projects
2. Write API test suite (can use existing WsTransport channel list as checklist):
   - Hit each endpoint on Rust server
   - Verify response shape matches Node server
3. Terminal lifecycle test:
   - Create session → write `echo hello` → read output → verify `hello` in buffer → kill → verify exit
4. Git test:
   - Init test repos with known state
   - Test status, fetch, branch listing, worktree ops
5. Agent store test:
   - Set up store with test items
   - Ship → verify symlink → unship → verify removed
   - Health check with intentionally broken symlink
6. WebSocket test:
   - Connect → send terminal:write → receive terminal:data → disconnect → reconnect
7. Side-by-side script: start both servers, replay same requests, diff JSON responses
8. Performance benchmarks: `wrk` or `hey` for throughput, terminal latency measurement

## Todo

- [ ] Test workspace fixture
- [ ] API compatibility suite
- [ ] Terminal lifecycle tests
- [ ] Git operation tests
- [ ] Agent store tests
- [ ] WebSocket tests
- [ ] Side-by-side comparison script
- [ ] Performance benchmarks
- [ ] Document any behavioral differences

## Success Criteria

- 100% endpoint coverage in tests
- All responses match Node server output (structure, not byte-identical)
- Terminal I/O latency < 10ms (comparable to Node)
- No regressions in git operations
- Agent store symlinks work identically

## Risk Assessment

- **Subtle response differences**: JSON field ordering, null vs missing, number precision. Need flexible comparison.
- **Timing-dependent tests**: Terminal output is async. Need waiters/retries.
- **Platform differences**: Tests must pass on both Linux and macOS.

## Next Steps

→ Phase 09: Cleanup old Node packages
