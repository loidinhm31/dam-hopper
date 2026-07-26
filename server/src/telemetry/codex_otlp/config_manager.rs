use std::path::PathBuf;

use serde::Serialize;
use toml_edit::{value, DocumentMut, InlineTable, Item, Table, Value};

use crate::config::TelemetryCollectorConfig;

use super::{
    config_file::{self, ConfigSnapshot},
    secret::load_existing_secret,
};

/// The only Codex-exporter states exposed outside the server. No variant
/// carries config text, endpoint headers, or bearer material.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexExporterStatus {
    NotConfigured,
    Managed,
    Conflict,
}

#[derive(Clone)]
pub struct CodexExporterManager {
    config_path: PathBuf,
    secret_path: PathBuf,
}

impl CodexExporterManager {
    pub fn default_paths() -> Result<Self, String> {
        let home =
            dirs::home_dir().ok_or_else(|| "Codex home directory unavailable".to_string())?;
        let secret = super::secret::default_secret_path()
            .map_err(|_| "Codex collector secret unavailable".to_string())?;
        Ok(Self::with_paths(home.join(".codex/config.toml"), secret))
    }

    pub fn with_paths(config_path: PathBuf, secret_path: PathBuf) -> Self {
        Self {
            config_path,
            secret_path,
        }
    }

    pub fn status(&self, collector: &TelemetryCollectorConfig) -> CodexExporterStatus {
        let Ok(doc) = config_file::read_document(&self.config_path) else {
            return CodexExporterStatus::Conflict;
        };
        if exporter_is_none(&doc) {
            return CodexExporterStatus::NotConfigured;
        }
        let Ok(secret) = load_existing_secret(&self.secret_path) else {
            return CodexExporterStatus::Conflict;
        };
        ownership(&doc, &endpoint(collector), &secret)
    }

    pub(crate) fn snapshot(&self) -> Result<ConfigSnapshot, String> {
        config_file::snapshot(&self.config_path)
    }

    pub(crate) fn restore(&self, snapshot: ConfigSnapshot) -> Result<(), String> {
        config_file::restore(&self.config_path, snapshot)
    }

    pub fn configure(
        &self,
        collector: &TelemetryCollectorConfig,
    ) -> Result<CodexExporterStatus, String> {
        let mut doc = config_file::read_document(&self.config_path)?;
        let secret = load_existing_secret(&self.secret_path)
            .map_err(|_| "Codex collector is not ready".to_string())?;
        let endpoint = endpoint(collector);
        match ownership(&doc, &endpoint, &secret) {
            CodexExporterStatus::Conflict => Ok(CodexExporterStatus::Conflict),
            CodexExporterStatus::NotConfigured | CodexExporterStatus::Managed => {
                let otel = otel_table(&mut doc)?;
                otel["log_user_prompt"] = value(false);
                otel["exporter"] = managed_exporter(&endpoint, &secret);
                config_file::write_raw(&self.config_path, &doc.to_string())?;
                Ok(CodexExporterStatus::Managed)
            }
        }
    }

    pub fn disable(
        &self,
        collector: &TelemetryCollectorConfig,
    ) -> Result<CodexExporterStatus, String> {
        let mut doc = match config_file::read_document(&self.config_path) {
            Ok(doc) => doc,
            Err(_) => return Ok(CodexExporterStatus::Conflict),
        };
        let secret = match load_existing_secret(&self.secret_path) {
            Ok(secret) => secret,
            Err(_) if exporter_is_none(&doc) => return Ok(CodexExporterStatus::NotConfigured),
            Err(_) => return Ok(CodexExporterStatus::Conflict),
        };
        if ownership(&doc, &endpoint(collector), &secret) != CodexExporterStatus::Managed {
            return Ok(self.status(collector));
        }
        otel_table(&mut doc)?["exporter"] = value("none");
        config_file::write_raw(&self.config_path, &doc.to_string())?;
        Ok(CodexExporterStatus::NotConfigured)
    }
}

fn endpoint(collector: &TelemetryCollectorConfig) -> String {
    format!("http://{}:{}/v1/logs", collector.host, collector.port)
}

fn ownership(doc: &DocumentMut, endpoint: &str, secret: &str) -> CodexExporterStatus {
    let Some(otel_item) = doc.as_table().get("otel") else {
        return CodexExporterStatus::NotConfigured;
    };
    let Some(otel) = otel_item.as_table() else {
        return CodexExporterStatus::Conflict;
    };
    let Some(exporter) = otel.get("exporter") else {
        return CodexExporterStatus::NotConfigured;
    };
    if exporter.as_value().and_then(Value::as_str) == Some("none") {
        return CodexExporterStatus::NotConfigured;
    }
    let Some(exporter_table) = exporter.as_value().and_then(Value::as_inline_table) else {
        return CodexExporterStatus::Conflict;
    };
    let Some(http) = exporter_table
        .get("otlp-http")
        .and_then(Value::as_inline_table)
    else {
        return CodexExporterStatus::Conflict;
    };
    let Some(headers) = http.get("headers").and_then(Value::as_inline_table) else {
        return CodexExporterStatus::Conflict;
    };
    let authorization = headers.get("authorization").and_then(Value::as_str);
    if exporter_table.len() == 1
        && http.len() == 3
        && headers.len() == 1
        && http.get("endpoint").and_then(Value::as_str) == Some(endpoint)
        && http.get("protocol").and_then(Value::as_str) == Some("binary")
        && authorization == Some(&format!("Bearer {secret}"))
    {
        CodexExporterStatus::Managed
    } else {
        CodexExporterStatus::Conflict
    }
}

fn exporter_is_none(doc: &DocumentMut) -> bool {
    let Some(otel_item) = doc.as_table().get("otel") else {
        return true;
    };
    let Some(otel) = otel_item.as_table() else {
        return false;
    };
    match otel.get("exporter") {
        None => true,
        Some(item) => item.as_value().and_then(Value::as_str) == Some("none"),
    }
}

fn otel_table(doc: &mut DocumentMut) -> Result<&mut Table, String> {
    let root = doc.as_table_mut();
    if !root.contains_key("otel") {
        root["otel"] = Item::Table(Table::new());
    }
    root["otel"]
        .as_table_mut()
        .ok_or_else(|| "Codex [otel] must be a table".to_string())
}

fn managed_exporter(endpoint: &str, secret: &str) -> Item {
    let mut headers = InlineTable::new();
    headers.insert("authorization", Value::from(format!("Bearer {secret}")));
    let mut http = InlineTable::new();
    http.insert("endpoint", Value::from(endpoint));
    http.insert("protocol", Value::from("binary"));
    http.insert("headers", Value::InlineTable(headers));
    let mut exporter = InlineTable::new();
    exporter.insert("otlp-http", Value::InlineTable(http));
    Item::Value(Value::InlineTable(exporter))
}
