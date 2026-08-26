# Phase 01: Extension Distribution

Date: 2026-07-25  
Priority: high  
Status: completed (2026-07-25 15:06 +07)

## Context Links

- [Plan](plan.md)
- `apps/browser-extension/vite.config.ts`
- `apps/web/vite.config.ts`
- `package.json`

## Overview

Produce a reproducible unpacked-extension archive and stage it in the web
application's public output so the client downloads the exact extension version
that matches the Browser Debug UI.

## Key Insights

- Chromium cannot load an unpacked extension directly from a downloaded ZIP.
- The UI must download the ZIP, then instruct the user to extract it and choose
  the extracted folder in `chrome://extensions`.
- The archive must be produced by the normal web/deploy build, not manually.

## Requirements

- Build the extension before staging web assets.
- Emit a versioned or deterministic ZIP containing `manifest.json` and `content.js`.
- Copy the archive to a stable relative public URL consumed by the UI.
- Fail the build when the archive is absent or malformed.

## Architecture

Add a small Node build-stage script rather than a server API. It builds the
extension, validates its manifest, creates the archive, and stages it beneath
the web public directory before Vite copies public assets to the deployment.

## Related Code Files

- `package.json`
- `apps/browser-extension/package.json`
- `apps/web/package.json`
- `apps/web/vite.config.ts`

## Implementation Steps

1. Add a deterministic extension staging script under `apps/web`.
2. Wire root/web build scripts so staging precedes Vite production build.
3. Add a stable archive URL and build test/assertion.
4. Confirm the deployed web server serves that relative asset.

## Todo List

- [x] Build/stage extension archive.
- [x] Wire production build.
- [x] Verify archive contents and URL.

## Success Criteria

`pnpm build` produces a downloadable archive containing a valid MV3 manifest
and the built content script.

## Risk Assessment

Archive creation must be cross-platform; do not rely on a host `zip` binary.

## Security Considerations

Do not include credentials, source maps, or server configuration in the archive.

## Next Steps

Expose and consume the archive from the Browser Debug setup gate.

Validation: `pnpm build` stages a deterministic archive containing only the
MV3 manifest and built content script at the documented relative URL.
