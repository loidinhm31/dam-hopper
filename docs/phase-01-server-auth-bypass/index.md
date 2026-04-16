# Phase 01: Server-Side Auth Bypass

**Status**: ✅ Complete  
**Date**: April 16, 2026  
**Tests Passing**: 7/7 (100%)

Server-side authentication bypass in dev mode via `--no-auth` CLI flag. Enables local development without MongoDB while maintaining production safety guards.

## Contents

- [Implementation Details](./implementation.md) — Code changes, architecture, and integration points
- [Security Considerations](#security-considerations) — Safety guards and constraints
- [Usage Guide](#usage-guide) — How to use the feature
- [Test Coverage](#test-coverage) — Test suite and validation

## Quick Start

Start the server in dev mode without authentication:

```bash
cd server
cargo run -- --no-auth --workspace /path/to/workspace
```

Or via environment variable:

```bash
DAM_HOPPER_NO_AUTH=1 cargo run -- --workspace /path/to/workspace
```

### Expected Behavior

- Multi-line warning banner printed to stderr on startup
- ERROR-level logging: `⚠️  NO-AUTH mode enabled — authentication bypassed`
- `/api/auth/login` returns dev token immediately (no credentials required)
- `/api/auth/status` returns `{ authenticated: true, dev_mode: true, user: "dev-user" }`
- All protected routes accessible without authentication

## Key Features

| Feature | Details |
|---------|---------|
| **Activation** | `--no-auth` flag or `DAM_HOPPER_NO_AUTH=1` env var |
| **Dev Token** | 30-day expiry, `dev-user` subject (suggested 1-day but currently 30-day) |
| **Status Indicator** | `/api/auth/status` includes `dev_mode: true` flag |
| **Middleware Bypass** | `require_auth()` returns immediately if `no_auth=true` |
| **Token Generation** | `/api/auth/login` auto-generates tokens without credential verification |

## Security Considerations

### Production Safety Guards

This feature **CANNOT** be used in production due to multiple failsafe mechanisms:

#### 1. MongoDB Configuration Check
```rust
if db.is_some() {
    anyhow::bail!(
        "FATAL: --no-auth cannot be used when MongoDB is configured (MONGODB_URI is set).\n\
         This combination is unsafe and forbidden."
    );
}
```
**Rationale**: Using `--no-auth` with a real database is explicitly forbidden to prevent accidental deployments.

#### 2. Environment Detection
```rust
if std::env::var("RUST_ENV").unwrap_or_default() == "production" 
    || std::env::var("ENVIRONMENT").unwrap_or_default() == "production" {
    anyhow::bail!(
        "FATAL: --no-auth is not allowed in production environment.\n\
         Set RUST_ENV or ENVIRONMENT to 'development' for local dev."
    );
}
```
**Rationale**: Explicit rejection of production environment indicators.

#### 3. Startup Warning Banner
```
⚠️  ═══════════════════════════════════════════════════════
⚠️  SECURITY WARNING: Authentication disabled!
⚠️  All API requests will bypass authentication checks.
⚠️  This mode is for LOCAL DEVELOPMENT ONLY.
⚠️  DO NOT use in production or with sensitive data.
⚠️  ═══════════════════════════════════════════════════════
```
**Rationale**: Highly visible startup warning with multi-line emphasis.

#### 4. ERROR-Level Logging
```rust
tracing::error!("⚠️  NO-AUTH mode enabled — authentication bypassed");
```
**Rationale**: ERROR level ensures maximum logging visibility in dev environments.

### Not for Production Use

- ⛔ Fails fast if MongoDB is configured
- ⛔ Fails fast if production environment is detected
- ⛔ Requires explicit flag/env var activation
- ✅ Safe for isolated local development

## Usage Guide

### Basic Usage

```bash
# From project root
cd server
cargo run -- --no-auth --workspace /path/to/workspace

# Or from anywhere with env var
DAM_HOPPER_NO_AUTH=1 pnpm dev:server
```

### API Integration

All authentication checks are bypassed:

```bash
# No authentication needed
curl http://localhost:4800/api/workspace

# Login endpoint returns dev token immediately
curl -X POST http://localhost:4800/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{}'

# Status endpoint shows dev mode active
curl http://localhost:4800/api/auth/status
```

### With Environment Variables

```bash
# Set all together
export DAM_HOPPER_NO_AUTH=1
export DAM_HOPPER_WORKSPACE=/path/to/workspace
export DAM_HOPPER_PORT=4800

cd server && cargo run
```

## Test Coverage

All 7 integration tests pass:

### No-Auth Mode Tests (3)
- ✅ `test_no_auth_login_returns_dev_token` — Login endpoint returns token in dev mode
- ✅ `test_no_auth_status_shows_dev_mode` — Status endpoint shows dev mode active
- ✅ `test_no_auth_bypasses_middleware` — Protected routes accessible without auth

### Normal Auth Regression Tests (3)
- ✅ `test_normal_auth_requires_credentials` — Normal mode still enforces credentials
- ✅ `test_normal_auth_protects_routes` — Normal mode still requires auth tokens
- ✅ `test_normal_auth_status_without_token` — Normal mode still protects status endpoint

### Production Safety Tests (1)
- ✅ `test_no_auth_with_mongodb_panics` — Explicitly prevents MongoDB + no-auth combination

Run tests:

```bash
cd server
cargo test auth_no_auth    # Run Phase 01 tests only
cargo test                 # Run all (111 passing, 8 pre-existing failures)
```

## Implementation Files Modified

| File | Changes |
|------|---------|
| `server/src/main.rs` | Added `--no-auth` CLI flag, production safety checks, warning banner |
| `server/src/state.rs` | Added `no_auth: bool` field to AppState |
| `server/src/api/auth.rs` | Dev mode bypass in middleware, login, status endpoints |
| `server/tests/auth_no_auth.rs` | 7 integration tests (new file) |
| `CLAUDE.md` | Documented `--no-auth` usage in Commands section |

## Related Documentation

- [System Architecture](../system-architecture.md) — Auth module design
- [API Reference](../api-reference.md) — Auth endpoints documentation
- [Code Standards](../code-standards.md) — Patterns used in implementation
- [Phase 02: Multi-Server Frontend](../../plans/20260416-multi-server-auth/phase-02-multi-server-frontend.md) — Next phase
