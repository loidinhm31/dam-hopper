use super::error::PluginError;

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
            let header_bytes: [u8; 4] = self.buffer[offset..offset + FRAME_HEADER_LEN]
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
    let parsed: serde_json::Value = serde_json::from_str(raw).map_err(|err| {
        PluginError::invalid_input(format!("Invalid JSON payload: {}", err))
    })?;

    if parsed.is_array() {
        return Err(PluginError::invalid_input("JSON-RPC batch payloads are rejected"));
    }

    let obj = parsed.as_object().ok_or_else(|| {
        PluginError::invalid_input("JSON-RPC message must be a JSON object")
    })?;

    let jsonrpc = obj.get("jsonrpc").and_then(|v| v.as_str());
    if jsonrpc != Some("2.0") {
        return Err(PluginError::invalid_input("Missing or invalid jsonrpc 2.0 version string"));
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
            return Err(PluginError::invalid_input("JSON-RPC method must be a non-empty string"));
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
            return Err(PluginError::invalid_input("JSON-RPC response must include string id"));
        }
        return Ok(parsed);
    }

    Err(PluginError::invalid_input("JSON-RPC message is neither request, response, nor notification"))
}
