# Phase 01 — Buffer Offset Tracking

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: none (standalone, first phase)

## Overview
- Date: 2026-04-17
- Description: Extend `ScrollbackBuffer` with monotonic byte counter for delta replay support.
- Priority: P2
- Implementation status: ✅ **COMPLETE**
- Effort: 2h (actual: 2h)

## Key Insights
- Current `ScrollbackBuffer` is a simple ring buffer with no offset tracking.
- Delta replay needs to know: "client has bytes up to offset X, send X+1 onwards".
- Monotonic counter survives eviction — counts all bytes ever pushed, not just retained.
- This enables efficient reconnect (send only new data) vs full replay every time.

## Requirements
- Add `total_written: u64` field to `ScrollbackBuffer`.
- Increment on every `push()` by chunk length.
- Add `current_offset()` → returns `total_written`.
- Add `read_from(from_offset: Option<u64>)` → returns `(&[u8], current_offset)`.
- If `from_offset` is older than buffer start, return full buffer.
- Backward compatible: existing `as_str_lossy()` unchanged.

## Architecture

```
Before:
  ScrollbackBuffer { data: Vec<u8>, capacity: usize }

After:
  ScrollbackBuffer { 
    data: Vec<u8>, 
    capacity: usize,
    total_written: u64  // NEW: monotonic counter
  }
```

**Offset math:**
```
buffer_start_offset = total_written - data.len()
requested_offset = from_offset.unwrap_or(0)

if requested_offset < buffer_start_offset:
    # Delta unavailable, return full buffer
    return (&data[..], total_written)
else:
    skip = requested_offset - buffer_start_offset
    return (&data[skip..], total_written)
```

## Related Code Files
- `server/src/pty/buffer.rs` — primary change

## Implementation Steps
1. Add `total_written: u64` field, initialize to 0 in `new()`.
2. Update `push()` to increment `total_written += chunk.len() as u64`.
3. Add `pub fn current_offset(&self) -> u64`.
4. Add `pub fn read_from(&self, from_offset: Option<u64>) -> (&[u8], u64)`.
5. Add unit tests for offset tracking through eviction cycles.

## Todo
- [x] Add `total_written` field
- [x] Increment in `push()`
- [x] Implement `current_offset()`
- [x] Implement `read_from()`
- [x] Unit tests (5 cases)

## Review
- **Date**: 2026-04-17
- **Score**: 9.0/10 ✅
- **Status**: APPROVED for Phase 02
- **Report**: [review-phase-01-20260417.md](./review-phase-01-20260417.md)

### Key Findings
- ✅ All requirements met
- ✅ 10/10 tests passing
- ✅ Zero breaking changes
- ✅ Minimal performance overhead
- ⚠️ Recommended: Apply `saturating_add` for u64 overflow defense
- ⚠️ Recommended: Add future offset edge case test

### Hardening Actions (Optional, ~10 min)
1. Use `saturating_add` for `total_written` increment
2. Add test: `offset_future_request()`
3. Document `clear()` behavior with offset counter

## Test Cases

| Scenario | Expected |
|----------|----------|
| Fresh buffer, read_from(None) | Full buffer, offset = len |
| After eviction, read_from(0) | Full buffer (delta unavailable) |
| After eviction, read_from(current - 10) | Last 10 bytes only |
| read_from(Some(current)) | Empty slice, current offset |
| Multiple pushes, offset monotonic | Never decreases |

## Success Criteria
- `cargo test buffer` passes with new offset tests.
- No breaking changes to existing `as_str_lossy()` / `len()` / `push()` API.

## Risk Assessment
- Low. Pure additive change to internal data structure.
- u64 overflow: at 1GB/s, would take 584 years. Not a concern.

## Next Steps
✅ **Phase 01 Complete** — Proceed to Phase 02: Protocol Extension

**Blockers**: None  
**Dependencies**: Phase 02 will use `read_from()` in WS handler for delta replay.
