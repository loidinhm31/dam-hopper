use serde::Serialize;
use uuid::Uuid;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Starting,
    Ready,
    Failed,
    Stopped,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TunnelSession {
    pub id: Uuid,
    pub port: u16,
    pub label: String,
    pub driver: String,
    pub status: TunnelStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}
