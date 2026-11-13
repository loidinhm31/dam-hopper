use bytes::{Bytes, BytesMut};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
// Constants from architecture-contracts.md
pub const BHJF_MAGIC: &[u8; 4] = b"BHJF";
pub const BHJF_VERSION: u8 = 1;
pub const BHJF_FLAGS_NONE: u8 = 0;
pub const BHJF_PREFIX_LEN: usize = 16;

pub const MAX_JSON_HEADER_BYTES: usize = 1024;
pub const MAX_JPEG_PAYLOAD_BYTES: usize = 2_097_152; // 2 MiB
pub const MAX_FRAME_MESSAGE_BYTES: usize =
    BHJF_PREFIX_LEN + MAX_JSON_HEADER_BYTES + MAX_JPEG_PAYLOAD_BYTES; // 2,098,192

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

pub const AUDIO_SAMPLE_RATE: u32 = 24_000;
pub const AUDIO_CHANNELS: u8 = 1;
pub const AUDIO_ENCODING_PCM16LE: &str = "pcm16le";
pub const MAX_AUDIO_CHUNK_SAMPLES: usize = 2_400; // 100 ms @ 24 kHz
pub const MAX_AUDIO_PCM_BYTES: usize = MAX_AUDIO_CHUNK_SAMPLES * 2; // 4,800 bytes
pub const MAX_AUDIO_BASE64_BYTES: usize = 6_400;
pub const MAX_AUDIO_MESSAGE_BYTES: usize = 8_192; // 8 KiB

pub const MEDIA_SUBPROTOCOL: &str = "damhopper.browser.media.v1";
pub const CONTROL_SUBPROTOCOL: &str = "damhopper.browser.control.v1";
pub const CDP_SUBPROTOCOL: &str = "damhopper.browser.cdp.v1";
pub const TICKET_SUBPROTOCOL_PREFIX: &str = "damhopper.ticket.";
pub const MAX_CLIENT_DECODE_MS: f64 = 60_000.0;
pub const MAX_HEARTBEAT_SAMPLE_MS: u32 = 60_000;
pub const MAX_HEARTBEAT_FRAME_COUNT: u32 = 10_000;
pub const MAX_MEDIA_CONTROL_REASON_BYTES: usize = 64;
pub const MAX_SUBSCRIPTION_EPOCH_BYTES: usize = 128;

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
            return Err(ProtocolError::InvalidGeometry(
                "non-finite float detected".to_string(),
            ));
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
            return Err(ProtocolError::InvalidGeometry(
                "offset exceeds 10,000,000 CSS px".to_string(),
            ));
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
    pub fn native_capture_time_unix_ms(&self) -> Option<u64> {
        (self.capture_time_unix_ms > 0).then_some(self.capture_time_unix_ms)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_decimal_sequence("profileEpoch", &self.profile_epoch)?;
        validate_decimal_sequence("viewportEpoch", &self.viewport_epoch)?;
        validate_decimal_sequence("frameSeq", &self.frame_seq)?;
        let validate_canonical_uuid = |field: &'static str,
                                       val: &str|
         -> Result<(), ProtocolError> {
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

        if self.width == 0
            || self.width > MAX_IMAGE_WIDTH
            || self.height == 0
            || self.height > MAX_IMAGE_HEIGHT
        {
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
        return Err(ProtocolError::InvalidJpeg(
            "not a valid JPEG stream (missing SOI)".to_string(),
        ));
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
            return Err(ProtocolError::InvalidJpeg(
                "malformed JPEG segment length".to_string(),
            ));
        }

        // SOF0 (Baseline), SOF1 (Extended), SOF2 (Progressive)
        if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
            if seg_len < 7 {
                return Err(ProtocolError::InvalidJpeg(
                    "SOF segment too short".to_string(),
                ));
            }
            // SOF layout: [len:2] [precision:1] [height:2] [width:2]
            let height = u16::from_be_bytes([data[idx + 3], data[idx + 4]]) as u32;
            let width = u16::from_be_bytes([data[idx + 5], data[idx + 6]]) as u32;
            return Ok((width, height));
        }

        idx += seg_len;
    }
    Err(ProtocolError::InvalidJpeg(
        "SOF marker not found".to_string(),
    ))
}

/// Immutable validated BHJF frame carrying pre-validated header and packed bytes.
/// Constructed only via `pack_validated_bhjf_frame` or `unpack_validated_bhjf_frame`
/// after header, payload bounds, and JPEG SOF dimension verification.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedBhjfFrame {
    data: Bytes,
    header: Arc<TargetFrameHeader>,
}

impl ValidatedBhjfFrame {
    pub fn data(&self) -> &Bytes {
        &self.data
    }

    pub fn into_parts(self) -> (Bytes, Arc<TargetFrameHeader>) {
        (self.data, self.header)
    }

    pub fn header(&self) -> &TargetFrameHeader {
        &self.header
    }

    pub fn header_arc(&self) -> &Arc<TargetFrameHeader> {
        &self.header
    }
}

fn pack_bhjf_frame_bytes_checked(
    header: &TargetFrameHeader,
    jpeg_payload: &[u8],
) -> Result<Bytes, ProtocolError> {
    let header_json =
        serde_json::to_string(header).map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
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

/// Pack a complete target BHJF frame into an immutable contiguous Bytes buffer.
pub fn pack_bhjf_frame(
    header: &TargetFrameHeader,
    jpeg_payload: &[u8],
) -> Result<Bytes, ProtocolError> {
    Ok(pack_validated_bhjf_frame(header.clone(), jpeg_payload)?.data)
}

/// Proof of verified JPEG SOF dimensions, constructible only by SOF validation functions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidatedJpegDims {
    width: u32,
    height: u32,
}

impl ValidatedJpegDims {
    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}

/// Parses JPEG SOF marker to inspect and validate actual image dimensions without a full decode,
/// returning a proof token `ValidatedJpegDims`.
pub fn validate_jpeg_sof(data: &[u8]) -> Result<ValidatedJpegDims, ProtocolError> {
    let (width, height) = parse_jpeg_dimensions(data)?;
    Ok(ValidatedJpegDims { width, height })
}

/// Validates header and JPEG SOF dimensions once, packs the BHJF frame, and returns a
/// `ValidatedBhjfFrame` retaining the immutable `Arc<TargetFrameHeader>` alongside the `Bytes`.
pub fn pack_validated_bhjf_frame(
    header: TargetFrameHeader,
    jpeg_payload: &[u8],
) -> Result<ValidatedBhjfFrame, ProtocolError> {
    let dims = validate_jpeg_sof(jpeg_payload)?;
    pack_validated_bhjf_frame_with_dims(header, jpeg_payload, dims)
}

pub(crate) fn pack_validated_bhjf_frame_with_dims(
    header: TargetFrameHeader,
    jpeg_payload: &[u8],
    dims: ValidatedJpegDims,
) -> Result<ValidatedBhjfFrame, ProtocolError> {
    header.validate()?;

    if jpeg_payload.is_empty() {
        return Err(ProtocolError::InvalidPayloadLength(0));
    }
    if jpeg_payload.len() > MAX_JPEG_PAYLOAD_BYTES {
        return Err(ProtocolError::InvalidPayloadLength(jpeg_payload.len()));
    }

    let (real_w, real_h) = dims.dimensions();
    if real_w != header.width || real_h != header.height {
        return Err(ProtocolError::InvalidGeometry(format!(
            "header dimensions ({}x{}) do not match JPEG SOF ({}x{})",
            header.width, header.height, real_w, real_h
        )));
    }

    let data = pack_bhjf_frame_bytes_checked(&header, jpeg_payload)?;
    Ok(ValidatedBhjfFrame {
        data,
        header: Arc::new(header),
    })
}

/// Unpacks and validates raw BHJF bytes into a `ValidatedBhjfFrame`.
pub fn unpack_validated_bhjf_frame(data: Bytes) -> Result<ValidatedBhjfFrame, ProtocolError> {
    let (header, _) = unpack_bhjf_frame(&data)?;
    Ok(ValidatedBhjfFrame {
        data,
        header: Arc::new(header),
    })
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeartbeatTelemetry {
    pub sample_ms: u32,
    pub decoded_frames: u32,
    pub replaced_frames: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decode_ms_ewma: Option<f64>,
}

impl HeartbeatTelemetry {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.sample_ms > MAX_HEARTBEAT_SAMPLE_MS {
            return Err(ProtocolError::InvalidJson(format!(
                "heartbeat sampleMs exceeds bound: {}",
                self.sample_ms
            )));
        }
        if self.decoded_frames > MAX_HEARTBEAT_FRAME_COUNT {
            return Err(ProtocolError::InvalidJson(format!(
                "heartbeat decodedFrames exceeds bound: {}",
                self.decoded_frames
            )));
        }
        if self.replaced_frames > MAX_HEARTBEAT_FRAME_COUNT {
            return Err(ProtocolError::InvalidJson(format!(
                "heartbeat replacedFrames exceeds bound: {}",
                self.replaced_frames
            )));
        }
        if let Some(ewma) = self.decode_ms_ewma {
            if !ewma.is_finite() || !(0.0..=MAX_CLIENT_DECODE_MS).contains(&ewma) {
                return Err(ProtocolError::InvalidJson(format!(
                    "heartbeat decodeMsEwma out of bounds: {ewma}"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MediaClientControlWire {
    FrameAck {
        subscription_epoch: String,
        producer_run: String,
        viewport_epoch: String,
        frame_seq: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        decode_ms: Option<f64>,
    },
    FrameDiscarded {
        subscription_epoch: String,
        producer_run: String,
        viewport_epoch: String,
        frame_seq: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<DiscardReason>,
    },
    Pause {
        subscription_epoch: String,
    },
    Heartbeat {
        subscription_epoch: String,
        visible: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        telemetry: Option<HeartbeatTelemetry>,
    },
    QualityPreference {
        subscription_epoch: String,
        preference: super::capture_tier::QualityPreference,
    },
    MuteState {
        subscription_epoch: String,
        muted: bool,
    },
}

impl MediaClientControlWire {
    pub fn parse_and_validate(text: &str) -> Result<Self, ProtocolError> {
        if text.is_empty() || text.len() > MAX_JSON_HEADER_BYTES {
            return Err(ProtocolError::MessageTooLarge {
                got: text.len(),
                max: MAX_JSON_HEADER_BYTES,
            });
        }
        let wire: Self =
            serde_json::from_str(text).map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
        wire.validate()?;
        Ok(wire)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        let check_sub = |sub: &str| -> Result<(), ProtocolError> {
            if sub.is_empty() || sub.len() > MAX_SUBSCRIPTION_EPOCH_BYTES {
                return Err(ProtocolError::InvalidJson(
                    "invalid subscriptionEpoch".to_string(),
                ));
            }
            Ok(())
        };
        let check_run = |run: &str| -> Result<(), ProtocolError> {
            let parsed = uuid::Uuid::parse_str(run).map_err(|e| {
                ProtocolError::InvalidJson(format!("invalid producerRun UUID: {e}"))
            })?;
            if run != parsed.to_string() {
                return Err(ProtocolError::InvalidJson(format!(
                    "producerRun UUID '{run}' is not canonical lowercase hyphenated"
                )));
            }
            Ok(())
        };
        match self {
            Self::FrameAck {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
                decode_ms,
            } => {
                check_sub(subscription_epoch)?;
                check_run(producer_run)?;
                validate_decimal_sequence("viewportEpoch", viewport_epoch)?;
                validate_decimal_sequence("frameSeq", frame_seq)?;
                if let Some(r) = reason {
                    if r.is_empty() || r.len() > MAX_MEDIA_CONTROL_REASON_BYTES {
                        return Err(ProtocolError::InvalidJson(
                            "frameAck reason out of bounds".to_string(),
                        ));
                    }
                }
                if let Some(ms) = decode_ms {
                    if !ms.is_finite() || !(0.0..=MAX_CLIENT_DECODE_MS).contains(ms) {
                        return Err(ProtocolError::InvalidJson(format!(
                            "frameAck decodeMs out of bounds: {ms}"
                        )));
                    }
                }
                Ok(())
            }
            Self::FrameDiscarded {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                ..
            } => {
                check_sub(subscription_epoch)?;
                check_run(producer_run)?;
                validate_decimal_sequence("viewportEpoch", viewport_epoch)?;
                validate_decimal_sequence("frameSeq", frame_seq)?;
                Ok(())
            }
            Self::Pause { subscription_epoch } => check_sub(subscription_epoch),
            Self::Heartbeat {
                subscription_epoch,
                telemetry,
                ..
            } => {
                check_sub(subscription_epoch)?;
                if let Some(t) = telemetry {
                    t.validate()?;
                }
                Ok(())
            }
            Self::QualityPreference {
                subscription_epoch, ..
            } => check_sub(subscription_epoch),
            Self::MuteState {
                subscription_epoch, ..
            } => check_sub(subscription_epoch),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    try_from = "MediaClientControlWire"
)]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        telemetry: Option<HeartbeatTelemetry>,
    },
    QualityPreference {
        subscription_epoch: String,
        preference: super::capture_tier::QualityPreference,
    },
    MuteState {
        subscription_epoch: String,
        muted: bool,
    },
}

impl TryFrom<MediaClientControlWire> for MediaClientControl {
    type Error = ProtocolError;

    fn try_from(wire: MediaClientControlWire) -> Result<Self, Self::Error> {
        wire.validate()?;
        Ok(match wire {
            MediaClientControlWire::FrameAck {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
                ..
            } => Self::FrameAck {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
            },
            MediaClientControlWire::FrameDiscarded {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
            } => Self::FrameDiscarded {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
            },
            MediaClientControlWire::Pause { subscription_epoch } => {
                Self::Pause { subscription_epoch }
            }
            MediaClientControlWire::Heartbeat {
                subscription_epoch,
                visible,
                telemetry,
            } => Self::Heartbeat {
                subscription_epoch,
                visible,
                telemetry,
            },
            MediaClientControlWire::QualityPreference {
                subscription_epoch,
                preference,
            } => Self::QualityPreference {
                subscription_epoch,
                preference,
            },
            MediaClientControlWire::MuteState {
                subscription_epoch,
                muted,
            } => Self::MuteState {
                subscription_epoch,
                muted,
            },
        })
    }
}

impl MediaClientControl {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::FrameAck {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
            } => MediaClientControlWire::FrameAck {
                subscription_epoch: subscription_epoch.clone(),
                producer_run: producer_run.clone(),
                viewport_epoch: viewport_epoch.clone(),
                frame_seq: frame_seq.clone(),
                reason: reason.clone(),
                decode_ms: None,
            }
            .validate(),
            Self::FrameDiscarded {
                subscription_epoch,
                producer_run,
                viewport_epoch,
                frame_seq,
                reason,
            } => MediaClientControlWire::FrameDiscarded {
                subscription_epoch: subscription_epoch.clone(),
                producer_run: producer_run.clone(),
                viewport_epoch: viewport_epoch.clone(),
                frame_seq: frame_seq.clone(),
                reason: *reason,
            }
            .validate(),
            Self::Pause { subscription_epoch } => MediaClientControlWire::Pause {
                subscription_epoch: subscription_epoch.clone(),
            }
            .validate(),
            Self::Heartbeat {
                subscription_epoch,
                visible,
                telemetry,
            } => MediaClientControlWire::Heartbeat {
                subscription_epoch: subscription_epoch.clone(),
                visible: *visible,
                telemetry: *telemetry,
            }
            .validate(),
            Self::QualityPreference {
                subscription_epoch,
                preference,
            } => MediaClientControlWire::QualityPreference {
                subscription_epoch: subscription_epoch.clone(),
                preference: *preference,
            }
            .validate(),
            Self::MuteState {
                subscription_epoch,
                muted,
            } => MediaClientControlWire::MuteState {
                subscription_epoch: subscription_epoch.clone(),
                muted: *muted,
            }
            .validate(),
        }
    }
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

fn serialize_arc_str<S>(val: &std::sync::Arc<str>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(val)
}

fn deserialize_arc_str<'de, D>(deserializer: D) -> Result<std::sync::Arc<str>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    Ok(std::sync::Arc::<str>::from(s))
}

/// Target-scoped PCM16 audio chunk broadcast by `ScreencastProducer`.
#[derive(Debug, Clone)]
pub struct ProducerAudioChunk {
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: String,
    pub audio_run: String,
    pub doc_epoch: u64,
    pub audio_seq: String,
    pub sample_rate: u32,
    pub channels: u8,
    pub encoding: String,
    pub data: std::sync::Arc<str>,
    pub reservation: Option<std::sync::Arc<super::diagnostics::MemoryReservation>>,
}

impl PartialEq for ProducerAudioChunk {
    fn eq(&self, other: &Self) -> bool {
        self.browser_session_id == other.browser_session_id
            && self.browser_incarnation == other.browser_incarnation
            && self.profile_epoch == other.profile_epoch
            && self.audio_run == other.audio_run
            && self.doc_epoch == other.doc_epoch
            && self.audio_seq == other.audio_seq
            && self.sample_rate == other.sample_rate
            && self.channels == other.channels
            && self.encoding == other.encoding
            && self.data == other.data
    }
}

impl Eq for ProducerAudioChunk {}
impl ProducerAudioChunk {
    pub fn to_viewer_envelope(&self, subscription_epoch: &str) -> BrowserAudioChunk {
        BrowserAudioChunk {
            kind: "audioChunk".to_string(),
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.clone(),
            audio_run: self.audio_run.clone(),
            subscription_epoch: subscription_epoch.to_string(),
            doc_epoch: self.doc_epoch.to_string(),
            audio_seq: self.audio_seq.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels,
            encoding: self.encoding.clone(),
            data: self.data.clone(),
        }
    }
}
/// Server -> Client JSON text envelope sent over `/api/browser/media` alongside binary BHJF frames.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserAudioChunk {
    pub kind: String,
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: String,
    pub audio_run: String,
    pub subscription_epoch: String,
    pub doc_epoch: String,
    pub audio_seq: String,
    pub sample_rate: u32,
    pub channels: u8,
    pub encoding: String,
    #[serde(
        serialize_with = "serialize_arc_str",
        deserialize_with = "deserialize_arc_str"
    )]
    pub data: std::sync::Arc<str>,
}
impl BrowserAudioChunk {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.kind != "audioChunk" {
            return Err(ProtocolError::InvalidJson(format!(
                "invalid audio envelope kind '{}'",
                self.kind
            )));
        }
        validate_decimal_sequence("profileEpoch", &self.profile_epoch)?;
        validate_decimal_sequence("docEpoch", &self.doc_epoch)?;
        validate_decimal_sequence("audioSeq", &self.audio_seq)?;
        for (field, val) in [
            ("browserSessionId", &self.browser_session_id),
            ("browserIncarnation", &self.browser_incarnation),
            ("audioRun", &self.audio_run),
        ] {
            let parsed = uuid::Uuid::parse_str(val)
                .map_err(|e| ProtocolError::InvalidJson(format!("invalid {field} UUID: {e}")))?;
            if val != &parsed.to_string() {
                return Err(ProtocolError::InvalidJson(format!(
                    "{field} UUID '{val}' is not canonical lowercase hyphenated"
                )));
            }
        }
        if self.subscription_epoch.is_empty() || self.subscription_epoch.len() > 128 {
            return Err(ProtocolError::InvalidJson(
                "invalid subscriptionEpoch".to_string(),
            ));
        }
        if self.sample_rate != AUDIO_SAMPLE_RATE {
            return Err(ProtocolError::InvalidJson(format!(
                "unsupported audio sampleRate: {}",
                self.sample_rate
            )));
        }
        if self.channels != AUDIO_CHANNELS {
            return Err(ProtocolError::InvalidJson(format!(
                "unsupported audio channels: {}",
                self.channels
            )));
        }
        if self.encoding != AUDIO_ENCODING_PCM16LE {
            return Err(ProtocolError::InvalidJson(format!(
                "unsupported audio encoding: {}",
                self.encoding
            )));
        }
        if self.data.is_empty()
            || self.data.len() > MAX_AUDIO_BASE64_BYTES
            || self.data.len() % 4 != 0
        {
            return Err(ProtocolError::InvalidPayloadLength(self.data.len()));
        }
        use base64::Engine as _;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(self.data.as_ref())
            .map_err(|_| ProtocolError::InvalidPayloadLength(self.data.len()))?;
        if decoded.is_empty() || decoded.len() % 2 != 0 || decoded.len() > MAX_AUDIO_PCM_BYTES {
            return Err(ProtocolError::InvalidPayloadLength(decoded.len()));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
            target_fps: 24,
            default_jpeg_quality: 75,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamAudioReason {
    Muted,
    Bandwidth,
    Hidden,
    Stalled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamQualityStatus {
    Warming,
    Switching,
    Effective,
    Unavailable,
}
fn deserialize_required_audio_reason<'de, D>(
    deserializer: D,
) -> Result<Option<StreamAudioReason>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<StreamAudioReason>::deserialize(deserializer)
}

/// Maximum wire size for any server->client media text message (audioChunk or streamQuality): 8,192 bytes.
/// Identical cap enforced on both Rust server and TS client decoders.
pub const MAX_SERVER_MEDIA_TEXT_BYTES: usize = MAX_AUDIO_MESSAGE_BYTES; // 8,192 bytes

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserStreamQuality {
    pub kind: String,
    pub subscription_epoch: String,
    pub preference: super::capture_tier::QualityPreference,
    pub producer_run: String,
    pub capture_version: String,
    pub shared_tier: super::capture_tier::CaptureTier,
    pub viewer_tier: super::capture_tier::CaptureTier,
    pub fps: u32,
    pub jpeg_quality: u8,
    pub scale: f64,
    pub image_width: u32,
    pub image_height: u32,
    pub audio_suppressed: bool,
    #[serde(deserialize_with = "deserialize_required_audio_reason")]
    pub audio_reason: Option<StreamAudioReason>,
    pub status: StreamQualityStatus,
}

impl BrowserStreamQuality {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.kind != "streamQuality" {
            return Err(ProtocolError::InvalidJson(format!(
                "invalid streamQuality kind '{}'",
                self.kind
            )));
        }
        if self.subscription_epoch.is_empty()
            || self.subscription_epoch.len() > MAX_SUBSCRIPTION_EPOCH_BYTES
        {
            return Err(ProtocolError::InvalidJson(
                "invalid subscriptionEpoch".to_string(),
            ));
        }
        let parsed_run = uuid::Uuid::parse_str(&self.producer_run)
            .map_err(|e| ProtocolError::InvalidJson(format!("invalid producerRun UUID: {e}")))?;
        if self.producer_run != parsed_run.to_string() {
            return Err(ProtocolError::InvalidJson(format!(
                "producerRun UUID '{}' is not canonical lowercase hyphenated",
                self.producer_run
            )));
        }
        validate_decimal_sequence("captureVersion", &self.capture_version)?;
        if self.fps < 1 || self.fps > 30 {
            return Err(ProtocolError::InvalidJson(format!(
                "streamQuality fps out of bounds: {}",
                self.fps
            )));
        }
        if self.jpeg_quality < 1 || self.jpeg_quality > 100 {
            return Err(ProtocolError::InvalidJson(format!(
                "streamQuality jpegQuality out of bounds: {}",
                self.jpeg_quality
            )));
        }
        if !self.scale.is_finite() || self.scale <= 0.0 || self.scale > 1.0 {
            return Err(ProtocolError::InvalidJson(format!(
                "streamQuality scale out of bounds: {}",
                self.scale
            )));
        }
        if self.image_width < 1 || self.image_width > MAX_IMAGE_WIDTH {
            return Err(ProtocolError::DimensionOutOfBounds {
                width: self.image_width,
                height: self.image_height,
            });
        }
        if self.image_height < 1 || self.image_height > MAX_IMAGE_HEIGHT {
            return Err(ProtocolError::DimensionOutOfBounds {
                width: self.image_width,
                height: self.image_height,
            });
        }
        if self.audio_suppressed != self.audio_reason.is_some() {
            return Err(ProtocolError::InvalidJson(format!(
                "audioSuppressed ({}) does not match audioReason presence ({:?})",
                self.audio_suppressed, self.audio_reason
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServerMediaEvent {
    Audio(BrowserAudioChunk),
    Quality(BrowserStreamQuality),
}

impl ServerMediaEvent {
    pub fn parse_and_validate(text: &str) -> Result<Self, ProtocolError> {
        if text.is_empty() {
            return Err(ProtocolError::MessageTooShort { got: 0, min: 1 });
        }
        if text.len() > MAX_SERVER_MEDIA_TEXT_BYTES {
            return Err(ProtocolError::MessageTooLarge {
                got: text.len(),
                max: MAX_SERVER_MEDIA_TEXT_BYTES,
            });
        }
        let v: serde_json::Value =
            serde_json::from_str(text).map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
        let kind = v.get("kind").and_then(|k| k.as_str()).ok_or_else(|| {
            ProtocolError::InvalidJson("missing or invalid kind field".to_string())
        })?;
        match kind {
            "audioChunk" => {
                let chunk: BrowserAudioChunk = serde_json::from_value(v)
                    .map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
                chunk.validate()?;
                Ok(Self::Audio(chunk))
            }
            "streamQuality" => {
                let quality: BrowserStreamQuality = serde_json::from_value(v)
                    .map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
                quality.validate()?;
                Ok(Self::Quality(quality))
            }
            other => Err(ProtocolError::InvalidJson(format!(
                "unknown server media event kind '{other}'"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser_host::capture_tier::{CaptureTier, QualityPreference};

    #[test]
    fn largest_valid_client_control_serialized_is_under_1024_bytes() {
        let max_sub = "s".repeat(MAX_SUBSCRIPTION_EPOCH_BYTES);
        let max_run = uuid::Uuid::new_v4().to_string();
        let max_dec = u64::MAX.to_string();
        let max_reason = "r".repeat(MAX_MEDIA_CONTROL_REASON_BYTES);

        let ack = MediaClientControlWire::FrameAck {
            subscription_epoch: max_sub.clone(),
            producer_run: max_run.clone(),
            viewport_epoch: max_dec.clone(),
            frame_seq: max_dec.clone(),
            reason: Some(max_reason),
            decode_ms: Some(MAX_CLIENT_DECODE_MS),
        };
        assert!(ack.validate().is_ok());
        let ack_json = serde_json::to_string(&ack).expect("serialize ack");
        assert!(
            ack_json.len() <= 1024,
            "ack exceeded 1024 bytes: {}",
            ack_json.len()
        );

        let discarded = MediaClientControlWire::FrameDiscarded {
            subscription_epoch: max_sub.clone(),
            producer_run: max_run.clone(),
            viewport_epoch: max_dec.clone(),
            frame_seq: max_dec,
            reason: Some(DiscardReason::DecodeFailed),
        };
        assert!(discarded.validate().is_ok());
        let discarded_json = serde_json::to_string(&discarded).expect("serialize discarded");
        assert!(
            discarded_json.len() <= 1024,
            "discarded exceeded 1024 bytes: {}",
            discarded_json.len()
        );

        let pause = MediaClientControlWire::Pause {
            subscription_epoch: max_sub.clone(),
        };
        assert!(pause.validate().is_ok());
        let pause_json = serde_json::to_string(&pause).expect("serialize pause");
        assert!(
            pause_json.len() <= 1024,
            "pause exceeded 1024 bytes: {}",
            pause_json.len()
        );

        let heartbeat = MediaClientControlWire::Heartbeat {
            subscription_epoch: max_sub.clone(),
            visible: true,
            telemetry: Some(HeartbeatTelemetry {
                sample_ms: MAX_HEARTBEAT_SAMPLE_MS,
                decoded_frames: MAX_HEARTBEAT_FRAME_COUNT,
                replaced_frames: MAX_HEARTBEAT_FRAME_COUNT,
                decode_ms_ewma: Some(MAX_CLIENT_DECODE_MS),
            }),
        };
        assert!(heartbeat.validate().is_ok());
        let heartbeat_json = serde_json::to_string(&heartbeat).expect("serialize heartbeat");
        assert!(
            heartbeat_json.len() <= 1024,
            "heartbeat exceeded 1024 bytes: {}",
            heartbeat_json.len()
        );

        let pref = MediaClientControlWire::QualityPreference {
            subscription_epoch: max_sub.clone(),
            preference: QualityPreference::Medium,
        };
        assert!(pref.validate().is_ok());
        let pref_json = serde_json::to_string(&pref).expect("serialize qualityPreference");
        assert!(
            pref_json.len() <= 1024,
            "qualityPreference exceeded 1024 bytes: {}",
            pref_json.len()
        );

        let mute = MediaClientControlWire::MuteState {
            subscription_epoch: max_sub,
            muted: true,
        };
        assert!(mute.validate().is_ok());
        let mute_json = serde_json::to_string(&mute).expect("serialize muteState");
        assert!(
            mute_json.len() <= 1024,
            "muteState exceeded 1024 bytes: {}",
            mute_json.len()
        );
    }

    #[test]
    fn stream_quality_validation_and_bounds() {
        let valid = BrowserStreamQuality {
            kind: "streamQuality".to_string(),
            subscription_epoch: "sub-123".to_string(),
            preference: QualityPreference::Auto,
            producer_run: uuid::Uuid::new_v4().to_string(),
            capture_version: "42".to_string(),
            shared_tier: CaptureTier::High,
            viewer_tier: CaptureTier::Medium,
            fps: 20,
            jpeg_quality: 80,
            scale: 0.75,
            image_width: 1280,
            image_height: 720,
            audio_suppressed: false,
            audio_reason: None,
            status: StreamQualityStatus::Effective,
        };
        assert!(valid.validate().is_ok());

        let json = serde_json::to_string(&valid).expect("serialize");
        assert!(json.contains("\"audioReason\":null"));
        assert!(json.contains("\"audioSuppressed\":false"));
        assert!(json.contains("\"status\":\"effective\""));

        let parsed: BrowserStreamQuality = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, valid);

        // audioSuppressed mismatch
        let mut bad_supp = valid.clone();
        bad_supp.audio_suppressed = true;
        assert!(bad_supp.validate().is_err());

        // audioReason without audioSuppressed
        let mut bad_reason = valid.clone();
        bad_reason.audio_reason = Some(StreamAudioReason::Muted);
        assert!(bad_reason.validate().is_err());

        // scale out of bounds
        let mut bad_scale = valid.clone();
        bad_scale.scale = 0.0;
        assert!(bad_scale.validate().is_err());
        bad_scale.scale = 1.05;
        assert!(bad_scale.validate().is_err());

        // fps out of bounds
        let mut bad_fps = valid.clone();
        bad_fps.fps = 0;
        assert!(bad_fps.validate().is_err());
        bad_fps.fps = 31;
        assert!(bad_fps.validate().is_err());

        // dimensions out of bounds
        let mut bad_dim = valid.clone();
        bad_dim.image_width = MAX_IMAGE_WIDTH + 1;
        assert!(bad_dim.validate().is_err());
    }

    #[test]
    fn audio_chunk_uses_audio_run_and_no_producer_run() {
        use base64::Engine as _;
        let chunk = ProducerAudioChunk {
            browser_session_id: uuid::Uuid::new_v4().to_string(),
            browser_incarnation: uuid::Uuid::new_v4().to_string(),
            profile_epoch: "1".to_string(),
            audio_run: uuid::Uuid::new_v4().to_string(),
            doc_epoch: 1,
            audio_seq: "1".to_string(),
            sample_rate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            encoding: AUDIO_ENCODING_PCM16LE.to_string(),
            data: std::sync::Arc::<str>::from(
                base64::engine::general_purpose::STANDARD.encode([0u8; 960]),
            ),
            reservation: None,
        };
        let env = chunk.to_viewer_envelope("sub-1");
        let json = serde_json::to_string(&env).expect("serialize audioChunk");
        assert!(
            json.contains("\"audioRun\":"),
            "must contain audioRun: {}",
            json
        );
        assert!(
            !json.contains("\"producerRun\":"),
            "must NOT contain producerRun: {}",
            json
        );

        let event = ServerMediaEvent::parse_and_validate(&json).expect("parse audio event");
        assert!(matches!(event, ServerMediaEvent::Audio(_)));
    }

    #[test]
    fn exhaustive_server_media_event_discrimination() {
        let quality = BrowserStreamQuality {
            kind: "streamQuality".to_string(),
            subscription_epoch: "sub-1".to_string(),
            preference: QualityPreference::Low,
            producer_run: uuid::Uuid::new_v4().to_string(),
            capture_version: "1".to_string(),
            shared_tier: CaptureTier::Low,
            viewer_tier: CaptureTier::Constrained,
            fps: 6,
            jpeg_quality: 60,
            scale: 0.75,
            image_width: 960,
            image_height: 540,
            audio_suppressed: true,
            audio_reason: Some(StreamAudioReason::Bandwidth),
            status: StreamQualityStatus::Switching,
        };
        let q_json = serde_json::to_string(&quality).expect("serialize quality");
        let event = ServerMediaEvent::parse_and_validate(&q_json).expect("parse quality event");
        assert!(matches!(event, ServerMediaEvent::Quality(_)));

        // Unknown kind rejected
        let err = ServerMediaEvent::parse_and_validate("{\"kind\":\"otherEvent\"}");
        assert!(err.is_err());
    }

    #[test]
    fn client_controls_reject_malformed_oversized_unknown_enum_and_extra_fields() {
        // Unknown preference enum variant
        let bad_enum = "{\"kind\":\"qualityPreference\",\"subscriptionEpoch\":\"sub-1\",\"preference\":\"ultra\"}";
        assert!(MediaClientControlWire::parse_and_validate(bad_enum).is_err());

        // Extra field in qualityPreference
        let extra_field_pref = "{\"kind\":\"qualityPreference\",\"subscriptionEpoch\":\"sub-1\",\"preference\":\"high\",\"extra\":123}";
        assert!(MediaClientControlWire::parse_and_validate(extra_field_pref).is_err());

        // Extra field in muteState
        let extra_field_mute =
            "{\"kind\":\"muteState\",\"subscriptionEpoch\":\"sub-1\",\"muted\":true,\"hack\":true}";
        assert!(MediaClientControlWire::parse_and_validate(extra_field_mute).is_err());

        // Oversized subscriptionEpoch (> 128 bytes)
        let oversized_sub = format!(
            "{{\"kind\":\"muteState\",\"subscriptionEpoch\":\"{}\",\"muted\":true}}",
            "s".repeat(129)
        );
        assert!(MediaClientControlWire::parse_and_validate(&oversized_sub).is_err());

        // Empty subscriptionEpoch
        let empty_sub =
            "{\"kind\":\"qualityPreference\",\"subscriptionEpoch\":\"\",\"preference\":\"auto\"}";
        assert!(MediaClientControlWire::parse_and_validate(empty_sub).is_err());

        // Valid preference variants roundtrip
        for p in ["auto", "high", "medium", "low"] {
            let json = format!("{{\"kind\":\"qualityPreference\",\"subscriptionEpoch\":\"sub-1\",\"preference\":\"{p}\"}}");
            assert!(MediaClientControlWire::parse_and_validate(&json).is_ok());
        }
    }

    #[test]
    fn rust_ts_parity_negative_fixtures() {
        let run = uuid::Uuid::new_v4().to_string();

        // 1. FIXTURE_AUDIO_LEGACY_PRODUCER_RUN: rejected by deny_unknown_fields
        let legacy_audio = format!(
            "{{\"kind\":\"audioChunk\",\"browserSessionId\":\"{}\",\"browserIncarnation\":\"{}\",\"profileEpoch\":\"1\",\"audioRun\":\"{}\",\"producerRun\":\"{}\",\"subscriptionEpoch\":\"sub-1\",\"docEpoch\":\"1\",\"audioSeq\":\"1\",\"sampleRate\":24000,\"channels\":1,\"encoding\":\"pcm16le\",\"data\":\"AAAA\"}}",
            run, run, run, run
        );
        assert!(serde_json::from_str::<BrowserAudioChunk>(&legacy_audio).is_err());

        // 2. FIXTURE_AUDIO_NON_CANONICAL_PADDING: non-zero trailing bits rejected by standard base64 decode
        let bad_padding_audio = format!(
            "{{\"kind\":\"audioChunk\",\"browserSessionId\":\"{}\",\"browserIncarnation\":\"{}\",\"profileEpoch\":\"1\",\"audioRun\":\"{}\",\"subscriptionEpoch\":\"sub-1\",\"docEpoch\":\"1\",\"audioSeq\":\"1\",\"sampleRate\":24000,\"channels\":1,\"encoding\":\"pcm16le\",\"data\":\"AAAAAB==\"}}",
            run, run, run
        );
        let chunk: Result<BrowserAudioChunk, _> = serde_json::from_str(&bad_padding_audio);
        assert!(chunk.is_err() || chunk.unwrap().validate().is_err());

        // 3. FIXTURE_STREAM_QUALITY_MISSING_AUDIO_REASON: audioReason is required, cannot be omitted
        let missing_reason = format!(
            "{{\"kind\":\"streamQuality\",\"subscriptionEpoch\":\"sub-1\",\"preference\":\"auto\",\"producerRun\":\"{}\",\"captureVersion\":\"1\",\"sharedTier\":\"high\",\"viewerTier\":\"high\",\"fps\":24,\"jpegQuality\":75,\"scale\":1.0,\"imageWidth\":1280,\"imageHeight\":720,\"audioSuppressed\":false,\"status\":\"effective\"}}",
            run
        );
        assert!(serde_json::from_str::<BrowserStreamQuality>(&missing_reason).is_err());

        // 4. FIXTURE_STREAM_QUALITY_UNKNOWN_PREF: invalid preference variant
        let bad_pref = format!(
            "{{\"kind\":\"streamQuality\",\"subscriptionEpoch\":\"sub-1\",\"preference\":\"ultra\",\"producerRun\":\"{}\",\"captureVersion\":\"1\",\"sharedTier\":\"high\",\"viewerTier\":\"high\",\"fps\":24,\"jpegQuality\":75,\"scale\":1.0,\"imageWidth\":1280,\"imageHeight\":720,\"audioSuppressed\":false,\"audioReason\":null,\"status\":\"effective\"}}",
            run
        );
        assert!(serde_json::from_str::<BrowserStreamQuality>(&bad_pref).is_err());

        // 5. FIXTURE_SERVER_MEDIA_OVERSIZED: text > 8192 bytes rejected by ServerMediaEvent parser
        let oversized_text = "x".repeat(MAX_SERVER_MEDIA_TEXT_BYTES + 1);
        let err = ServerMediaEvent::parse_and_validate(&oversized_text);
        assert!(matches!(err, Err(ProtocolError::MessageTooLarge { .. })));
    }
}
