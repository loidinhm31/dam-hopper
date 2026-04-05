use super::registry::CommandRegistry;

#[test]
fn test_registry_loads_all_databases() {
    let registry = CommandRegistry::new();
    let types = registry.all_project_types();
    // Should have maven, gradle, npm, pnpm, cargo
    assert!(types.contains(&"maven"), "missing maven");
    assert!(types.contains(&"cargo"), "missing cargo");
    assert!(types.contains(&"npm"), "missing npm");
    assert!(types.contains(&"pnpm"), "missing pnpm");
    assert!(types.contains(&"gradle"), "missing gradle");
}

#[test]
fn test_get_commands_by_type() {
    let registry = CommandRegistry::new();
    let cmds = registry.get_commands("cargo");
    assert!(!cmds.is_empty(), "expected cargo commands");
    assert!(cmds.iter().any(|c| c.command == "cargo build"));
}

#[test]
fn test_search_returns_results() {
    let registry = CommandRegistry::new();
    let results = registry.search("build", 5);
    assert!(!results.is_empty(), "expected search results for 'build'");
    // All scores should be positive
    assert!(results.iter().all(|r| r.score > 0.0));
}

#[test]
fn test_search_by_type_filters() {
    let registry = CommandRegistry::new();
    let results = registry.search_by_type("test", "cargo", 10);
    assert!(!results.is_empty());
    assert!(results.iter().all(|r| r.project_type == "cargo"));
}

#[test]
fn test_search_empty_query() {
    let registry = CommandRegistry::new();
    let results = registry.search("", 10);
    assert!(results.is_empty(), "empty query should return no results");
}

#[test]
fn test_search_ordering() {
    let registry = CommandRegistry::new();
    let results = registry.search("cargo build release", 10);
    // Scores should be descending
    for i in 1..results.len() {
        assert!(results[i - 1].score >= results[i].score);
    }
}

#[test]
fn test_search_limit_respected() {
    let registry = CommandRegistry::new();
    let results = registry.search("build", 2);
    assert!(results.len() <= 2);
}

#[test]
fn test_search_unknown_type_returns_empty() {
    let registry = CommandRegistry::new();
    let results = registry.search_by_type("build", "unknownXYZ", 10);
    assert!(results.is_empty());
}
