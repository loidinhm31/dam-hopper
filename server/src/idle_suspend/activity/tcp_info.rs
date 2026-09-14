//! Bounded Linux `tcp_info` attribute prefix parser.
//!
//! Linux `INET_DIAG_INFO` carries a native `tcp_info` byte payload. The cumulative
//! byte counters are located at stable offsets in the prefix:
//! - `tcpi_bytes_received`: bytes 128..136 (u64, native endian)
//! - `tcpi_bytes_sent`: bytes 200..208 (u64, native endian)
//!
//! A payload shorter than 208 bytes is rejected. Extended payloads longer than 208 bytes
//! are safely accepted by reading only the required stable prefix without relying on
//! `size_of::<libc::tcp_info>()` or casting raw bytes to local C structures.

/// Minimum prefix length in bytes required to extract cumulative TCP byte counters.
pub(crate) const TCP_INFO_REQUIRED_PREFIX_BYTES: usize = 208;

/// Byte offset of `tcpi_bytes_received` in `tcp_info`.
const TCPI_BYTES_RECEIVED_OFFSET: usize = 128;

/// Byte offset of `tcpi_bytes_sent` in `tcp_info`.
const TCPI_BYTES_SENT_OFFSET: usize = 200;

/// Size of each 64-bit counter in bytes.
const COUNTER_BYTE_LEN: usize = 8;

/// Cumulative TCP byte counters extracted from `tcp_info`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct TcpCounters {
    pub(crate) bytes_received: u64,
    pub(crate) bytes_sent: u64,
}

/// Closed error type for `tcp_info` prefix parsing.
///
/// Intentionally does not capture or format raw byte values to prevent information leakage.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum TcpInfoParseError {
    #[error("tcp_info payload too short: {actual} bytes (expected at least {required})")]
    TooShort { actual: usize, required: usize },
}

/// Parse cumulative byte counters from a raw `tcp_info` attribute slice.
///
/// Requires at least 208 bytes. Ignores trailing kernel extension fields.
pub(crate) fn parse_counters(bytes: &[u8]) -> Result<TcpCounters, TcpInfoParseError> {
    if bytes.len() < TCP_INFO_REQUIRED_PREFIX_BYTES {
        return Err(TcpInfoParseError::TooShort {
            actual: bytes.len(),
            required: TCP_INFO_REQUIRED_PREFIX_BYTES,
        });
    }

    let rx_end = TCPI_BYTES_RECEIVED_OFFSET + COUNTER_BYTE_LEN;
    let tx_end = TCPI_BYTES_SENT_OFFSET + COUNTER_BYTE_LEN;

    // Checked slice boundaries are guaranteed by bytes.len() >= 208, but we use try_into safely:
    let rx_bytes: [u8; 8] = bytes[TCPI_BYTES_RECEIVED_OFFSET..rx_end]
        .try_into()
        .map_err(|_| TcpInfoParseError::TooShort {
            actual: bytes.len(),
            required: TCP_INFO_REQUIRED_PREFIX_BYTES,
        })?;

    let tx_bytes: [u8; 8] = bytes[TCPI_BYTES_SENT_OFFSET..tx_end]
        .try_into()
        .map_err(|_| TcpInfoParseError::TooShort {
            actual: bytes.len(),
            required: TCP_INFO_REQUIRED_PREFIX_BYTES,
        })?;

    Ok(TcpCounters {
        bytes_received: u64::from_ne_bytes(rx_bytes),
        bytes_sent: u64::from_ne_bytes(tx_bytes),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn test_parse_counters_exact_minimum_length() {
        let mut fixture = vec![0u8; TCP_INFO_REQUIRED_PREFIX_BYTES];
        let expected_rx: u64 = 0x0102030405060708;
        let expected_tx: u64 = 0x1112131415161718;

        fixture[TCPI_BYTES_RECEIVED_OFFSET..TCPI_BYTES_RECEIVED_OFFSET + 8]
            .copy_from_slice(&expected_rx.to_ne_bytes());
        fixture[TCPI_BYTES_SENT_OFFSET..TCPI_BYTES_SENT_OFFSET + 8]
            .copy_from_slice(&expected_tx.to_ne_bytes());

        let counters = parse_counters(&fixture).expect("valid 208-byte prefix must parse");
        assert_eq!(
            counters,
            TcpCounters {
                bytes_received: expected_rx,
                bytes_sent: expected_tx,
            }
        );
    }

    #[test]
    fn test_parse_counters_extended_length_accepted() {
        let mut fixture = vec![0xAAu8; 320]; // 320 bytes (longer than 208)
        let expected_rx: u64 = 9_999_999;
        let expected_tx: u64 = 42_000_000;

        fixture[TCPI_BYTES_RECEIVED_OFFSET..TCPI_BYTES_RECEIVED_OFFSET + 8]
            .copy_from_slice(&expected_rx.to_ne_bytes());
        fixture[TCPI_BYTES_SENT_OFFSET..TCPI_BYTES_SENT_OFFSET + 8]
            .copy_from_slice(&expected_tx.to_ne_bytes());

        let counters = parse_counters(&fixture).expect("longer prefix must parse safely");
        assert_eq!(
            counters,
            TcpCounters {
                bytes_received: expected_rx,
                bytes_sent: expected_tx,
            }
        );
    }

    #[test]
    fn test_parse_counters_too_short_rejected() {
        // 207 bytes: exactly 1 byte short of the 208-byte required prefix
        let fixture_207 = vec![0u8; 207];
        assert_eq!(
            parse_counters(&fixture_207),
            Err(TcpInfoParseError::TooShort {
                actual: 207,
                required: 208,
            })
        );

        // 0 bytes
        assert_eq!(
            parse_counters(&[]),
            Err(TcpInfoParseError::TooShort {
                actual: 0,
                required: 208,
            })
        );

        // 128 bytes (rx starts here, but not 208)
        let fixture_128 = vec![0u8; 128];
        assert_eq!(
            parse_counters(&fixture_128),
            Err(TcpInfoParseError::TooShort {
                actual: 128,
                required: 208,
            })
        );

        // 200 bytes (tx starts here, but not 208)
        let fixture_200 = vec![0u8; 200];
        assert_eq!(
            parse_counters(&fixture_200),
            Err(TcpInfoParseError::TooShort {
                actual: 200,
                required: 208,
            })
        );
    }

    #[test]
    fn test_parse_counters_endianness() {
        let mut fixture = vec![0u8; TCP_INFO_REQUIRED_PREFIX_BYTES];
        let rx_val = 1u64;
        let tx_val = 2u64;
        fixture[TCPI_BYTES_RECEIVED_OFFSET..TCPI_BYTES_RECEIVED_OFFSET + 8]
            .copy_from_slice(&rx_val.to_ne_bytes());
        fixture[TCPI_BYTES_SENT_OFFSET..TCPI_BYTES_SENT_OFFSET + 8]
            .copy_from_slice(&tx_val.to_ne_bytes());

        let counters = parse_counters(&fixture).unwrap();
        assert_eq!(counters.bytes_received, 1);
        assert_eq!(counters.bytes_sent, 2);
    }
}
