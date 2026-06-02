/// Fixed-capacity scrollback buffer storing raw terminal bytes.
///
/// Maintains the last `capacity` bytes — older data is evicted when full.
/// UTF-8 is not enforced; the terminal emulator (xterm.js) handles decoding.
///
/// Tracks a monotonic byte counter (`total_written`) for delta replay support.
pub struct ScrollbackBuffer {
    data: Vec<u8>,
    capacity: usize,
    /// Total bytes ever written (survives eviction).
    total_written: u64,
}

pub struct BufferReplay<'a> {
    pub data: &'a [u8],
    pub offset: u64,
    pub reset: bool,
    pub truncated: bool,
}

impl ScrollbackBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity.min(1024 * 1024)),
            capacity,
            total_written: 0,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.total_written += chunk.len() as u64;

        let total = self.data.len() + chunk.len();
        if total > self.capacity {
            let keep_from = total - self.capacity;
            if keep_from >= self.data.len() {
                // chunk alone exceeds capacity — keep its tail
                let chunk_keep = chunk.len() - (keep_from - self.data.len());
                self.data.clear();
                self.data
                    .extend_from_slice(&chunk[chunk.len() - chunk_keep..]);
            } else {
                self.data.drain(..keep_from);
                self.data.extend_from_slice(chunk);
            }
        } else {
            self.data.extend_from_slice(chunk);
        }
    }

    /// Returns the current byte offset (total bytes ever written).
    pub fn current_offset(&self) -> u64 {
        self.total_written
    }

    /// Reads buffer data from a given offset.
    ///
    /// If `from_offset` is older than buffer start, returns the full buffer.
    /// Returns a tuple of (data slice, current offset).
    pub fn read_from(&self, from_offset: Option<u64>) -> (&[u8], u64) {
        let replay = self.read_replay(from_offset);
        (replay.data, replay.offset)
    }

    /// Reads buffer data with replay metadata for websocket attach.
    ///
    /// `reset=true` means the client must clear terminal display and write the
    /// returned snapshot. `reset=false` means the returned bytes are a delta.
    /// `truncated=true` means the requested offset was older than retained tail.
    pub fn read_replay(&self, from_offset: Option<u64>) -> BufferReplay<'_> {
        let buffer_start_offset = self.total_written.saturating_sub(self.data.len() as u64);
        let Some(requested_offset) = from_offset else {
            return BufferReplay {
                data: &self.data,
                offset: self.total_written,
                reset: true,
                truncated: false,
            };
        };

        if requested_offset < buffer_start_offset {
            BufferReplay {
                data: &self.data,
                offset: self.total_written,
                reset: true,
                truncated: true,
            }
        } else if requested_offset > self.total_written {
            BufferReplay {
                data: &self.data,
                offset: self.total_written,
                reset: true,
                truncated: false,
            }
        } else {
            let skip = (requested_offset - buffer_start_offset) as usize;
            let skip = skip.min(self.data.len()); // Safety clamp
            BufferReplay {
                data: &self.data[skip..],
                offset: self.total_written,
                reset: false,
                truncated: false,
            }
        }
    }

    /// Returns a snapshot of the current buffer data and total_written offset.
    /// Used by persist worker to clone buffer state without blocking writer.
    pub fn snapshot(&self) -> (Vec<u8>, u64) {
        (self.data.clone(), self.total_written)
    }

    /// Returns buffer contents as a lossy UTF-8 string (matches Node impl behaviour).
    pub fn as_str_lossy(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.data)
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }

    /// Seed an empty buffer with persisted data (e.g. on startup restore).
    /// Keeps only the tail that fits within `capacity` and preserves the
    /// original `total_written` so delta replay offsets stay monotonic.
    pub fn hydrate(&mut self, data: &[u8], total_written: u64) {
        self.data.clear();
        let keep = data.len().min(self.capacity);
        let start = data.len() - keep;
        self.data.extend_from_slice(&data[start..]);
        self.total_written = total_written;
    }

    /// Seed persisted data before bytes already captured from the relaunched PTY.
    pub fn hydrate_prefix(&mut self, data: &[u8], total_written: u64) {
        let (suffix, suffix_total_written) = self.snapshot();
        let mut combined = Vec::with_capacity(data.len().saturating_add(suffix.len()));
        combined.extend_from_slice(data);
        combined.extend_from_slice(&suffix);
        self.hydrate(
            &combined,
            total_written.saturating_add(suffix_total_written),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_push_within_capacity() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"hello");
        assert_eq!(buf.as_str_lossy(), "hello");
        assert_eq!(buf.len(), 5);
    }

    #[test]
    fn evicts_oldest_bytes_when_full() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"1234567890");
        buf.push(b"abc");
        assert_eq!(buf.as_str_lossy(), "4567890abc");
    }

    #[test]
    fn chunk_larger_than_capacity() {
        let mut buf = ScrollbackBuffer::new(5);
        buf.push(b"0123456789");
        assert_eq!(buf.as_str_lossy(), "56789");
    }

    #[test]
    fn empty_push_is_noop() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"");
        assert!(buf.is_empty());
    }

    #[test]
    fn offset_tracking_fresh_buffer() {
        let mut buf = ScrollbackBuffer::new(100);
        buf.push(b"hello");
        assert_eq!(buf.current_offset(), 5);

        let (data, offset) = buf.read_from(None);
        assert_eq!(data, b"hello");
        assert_eq!(offset, 5);
    }

    #[test]
    fn offset_tracking_after_eviction() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"1234567890"); // offset = 10
        buf.push(b"abcdef"); // offset = 16, buffer = "4567890abc" + "def" (evicted 1-6)
        assert_eq!(buf.current_offset(), 16);

        // Request from offset 0 (evicted) — should return full buffer
        let (data, offset) = buf.read_from(Some(0));
        assert_eq!(data, b"7890abcdef");
        assert_eq!(offset, 16);
    }

    #[test]
    fn replay_metadata_marks_full_delta_and_truncated() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"1234567890");
        buf.push(b"abcdef");

        let full = buf.read_replay(None);
        assert_eq!(full.data, b"7890abcdef");
        assert_eq!(full.offset, 16);
        assert!(full.reset);
        assert!(!full.truncated);

        let delta = buf.read_replay(Some(10));
        assert_eq!(delta.data, b"abcdef");
        assert_eq!(delta.offset, 16);
        assert!(!delta.reset);
        assert!(!delta.truncated);

        let truncated = buf.read_replay(Some(1));
        assert_eq!(truncated.data, b"7890abcdef");
        assert!(truncated.reset);
        assert!(truncated.truncated);
    }

    #[test]
    fn retains_one_megabyte_tail() {
        let mut buf = ScrollbackBuffer::new(crate::pty::session::SCROLLBACK_CAPACITY);
        let chunk = vec![b'a'; crate::pty::session::SCROLLBACK_CAPACITY + 128];
        buf.push(&chunk);

        assert_eq!(buf.len(), crate::pty::session::SCROLLBACK_CAPACITY);
        assert_eq!(buf.current_offset(), chunk.len() as u64);

        let replay = buf.read_replay(Some(0));
        assert!(replay.reset);
        assert!(replay.truncated);
        assert_eq!(replay.data.len(), crate::pty::session::SCROLLBACK_CAPACITY);
    }

    #[test]
    fn offset_tracking_delta_replay() {
        let mut buf = ScrollbackBuffer::new(20);
        buf.push(b"1234567890"); // offset = 10
        buf.push(b"abcdef"); // offset = 16

        // Request last 6 bytes (from offset 10)
        let (data, offset) = buf.read_from(Some(10));
        assert_eq!(data, b"abcdef");
        assert_eq!(offset, 16);
    }

    #[test]
    fn offset_tracking_exact_current() {
        let mut buf = ScrollbackBuffer::new(20);
        buf.push(b"hello");

        // Request from current offset — should return empty slice
        let (data, offset) = buf.read_from(Some(5));
        assert_eq!(data, b"");
        assert_eq!(offset, 5);
    }

    #[test]
    fn offset_monotonic_increases() {
        let mut buf = ScrollbackBuffer::new(10);
        let mut prev_offset = 0;

        for _ in 0..10 {
            buf.push(b"abc");
            let current = buf.current_offset();
            assert!(
                current > prev_offset,
                "Offset should monotonically increase"
            );
            prev_offset = current;
        }

        assert_eq!(prev_offset, 30); // 10 pushes × 3 bytes
    }
}
