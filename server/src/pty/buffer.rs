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
                self.data.extend_from_slice(&chunk[chunk.len() - chunk_keep..]);
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
        buf.push(b"abcdef");     // offset = 16, buffer = "4567890abc" + "def" (evicted 1-6)
        assert_eq!(buf.current_offset(), 16);

        // Request from offset 0 (evicted) — should return full buffer
        let (data, offset) = buf.read_from(Some(0));
        assert_eq!(data, b"7890abcdef");
        assert_eq!(offset, 16);
    }

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
            assert!(current > prev_offset, "Offset should monotonically increase");
            prev_offset = current;
        }

        assert_eq!(prev_offset, 30); // 10 pushes × 3 bytes
    }
}
