use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const MAX_RECORDS: usize = 10_000;
const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Clone)]
pub struct ActionAuditStore {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AuditRecord {
    pub timestamp: u64,
    pub actor: String,
    pub action: String,
    pub target: Option<serde_json::Value>,
    pub intent_id: String,
    pub execution_id: Option<String>,
    pub helper_receipt_id: Option<String>,
    pub state: String,
    pub code: Option<String>,
    pub before_sample_id: Option<String>,
    pub after_sample_id: Option<String>,
    pub alert_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionAuditPage {
    pub records: Vec<serde_json::Value>,
    pub next_cursor: Option<String>,
}

impl ActionAuditStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub(super) fn append(&self, record: &AuditRecord) -> std::io::Result<()> {
        let _guard = self.lock.lock().expect("host action audit lock poisoned");
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = options.open(&*self.path)?;
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::other(
                "host action audit is not a regular file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(serde_json::to_string(record)?.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_data()?;
        self.compact_locked()
    }

    #[cfg(test)]
    pub fn list(&self, cursor: Option<&str>, limit: usize) -> std::io::Result<ActionAuditPage> {
        self.list_for_actor(None, cursor, limit)
    }

    pub fn list_for_actor(
        &self,
        actor: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> std::io::Result<ActionAuditPage> {
        let _guard = self.lock.lock().expect("host action audit lock poisoned");
        let offset = cursor
            .and_then(|item| item.parse::<usize>().ok())
            .unwrap_or(0);
        let records: Vec<_> = read_records(&self.path)?
            .into_iter()
            .filter(|record| {
                actor.is_none_or(|actor| {
                    record.get("actor").and_then(|value| value.as_str()) == Some(actor)
                })
            })
            .collect();
        let limit = limit.min(100);
        let page: Vec<_> = records.iter().skip(offset).take(limit).cloned().collect();
        let next = (offset + page.len() < records.len()).then(|| (offset + page.len()).to_string());
        Ok(ActionAuditPage {
            records: page,
            next_cursor: next,
        })
    }

    fn compact_locked(&self) -> std::io::Result<()> {
        let mut records = read_records(&self.path)?;
        let min_timestamp = now_ms().saturating_sub(RETENTION_MS);
        records.retain(|record| {
            record
                .get("timestamp")
                .and_then(|item| item.as_u64())
                .is_some_and(|ts| ts >= min_timestamp)
        });
        if records.len() > MAX_RECORDS {
            records.drain(..records.len() - MAX_RECORDS);
        }
        let temp = self.path.with_extension("jsonl.tmp");
        write_records(&temp, &records)?;
        fs::rename(temp, &*self.path)
    }
}

fn read_records(path: &Path) -> std::io::Result<Vec<serde_json::Value>> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    Ok(contents
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}

fn write_records(path: &Path, records: &[serde_json::Value]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    for record in records {
        writeln!(file, "{}", serde_json::to_string(record)?)?;
    }
    file.sync_data()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
