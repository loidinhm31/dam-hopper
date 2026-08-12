//! Translation between typed semantic requests and a small LSP subset.

use serde_json::{json, Value};

use super::path_mapper::SemanticPathMapper;
use super::protocol::{
    NavigationOperation, SemanticLanguage, SemanticNavigationRequest, SemanticNavigationTarget,
    SemanticPosition, SemanticRange, MAX_POSITION, MAX_TARGETS,
};

pub const NAVIGATION_DEADLINE_MS: u64 = 30_000;

pub fn lsp_request(
    lsp_request_id: &str,
    request: &SemanticNavigationRequest,
    lsp_uri: &str,
) -> Value {
    let method = match request.operation {
        NavigationOperation::Definition => "textDocument/definition",
        NavigationOperation::Implementation => "textDocument/implementation",
        NavigationOperation::References => "textDocument/references",
    };
    let mut params = json!({
        "textDocument": {"uri": lsp_uri},
        "position": {
            "line": request.position.line,
            "character": request.position.character
        }
    });
    if request.operation == NavigationOperation::References {
        params["context"] = json!({"includeDeclaration": true});
    }
    json!({
        "jsonrpc": "2.0",
        "id": lsp_request_id,
        "method": method,
        "params": params
    })
}

pub async fn map_result(
    result: &Value,
    mapper: &SemanticPathMapper,
    profile_id: &str,
    project_id: &str,
    language: SemanticLanguage,
    max_targets: Option<u16>,
) -> Vec<SemanticNavigationTarget> {
    let Some(items) = result_items(result) else {
        return Vec::new();
    };
    let cap = usize::from(max_targets.unwrap_or(MAX_TARGETS).min(MAX_TARGETS));
    let mut targets = Vec::with_capacity(items.len().min(cap));
    for item in items.iter().take(cap) {
        let Some((raw_uri, range)) = location_parts(item) else {
            continue;
        };
        let Ok(uri) = mapper
            .map_lsp_uri(profile_id, project_id, language, raw_uri)
            .await
        else {
            // Cross-project, dependency, malformed, or host-only locations are
            // intentionally omitted rather than returned as leaked diagnostics.
            continue;
        };
        if let Ok(range) = parse_range(range) {
            targets.push(SemanticNavigationTarget {
                label: uri.path.clone(),
                uri,
                range,
            });
        }
    }
    targets
}

fn result_items(value: &Value) -> Option<Vec<Value>> {
    match value {
        Value::Null => Some(Vec::new()),
        Value::Array(items) => Some(items.clone()),
        Value::Object(_) => Some(vec![value.clone()]),
        _ => None,
    }
}

fn location_parts(value: &Value) -> Option<(&str, &Value)> {
    let object = value.as_object()?;
    if let (Some(uri), Some(range)) = (
        object.get("uri").and_then(Value::as_str),
        object.get("range"),
    ) {
        return Some((uri, range));
    }
    let uri = object.get("targetUri").and_then(Value::as_str)?;
    let range = object
        .get("targetRange")
        .or_else(|| object.get("targetSelectionRange"))?;
    Some((uri, range))
}

fn parse_range(value: &Value) -> Result<SemanticRange, ()> {
    let object = value.as_object().ok_or(())?;
    let start = parse_position(object.get("start").ok_or(())?)?;
    let end = parse_position(object.get("end").ok_or(())?)?;
    let range = SemanticRange { start, end };
    range.validate().map_err(|_| ())?;
    Ok(range)
}

fn parse_position(value: &Value) -> Result<SemanticPosition, ()> {
    let object = value.as_object().ok_or(())?;
    let line = object.get("line").and_then(Value::as_u64).ok_or(())?;
    let character = object.get("character").and_then(Value::as_u64).ok_or(())?;
    if line > u64::from(MAX_POSITION) || character > u64::from(MAX_POSITION) {
        return Err(());
    }
    Ok(SemanticPosition {
        line: line as u32,
        character: character as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn maps_locations_and_omits_external_targets() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src/main.rs"), "fn main() {}").unwrap();
        let mapper = SemanticPathMapper::new(
            crate::fs::ProjectSandbox::new(vec![("project".into(), project.clone())]).unwrap(),
        );
        let result = json!([
            {"uri": url::Url::from_file_path(project.join("src/main.rs")).unwrap().to_string(), "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 2}}},
            {"uri": "file:///etc/passwd", "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}}
        ]);
        let targets = map_result(
            &result,
            &mapper,
            "profile",
            "project",
            SemanticLanguage::Rust,
            None,
        )
        .await;
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].uri.path, "src/main.rs");
    }
}
