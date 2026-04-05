/// Fixed-capacity scrollback buffer storing raw terminal bytes.
///
/// Maintains the last `capacity` bytes — older data is evicted when full.
/// UTF-8 is not enforced; the terminal emulator (xterm.js) handles decoding.
pub struct ScrollbackBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl ScrollbackBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity.min(1024 * 1024)),
            capacity,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
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
}
