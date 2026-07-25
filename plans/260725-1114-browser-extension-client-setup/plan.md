# Browser Extension Client Setup

Date: 2026-07-25  
Status: complete (2026-07-25 15:18 +07; native release checks carried into parent phase 6)

## Outcome

Ship the Browser Debug Chromium extension with the web deployment and gate DOM
selection behind a client-side setup flow. The target app remains unchanged.

## Preflight Contract

- Output: downloadable extension archive, extension-presence signal, setup UI.
- Acceptance: missing extension is explained before Browser Debug selection; a
  loaded extension is detected after page reload; download works from the web
  deployment; existing handshake works unchanged after detection.
- In scope: Chromium unpacked-extension guidance, local download, browser UI.
- Out of scope: silent extension installation, Chrome Web Store, enterprise
  policies, target-app packages/scripts, Firefox support.
- Risks: browser permissions and page reload are user-controlled; archive
  integrity and relative deployment paths must work in dev and production.
- Test: package build, unit/component tests, Chromium tests with/without the
  extension, manual load-unpacked check.
- Open questions: none. Chromium requires explicit user confirmation.

## Phases

1. [Extension distribution](phase-01-extension-distribution.md) - build and stage archive.
2. [Presence and setup gate](phase-02-presence-and-setup-gate.md) - detect extension and guide client setup.
3. [Validation and docs](phase-03-validation-and-docs.md) - test and document deployment.

## Side-Effect Review

- Auth: archive is a static public asset; it contains no server token or user data.
- Permissions: user explicitly loads the extension and grants site access.
- Compatibility: Chromium only; Browser Debug preview remains available after setup.
- Security: target DOM access is restricted to declared extension match
  patterns, loopback or configured exact DamHopper parent origins, and the
  existing source/nonce/request/schema bridge checks.
- Performance: one small content-script marker on the Dam Hopper page.
- Deployment: archive is generated with the web bundle, not from a local source path.
- Automated validation is complete; native Chromium install and deployed-origin
  permission checks remain pending.
