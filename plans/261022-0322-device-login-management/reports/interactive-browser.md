# Parent interactive browser verification

- Actual built application, real isolated SQLite server at loopback; credential transferred through private mode-0600 temp file without printing token.
- Opened managed Chromium tab `device-access-smoke` using browser.open; authenticated through existing profile localStorage shape from application-storage-state fixture. Navigated actual `/workspace` and used real Server connections / Edit profile controls.
- Desktop 1440x900: rendered Login devices explanation, `ParentBrowser/1.0` hint, `This session`, login and expiry timestamps, Revoke access. Screenshot observed via browser tool: `/tmp/omp-sshots-15af66047c74084c.webp`.
- 320x667: reopened settings after responsive shell replacement, opened current-session confirmation. `End this login?`, account/server scope warning, Cancel and Revoke access visible. Screenshot observed: `/tmp/omp-sshots-15af661b4f74084d.webp`.
- Confirmed actual revoke in scoped dialog. UI changed to `Log in and save this profile to manage its logins.`; exact profile saved auth absent; document horizontal overflow false; revoked bearer protected `/api/projects` returned HTTP 401.
- Final logged-out screenshot observed inline in browser tool output; ephemeral screenshot, not canonical release evidence.
- Two interaction selector errors were corrected by observing actual DOM and scoping to dialog: first broad CSS selected Refresh; second role selector matched background and dialog Revoke buttons. No production change or feature failure inferred.
- Tab released with browser.close. Canonical fresh E2E captures remain in packages/ui/e2e/device-login-management; human visual governance remains PENDING_HUMAN_REVIEW. Agent inspection is not human approval.
