# C3UI Cycle 3 Fixes Report
- C3-W3: Bound quality `<select>` to `value={qualityPreference}` in browser-tools.tsx; asserted rendered values across non-Auto initial props, tab change, panel reopen, and generation reset in browser-tools.test.tsx and BrowserApp.test.tsx.
- C3-W5: Cleared lastSentPrefRef on disconnect/reset in BrowserStreamKeepAliveHost.tsx; added close-before-open regression test with unchanged live tab: status/ack/pending cleared, preference retained and re-sent on reconnect.
- C3-W6: Replaced manual DOM assignment in host-browser-lifecycle.browser.tsx with userEvent.selectOptions; asserted rendered selector reset on generation replacement.
- Keyboard oracle: Added browser-tools-quality-keyboard.browser.tsx testing real userEvent.selectOptions, Chromium keyboard focus+ArrowDown navigation, Escape closing, and controlled reflections without manual assignments.
- Host oracles: Asserted setAudioMuted value immediately before attach and at first media-open in BrowserStreamKeepAliveHost.test.tsx; exercised resets via controller/socket double close.
- Validation: tsc --noEmit passed (0 errors); 81/81 unit tests passed; 10/10 Chromium browser tests passed.
- Unresolved questions: none.
