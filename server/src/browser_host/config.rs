use serde::{Deserialize, Serialize};
use std::fmt;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

pub const BROWSER_PROTOCOL_VERSION: u32 = 1;

pub const DEFAULT_MAX_PROCESSES: usize = 1;
pub const DEFAULT_MAX_TARGETS: usize = 2;
pub const DEFAULT_MAX_VIEWERS: usize = 2;
pub const DEFAULT_MAX_RAW_CDP_CONNECTIONS: usize = 2;
pub const DEFAULT_MEMORY_CEILING_BYTES: u64 = 134_217_728; // 128 MiB
pub const DEFAULT_JPEG_QUALITY: u8 = 65;
pub const DEFAULT_MAX_WIDTH: u32 = 1280;
pub const DEFAULT_MAX_HEIGHT: u32 = 900;
pub const DEFAULT_FRAME_RATE_FPS: u32 = 10;

pub const MIN_MEMORY_CEILING_BYTES: u64 = 33_554_432; // 32 MiB
pub const MAX_MEMORY_CEILING_BYTES: u64 = 1_073_741_824; // 1 GiB

pub const DEFAULT_DENIED_DESTINATIONS: &[&str] = &[
    "169.254.169.254",          // AWS/GCP/Azure link-local metadata
    "fd00:ec2::254",            // AWS IPv6 link-local metadata
    "metadata.google.internal", // GCP metadata DNS
    "100.100.100.200",          // Alibaba cloud metadata
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserConfigError {
    InvalidBudget(String),
    MemoryCeilingExceeded { estimated: u64, ceiling: u64 },
    InvalidOrigin { origin: String, reason: String },
    InvalidDestination { destination: String, reason: String },
    UnsafeExecutablePermissions { path: String, reason: String },
    UnsafeProfileRootPermissions { path: String, reason: String },
}

impl fmt::Display for BrowserConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBudget(msg) => write!(f, "invalid browser budget: {msg}"),
            Self::MemoryCeilingExceeded { estimated, ceiling } => write!(
                f,
                "overbudget configuration: estimated memory reservation {estimated} bytes exceeds memory ceiling {ceiling} bytes"
            ),
            Self::InvalidOrigin { origin, reason } => {
                write!(f, "invalid origin '{origin}': {reason}")
            }
            Self::InvalidDestination { destination, reason } => {
                write!(f, "invalid denied destination '{destination}': {reason}")
            }
            Self::UnsafeExecutablePermissions { path, reason } => {
                write!(f, "unsafe browser executable permissions for '{path}': {reason}")
            }
            Self::UnsafeProfileRootPermissions { path, reason } => {
                write!(f, "unsafe browser profile root permissions for '{path}': {reason}")
            }
        }
    }
}

impl std::error::Error for BrowserConfigError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBudgetsConfig {
    #[serde(default = "default_max_processes", alias = "max_processes")]
    pub max_processes: usize,
    #[serde(default = "default_max_targets", alias = "max_targets")]
    pub max_targets: usize,
    #[serde(default = "default_max_viewers", alias = "max_viewers")]
    pub max_viewers: usize,
    #[serde(
        default = "default_max_raw_cdp_connections",
        alias = "max_raw_cdp_connections"
    )]
    pub max_raw_cdp_connections: usize,
    #[serde(
        default = "default_memory_ceiling_bytes",
        alias = "memory_ceiling_bytes"
    )]
    pub memory_ceiling_bytes: u64,
    #[serde(default = "default_jpeg_quality", alias = "jpeg_quality")]
    pub jpeg_quality: u8,
    #[serde(default = "default_max_width", alias = "max_width")]
    pub max_width: u32,
    #[serde(default = "default_max_height", alias = "max_height")]
    pub max_height: u32,
    #[serde(default = "default_frame_rate_fps", alias = "frame_rate_fps")]
    pub frame_rate_fps: u32,
}

pub fn default_max_processes() -> usize {
    DEFAULT_MAX_PROCESSES
}
pub fn default_max_targets() -> usize {
    DEFAULT_MAX_TARGETS
}
pub fn default_max_viewers() -> usize {
    DEFAULT_MAX_VIEWERS
}
pub fn default_max_raw_cdp_connections() -> usize {
    DEFAULT_MAX_RAW_CDP_CONNECTIONS
}
pub fn default_memory_ceiling_bytes() -> u64 {
    DEFAULT_MEMORY_CEILING_BYTES
}
pub fn default_jpeg_quality() -> u8 {
    DEFAULT_JPEG_QUALITY
}
pub fn default_max_width() -> u32 {
    DEFAULT_MAX_WIDTH
}
pub fn default_max_height() -> u32 {
    DEFAULT_MAX_HEIGHT
}
pub fn default_frame_rate_fps() -> u32 {
    DEFAULT_FRAME_RATE_FPS
}

impl Default for BrowserBudgetsConfig {
    fn default() -> Self {
        Self {
            max_processes: DEFAULT_MAX_PROCESSES,
            max_targets: DEFAULT_MAX_TARGETS,
            max_viewers: DEFAULT_MAX_VIEWERS,
            max_raw_cdp_connections: DEFAULT_MAX_RAW_CDP_CONNECTIONS,
            memory_ceiling_bytes: DEFAULT_MEMORY_CEILING_BYTES,
            jpeg_quality: DEFAULT_JPEG_QUALITY,
            max_width: DEFAULT_MAX_WIDTH,
            max_height: DEFAULT_MAX_HEIGHT,
            frame_rate_fps: DEFAULT_FRAME_RATE_FPS,
        }
    }
}

impl BrowserBudgetsConfig {
    /// Calculate estimated worst-case memory reservation across configured bounds.
    ///
    /// Per architecture-contracts.md §3:
    /// - Each target: 2 MiB command budget + 4 MiB WS event buffer + 4 MiB candidate buffer + ~2.1 MiB complete BHJF buffer ≈ 12.1 MiB
    /// - Each viewer: 2 outstanding + 1 pending Bytes handles (buffered) + writer queue ≈ 4.2 MiB
    /// - Each raw CDP connection: 4 MiB per direction = 8 MiB
    pub fn estimate_reservation_bytes(&self) -> u64 {
        let per_target = 12_687_744u64; // ~12.1 MiB
        let per_viewer = 4_404_019u64; // ~4.2 MiB
        let per_raw_cdp = 8_388_608u64; // 8 MiB

        (self.max_targets as u64)
            .saturating_mul(per_target)
            .saturating_add((self.max_viewers as u64).saturating_mul(per_viewer))
            .saturating_add((self.max_raw_cdp_connections as u64).saturating_mul(per_raw_cdp))
    }

    pub fn validate(&self) -> Result<(), BrowserConfigError> {
        if self.max_processes < 1 || self.max_processes > 4 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_processes must be between 1 and 4, got {}",
                self.max_processes
            )));
        }
        if self.max_targets < 1 || self.max_targets > 16 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_targets must be between 1 and 16, got {}",
                self.max_targets
            )));
        }
        if self.max_viewers < 1 || self.max_viewers > 16 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_viewers must be between 1 and 16, got {}",
                self.max_viewers
            )));
        }
        if self.max_raw_cdp_connections < 1 || self.max_raw_cdp_connections > 8 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_raw_cdp_connections must be between 1 and 8, got {}",
                self.max_raw_cdp_connections
            )));
        }
        if self.memory_ceiling_bytes < MIN_MEMORY_CEILING_BYTES
            || self.memory_ceiling_bytes > MAX_MEMORY_CEILING_BYTES
        {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "memory_ceiling_bytes must be between {MIN_MEMORY_CEILING_BYTES} (32MiB) and {MAX_MEMORY_CEILING_BYTES} (1GiB), got {}",
                self.memory_ceiling_bytes
            )));
        }
        if self.jpeg_quality < 10 || self.jpeg_quality > 100 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "jpeg_quality must be between 10 and 100, got {}",
                self.jpeg_quality
            )));
        }
        if self.max_width < 64 || self.max_width > 1920 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_width must be between 64 and 1920, got {}",
                self.max_width
            )));
        }
        if self.max_height < 64 || self.max_height > 1080 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "max_height must be between 64 and 1080, got {}",
                self.max_height
            )));
        }
        if self.frame_rate_fps < 1 || self.frame_rate_fps > 30 {
            return Err(BrowserConfigError::InvalidBudget(format!(
                "frame_rate_fps must be between 1 and 30, got {}",
                self.frame_rate_fps
            )));
        }

        let estimated = self.estimate_reservation_bytes();
        if estimated > self.memory_ceiling_bytes {
            return Err(BrowserConfigError::MemoryCeilingExceeded {
                estimated,
                ceiling: self.memory_ceiling_bytes,
            });
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(
        default,
        alias = "executable_path",
        skip_serializing_if = "Option::is_none"
    )]
    pub executable_path: Option<PathBuf>,
    #[serde(
        default,
        alias = "profile_root",
        skip_serializing_if = "Option::is_none"
    )]
    pub profile_root: Option<PathBuf>,
    #[serde(
        default,
        alias = "allowed_target_origins",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub allowed_target_origins: Vec<String>,
    #[serde(
        default,
        alias = "allowed_asset_origins",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub allowed_asset_origins: Vec<String>,
    #[serde(
        default,
        alias = "allowed_dev_origins",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub allowed_dev_origins: Vec<String>,
    #[serde(
        default,
        alias = "denied_destinations",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub denied_destinations: Vec<String>,
    #[serde(default)]
    pub budgets: BrowserBudgetsConfig,
}

impl Default for BrowserHostConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            executable_path: None,
            profile_root: None,
            allowed_target_origins: Vec::new(),
            allowed_asset_origins: Vec::new(),
            allowed_dev_origins: Vec::new(),
            denied_destinations: DEFAULT_DENIED_DESTINATIONS
                .iter()
                .map(|s| s.to_string())
                .collect(),
            budgets: BrowserBudgetsConfig::default(),
        }
    }
}

impl BrowserHostConfig {
    /// Validates origin string strictly: must be scheme + host (+ optional port), no path/query/fragment/auth.
    pub fn validate_origin(origin_str: &str) -> Result<(), String> {
        let trimmed = origin_str.trim();
        if trimmed.is_empty() {
            return Err("origin cannot be empty".to_string());
        }

        let url = url::Url::parse(trimmed).map_err(|e| format!("parse error: {e}"))?;
        let scheme = url.scheme();
        if scheme != "http" && scheme != "https" {
            return Err(format!(
                "unsupported scheme '{scheme}', only http and https allowed"
            ));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("credentials in origin are forbidden".to_string());
        }
        if url.query().is_some() {
            return Err("query parameters in origin are forbidden".to_string());
        }
        if url.fragment().is_some() {
            return Err("fragments in origin are forbidden".to_string());
        }
        if trimmed.ends_with('/') {
            return Err("origin must not contain a trailing slash".to_string());
        }
        let path = url.path();
        if !path.is_empty() && path != "/" {
            return Err(format!("origin cannot contain path segments: '{path}'"));
        }

        Ok(())
    }

    /// Validates denied destination string: must be valid IP, host, or host:port.
    pub fn validate_destination(dest: &str) -> Result<(), String> {
        let trimmed = dest.trim();
        if trimmed.is_empty() {
            return Err("destination cannot be empty".to_string());
        }

        // Could be IP or host, optionally with port or CIDR
        if trimmed.parse::<IpAddr>().is_ok() {
            return Ok(());
        }
        // Check host:port or hostname
        if trimmed.contains('/') {
            // Check IP CIDR
            let parts: Vec<&str> = trimmed.split('/').collect();
            if parts.len() == 2
                && parts[0].parse::<IpAddr>().is_ok()
                && parts[1].parse::<u8>().is_ok()
            {
                return Ok(());
            }
            return Err("invalid destination CIDR format".to_string());
        }

        let host = if trimmed.starts_with('[') && trimmed.contains("]:") {
            let (h, port_str) = trimmed.rsplit_once(':').unwrap();
            if port_str.parse::<u16>().is_err() {
                return Err(format!("invalid port in destination: {port_str}"));
            }
            h
        } else if let Some((h, port_str)) = trimmed.split_once(':') {
            if !h.contains(':') {
                if port_str.parse::<u16>().is_err() {
                    return Err(format!("invalid port in destination: {port_str}"));
                }
                h
            } else {
                trimmed
            }
        } else {
            trimmed
        };
        if host.starts_with('[') && host.ends_with(']') {
            let inner = &host[1..host.len() - 1];
            if inner.parse::<std::net::Ipv6Addr>().is_err() {
                return Err(format!("invalid IPv6 destination address: {host}"));
            }
            return Ok(());
        }
        if host.is_empty()
            || !host
                .chars()
                .all(|c| c.is_alphanumeric() || c == '.' || c == '-')
        {
            return Err(format!(
                "invalid characters in destination hostname: {host}"
            ));
        }

        Ok(())
    }

    /// Validate permissions of executable path if present.
    pub fn validate_executable_permissions(path: &Path) -> Result<(), BrowserConfigError> {
        let meta = std::fs::metadata(path).map_err(|e| {
            BrowserConfigError::UnsafeExecutablePermissions {
                path: path.display().to_string(),
                reason: format!("cannot read metadata: {e}"),
            }
        })?;

        if !meta.is_file() {
            return Err(BrowserConfigError::UnsafeExecutablePermissions {
                path: path.display().to_string(),
                reason: "path is not a regular file".to_string(),
            });
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                return Err(BrowserConfigError::UnsafeExecutablePermissions {
                    path: path.display().to_string(),
                    reason: "file does not have execute permissions".to_string(),
                });
            }
            if mode & 0o002 != 0 {
                return Err(BrowserConfigError::UnsafeExecutablePermissions {
                    path: path.display().to_string(),
                    reason: "file is world-writable (must be mode 0755 or more restrictive)"
                        .to_string(),
                });
            }
        }

        Ok(())
    }

    /// Validate permissions of profile root directory if present.
    pub fn validate_profile_root_permissions(path: &Path) -> Result<(), BrowserConfigError> {
        if !path.exists() {
            // If it doesn't exist, check parent
            if let Some(parent) = path.parent() {
                if parent.exists() && !parent.is_dir() {
                    return Err(BrowserConfigError::UnsafeProfileRootPermissions {
                        path: path.display().to_string(),
                        reason: "parent path exists and is not a directory".to_string(),
                    });
                }
            }
            return Ok(());
        }

        // Must not be a symlink
        let symlink_meta = std::fs::symlink_metadata(path).map_err(|e| {
            BrowserConfigError::UnsafeProfileRootPermissions {
                path: path.display().to_string(),
                reason: format!("cannot read symlink metadata: {e}"),
            }
        })?;

        if symlink_meta.file_type().is_symlink() {
            return Err(BrowserConfigError::UnsafeProfileRootPermissions {
                path: path.display().to_string(),
                reason: "profile root cannot be a symbolic link".to_string(),
            });
        }

        if !symlink_meta.is_dir() {
            return Err(BrowserConfigError::UnsafeProfileRootPermissions {
                path: path.display().to_string(),
                reason: "profile root exists but is not a directory".to_string(),
            });
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = symlink_meta.permissions().mode();
            if mode & 0o077 != 0 {
                return Err(BrowserConfigError::UnsafeProfileRootPermissions {
                    path: path.display().to_string(),
                    reason: format!(
                        "profile root has insecure permissions {mode:#o}; must not be accessible to group or others (expected mode 0700)"
                    ),
                });
            }
        }

        Ok(())
    }

    /// Comprehensive validation of browser host configuration.
    pub fn validate(&self) -> Result<(), BrowserConfigError> {
        self.budgets.validate()?;

        for origin in &self.allowed_target_origins {
            Self::validate_origin(origin).map_err(|reason| BrowserConfigError::InvalidOrigin {
                origin: origin.clone(),
                reason,
            })?;
        }

        for origin in &self.allowed_asset_origins {
            Self::validate_origin(origin).map_err(|reason| BrowserConfigError::InvalidOrigin {
                origin: origin.clone(),
                reason,
            })?;
        }

        for origin in &self.allowed_dev_origins {
            Self::validate_origin(origin).map_err(|reason| BrowserConfigError::InvalidOrigin {
                origin: origin.clone(),
                reason,
            })?;
        }

        for dest in &self.denied_destinations {
            Self::validate_destination(dest).map_err(|reason| {
                BrowserConfigError::InvalidDestination {
                    destination: dest.clone(),
                    reason,
                }
            })?;
        }

        if self.enabled {
            if let Some(exec) = &self.executable_path {
                Self::validate_executable_permissions(exec)?;
            }
            if let Some(root) = &self.profile_root {
                Self::validate_profile_root_permissions(root)?;
            }
        }

        Ok(())
    }

    /// Determine if changes between existing and new config require a server/manager restart.
    pub fn requires_restart(&self, new_cfg: &BrowserHostConfig) -> bool {
        if self.enabled != new_cfg.enabled {
            return true;
        }
        if self.executable_path != new_cfg.executable_path {
            return true;
        }
        if self.profile_root != new_cfg.profile_root {
            return true;
        }
        if self.budgets.max_processes != new_cfg.budgets.max_processes {
            return true;
        }
        false
    }
}

/// Trusted, parsed public http(s) origin of this server (scheme + authority only).
///
/// It is the only authority raw CDP discovery may advertise: it comes from operator
/// configuration (`DAM_HOPPER_PUBLIC_SERVER_ORIGIN`) or, in guarded development, from the
/// verified bound loopback listener — never from request headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicServerOrigin {
    origin: String,
    authority: String,
    ws_base: String,
}

impl PublicServerOrigin {
    /// Parses an operator-supplied origin. Rejects non-http(s) schemes, missing host,
    /// userinfo, any path other than a single trailing `/`, query and fragment.
    pub fn parse(raw: &str) -> Result<Self, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("origin cannot be empty".to_string());
        }
        let url = url::Url::parse(trimmed).map_err(|e| format!("parse error: {e}"))?;
        let ws_scheme = match url.scheme() {
            "https" => "wss",
            "http" => "ws",
            other => {
                return Err(format!(
                    "unsupported scheme '{other}', only http and https allowed"
                ))
            }
        };
        if !url.username().is_empty() || url.password().is_some() {
            return Err("userinfo in origin is forbidden".to_string());
        }
        if url.host_str().is_none_or(str::is_empty) {
            return Err("origin must include a host".to_string());
        }
        if url.query().is_some() || trimmed.contains('?') {
            return Err("query parameters in origin are forbidden".to_string());
        }
        if url.fragment().is_some() || trimmed.contains('#') {
            return Err("fragments in origin are forbidden".to_string());
        }
        if url.path() != "/" {
            return Err(format!(
                "origin cannot contain path segments: '{}'",
                url.path()
            ));
        }
        let origin = url.origin().ascii_serialization();
        let authority = origin
            .split_once("://")
            .map(|(_, rest)| rest.to_string())
            .ok_or_else(|| "origin has no authority".to_string())?;
        let ws_base = format!("{ws_scheme}://{authority}");
        Ok(Self {
            origin,
            authority,
            ws_base,
        })
    }

    /// Builds the origin of a verified bound listener address (development only).
    pub fn from_listener_addr(addr: std::net::SocketAddr) -> Self {
        let authority = addr.to_string();
        Self {
            origin: format!("http://{authority}"),
            ws_base: format!("ws://{authority}"),
            authority,
        }
    }

    /// Canonical `scheme://authority` serialization (byte-comparable with an `Origin` header).
    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// `host[:port]` without scheme.
    pub fn authority(&self) -> &str {
        &self.authority
    }

    /// `ws://authority` or `wss://authority` matching the public scheme.
    pub fn ws_base(&self) -> &str {
        &self.ws_base
    }
}

// ──────────────────────────────────────────────
// Domain Capability DTO
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEffectiveLimitsDto {
    pub max_processes: usize,
    pub max_targets: usize,
    pub max_viewers: usize,
    pub max_raw_cdp_connections: usize,
    pub memory_ceiling_bytes: u64,
    pub jpeg_quality: u8,
    pub max_width: u32,
    pub max_height: u32,
    pub frame_rate_fps: u32,
}

impl From<&BrowserBudgetsConfig> for BrowserEffectiveLimitsDto {
    fn from(b: &BrowserBudgetsConfig) -> Self {
        Self {
            max_processes: b.max_processes,
            max_targets: b.max_targets,
            max_viewers: b.max_viewers,
            max_raw_cdp_connections: b.max_raw_cdp_connections,
            memory_ceiling_bytes: b.memory_ceiling_bytes,
            jpeg_quality: b.jpeg_quality,
            max_width: b.max_width,
            max_height: b.max_height,
            frame_rate_fps: b.frame_rate_fps,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilitiesDto {
    pub protocol_version: u32,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    pub effective_limits: BrowserEffectiveLimitsDto,
    pub engine_qualified: bool,
    pub profile_epoch: String,
    pub managed_profile_present: bool,
}

/// Evaluates domain capabilities directly without spawning Chromium or making network calls.
///
/// Per architecture-contracts.md §4:
/// Exposes protocol1, configured effective limits, qualified engine status and unavailable reason
/// without exposing any local debug address or port.
pub fn evaluate_capabilities(
    config: &BrowserHostConfig,
    managed_profile_present: bool,
    profile_epoch: u64,
) -> BrowserCapabilitiesDto {
    let effective_limits = BrowserEffectiveLimitsDto::from(&config.budgets);

    #[cfg(unix)]
    let platform_supported = true;
    #[cfg(not(unix))]
    let platform_supported = false;

    if !platform_supported {
        return BrowserCapabilitiesDto {
            protocol_version: BROWSER_PROTOCOL_VERSION,
            available: false,
            unavailable_reason: Some(
                "Windows Job Object containment unavailable; browser host fails closed per security contracts".to_string(),
            ),
            effective_limits,
            engine_qualified: false,
            profile_epoch: profile_epoch.to_string(),
            managed_profile_present,
        };
    }

    if !config.enabled {
        return BrowserCapabilitiesDto {
            protocol_version: BROWSER_PROTOCOL_VERSION,
            available: false,
            unavailable_reason: Some("browser host disabled in configuration".to_string()),
            effective_limits,
            engine_qualified: true,
            profile_epoch: profile_epoch.to_string(),
            managed_profile_present,
        };
    }

    if let Err(err) = config.validate() {
        return BrowserCapabilitiesDto {
            protocol_version: BROWSER_PROTOCOL_VERSION,
            available: false,
            unavailable_reason: Some(format!("invalid configuration: {err}")),
            effective_limits,
            engine_qualified: false,
            profile_epoch: profile_epoch.to_string(),
            managed_profile_present,
        };
    }

    // Check executable presence
    match crate::browser_host::process::find_browser_executable(config.executable_path.as_deref()) {
        Ok(exec_path) => {
            if let Err(err) = BrowserHostConfig::validate_executable_permissions(&exec_path) {
                return BrowserCapabilitiesDto {
                    protocol_version: BROWSER_PROTOCOL_VERSION,
                    available: false,
                    unavailable_reason: Some(format!("unsafe executable permissions: {err}")),
                    effective_limits,
                    engine_qualified: false,
                    profile_epoch: profile_epoch.to_string(),
                    managed_profile_present,
                };
            }
        }
        Err(err) => {
            return BrowserCapabilitiesDto {
                protocol_version: BROWSER_PROTOCOL_VERSION,
                available: false,
                unavailable_reason: Some(format!("browser executable unavailable: {err}")),
                effective_limits,
                engine_qualified: false,
                profile_epoch: profile_epoch.to_string(),
                managed_profile_present,
            };
        }
    }

    BrowserCapabilitiesDto {
        protocol_version: BROWSER_PROTOCOL_VERSION,
        available: true,
        unavailable_reason: None,
        effective_limits,
        engine_qualified: true,
        profile_epoch: profile_epoch.to_string(),
        managed_profile_present,
    }
}
