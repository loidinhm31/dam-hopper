use serde::Serialize;

/// How the port was first detected.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DetectedVia {
    StdoutRegex,
    ProcNet,
}

/// Lifecycle state of a detected port.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PortState {
    /// Seen in stdout but not yet confirmed by /proc/net/tcp.
    Provisional,
    /// Confirmed LISTEN entry in /proc/net/tcp.
    Listening,
    /// Was listening but no longer detected.
    Lost,
}

/// A port detected on the server host.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedPort {
    pub port: u16,
    pub session_id: String,
    pub project: Option<String>,
    pub detected_via: DetectedVia,
    pub state: PortState,
}

impl DetectedPort {
    pub fn new_provisional(port: u16, session_id: String, project: Option<String>) -> Self {
        Self {
            port,
            session_id,
            project,
            detected_via: DetectedVia::StdoutRegex,
            state: PortState::Provisional,
        }
    }
}
