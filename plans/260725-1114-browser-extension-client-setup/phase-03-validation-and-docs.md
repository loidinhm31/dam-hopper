# Phase 03: Validation and Docs

Date: 2026-07-25  
Priority: medium  
Status: pending

## Context Links

- [Plan](plan.md)
- `docs/configuration-guide.md`
- `docs/frontend-components.md`
- `packages/ui/browser-tests/browser-bridge.browser.ts`

## Overview

Prove the setup flow works in Chromium and document the client-side boundary.

## Key Insights

- Unit tests cannot install Chromium extensions.
- A browser test can load the unpacked staged output and assert marker,
  handshake, and DOM selection.
- Manual validation remains required for the native Chromium confirmation UI.

## Requirements

- Test missing marker/setup rendering and detected marker state.
- Test extension archive build/staging.
- Test real Chromium handshake after loading the unpacked extension.
- Document SSH port forwarding and client-browser extension installation.

## Architecture

Keep the test split: deterministic build/UI tests plus a Chromium integration
test using a temporary extension profile.

## Related Code Files

- `packages/ui/src/components/organisms/BrowserDebugPanel.test.tsx`
- `packages/ui/browser-tests/browser-bridge.browser.ts`
- `docs/configuration-guide.md`
- `docs/frontend-components.md`

## Implementation Steps

1. Add package and UI tests.
2. Extend Chromium integration coverage.
3. Update configuration and component documentation.
4. Run build, lint, focused tests, and manual extension load check.

## Todo List

- [ ] Build/UI tests.
- [ ] Chromium test.
- [ ] Documentation.
- [ ] Release validation.

## Success Criteria

The client receives the correct setup path before Browser Debug DOM selection
and can use the bundled extension after the explicit Chromium confirmation.

## Risk Assessment

Chromium's extension settings are user-controlled and cannot be fully automated.

## Security Considerations

Documentation must state that the extension is installed in the client browser,
never in the target app, and that it only runs on declared host patterns.

## Next Steps

Hand off to implementation.
