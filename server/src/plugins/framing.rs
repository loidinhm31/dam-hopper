use super::error::PluginError;
use serde::Deserialize;

pub const FRAME_HEADER_LEN: usize = 4;
pub const MAX_FRAME_PAYLOAD_BYTES: usize = 16 * 1024 * 1024; // 16 MiB
pub const MAX_CONTROL_FRAME_BYTES: usize = 64 * 1024; // 64 KiB
pub const MAX_AGGREGATE_BUFFER_BYTES: usize = 64 * 1024 * 1024; // 64 MiB

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, PluginError> {
    let len = payload.len();
    if len > MAX_FRAME_PAYLOAD_BYTES {
        return Err(PluginError::overloaded(format!(
            "Frame size {} exceeds maximum allowed payload of {} bytes",
            len, MAX_FRAME_PAYLOAD_BYTES
        )));
    }
    let mut out = Vec::with_capacity(FRAME_HEADER_LEN + len);
    let len_u32 = u32::try_from(len).map_err(|_| {
        PluginError::invalid_input("Frame length does not fit into 32-bit unsigned integer")
    })?;
    out.extend_from_slice(&len_u32.to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, PluginError> {
        if self.buffer.len() + chunk.len() > MAX_AGGREGATE_BUFFER_BYTES {
            return Err(PluginError::overloaded(format!(
                "Aggregate decoder buffer exceeds limit of {} bytes",
                MAX_AGGREGATE_BUFFER_BYTES
            )));
        }
        self.buffer.extend_from_slice(chunk);

        let mut frames = Vec::new();
        let mut offset = 0;

        while self.buffer.len() - offset >= FRAME_HEADER_LEN {
            let header_bytes: [u8; 4] =
                self.buffer[offset..offset + FRAME_HEADER_LEN]
                    .try_into()
                    .map_err(|_| PluginError::invalid_input("Failed to read frame header"))?;
            let payload_len = u32::from_be_bytes(header_bytes) as usize;

            if payload_len > MAX_FRAME_PAYLOAD_BYTES {
                return Err(PluginError::overloaded(format!(
                    "Oversized frame header: {} bytes exceeds {} ceiling",
                    payload_len, MAX_FRAME_PAYLOAD_BYTES
                )));
            }

            let total_len = FRAME_HEADER_LEN + payload_len;
            if self.buffer.len() - offset < total_len {
                break;
            }

            let body_bytes = &self.buffer[offset + FRAME_HEADER_LEN..offset + total_len];
            let decoded = std::str::from_utf8(body_bytes).map_err(|err| {
                PluginError::invalid_input(format!("Frame contains invalid UTF-8: {}", err))
            })?;
            frames.push(decoded.to_string());
            offset += total_len;
        }

        if offset > 0 {
            self.buffer.drain(..offset);
        }

        Ok(frames)
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buffer.len()
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }
}

pub fn validate_json_rpc_message(raw: &str) -> Result<serde_json::Value, PluginError> {
    let mut de = serde_json::Deserializer::from_str(raw);
    let parsed = serde_json::Value::deserialize(&mut de)
        .map_err(|err| PluginError::invalid_input(format!("Invalid JSON payload: {}", err)))?;
    de.end().map_err(|err| {
        PluginError::invalid_input(format!("Trailing data after JSON payload: {}", err))
    })?;

    if parsed.is_array() {
        return Err(PluginError::invalid_input(
            "JSON-RPC batch payloads are rejected",
        ));
    }

    let obj = parsed
        .as_object()
        .ok_or_else(|| PluginError::invalid_input("JSON-RPC message must be a JSON object"))?;

    let jsonrpc = obj.get("jsonrpc").and_then(|v| v.as_str());
    if jsonrpc != Some("2.0") {
        return Err(PluginError::invalid_input(
            "Missing or invalid jsonrpc 2.0 version string",
        ));
    }

    if let Some(id_val) = obj.get("id") {
        if !id_val.is_string() {
            return Err(PluginError::invalid_input(format!(
                "JSON-RPC id must be a string, received {:?}",
                id_val
            )));
        }
        if id_val.as_str().map_or(true, |s| s.trim().is_empty()) {
            return Err(PluginError::invalid_input("JSON-RPC id must not be empty"));
        }
    }

    if let Some(method_val) = obj.get("method") {
        if !method_val.is_string() || method_val.as_str().map_or(true, |s| s.trim().is_empty()) {
            return Err(PluginError::invalid_input(
                "JSON-RPC method must be a non-empty string",
            ));
        }
        let is_request = obj.contains_key("id");
        for key in obj.keys() {
            if is_request {
                if key != "jsonrpc" && key != "id" && key != "method" && key != "params" {
                    return Err(PluginError::invalid_input(format!(
                        "Unknown field in JSON-RPC request: '{key}'"
                    )));
                }
            } else if key != "jsonrpc" && key != "method" && key != "params" {
                return Err(PluginError::invalid_input(format!(
                    "Unknown field in JSON-RPC notification: '{key}'"
                )));
            }
        }
        return Ok(parsed);
    }

    if obj.contains_key("result") || obj.contains_key("error") {
        if obj.contains_key("result") && obj.contains_key("error") {
            return Err(PluginError::invalid_input(
                "JSON-RPC response cannot include both result and error",
            ));
        }
        if !obj.contains_key("id") {
            return Err(PluginError::invalid_input(
                "JSON-RPC response must include string id",
            ));
        }
        for key in obj.keys() {
            if key != "jsonrpc" && key != "id" && key != "result" && key != "error" {
                return Err(PluginError::invalid_input(format!(
                    "Unknown field in JSON-RPC response: '{key}'"
                )));
            }
        }
        return Ok(parsed);
    }

    Err(PluginError::invalid_input(
        "JSON-RPC message is neither request, response, nor notification",
    ))
}

pub async fn read_frame_async<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<Option<String>, PluginError> {
    use tokio::io::AsyncReadExt;
    let mut header = [0u8; FRAME_HEADER_LEN];
    let mut total_read = 0;
    while total_read < FRAME_HEADER_LEN {
        let n = reader.read(&mut header[total_read..]).await.map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to read frame header: {e}"))
        })?;
        if n == 0 {
            if total_read == 0 {
                return Ok(None);
            } else {
                return Err(PluginError::runner_unavailable(format!(
                    "Truncated frame header: received only {total_read} of {FRAME_HEADER_LEN} bytes"
                )));
            }
        }
        total_read += n;
    }
    let payload_len = u32::from_be_bytes(header) as usize;
    if payload_len > MAX_FRAME_PAYLOAD_BYTES {
        return Err(PluginError::overloaded(format!(
            "Oversized frame header: {} bytes exceeds {} ceiling",
            payload_len, MAX_FRAME_PAYLOAD_BYTES
        )));
    }
    let mut body = vec![0u8; payload_len];
    reader.read_exact(&mut body).await.map_err(|e| {
        PluginError::runner_unavailable(format!("Failed to read frame payload: {e}"))
    })?;
    let text = String::from_utf8(body).map_err(|err| {
        PluginError::invalid_input(format!("Frame contains invalid UTF-8: {err}"))
    })?;
    Ok(Some(text))
}

pub async fn write_frame_async<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    payload: &[u8],
) -> Result<(), PluginError> {
    use tokio::io::AsyncWriteExt;
    let encoded = encode_frame(payload)?;
    writer
        .write_all(&encoded)
        .await
        .map_err(|e| PluginError::runner_unavailable(format!("Failed to write frame: {e}")))?;
    writer
        .flush()
        .await
        .map_err(|e| PluginError::runner_unavailable(format!("Failed to flush frame: {e}")))?;
    Ok(())
}

pub fn build_json_rpc_request(
    id: &str,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

pub fn build_json_rpc_response(id: &str, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

pub fn build_json_rpc_error(
    id: &str,
    code: i32,
    message: &str,
    data: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut err_obj = serde_json::json!({
        "code": code,
        "message": message,
    });
    if let Some(d) = data {
        err_obj["data"] = d;
    }
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": err_obj,
    })
}
