# Stage 1: Build Rust server
# vendored feature bundles libgit2 + openssl statically — no system libs needed at runtime
FROM rust:1.82-slim AS server-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY server/Cargo.toml server/Cargo.lock ./
# Pre-build dependency layer for caching
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --features vendored \
    && rm -rf src

COPY server/src ./src
RUN touch src/main.rs && cargo build --release --features vendored

# Stage 2: Build web SPA
FROM node:20-slim AS web-builder

WORKDIR /build

# pnpm version kept in sync with .github/workflows — update both when upgrading
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/browser-extension/package.json ./apps/browser-extension/
COPY packages/browser-bridge/package.json ./packages/browser-bridge/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY apps/browser-extension ./apps/browser-extension
COPY packages/browser-bridge ./packages/browser-bridge
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
RUN pnpm build

# Stage 3: Runtime — pinned digest for reproducible builds
FROM debian:bookworm-20250317-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=server-builder /build/target/release/dam-hopper-server /usr/local/bin/dam-hopper-server
COPY --from=web-builder /build/apps/web/dist /opt/dam-hopper/web

EXPOSE 4800

ENTRYPOINT ["dam-hopper-server"]
CMD ["--port", "4800"]
