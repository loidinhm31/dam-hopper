/// A normalized, inclusive HTTP byte range.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    pub(crate) fn len(self) -> Option<u64> {
        self.end.checked_sub(self.start)?.checked_add(1)
    }
}

/// Parse exactly one `Range: bytes=...` value for a representation of `size` bytes.
/// Multipart ranges are deliberately unsupported.
pub(crate) fn parse_single_range(value: &str, size: u64) -> Result<ByteRange, ()> {
    if size == 0 {
        return Err(());
    }
    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.contains(',') {
        return Err(());
    }
    let (first, last) = range.split_once('-').ok_or(())?;
    if last.contains('-') {
        return Err(());
    }

    if first.is_empty() {
        let suffix = parse_u64(last)?;
        if suffix == 0 {
            return Err(());
        }
        let len = suffix.min(size);
        return Ok(ByteRange {
            start: size - len,
            end: size - 1,
        });
    }

    let start = parse_u64(first)?;
    if start >= size {
        return Err(());
    }
    let end = if last.is_empty() {
        size - 1
    } else {
        parse_u64(last)?.min(size - 1)
    };
    if start > end {
        return Err(());
    }
    Ok(ByteRange { start, end })
}

fn parse_u64(value: &str) -> Result<u64, ()> {
    (!value.is_empty())
        .then_some(value)
        .ok_or(())?
        .parse()
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{parse_single_range, ByteRange};

    #[test]
    fn parses_closed_open_and_suffix_ranges() {
        assert_eq!(
            parse_single_range("bytes=2-4", 10),
            Ok(ByteRange { start: 2, end: 4 })
        );
        assert_eq!(
            parse_single_range("bytes=8-99", 10),
            Ok(ByteRange { start: 8, end: 9 })
        );
        assert_eq!(
            parse_single_range("bytes=8-", 10),
            Ok(ByteRange { start: 8, end: 9 })
        );
        assert_eq!(
            parse_single_range("bytes=-3", 10),
            Ok(ByteRange { start: 7, end: 9 })
        );
        assert_eq!(
            parse_single_range("bytes=-99", 10),
            Ok(ByteRange { start: 0, end: 9 })
        );
    }

    #[test]
    fn rejects_empty_overflow_and_unsupported_ranges() {
        for value in [
            "bytes=",
            "bytes=-",
            "bytes=-0",
            "bytes=4-3",
            "bytes=10-",
            "bytes=0-1,3-4",
            "bytes=0-1-2",
            "items=0-1",
            "bytes=18446744073709551616-",
            "bytes=0-18446744073709551616",
        ] {
            assert!(parse_single_range(value, 10).is_err(), "{value}");
        }
        assert!(parse_single_range("bytes=0-0", 0).is_err());
    }

    #[test]
    fn length_is_checked_without_overflow() {
        assert_eq!(
            ByteRange {
                start: 0,
                end: u64::MAX - 1
            }
            .len(),
            Some(u64::MAX)
        );
        assert_eq!(
            ByteRange {
                start: 0,
                end: u64::MAX
            }
            .len(),
            None
        );
        assert_eq!(
            parse_single_range("bytes=0-", u64::MAX),
            Ok(ByteRange {
                start: 0,
                end: u64::MAX - 1
            })
        );
    }
}
