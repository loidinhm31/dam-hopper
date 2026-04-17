# Implementation Details: Phase 01 - Buffer Offset Tracking (F-08)

Technical documentation of the scrollback buffer offset tracking feature. Enables delta replay for WebSocket reconnect scenarios.

## Feature Overview

The ScrollbackBuffer now tracks a monotonic byte counter (`total_written: u64`) to support efficient delta replay during WebSocket reconnections. Instead of resending the entire terminal history on reconnect, the client can request only new bytes since its last known offset.

## Architecture

```
PTY Reader Thread
  ↓
Output bytes → ScrollbackBuffer.push()
  │
  ├─ Updates total_written (monotonic)
  ├─ Maintains fixed-capacity ring buffer
  └─ Evicts old data when full
  
WebSocket Reconnect
  ↓
Client sends last_offset = N
  ↓
Server calls buffer.read_from(Some(N))
  │
  ├─ If N is within buffer: (delta slice, current offset)
  └─ If N evicted: (full buffer, current offset) — fallback
```

## Code Changes

### Location: `server/src/pty/buffer.rs`

**Changed Lines**: +30 (new methods) / -8 (refactored) = net +30 lines  
**Backward Compatible**: ✅ All existing tests pass

### 1. New Field in ScrollbackBuffer Struct

```rust
pub struct ScrollbackBuffer {
    data: Vec<u8>,
    capacity: usize,
    /// Total bytes ever written (survives eviction).
    total_written: u64,
}
```

**Purpose**: Tracks cumulative bytes written, survives data eviction. Enables clients to detect if their last offset is still in the buffer.

**Invariants**:
- Always non-decreasing (monotonic)
- Updated in `push()` before any eviction logic
- Survives buffer wraparound/eviction

### 2. Constructor: No Changes Required

```rust
pub fn new(capacity: usize) -> Self {
    Self {
        data: Vec::with_capacity(capacity.min(1024 * 1024)),
        capacity,
        total_written: 0,  // New field initialized
    }
}
```

### 3. New Public Method: `current_offset()`

```rust
pub fn current_offset(&self) -> u64 {
    self.total_written
}
```

**Purpose**: Returns the total bytes ever written.

**Usage**: 
- Client can store this value after each output message
- Used as checkpoint for next reconnect

**Example**:
```rust
let offset = buffer.current_offset();  // e.g., 5 (after "hello" written)
// ... later, after reconnect ...
let (delta, new_offset) = buffer.read_from(Some(5));
```

### 4. New Public Method: `read_from()`

```rust
pub fn read_from(&self, from_offset: Option<u64>) -> (&[u8], u64) {
    let buffer_start_offset = self.total_written.saturating_sub(self.data.len() as u64);
    let requested_offset = from_offset.unwrap_or(0);

    if requested_offset < buffer_start_offset {
        // Delta unavailable, return full buffer
        (&self.data[..], self.total_written)
    } else {
        let skip = (requested_offset - buffer_start_offset) as usize;
        let skip = skip.min(self.data.len()); // Safety clamp
        (&self.data[skip..], self.total_written)
    }
}
```

**Algorithm**:

1. Calculate buffer start offset: `total_written - buffer.len()`
2. Check if requested offset is still in buffer
3. If yes: return only new bytes (delta)
4. If no (evicted): return entire buffer (fallback)

**Logic Explanation**:

| Scenario | requested_offset | buffer_start_offset | Result |
|----------|-----------------|-------------------|--------|
| Fresh connect | `None` | e.g., 0 | Full buffer |
| Delta available | 5 | 5 | Slice from byte 5 → end |
| Offset too old | 1 | 5 | Full buffer (delta lost) |
| Exact current | 10 | 10 | Empty slice (no new bytes) |

**Return Value**: `(data_slice: &[u8], current_offset: u64)`

- `data_slice`: Requested bytes or fallback to full buffer
- `current_offset`: Current total offset for client to store

### 5. Offset Calculation Safety

**Saturation**: Uses `saturating_sub` to prevent underflow if `data.len() > total_written` (should not happen but defensive).

**Clamp**: `skip.min(self.data.len())` prevents out-of-bounds if offset calculation incorrect.

## Unit Tests Added

**Location**: `server/src/pty/buffer.rs` — lines ~135–205  
**Total Tests**: 5 new + 4 existing = 9 total

### Test 1: `offset_tracking_fresh_buffer`

```rust
#[test]
fn offset_tracking_fresh_buffer() {
    let mut buf = ScrollbackBuffer::new(100);
    buf.push(b"hello");
    assert_eq!(buf.current_offset(), 5);

    let (data, offset) = buf.read_from(None);
    assert_eq!(data, b"hello");
    assert_eq!(offset, 5);
}
```

**Validates**: 
- `current_offset()` returns correct sum of bytes written
- `read_from(None)` returns full buffer on fresh connect

### Test 2: `offset_tracking_after_eviction`

```rust
#[test]
fn offset_tracking_after_eviction() {
    let mut buf = ScrollbackBuffer::new(10);
    buf.push(b"1234567890"); // offset = 10
    buf.push(b"abcdef");     // offset = 16, buffer = "7890abcdef" (evicted "1-6")
    assert_eq!(buf.current_offset(), 16);

    // Request from offset 0 (evicted) — should return full buffer
    let (data, offset) = buf.read_from(Some(0));
    assert_eq!(data, b"7890abcdef");
    assert_eq!(offset, 16);
}
```

**Validates**:
- `total_written` continues after eviction
- `read_from()` detects when offset is outside buffer bounds
- Fallback to full buffer when delta unavailable

### Test 3: `offset_tracking_delta_replay`

```rust
#[test]
fn offset_tracking_delta_replay() {
    let mut buf = ScrollbackBuffer::new(20);
    buf.push(b"1234567890"); // offset = 10
    buf.push(b"abcdef");     // offset = 16

    // Request last 6 bytes (from offset 10)
    let (data, offset) = buf.read_from(Some(10));
    assert_eq!(data, b"abcdef");
    assert_eq!(offset, 16);
}
```

**Validates**: 
- `read_from()` calculates correct delta slice
- Returns only new bytes since last offset

### Test 4: `offset_tracking_exact_current`

```rust
#[test]
fn offset_tracking_exact_current() {
    let mut buf = ScrollbackBuffer::new(20);
    buf.push(b"hello");

    // Request from current offset — should return empty slice
    let (data, offset) = buf.read_from(Some(5));
    assert_eq!(data, b"");
    assert_eq!(offset, 5);
}
```

**Validates**:
- Edge case: client already has latest offset
- Returns empty slice (no new data)
- Does not error or panic

### Test 5: `offset_monotonic_increases`

```rust
#[test]
fn offset_monotonic_increases() {
    let mut buf = ScrollbackBuffer::new(10);
    let mut prev_offset = 0;

    for _ in 0..10 {
        buf.push(b"abc");
        let current = buf.current_offset();
        assert!(current > prev_offset, "Offset should monotonically increase");
        prev_offset = current;
    }

    assert_eq!(prev_offset, 30); // 10 pushes × 3 bytes
}
```

**Validates**: 
- Monotonic property under repeated writes
- No reset or drift in counter

## Regression Testing

All existing tests continue to pass:
- ✅ `basic_push_within_capacity` 
- ✅ `evicts_oldest_bytes_when_full`
- ✅ `chunk_larger_than_capacity`
- ✅ `empty_push_is_noop`

**Backward Compatibility**: New field `total_written` is initialized at construction and automatically updated. No changes to existing method signatures.

## Performance Notes

**Memory**: +8 bytes per buffer instance (u64 for `total_written`)  
**CPU**: +0 — offset tracking is free; u64 addition during push is negligible  
**Buffer Logic**: No change to ring buffer eviction algorithm; offset calculation happens at read time only

## Integration with Phase 02+

**Phase 01 Deliverable**: Buffer infrastructure ready for delta replay
- ✅ Monotonic offset tracking
- ✅ `current_offset()` API for client checkpoint
- ✅ `read_from()` API for efficient reconnect replay
- ✅ Full fallback when delta unavailable

**Phase 02 (WebSocket Reconnect)**: Client will:
1. Store `offset` after each terminal output message
2. On reconnect, send last `offset` to server
3. Server calls `buffer.read_from(Some(offset))`
4. Client receives delta (or full buffer if too old)
5. Client renders only new bytes to terminal

**No Blocked Dependencies**: Phase 01 is standalone; no changes to WebSocket protocol or client required this phase.

## Files Modified

| File | Change Type | Lines | Details |
|------|------------|-------|---------|
| `server/src/pty/buffer.rs` | Modified | +30/-8 | Added field, two new methods, five unit tests |

## API Surface (Public)

**New Public Methods**:
```rust
impl ScrollbackBuffer {
    pub fn current_offset(&self) -> u64;
    pub fn read_from(&self, from_offset: Option<u64>) -> (&[u8], u64);
}
```

**Existing Public Methods** (unchanged):
```rust
pub fn new(capacity: usize) -> Self
pub fn push(&mut self, chunk: &[u8])
pub fn as_str_lossy(&self) -> Cow<'_, str>
pub fn len(&self) -> usize
pub fn is_empty(&self) -> bool
pub fn clear(&mut self)
```

## Design Decisions

### Why Saturating Subtraction?

`self.total_written.saturating_sub(self.data.len() as u64)` prevents panic if buffer state is corrupted. In practice, `total_written` >= buffer length always, but defensive coding prevents subtle bugs.

### Why Option<u64> for read_from()?

`from_offset: Option<u64>` with `None` defaulting to full buffer. Common case: fresh connect uses `None`, reconnect uses `Some(last_offset)`. This mirrors typical API patterns and avoids 0-vs-None ambiguity.

### Why Return Tuple (slice, offset)?

Returning both (`&[u8], u64`) allows client to:
1. Process data immediately (slice)
2. Store new offset for next reconnect (current offset)

Single return value would force two API calls.

## Testing Commands

Run all buffer tests:
```bash
cd server
cargo test pty::buffer::
```

Run specific test:
```bash
cargo test pty::buffer::offset_tracking_delta_replay
```

Run with output:
```bash
cargo test pty::buffer:: -- --nocapture
```

Test results (all passing):
```
test pty::buffer::basic_push_within_capacity ... ok
test pty::buffer::chunk_larger_than_capacity ... ok
test pty::buffer::empty_push_is_noop ... ok
test pty::buffer::evicts_oldest_bytes_when_full ... ok
test pty::buffer::offset_monotonic_increases ... ok
test pty::buffer::offset_tracking_after_eviction ... ok
test pty::buffer::offset_tracking_delta_replay ... ok
test pty::buffer::offset_tracking_exact_current ... ok
test pty::buffer::offset_tracking_fresh_buffer ... ok
```

## Future Extensions

**Phase 08+**: Consider adding:
- Buffer snapshot serialization (for persistent storage)
- Offset indexing (map offset → byte position for O(1) lookup)
- Memory statistics API (total evicted, checkpoint efficiency)
