# Phase 6 Frontend Lifecycle UI — Manual Test Plan

**Date:** 2026-04-17  
**Tester:** [To be assigned]  
**Status:** Ready for testing

## Prerequisites

1. Dam Hopper server running with Phase 4 + Phase 5 backend changes deployed
2. At least one project with `restartPolicy` configured in `dam-hopper.toml`:
   ```toml
   [[project]]
   name = "test-project"
   path = "./test-project"
   
   [[project.terminal]]
   key = "dev"
   command = "node crasher.js"  # Script that exits with code 1
   restart_policy = "on-failure"
   restart_max_retries = 3
   restart_backoff_ms = 2000
   ```
3. Web UI accessible at `http://localhost:3000`

## Test Scenarios

### T1: Status Dot Colors

**Objective:** Verify status dots display correct colors for different session states.

1. Navigate to Dashboard page
2. Launch a long-running terminal (e.g., `npm run dev`)
3. **Expected:** Status dot is **green** 🟢
4. Kill the process (`Ctrl+C` in terminal)
5. **Expected:** Status dot turns **white** ⚪ (clean exit, code 0)
6. Launch crasher script (exits with code 1, `restartPolicy: "on-failure"`)
7. **Expected:** During backoff window, status dot is **yellow** 🟡
8. Wait for restart
9. **Expected:** After restart, status dot returns to **green** 🟢
10. Launch crasher script, exhaust all retries
11. **Expected:** After final crash, status dot is **red** 🔴

**Pass Criteria:**
- ✅ Green for alive processes
- ✅ Yellow during restart backoff
- ✅ Red for crashed (exit≠0, no restart)
- ✅ White for clean exit (exit=0)

---

### T2: Restart Badge

**Objective:** Verify restart count badge appears after restarts.

1. Navigate to Dashboard page
2. Launch crasher script with `restartPolicy: "on-failure"`
3. Wait for first crash and restart
4. **Expected:** Badge `↻ 1` appears next to uptime
5. Manually crash again (or let it crash if it keeps exiting)
6. **Expected:** Badge updates to `↻ 2`
7. Hover over badge
8. **Expected:** Tooltip shows "Restarted N time(s)"

**Pass Criteria:**
- ✅ Badge hidden when `restartCount = 0`
- ✅ Badge shows restart count icon + number
- ✅ Badge color is yellow (`bg-yellow-500/10`)
- ✅ Badge increments on each restart
- ✅ Tooltip is accurate

---

### T3: Exit Banner (willRestart-Aware)

**Objective:** Verify exit banner in terminal panel shows correct text and color.

1. Open a terminal panel
2. Run command that exits cleanly: `echo "done"`
3. **Expected:** Banner `[Process exited with code 0]` in **green**
4. Run command that crashes: `node -e "process.exit(1)"`
5. **Expected:** Banner `[Process exited with code 1]` in **red**
6. Launch crasher with `restartPolicy: "on-failure"`
7. **Expected:** Banner `[Process exited (code 1), restarting in 2s…]` in **yellow**
8. Wait for restart
9. **Expected:** Restart banner appears (see T4)

**Pass Criteria:**
- ✅ Green banner for exitCode=0, no restart
- ✅ Red banner for exitCode≠0, no restart
- ✅ Yellow banner for exitCode≠0, willRestart=true
- ✅ Banner text includes restart countdown

---

### T4: Restart Banner

**Objective:** Verify restart banner appears after process respawns.

1. Launch crasher with `restartPolicy: "on-failure"`
2. Wait for exit + backoff + restart
3. **Expected:** Banner `[Process restarted (#1)]` in **yellow** appears
4. Let it crash again
5. **Expected:** Banner `[Process restarted (#2)]` appears

**Pass Criteria:**
- ✅ Banner appears immediately after PTY respawn
- ✅ Banner shows correct restart count
- ✅ Banner is yellow (`\x1b[33m`)

---

### T5: Reconnect Indicator

**Objective:** Verify WebSocket reconnect banners.

1. Open a terminal panel
2. Stop the Dam Hopper server (simulate connection loss)
3. **Expected:** Banner `[Reconnecting…]` appears in **dim gray** (`\x1b[2m`)
4. Restart the server
5. **Expected:** Banner updates to `[Reconnected]`, then new prompt appears

**Pass Criteria:**
- ✅ `[Reconnecting…]` appears on WS disconnect
- ✅ `[Reconnected]` appears on WS reconnect
- ✅ Banners are dim (`\x1b[2m`)
- ✅ Terminal resumes normal operation after reconnect

---

### T6: Query Invalidation on Restart

**Objective:** Verify dashboard refreshes when process restarts.

1. Open Dashboard page
2. Launch crasher with `restartPolicy: "on-failure"`
3. Open browser DevTools → Network tab, filter WS messages
4. Wait for process restart
5. **Expected:** 
   - `process:restarted` event visible in WS messages
   - Dashboard session list refreshes automatically
   - Restart badge updates without page reload

**Pass Criteria:**
- ✅ Dashboard auto-refreshes on `process:restarted`
- ✅ No manual refresh required
- ✅ Restart count updates in real-time

---

### T7: TerminalTreeView Status Dot

**Objective:** Verify status dots in tree view match dashboard.

1. Navigate to Terminals page
2. Launch crasher with `restartPolicy: "on-failure"`
3. Observe status dot in tree view (left sidebar)
4. **Expected:** Dot color matches dashboard dot
5. Wait for restart
6. **Expected:** Dot transitions yellow → green
7. Exhaust retries
8. **Expected:** Dot turns red

**Pass Criteria:**
- ✅ Tree view dot uses same color logic as dashboard
- ✅ Dot updates in real-time
- ✅ Dot color matches dashboard for same session

---

### T8: Banner Color Rendering (xterm ANSI)

**Objective:** Verify ANSI color codes render correctly.

1. Open terminal panel
2. Trigger each banner type (exit clean, exit crashed, restarting, restarted, reconnect)
3. **Expected:**
   - Green: `\x1b[32m` → visible as green text
   - Red: `\x1b[31m` → visible as red text
   - Yellow: `\x1b[33m` → visible as yellow text
   - Dim: `\x1b[2m` → visible as dim/gray text
   - Reset: `\x1b[0m` → returns to normal color

**Pass Criteria:**
- ✅ All colors render correctly in xterm
- ✅ Colors reset after each banner (`\x1b[0m`)
- ✅ No color bleed into subsequent output

---

### T9: Edge Cases

**Objective:** Test boundary conditions.

1. **exitCode = null**
   - Kill process without clean exit
   - **Expected:** Treated as clean exit (white dot, no crash indicator)

2. **restartCount = 0 after clean exit**
   - Launch crasher, let it restart once
   - Stop crasher cleanly
   - Launch it again
   - **Expected:** Restart count resets to 0 (backend Phase 4 behavior)

3. **Multiple simultaneous restarts**
   - Launch 3 crashers with `restartPolicy: "on-failure"`
   - Let them all crash at once
   - **Expected:** All show restart banners, dots update independently

**Pass Criteria:**
- ✅ Null exit code handled gracefully
- ✅ Restart counter resets on clean exit
- ✅ Multiple sessions don't interfere

---

## Success Criteria Summary

All test scenarios (T1-T9) must pass:
- ✅ Status dots show correct colors
- ✅ Restart badge displays and updates
- ✅ Exit banners show willRestart-aware text/color
- ✅ Restart banners appear with correct count
- ✅ Reconnect indicators work
- ✅ Dashboard auto-refreshes on restart
- ✅ Tree view dots match dashboard
- ✅ ANSI colors render correctly
- ✅ Edge cases handled

## Test Environment

- **OS:** Windows 11
- **Browser:** Chrome 132 / Edge 132
- **Node.js:** 20.x
- **Rust:** 1.78+

## Notes

- Manual testing required due to no frontend test infrastructure (Vitest not configured)
- Unit tests created for session-status helpers (pure functions)
- Backend Phase 4 + Phase 5 must be deployed for full feature testing
- Test data fixtures in `crasher.js`:
  ```js
  // crasher.js — immediately exits with code 1
  process.exit(1);
  ```

## Sign-Off

- [ ] All scenarios passed
- [ ] Edge cases validated
- [ ] Performance acceptable (no UI lag on restart)
- [ ] No console errors
- [ ] Ready for code review

**Tester Signature:** _________________________  
**Date:** _________________________
