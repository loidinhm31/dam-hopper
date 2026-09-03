# Stage 1: Build Rust server
# vendored feature bundles libgit2 + openssl statically — no system libs needed at runtime
# Keep the builder at or above the locked dependency MSRV (currently Rust 1.95
# for sysinfo) so a fresh release build cannot select an unsupported toolchain.
FROM rust:1.97.1-bookworm@sha256:e544a8ee0b93bb2ddc8c67a80606f040998eff3847e4deed988d0874559f52a8 AS server-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    make \
    perl \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY server/Cargo.toml server/Cargo.lock ./
# Pre-build dependency layer for caching
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --features vendored \
    && rm -rf src

COPY server/src ./src
COPY server/assets ./assets
RUN touch src/main.rs && cargo build --release --features vendored

# Stage 2: Build web SPA
FROM node:20-slim@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c AS web-builder

WORKDIR /build

# pnpm version kept in sync with .github/workflows — update both when upgrading
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
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

# Stage 3: Runtime. Base image digests are pinned for reproducible release builds.
FROM debian:bookworm-20250317-slim@sha256:e9ac68ffde903b241342267a51cd74c5417414af652cb2e380c6ddcf522589bc

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=server-builder /build/target/release/dam-hopper-server /usr/local/bin/dam-hopper-server
COPY --from=web-builder /build/apps/web/dist /opt/dam-hopper/web

EXPOSE 4800

ENTRYPOINT ["dam-hopper-server"]
CMD ["--port", "4800", "--web-dir", "/opt/dam-hopper/web"]
