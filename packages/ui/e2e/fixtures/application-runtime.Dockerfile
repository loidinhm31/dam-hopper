# syntax=docker/dockerfile:1
# Test runtime image: layers the E2E seed binary on top of the production application image.
# Built using the server-builder image for compiling the seed executable.

ARG BUILDER_IMAGE=dam-hopper:server-builder
ARG BASE_IMAGE=dam-hopper:production

FROM ${BUILDER_IMAGE} AS seed-builder

WORKDIR /build
COPY server/examples/application_e2e_seed.rs ./examples/application_e2e_seed.rs
RUN cargo build --release --features vendored --example application_e2e_seed

FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*


COPY --from=seed-builder /build/target/release/examples/application_e2e_seed /usr/local/bin/application_e2e_seed
