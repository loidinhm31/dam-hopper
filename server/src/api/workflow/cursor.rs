use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize)] struct Cursor { recorded_at: u64, id: String }
pub fn encode(recorded_at: u64, id: &str) -> String { URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursor{recorded_at,id:id.to_string()}).unwrap()) }
pub fn decode(value: &str) -> Result<(Option<u64>, Option<String>), ()> {
    if value.is_empty() || value.contains('=') { return Err(()); }
    let raw = URL_SAFE_NO_PAD.decode(value).map_err(|_| ())?;
    let c: Cursor = serde_json::from_slice(&raw).map_err(|_| ())?;
    if c.id.is_empty() || uuid::Uuid::parse_str(&c.id).is_err() { return Err(()); }
    if encode(c.recorded_at,&c.id) != value { return Err(()); }
    Ok((Some(c.recorded_at), Some(c.id)))
}
