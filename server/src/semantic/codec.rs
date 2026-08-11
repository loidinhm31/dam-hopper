//! Bounded LSP JSON-RPC framing.

use serde_json::Value;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

pub fn encode_frame(value: &Value) -> Result<Vec<u8>, CodecError> {
    let payload = serde_json::to_vec(value).map_err(|_| CodecError::Json)?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(CodecError::FrameTooLarge);
    }
    let mut frame = format!("Content-Length: {}\r\n\r\n", payload.len()).into_bytes();
    frame.extend_from_slice(&payload);
    Ok(frame)
}

/// Decode at most one frame. The consumed byte count allows callers to retain
/// a subsequent frame in the same stdout read buffer.
pub fn decode_frame(bytes: &[u8]) -> Result<Option<(Value, usize)>, CodecError> {
    let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(CodecError::HeaderTooLarge);
        }
        return Ok(None);
    };
    if header_end > MAX_HEADER_BYTES {
        return Err(CodecError::HeaderTooLarge);
    }
    let header =
        std::str::from_utf8(&bytes[..header_end]).map_err(|_| CodecError::InvalidHeader)?;
    let length = parse_content_length(header)?;
    let payload_start = header_end + 4;
    let payload_end = payload_start
        .checked_add(length)
        .ok_or(CodecError::FrameTooLarge)?;
    if payload_end > bytes.len() {
        return Ok(None);
    }
    let value =
        serde_json::from_slice(&bytes[payload_start..payload_end]).map_err(|_| CodecError::Json)?;
    Ok(Some((value, payload_end)))
}

pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<Value>, CodecError> {
    let mut header = Vec::with_capacity(128);
    loop {
        let byte = match reader.read_u8().await {
            Ok(byte) => byte,
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                if header.is_empty() {
                    return Ok(None);
                }
                return Err(CodecError::UnexpectedEof);
            }
            Err(_) => return Err(CodecError::Io),
        };
        header.push(byte);
        if header.len() > MAX_HEADER_BYTES {
            return Err(CodecError::HeaderTooLarge);
        }
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let header_text =
        std::str::from_utf8(&header[..header.len() - 4]).map_err(|_| CodecError::InvalidHeader)?;
    let length = parse_content_length(header_text)?;
    let mut payload = vec![0; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|_| CodecError::UnexpectedEof)?;
    serde_json::from_slice(&payload)
        .map(Some)
        .map_err(|_| CodecError::Json)
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &Value,
) -> Result<(), CodecError> {
    let frame = encode_frame(value)?;
    writer.write_all(&frame).await.map_err(|_| CodecError::Io)
}

fn parse_content_length(header: &str) -> Result<usize, CodecError> {
    let mut content_length = None;
    for line in header.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            return Err(CodecError::InvalidHeader);
        };
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(CodecError::InvalidHeader);
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| CodecError::InvalidHeader)?,
            );
        }
    }
    let length = content_length.ok_or(CodecError::MissingContentLength)?;
    if length > MAX_FRAME_BYTES {
        return Err(CodecError::FrameTooLarge);
    }
    Ok(length)
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CodecError {
    #[error("LSP frame header is invalid")]
    InvalidHeader,
    #[error("LSP frame has no Content-Length")]
    MissingContentLength,
    #[error("LSP frame header exceeds the limit")]
    HeaderTooLarge,
    #[error("LSP frame exceeds the limit")]
    FrameTooLarge,
    #[error("LSP frame is incomplete")]
    UnexpectedEof,
    #[error("LSP frame is not valid JSON")]
    Json,
    #[error("LSP frame I/O failed")]
    Io,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[test]
    fn decoder_is_bounded_and_supports_pipelined_frames() {
        let first = encode_frame(&serde_json::json!({"id": 1})).unwrap();
        let second = encode_frame(&serde_json::json!({"id": 2})).unwrap();
        let mut bytes = first.clone();
        bytes.extend(second);
        let (value, consumed) = decode_frame(&bytes).unwrap().unwrap();
        assert_eq!(value["id"], 1);
        let (value, _) = decode_frame(&bytes[consumed..]).unwrap().unwrap();
        assert_eq!(value["id"], 2);
        assert_eq!(decode_frame(b"Content-Length: 9\r\n\r\n{}"), Ok(None));
        assert_eq!(
            decode_frame(b"X: 1\r\n\r\n{}"),
            Err(CodecError::MissingContentLength)
        );
    }

    #[tokio::test]
    async fn async_reader_and_writer_preserve_json_bytes() {
        let (mut writer, mut reader) = duplex(1024);
        let value = serde_json::json!({"method": "initialize"});
        let sent_value = value.clone();
        let send = tokio::spawn(async move { write_frame(&mut writer, &sent_value).await });
        assert_eq!(read_frame(&mut reader).await.unwrap(), Some(value));
        send.await.unwrap().unwrap();
    }
}
