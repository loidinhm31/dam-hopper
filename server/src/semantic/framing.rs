use std::io;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::resources::{MAX_FRAME_BODY_BYTES, MAX_STDIO_HEADER_BYTES};

/// Maximum allowed header size (8 KiB) to prevent memory exhaustion from runaway headers.
pub const MAX_HEADER_SIZE: usize = MAX_STDIO_HEADER_BYTES;

/// Maximum allowed LSP body size (4 MiB) matching gateway and framing policy.
pub const MAX_BODY_SIZE: usize = MAX_FRAME_BODY_BYTES;

#[derive(Debug, Error)]
pub enum FramingError {
    #[error("LSP header exceeds maximum allowed size of {MAX_HEADER_SIZE} bytes")]
    HeaderTooLarge,

    #[error("Missing Content-Length header in LSP frame")]
    MissingContentLength,

    #[error("Duplicate Content-Length header in LSP frame")]
    DuplicateContentLength,

    #[error("Invalid Content-Length header format")]
    InvalidContentLength,

    #[error("Malformed header line (missing colon separator)")]
    MalformedHeader,
    #[error("LSP body size ({0} bytes) exceeds maximum allowed size of {MAX_BODY_SIZE} bytes")]
    BodyTooLarge(usize),

    #[error("Invalid UTF-8 sequence in LSP message body: {0}")]
    InvalidUtf8(#[from] std::str::Utf8Error),

    #[error("Invalid JSON syntax in LSP message body: {0}")]
    InvalidJson(#[from] serde_json::Error),

    #[error("I/O error during LSP framing: {0}")]
    Io(#[from] io::Error),

    #[error("Unexpected EOF while reading LSP frame (incomplete frame)")]
    UnexpectedEof,

    #[error(
        "Truncated LSP body: expected {expected} bytes, but stream ended after {actual} bytes"
    )]
    TruncatedBody { expected: usize, actual: usize },
}

/// Parses a single complete LSP frame from `buffer`, draining consumed bytes if successful.
///
/// Returns:
/// - `Ok(Some(body_bytes))` if a full valid frame was parsed (bytes are drained from buffer).
/// - `Ok(None)` if buffer does not yet contain a complete header or body (buffer remains intact).
/// - `Err(FramingError)` if header or body limits or syntax rules are violated.
pub fn parse_frame(buffer: &mut Vec<u8>) -> Result<Option<Vec<u8>>, FramingError> {
    let header_delim = b"\r\n\r\n";
    let delim_pos = buffer
        .windows(header_delim.len())
        .position(|window| window == header_delim);

    let (header_end, delim_len) = match delim_pos {
        Some(pos) => (pos, 4),
        None => {
            if buffer.len() > MAX_HEADER_SIZE {
                return Err(FramingError::HeaderTooLarge);
            }
            return Ok(None);
        }
    };

    if header_end > MAX_HEADER_SIZE {
        return Err(FramingError::HeaderTooLarge);
    }

    let header_str = match std::str::from_utf8(&buffer[..header_end]) {
        Ok(s) => s,
        Err(_) => return Err(FramingError::InvalidContentLength),
    };

    let mut content_length: Option<usize> = None;

    for line in header_str.split("\r\n") {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or(FramingError::MalformedHeader)?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(FramingError::DuplicateContentLength);
            }
            let val_str = value.trim();
            if val_str.is_empty() || !val_str.chars().all(|c| c.is_ascii_digit()) {
                return Err(FramingError::InvalidContentLength);
            }
            let parsed = val_str
                .parse::<usize>()
                .map_err(|_| FramingError::InvalidContentLength)?;
            if parsed > MAX_BODY_SIZE {
                return Err(FramingError::BodyTooLarge(parsed));
            }
            content_length = Some(parsed);
        }
    }

    let body_len = content_length.ok_or(FramingError::MissingContentLength)?;
    let total_required = header_end + delim_len + body_len;

    if buffer.len() < total_required {
        return Ok(None);
    }

    // Drain the complete frame from the front of the buffer
    let mut frame_bytes = buffer.drain(..total_required).collect::<Vec<u8>>();
    let body_bytes = frame_bytes.split_off(header_end + delim_len);

    // Validate UTF-8 body
    std::str::from_utf8(&body_bytes)?;

    // Validate JSON structure
    serde_json::from_slice::<serde_json::Value>(&body_bytes)?;

    Ok(Some(body_bytes))
}

/// Encodes a UTF-8 JSON message into standard LSP `Content-Length: <n>\r\n\r\n<body>` format.
pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, FramingError> {
    if payload.len() > MAX_BODY_SIZE {
        return Err(FramingError::BodyTooLarge(payload.len()));
    }
    std::str::from_utf8(payload)?;
    serde_json::from_slice::<serde_json::Value>(payload)?;
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    let mut out = Vec::with_capacity(header.len() + payload.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Asynchronous framed LSP reader with bounded internal buffering.
pub struct AsyncLspReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: AsyncRead + Unpin> AsyncLspReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::with_capacity(8192),
        }
    }

    /// Reads the next complete LSP message. Returns `None` on clean EOF when buffer is empty.
    pub async fn read_message(&mut self) -> Result<Option<Vec<u8>>, FramingError> {
        loop {
            if let Some(msg) = parse_frame(&mut self.buffer)? {
                return Ok(Some(msg));
            }

            let mut chunk = [0u8; 8192];
            let n = self.reader.read(&mut chunk).await?;
            if n == 0 {
                if self.buffer.is_empty() {
                    return Ok(None);
                } else {
                    return Err(FramingError::UnexpectedEof);
                }
            }

            if self.buffer.len() + n > MAX_HEADER_SIZE + MAX_BODY_SIZE + 1024 {
                return Err(FramingError::BodyTooLarge(self.buffer.len() + n));
            }

            self.buffer.extend_from_slice(&chunk[..n]);
        }
    }
}

/// Asynchronous framed LSP writer.
pub struct AsyncLspWriter<W> {
    writer: W,
}

impl<W: AsyncWrite + Unpin> AsyncLspWriter<W> {
    pub fn new(writer: W) -> Self {
        Self { writer }
    }

    pub async fn write_message(&mut self, payload: &[u8]) -> Result<(), FramingError> {
        let frame = encode_frame(payload)?;
        self.writer.write_all(&frame).await?;
        self.writer.flush().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_parse_simple() {
        let payload = br#"{"jsonrpc":"2.0","method":"test","params":{}}"#;
        let encoded = encode_frame(payload).expect("encode should succeed");
        let mut buffer = encoded.clone();
        let parsed = parse_frame(&mut buffer).expect("parse should succeed");
        assert_eq!(parsed, Some(payload.to_vec()));
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_astral_unicode_byte_length() {
        // "🚀" is 4 bytes in UTF-8
        let payload = r#"{"msg":"🚀"}"#.as_bytes();
        let encoded = encode_frame(payload).unwrap();
        assert!(
            encoded.starts_with(format!("Content-Length: {}\r\n\r\n", payload.len()).as_bytes())
        );
        let mut buf = encoded;
        let parsed = parse_frame(&mut buf).unwrap();
        assert_eq!(parsed, Some(payload.to_vec()));
    }

    #[test]
    fn test_split_frames_and_coalesced() {
        let msg1 = br#"{"id":1}"#;
        let msg2 = br#"{"id":2}"#;
        let mut encoded = encode_frame(msg1).unwrap();
        encoded.extend_from_slice(&encode_frame(msg2).unwrap());

        let mut buffer = Vec::new();
        // Feed byte by byte
        let mut parsed_messages = Vec::new();
        for b in encoded {
            buffer.push(b);
            if let Some(msg) = parse_frame(&mut buffer).unwrap() {
                parsed_messages.push(msg);
            }
        }
        assert_eq!(parsed_messages.len(), 2);
        assert_eq!(parsed_messages[0], msg1.to_vec());
        assert_eq!(parsed_messages[1], msg2.to_vec());
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_header_too_large() {
        let mut huge_header = vec![b'A'; MAX_HEADER_SIZE + 10];
        let err = parse_frame(&mut huge_header).unwrap_err();
        assert!(matches!(err, FramingError::HeaderTooLarge));
    }

    #[test]
    fn test_body_too_large() {
        let mut buf = format!("Content-Length: {}\r\n\r\n", MAX_BODY_SIZE + 1).into_bytes();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::BodyTooLarge(_)));
    }

    #[test]
    fn test_duplicate_content_length() {
        let mut buf = b"Content-Length: 10\r\nContent-Length: 10\r\n\r\n0123456789".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::DuplicateContentLength));
    }

    #[test]
    fn test_invalid_json() {
        let mut buf = b"Content-Length: 4\r\n\r\n{bad".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::InvalidJson(_)));
    }

    #[test]
    fn test_invalid_utf8() {
        let mut buf = b"Content-Length: 2\r\n\r\n\xFF\xFE".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::InvalidUtf8(_)));
    }

    #[test]
    fn test_extra_headers_and_case_insensitivity() {
        let payload = br#"{"id":100}"#;
        let raw = format!(
            "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: {}\r\nX-Custom: test\r\n\r\n{}",
            payload.len(),
            std::str::from_utf8(payload).unwrap()
        );
        let mut buf = raw.into_bytes();
        let parsed = parse_frame(&mut buf).unwrap();
        assert_eq!(parsed, Some(payload.to_vec()));
        assert!(buf.is_empty());
    }

    #[test]
    fn test_invalid_content_length_format() {
        let mut buf = b"Content-Length: not-a-number\r\n\r\n{}".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::InvalidContentLength));
    }

    #[test]
    fn test_malformed_header_no_colon() {
        let mut buf = b"InvalidHeaderLineWithoutColon\r\n\r\n{}".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::MalformedHeader));
    }

    #[test]
    fn test_missing_content_length() {
        let mut buf = b"Content-Type: application/json\r\n\r\n{}".to_vec();
        let err = parse_frame(&mut buf).unwrap_err();
        assert!(matches!(err, FramingError::MissingContentLength));
    }

    #[tokio::test]
    async fn test_async_reader_writer_roundtrip() {
        let (client_io, server_io) = tokio::io::duplex(1024);
        let mut writer = AsyncLspWriter::new(client_io);
        let mut reader = AsyncLspReader::new(server_io);

        let msg = br#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#;
        writer.write_message(msg).await.expect("write message");

        let read_back = reader.read_message().await.expect("read message");
        assert_eq!(read_back, Some(msg.to_vec()));
    }
}
