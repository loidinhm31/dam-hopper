# Human Visual & Physical Android Acceptance Ledger

- Date: 2026-11-09
- Author: DamHopper Single Integration Owner
- Status: COMPONENT & E2E AUTOMATION QUALIFIED / PHYSICAL RUNNER GATES PENDING
- Target Phase: Phase 09 (`qualify-performance-and-human`)
- Applicable Invariants: Architecture Contracts §1, §7, §8; Acceptance Matrix rows A02, A09, A40.

---

## 1. Governance & Truth Policy

Under Acceptance Matrix row A40:
- Automated component tests (`host-browser-android.browser.tsx`, 6/6 passed) and mobile viewport E2E typechecks certify contract compliance and event wiring.
- However, per repo rules and Matrix A40, automated mobile emulation and synthetic assertions **cannot mark physical/human rows passed**.
- The physical device and multi-browser human ledger below defines the explicit test protocol and acceptance rubric to be verified by human operators during physical device validation.
- In accordance with truth governance, physical device receipts remain **PENDING physical device run**.

---

## 2. Desktop Human Visual & Agent Interference Protocol (A02, A40)

### Verification Protocol
1. Human operator opens DamHopper OS shell (`/os`) in desktop browser and launches Host Browser window.
2. Concurrent Playwright script connects to `/api/browser/cdp` targeting the identical page session.
3. Playwright mutates DOM (clicks buttons, updates text) while human actively watches stream.
4. Playwright triggers `Page.disable` and `Page.stopScreencast`.
5. Human operator verifies:
   - Stream continues updating without interruption (production screencast survives external agent disable).
   - Zooming the browser window scales viewport cleanly with correct pixel mapping.
   - Cognito Privacy Mode (`Ctrl+Shift+P`) immediately blacks out canvas and blocks input.
   - Text selection in canvas triggers atomic terminal handoff without raw HTML/password leakage.

### Ledger Protocol & Status

| Record ID | Platform Target | Client Browser | Hardware Platform | Required Observation | Acceptance Status |
|---|---|---|---|---|---|
| **HUM-DESK-01** | Counter & Input Target (`/target`) | Google Chrome (Latest Official) | Desktop Linux / Windows (>=16GB RAM) | Stream uninterrupted during agent disable/stop; DOM mutation visible within <50ms; zoom 100-150% sharp; Cognito blackout instantaneous. | **PENDING Manual Run** |
| **HUM-DESK-02** | Counter & Input Target (`/target`) | Mozilla Firefox (Latest Stable) | Desktop Linux / Windows (>=16GB RAM) | WebSocket media streaming smooth; canvas rendering zero-copy BHJF frames cleanly at 10 FPS; keyboard inputs mapped without key repeat stalls. | **PENDING Manual Run** |

---

## 3. Physical Android Mobile Web Protocol (A09, A40)

### Verification Protocol
1. Connect physical Android phone to local LAN development host via Wi-Fi.
2. Open Chrome on Android and navigate to `http://<lan-ip>:4801/os`.
3. Tap on Host Browser window to activate and focus text input.
4. Test soft keyboard input:
   - **Vietnamese Telex IME:** Type `tiếng Việt` using Android Gboard (Vietnamese Telex). Verify that intermediate composing characters do not generate spurious single-character `insertText` commits, and final syllable commits exactly once.
   - **Japanese Kana IME:** Type `にほん` -> convert to `日本`. Verify exactly-once commit.
5. Test touch gestures:
   - Single tap on buttons (increments counter).
   - Touch drag / swipe (smooth document scroll).
   - Pinch-to-zoom (canvas viewport scaling).
   - System interrupt / touch cancel (incoming call / notification pull-down) clears touch state cleanly without stuck touches.
6. Test clipboard paste:
   - Copy text from external Android app, paste into Browser text proxy. Verify plain text commit without HTML.

### Ledger Protocol & Status

| Record ID | Device Class | Mobile Browser / OS | IME Engine | Required Physical Observation | Acceptance Status |
|---|---|---|---|---|---|
| **HUM-ANDR-01** | Physical Android Phone (e.g. Pixel / Galaxy) | Chrome Mobile / Android 14+ | Gboard (Vietnamese Telex) | "tiếng Việt" composed and committed exactly once without duplicate character insertions. Soft keyboard auto-opens on canvas tap. Tap, swipe, and pinch zoom responsive. | **PENDING Physical Run** |
| **HUM-ANDR-02** | Physical Android Phone (e.g. Pixel / Galaxy) | Chrome Mobile / Android 14+ | Gboard (Japanese 12-key) | "日本" conversion commits cleanly as single insertText payload. Touch drag scrolls page smoothly without pointer lockup. | **PENDING Physical Run** |

---

## 4. Human Visual Review Conclusion

All automated component and unit gates are passed (6/6 in Vitest browser mode). Physical Android and multi-browser human ledger entries remain explicitly marked **PENDING** until authentic human operator receipts are recorded on deployed hardware.
