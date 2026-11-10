use bytes::{Bytes, BytesMut};
use serde::{Deserialize, Serialize};
use std::fmt;

// Constants from architecture-contracts.md
pub const BHJF_MAGIC: &[u8; 4] = b"BHJF";
pub const BHJF_VERSION: u8 = 1;
pub const BHJF_FLAGS_NONE: u8 = 0;
pub const BHJF_PREFIX_LEN: usize = 16;

pub const MAX_JSON_HEADER_BYTES: usize = 1024;
pub const MAX_JPEG_PAYLOAD_BYTES: usize = 2_097_152; // 2 MiB
pub const MAX_FRAME_MESSAGE_BYTES: usize = BHJF_PREFIX_LEN + MAX_JSON_HEADER_BYTES + MAX_JPEG_PAYLOAD_BYTES; // 2,098,192

pub const MAX_PENDING_COMMANDS: usize = 64;
pub const COMMAND_TIMEOUT_SECS: u64 = 10;
pub const MAX_COMMAND_BYTES: usize = 65_536; // 64 KiB
pub const MAX_WS_MESSAGE_BYTES: usize = 4_194_304; // 4 MiB
pub const MAX_WRITER_QUEUE_MESSAGES: usize = 32;
pub const MAX_WRITER_QUEUE_BYTES: usize = 2_097_152; // 2 MiB

pub const MAX_IMAGE_WIDTH: u32 = 1920;
pub const MAX_IMAGE_HEIGHT: u32 = 1080;
pub const MAX_PIXELS: u64 = 2_073_600; // 1920 * 1080

/// Documented viewport ceiling (architecture-contracts.md §4 viewport PUT: 64..1920 x 64..1080).
/// Applied to cssWidth/cssHeight; below-100% browser zoom would exceed it, which stays an
/// unverified-zoom qualification blocker rather than a silently widened bound.
pub const MAX_VIEWPORT_CSS_WIDTH: f64 = 1920.0;
pub const MAX_VIEWPORT_CSS_HEIGHT: f64 = 1080.0;

pub const MEDIA_SUBPROTOCOL: &str = "damhopper.browser.media.v1";
pub const CONTROL_SUBPROTOCOL: &str = "damhopper.browser.control.v1";
pub const CDP_SUBPROTOCOL: &str = "damhopper.browser.cdp.v1";
pub const TICKET_SUBPROTOCOL_PREFIX: &str = "damhopper.ticket.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    MessageTooShort { got: usize, min: usize },
    MessageTooLarge { got: usize, max: usize },
    InvalidMagic([u8; 4]),
    UnsupportedVersion(u8),
    UnsupportedFlags(u8),
    InvalidHeaderLength(usize),
    InvalidPayloadLength(usize),
    LengthMismatch { expected: usize, actual: usize },
    InvalidJson(String),
    InvalidDecimalSequence { field: &'static str, value: String },
    InvalidGeometry(String),
    InvalidJpeg(String),
    DimensionOutOfBounds { width: u32, height: u32 },
    PixelCeilingExceeded { pixels: u64, max: u64 },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MessageTooShort { got, min } => {
                write!(f, "message too short: {got} < {min}")
            }
            Self::MessageTooLarge { got, max } => {
                write!(f, "message too large: {got} > {max}")
            }
            Self::InvalidMagic(m) => {
                write!(f, "invalid magic: {:?}", m)
            }
            Self::UnsupportedVersion(v) => {
                write!(f, "unsupported version: {v}")
            }
            Self::UnsupportedFlags(flags) => {
                write!(f, "unsupported flags: {flags}")
            }
            Self::InvalidHeaderLength(len) => {
                write!(f, "invalid header length: {len}")
            }
            Self::InvalidPayloadLength(len) => {
                write!(f, "invalid payload length: {len}")
            }
            Self::LengthMismatch { expected, actual } => {
                write!(f, "length mismatch: expected {expected}, actual {actual}")
            }
            Self::InvalidJson(err) => {
                write!(f, "invalid json header: {err}")
            }
            Self::InvalidDecimalSequence { field, value } => {
                write!(f, "invalid decimal sequence for field {field}: {value}")
            }
            Self::InvalidGeometry(err) => {
                write!(f, "invalid geometry: {err}")
            }
            Self::InvalidJpeg(err) => {
                write!(f, "invalid jpeg: {err}")
            }
            Self::DimensionOutOfBounds { width, height } => {
                write!(f, "dimensions out of bounds: {width}x{height}")
            }
            Self::PixelCeilingExceeded { pixels, max } => {
                write!(f, "pixel ceiling exceeded: {pixels} > {max}")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

/// Decimal counter string representation (profileEpoch, viewportEpoch, frameSeq, ...).
/// Invariants: canonical positive decimal `^[1-9][0-9]{0,19}$` with numeric value <= u64::MAX.
/// Zero, leading zeros, signs, whitespace and non-ASCII digits are rejected.
pub fn validate_decimal_sequence(field: &'static str, s: &str) -> Result<u64, ProtocolError> {
    let invalid = || ProtocolError::InvalidDecimalSequence {
        field,
        value: s.to_string(),
    };
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 20 {
        return Err(invalid());
    }
    if !(b'1'..=b'9').contains(&bytes[0]) || !bytes[1..].iter().all(u8::is_ascii_digit) {
        return Err(invalid());
    }
    s.parse::<u64>().map_err(|_| invalid())
}

/// Geometry metadata from browser engine layout metrics
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetGeometry {
    pub css_width: f64,
    pub css_height: f64,
    pub offset_top: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub page_scale: f64,
    pub visual_offset_x: f64,
    pub visual_offset_y: f64,
    pub dpr: f64,
}

impl TargetGeometry {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        let is_valid_float = |x: f64| x.is_finite();
        if !is_valid_float(self.css_width)
            || !is_valid_float(self.css_height)
            || !is_valid_float(self.offset_top)
            || !is_valid_float(self.scroll_x)
            || !is_valid_float(self.scroll_y)
            || !is_valid_float(self.page_scale)
            || !is_valid_float(self.visual_offset_x)
            || !is_valid_float(self.visual_offset_y)
            || !is_valid_float(self.dpr)
        {
            return Err(ProtocolError::InvalidGeometry("non-finite float detected".to_string()));
        }
        if self.css_width <= 0.0
            || self.css_width > MAX_VIEWPORT_CSS_WIDTH
            || self.css_height <= 0.0
            || self.css_height > MAX_VIEWPORT_CSS_HEIGHT
        {
            return Err(ProtocolError::InvalidGeometry(format!(
                "cssWidth ({}) must be in (0, {}] and cssHeight ({}) in (0, {}]",
                self.css_width, MAX_VIEWPORT_CSS_WIDTH, self.css_height, MAX_VIEWPORT_CSS_HEIGHT
            )));
        }
        if self.page_scale < 0.1 || self.page_scale > 10.0 {
            return Err(ProtocolError::InvalidGeometry(format!(
                "pageScale out of bounds (0.1..=10.0): {}",
                self.page_scale
            )));
        }
        if self.dpr < 0.1 || self.dpr > 10.0 {
            return Err(ProtocolError::InvalidGeometry(format!(
                "dpr out of bounds (0.1..=10.0): {}",
                self.dpr
            )));
        }
        const MAX_OFFSET: f64 = 10_000_000.0;
        if self.offset_top.abs() > MAX_OFFSET
            || self.scroll_x.abs() > MAX_OFFSET
            || self.scroll_y.abs() > MAX_OFFSET
            || self.visual_offset_x.abs() > MAX_OFFSET
            || self.visual_offset_y.abs() > MAX_OFFSET
        {
            return Err(ProtocolError::InvalidGeometry("offset exceeds 10,000,000 CSS px".to_string()));
        }
        Ok(())
    }
}

/// Target-scoped JSON header inside BHJF packet.
/// Contains only target/process/profile/producer/viewport/publication values.
/// MUST NOT contain any per-viewer or subscription data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetFrameHeader {
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: String,
    pub producer_run: String,
    pub viewport_epoch: String,
    pub frame_seq: String,
    pub width: u32,
    pub height: u32,
    pub capture_time_unix_ms: u64,
    pub geometry: TargetGeometry,
    pub input_trusted: bool,
}

impl TargetFrameHeader {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_decimal_sequence("profileEpoch", &self.profile_epoch)?;
        validate_decimal_sequence("viewportEpoch", &self.viewport_epoch)?;
        validate_decimal_sequence("frameSeq", &self.frame_seq)?;
        let validate_canonical_uuid = |field: &'static str, val: &str| -> Result<(), ProtocolError> {
            let parsed = uuid::Uuid::parse_str(val)
                .map_err(|e| ProtocolError::InvalidJson(format!("invalid {field} UUID: {e}")))?;
            if val != parsed.to_string() {
                return Err(ProtocolError::InvalidJson(format!(
                    "{field} UUID '{val}' is not canonical lowercase hyphenated"
                )));
            }
            Ok(())
        };
        validate_canonical_uuid("browserSessionId", &self.browser_session_id)?;
        validate_canonical_uuid("browserIncarnation", &self.browser_incarnation)?;
        validate_canonical_uuid("producerRun", &self.producer_run)?;

        // captureTimeUnixMs <= 2^53 - 1 (safe JS integer)
        const MAX_SAFE_JS_INT: u64 = 9_007_199_254_740_991;
        if self.capture_time_unix_ms > MAX_SAFE_JS_INT {
            return Err(ProtocolError::InvalidJson(format!(
                "captureTimeUnixMs exceeds JS safe integer: {}",
                self.capture_time_unix_ms
            )));
        }

        self.geometry.validate()?;

        if self.width == 0 || self.width > MAX_IMAGE_WIDTH || self.height == 0 || self.height > MAX_IMAGE_HEIGHT {
            return Err(ProtocolError::DimensionOutOfBounds {
                width: self.width,
                height: self.height,
            });
        }
        let pixels = (self.width as u64) * (self.height as u64);
        if pixels > MAX_PIXELS {
            return Err(ProtocolError::PixelCeilingExceeded {
                pixels,
                max: MAX_PIXELS,
            });
        }

        Ok(())
    }
}

/// Parse JPEG SOF marker to inspect actual image dimensions without a full decode.
pub fn parse_jpeg_dimensions(data: &[u8]) -> Result<(u32, u32), ProtocolError> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err(ProtocolError::InvalidJpeg("not a valid JPEG stream (missing SOI)".to_string()));
    }
    let mut idx = 2;
    while idx + 4 <= data.len() {
        if data[idx] != 0xFF {
            idx += 1;
            continue;
        }
        let marker = data[idx + 1];
        idx += 2;
        // Ignore fill bytes
        if marker == 0xFF || marker == 0x00 {
            continue;
        }
        // Standalone markers without length
        if marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        if idx + 2 > data.len() {
            break;
        }
        let seg_len = u16::from_be_bytes([data[idx], data[idx + 1]]) as usize;
        if seg_len < 2 || idx + seg_len > data.len() {
            return Err(ProtocolError::InvalidJpeg("malformed JPEG segment length".to_string()));
        }

        // SOF0 (Baseline), SOF1 (Extended), SOF2 (Progressive)
        if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
            if seg_len < 7 {
                return Err(ProtocolError::InvalidJpeg("SOF segment too short".to_string()));
            }
            // SOF layout: [len:2] [precision:1] [height:2] [width:2]
            let height = u16::from_be_bytes([data[idx + 3], data[idx + 4]]) as u32;
            let width = u16::from_be_bytes([data[idx + 5], data[idx + 6]]) as u32;
            return Ok((width, height));
        }

        idx += seg_len;
    }
    Err(ProtocolError::InvalidJpeg("SOF marker not found".to_string()))
}

/// Pack a complete target BHJF frame into an immutable contiguous Bytes buffer.
pub fn pack_bhjf_frame(header: &TargetFrameHeader, jpeg_payload: &[u8]) -> Result<Bytes, ProtocolError> {
    header.validate()?;

    if jpeg_payload.is_empty() {
        return Err(ProtocolError::InvalidPayloadLength(0));
    }
    if jpeg_payload.len() > MAX_JPEG_PAYLOAD_BYTES {
        return Err(ProtocolError::InvalidPayloadLength(jpeg_payload.len()));
    }

    // Validate actual JPEG dimensions against header
    let (real_w, real_h) = parse_jpeg_dimensions(jpeg_payload)?;
    if real_w != header.width || real_h != header.height {
        return Err(ProtocolError::InvalidGeometry(format!(
            "header dimensions ({}x{}) do not match JPEG SOF ({}x{})",
            header.width, header.height, real_w, real_h
        )));
    }

    let header_json = serde_json::to_string(header)
        .map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
    let header_bytes = header_json.as_bytes();
    if header_bytes.is_empty() || header_bytes.len() > MAX_JSON_HEADER_BYTES {
        return Err(ProtocolError::InvalidHeaderLength(header_bytes.len()));
    }

    let total_len = BHJF_PREFIX_LEN
        .checked_add(header_bytes.len())
        .and_then(|l| l.checked_add(jpeg_payload.len()))
        .ok_or_else(|| ProtocolError::MessageTooLarge {
            got: usize::MAX,
            max: MAX_FRAME_MESSAGE_BYTES,
        })?;

    if total_len > MAX_FRAME_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge {
            got: total_len,
            max: MAX_FRAME_MESSAGE_BYTES,
        });
    }

    let mut buf = BytesMut::with_capacity(total_len);
    // 0..4: ASCII "BHJF"
    buf.extend_from_slice(BHJF_MAGIC);
    // 4: version 1
    buf.extend_from_slice(&[BHJF_VERSION]);
    // 5: flags 0
    buf.extend_from_slice(&[BHJF_FLAGS_NONE]);
    // 6..8: header length (u16 big endian)
    buf.extend_from_slice(&(header_bytes.len() as u16).to_be_bytes());
    // 8..12: jpeg payload length (u32 big endian)
    buf.extend_from_slice(&(jpeg_payload.len() as u32).to_be_bytes());
    // 12..16: reserved 0 (u32 big endian)
    buf.extend_from_slice(&0u32.to_be_bytes());
    // 16..16+header_len: header json
    buf.extend_from_slice(header_bytes);
    // payload
    buf.extend_from_slice(jpeg_payload);

    Ok(buf.freeze())
}

/// Unpack and validate a BHJF frame from raw binary WebSocket data.
pub fn unpack_bhjf_frame(data: &[u8]) -> Result<(TargetFrameHeader, &[u8]), ProtocolError> {
    if data.len() < BHJF_PREFIX_LEN {
        return Err(ProtocolError::MessageTooShort {
            got: data.len(),
            min: BHJF_PREFIX_LEN,
        });
    }
    if data.len() > MAX_FRAME_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge {
            got: data.len(),
            max: MAX_FRAME_MESSAGE_BYTES,
        });
    }

    let magic: [u8; 4] = data[0..4].try_into().unwrap();
    if &magic != BHJF_MAGIC {
        return Err(ProtocolError::InvalidMagic(magic));
    }

    let version = data[4];
    if version != BHJF_VERSION {
        return Err(ProtocolError::UnsupportedVersion(version));
    }

    let flags = data[5];
    if flags != BHJF_FLAGS_NONE {
        return Err(ProtocolError::UnsupportedFlags(flags));
    }
    let reserved = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
    if reserved != 0 {
        return Err(ProtocolError::UnsupportedFlags(data[12]));
    }

    let header_len = u16::from_be_bytes([data[6], data[7]]) as usize;
    if header_len == 0 || header_len > MAX_JSON_HEADER_BYTES {
        return Err(ProtocolError::InvalidHeaderLength(header_len));
    }

    let payload_len = u32::from_be_bytes([data[8], data[9], data[10], data[11]]) as usize;
    if payload_len == 0 || payload_len > MAX_JPEG_PAYLOAD_BYTES {
        return Err(ProtocolError::InvalidPayloadLength(payload_len));
    }

    let expected_total = BHJF_PREFIX_LEN
        .checked_add(header_len)
        .and_then(|l| l.checked_add(payload_len))
        .ok_or_else(|| ProtocolError::MessageTooLarge {
            got: usize::MAX,
            max: MAX_FRAME_MESSAGE_BYTES,
        })?;

    if expected_total != data.len() {
        return Err(ProtocolError::LengthMismatch {
            expected: expected_total,
            actual: data.len(),
        });
    }

    let header_start = BHJF_PREFIX_LEN;
    let header_end = header_start + header_len;
    let header_bytes = &data[header_start..header_end];
    let payload = &data[header_end..];

    let header: TargetFrameHeader = serde_json::from_slice(header_bytes)
        .map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;

    header.validate()?;

    // Validate payload against JPEG SOF
    let (real_w, real_h) = parse_jpeg_dimensions(payload)?;
    if real_w != header.width || real_h != header.height {
        return Err(ProtocolError::InvalidGeometry(format!(
            "header dimensions ({}x{}) do not match JPEG SOF ({}x{})",
            header.width, header.height, real_w, real_h
        )));
    }

    Ok((header, payload))
}

// Media text control envelopes (Client -> Server)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MediaClientControl {
    FrameAck {
        subscription_epoch: String,
        producer_run: String,
        viewport_epoch: String,
        frame_seq: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    FrameDiscarded {
        subscription_epoch: String,
        producer_run: String,
        viewport_epoch: String,
        frame_seq: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<DiscardReason>,
    },
    Pause {
        subscription_epoch: String,
    },
    Heartbeat {
        subscription_epoch: String,
        visible: bool,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiscardReason {
    Replaced,
    Obsolete,
    Hidden,
    DecodeFailed,
    OwnerChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerControlEvent {
    SessionUpdated {
        session: Box<super::session::BrowserSessionDto>,
    },
    DialogOpened {
        dialog_id: String,
        message: String,
        dialog_type: String,
    },
    DialogClosed {
        dialog_id: String,
    },
    LeaseRevoked {
        reason: String,
    },
    Status {
        input_available: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        unavailable_reason: Option<String>,
    },
    Error {
        message: String,
    },
}

// Capabilities DTO for GET /api/browser/capabilities
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilitiesResponse {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub protocol_version: u32,
    pub effective_bounds: EffectiveBounds,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_qualification: Option<EngineQualificationSummary>,
    pub profile_epoch: String,
    pub managed_profile_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveBounds {
    pub max_image_width: u32,
    pub max_image_height: u32,
    pub max_jpeg_payload_bytes: usize,
    pub max_frame_message_bytes: usize,
    pub max_pending_commands: usize,
    pub command_timeout_secs: u64,
    pub max_command_bytes: usize,
    pub max_ws_message_bytes: usize,
    pub target_fps: u32,
    pub default_jpeg_quality: u8,
}

impl Default for EffectiveBounds {
    fn default() -> Self {
        Self {
            max_image_width: MAX_IMAGE_WIDTH,
            max_image_height: MAX_IMAGE_HEIGHT,
            max_jpeg_payload_bytes: MAX_JPEG_PAYLOAD_BYTES,
            max_frame_message_bytes: MAX_FRAME_MESSAGE_BYTES,
            max_pending_commands: MAX_PENDING_COMMANDS,
            command_timeout_secs: COMMAND_TIMEOUT_SECS,
            max_command_bytes: MAX_COMMAND_BYTES,
            max_ws_message_bytes: MAX_WS_MESSAGE_BYTES,
            target_fps: 10,
            default_jpeg_quality: 65,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineQualificationSummary {
    pub qualified: bool,
    pub engine_name: String,
    pub engine_version: String,
    pub cdp_revision: String,
    pub tested_platform: String,
}
