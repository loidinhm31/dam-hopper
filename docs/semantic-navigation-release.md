# Semantic navigation release signing

Semantic navigation is supported only for **Linux x86_64** in Phase 5: Rust, JavaScript, and TypeScript. Windows, macOS, aarch64, and Java remain capability-disabled. The server never falls back to host-installed tools.

A released Linux server package contains its semantic runtime beside the server binary:

```text
dam-hopper-server
semantic-bundles/
  manifest.json       # signed metadata, schema version 2
  manifest.sig        # 64-byte detached Ed25519 signature
  manifest.sha256     # SHA-256 of manifest.json
  payload/            # Rust Analyzer, Node, TypeScript language server
  sbom.cdx.json
  licenses/
```

An absent, corrupt, or incorrectly signed bundle disables semantic navigation only. Editing, saves, terminals, and primary `/ws` continue working.

## One-time key setup

Generate the key in a protected workstation, vault, or HSM—not the repository. The private key signs release manifests; the public key is compiled into the matching server binary.

```bash
openssl genpkey -algorithm ED25519 -out semantic-bundle-signing-key.pem
chmod 600 semantic-bundle-signing-key.pem

# Save this 64-character output as the public-key CI secret.
openssl pkey -in semantic-bundle-signing-key.pem -pubout -outform DER \
  | tail -c 32 | xxd -p -c 256
```

Create these protected GitHub Actions secrets, scoped to the release environment:

| Secret | Value | Used for |
| --- | --- | --- |
| `DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY` | Raw 32-byte Ed25519 public key, lowercase hex | Compiling server; staging verification |
| `DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_PEM` | Entire private PEM | Write temporary CI key file only during signing |

Never commit either key, generated bundle, source archives, or release output. The private PEM is briefly passed from the CI secret store into a `0600` temporary file; it must not be printed or supplied as a command argument.

## Bundle inputs and creation

The committed source lock is [`release/semantic-bundle-input.lock.json`](../release/semantic-bundle-input.lock.json). It pins the following Linux x86_64 inputs: Rust Analyzer `2026-08-10.1`, Node `24.19.0`, TypeScript `6.0.3`, and TypeScript Language Server `5.3.0`. These are the newest compatible stable releases. TypeScript `7.0.2` is intentionally excluded: its npm package no longer contains `lib/tsserver.js`, which TypeScript Language Server requires. Update the lock only through a reviewed dependency/security update; pinning means never resolving `latest` during a release.

`scripts/prepare-semantic-bundle-input.sh` downloads these exact public archives, checks every SHA-256, and deterministically extracts the runtime payload. Run it only in the protected Linux release job; its output is temporary and never committed. A protected producer uses that output as this non-repository input directory:

```text
input/
  bundle-input.json       # approved versions, HTTPS locations, source SHA-256 values
  sources/                # immutable archives named by bundle-input.json
  payload/                # deterministic extraction of verified archives
    rust-analyzer
    node/bin/node
    typescript-language-server/lib/cli.mjs
    typescript-language-server/node_modules/typescript/
  sbom.cdx.json
  licenses/
```

`bundle-input.json` is schema version 2. The producer derives it from the committed lock after extraction, adding actual payload entrypoint sizes/checksums. The build script checks archive digests, approved Linux descriptors, entrypoint checksums/modes, SBOM references, license presence, and the complete payload-tree checksum before it signs `manifest.json`. TypeScript must be installed below the bundled language-server module so Node resolves it from the verified payload, never host PATH or global packages.

`build-semantic-bundle-release.sh` verifies both downloaded source archives and the extracted payload before signing. The 5.3.0 language-server archive ships a self-contained `lib/cli.mjs`; its production dependency closure is bundled into that file. The only external runtime package it resolves is the pinned TypeScript package, staged at `node_modules/typescript`. The real runtime smoke test proves this closure under empty PATH. The input-preparation script is the only supported producer for release payloads.

Build and sign:

```bash
DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_FILE=/secure/semantic-bundle-signing-key.pem \
  scripts/build-semantic-bundle-release.sh \
  /secure/semantic-input /secure/out/linux-x86_64
```

The staging script checks manifest digest **and Ed25519 signature** against the public key before copying the package next to the binary:

```bash
DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY=<public-key-hex> \
  scripts/prepare-semantic-bundle-release.sh \
  /secure/out/linux-x86_64 /secure/server-package/semantic-bundles
```

## CI/release handoff

The release workflow must first obtain the protected Linux bundle artifact, then compile/stage it with the same public key. Example signing producer step:

```yaml
- name: Write ephemeral semantic signing key
  shell: bash
  env:
    SIGNING_KEY: ${{ secrets.DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_PEM }}
  run: |
    umask 077
    printf '%s' "$SIGNING_KEY" > "$RUNNER_TEMP/semantic-bundle-key.pem"

- name: Build signed Linux semantic bundle
  env:
    DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_FILE: ${{ runner.temp }}/semantic-bundle-key.pem
  run: scripts/build-semantic-bundle-release.sh "$RUNNER_TEMP/semantic-input" release/semantic-bundles/linux-x86_64
```

The server build must use the matching public key in its environment at compile time:

```bash
DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY=<public-key-hex> \
  bash -c 'cd server && cargo build --release --features vendored'
```

The release workflow creates the bundle in its protected Linux job from the committed input lock, then stages it beside the compiled server binary. Signing steps run only for version tags or an explicitly approved `workflow_dispatch`; pull-request runs never receive or write the private key. Configure those release runs behind the required-reviewer `semantic-release` GitHub environment, with the signing secrets scoped only to that environment. The build-server job has read-only repository permissions; only the desktop publication job receives `contents: write`. It removes the temporary private key in an `always()` cleanup step. It does not download an unverified prebuilt bundle or put generated payloads in the repository.

## Validation

The release-script gate now downloads the exact pinned public archives, builds a signed bundle with an ephemeral test key, verifies staging, rejects tampered payload/signature, and runs real Rust and TypeScript initialization, definition, and references navigation with empty PATH:

```bash
scripts/test-semantic-bundle-release.sh
scripts/test-semantic-runtime-slo.sh /path/to/staged/payload
cd server && cargo test semantic::bundle && cargo test semantic::registry
```

`test-semantic-runtime-slo.sh` reports real warm TypeScript definition p95/p99, initialize latency, cancellation-forwarding latency, and RSS. It hard-fails above the Phase 0 thresholds: definition p95 300 ms/p99 1 s, initialize 2 s, cancellation 100 ms, or RSS 1 GiB/process. The Rust supervisor separately enforces the 3-process/client-project, 8-process global, 32-request/16 MiB queue, 2-active-request, frame, document, and response caps. Protected Linux CI packaged-browser, aggregate resource, and primary `/ws` independence gates are waived as unavailable in this environment per release-owner instruction; they are not represented as passed evidence. Available local gates include empty-PATH signed-bundle runtime qualification, semantic transport/auth/trust tests, bundle tamper rejection, and bounded lifecycle tests. CI pins Python 3.12 for safe archive extraction.

## Rotation, update, rollback

1. Generate a new Ed25519 pair in the protected signing system.
2. Replace the public-key secret; compile a new server with it.
3. Rebuild/sign a matching Linux bundle with the new private key; validate before release.
4. For compromised keys/dependencies, withdraw the affected package and ship a server without a valid semantic bundle (capability-disable rollback), then rotate keys as needed.

No editor-data migration is needed for rollback.
