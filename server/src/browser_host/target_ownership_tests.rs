use super::{ConnectionToken, FrameOwner, FrameSnapshotNode, OwnershipFence, Phase, ValidityToken, MAX_FRAME_FACTS};

fn connection(fence: &OwnershipFence, generation: u64) -> ConnectionToken {
    fence
        .start_generation(generation)
        .expect("next connection generation starts")
}

fn available(fence: &OwnershipFence, connection: ConnectionToken) -> ValidityToken {
    let token = fence.token(connection).expect("active connection has a token");
    assert!(fence.install(token, || true, || {}));
    token
}

#[test]
fn tokens_are_namespaced_and_require_an_active_connection() {
    let first = OwnershipFence::new();
    let second = OwnershipFence::new();
    let disconnected = ConnectionToken {
        namespace: first.lock().namespace.unwrap(),
        generation: 1,
    };
    assert!(first.token(disconnected).is_none());

    let first_connection = connection(&first, 1);
    let first_token = available(&first, first_connection);
    let second_connection = connection(&second, 1);
    let second_token = available(&second, second_connection);
    let mut publications = 0;
    assert!(!second.commit(first_token, || publications += 1));
    assert_eq!(publications, 0);
    assert!(second.commit(second_token, || publications += 1));
    assert_eq!(publications, 1);
}

#[test]
fn invalidation_fences_queued_observations_and_commits() {
    let fence = OwnershipFence::new();
    let connection = connection(&fence, 1);
    let old = available(&fence, connection);
    assert!(fence.invalidate(connection));

    let mut mutations = 0;
    assert!(!fence.observe(old, || mutations += 1));
    assert!(!fence.commit(old, || mutations += 1));
    assert_eq!(mutations, 0);

    let replacement = fence.token(connection).expect("same connection can reseed");
    assert!(fence.install(replacement, || true, || mutations += 1));
    assert_eq!(mutations, 1);
}

#[test]
fn retirement_revokes_publication_before_observer_abort() {
    let fence = OwnershipFence::new();
    let connection = connection(&fence, 1);
    let token = available(&fence, connection);
    fence.retire_current();

    let mut publications = 0;
    assert!(!fence.commit(token, || publications += 1));
    assert_eq!(publications, 0);
}

#[test]
fn queue_failure_invalidates_before_stale_records_can_commit() {
    let fence = OwnershipFence::new();
    let connection = connection(&fence, 1);
    let old = available(&fence, connection);
    let mut queued = None;
    assert!(!fence.publish(connection, |token| {
        queued = Some(token);
        false
    }));
    let mut mutations = 0;
    assert!(!fence.observe(queued.unwrap(), || mutations += 1));
    assert!(!fence.commit(old, || mutations += 1));
    assert_eq!(mutations, 0);
}

#[test]
fn multiple_validated_owner_updates_share_instance_fence() {
    let fence = OwnershipFence::new();
    let connection = connection(&fence, 1);
    let token = fence.token(connection).unwrap();
    let mut installed_roots = 0;
    assert!(fence.install(token, || true, || installed_roots += 1));
    assert!(fence.install(token, || true, || installed_roots += 1));
    assert_eq!(installed_roots, 2);
}

#[test]
fn stale_connection_callbacks_cannot_invalidate_or_retire_replacement() {
    let fence = OwnershipFence::new();
    let old_connection = connection(&fence, 1);
    let old = available(&fence, old_connection);
    assert!(fence.disconnect(old_connection));
    let replacement = connection(&fence, 2);
    assert!(fence.start_generation(1).is_none());
    assert!(!fence.invalidate(old_connection));
    fence.retire(old_connection);

    let token = fence.token(replacement).unwrap();
    assert!(fence.install(token, || true, || {}));
    assert!(!fence.commit(old, || {}));
    assert!(fence.commit(token, || {}));
}

#[test]
fn ordinary_connection_loss_allows_next_generation() {
    let fence = OwnershipFence::new();
    let first = connection(&fence, 1);
    assert!(fence.disconnect(first));
    assert!(fence.start_generation(2).is_some());
}

#[test]
fn next_generation_is_atomic_and_overlap_retires() {
    let fence = OwnershipFence::new();
    let first = fence.start_next_generation().unwrap();
    let old = available(&fence, first);
    assert!(fence.disconnect(first));
    let second = fence.start_next_generation().unwrap();
    let current = fence.token(second).unwrap();
    assert_ne!(old, current);
    assert!(!fence.install(old, || true, || {}));
    assert!(fence.start_next_generation().is_none());
    assert!(!fence.install(current, || true, || {}));
}
#[test]
fn overlapping_generation_start_retires_fence() {
    let fence = OwnershipFence::new();
    assert!(fence.start_generation(1).is_some());
    assert!(fence.start_generation(2).is_none());
    assert_eq!(fence.lock().phase, Phase::Retired);
}
#[test]
fn disconnected_generation_cannot_publish_or_install() {
    let fence = OwnershipFence::new();
    let old_connection = connection(&fence, 1);
    let old_token = fence.token(old_connection).unwrap();
    assert!(fence.disconnect(old_connection));

    let mut mutations = 0;
    assert!(fence.token(old_connection).is_none());
    assert!(!fence.publish(old_connection, |_| true));
    assert!(!fence.observe(old_token, || mutations += 1));
    assert!(!fence.install(old_token, || true, || mutations += 1));
    assert!(!fence.commit(old_token, || mutations += 1));
    assert_eq!(mutations, 0);
}

#[test]
fn failed_install_does_not_publish_availability_or_mutate() {
    let fence = OwnershipFence::new();
    let connection = connection(&fence, 1);
    let token = fence.token(connection).unwrap();
    let mut mutations = 0;
    assert!(!fence.install(token, || false, || mutations += 1));
    assert_eq!(mutations, 0);
    assert!(fence.token(connection).is_some());
    assert!(!fence.commit(token, || mutations += 1));
}

#[test]
fn skipped_generation_and_epoch_exhaustion_permanently_retire_fence() {
    let skipped = OwnershipFence::new();
    assert!(skipped.start_generation(2).is_none());
    assert_eq!(skipped.lock().phase, Phase::Retired);

    let exhausted = OwnershipFence::new();
    let connection = connection(&exhausted, 1);
    exhausted.lock().epoch = u64::MAX;
    assert!(!exhausted.invalidate(connection));
    assert_eq!(exhausted.lock().phase, Phase::Retired);
}

fn owner(id: &str, attachment_generation: u64) -> FrameOwner {
    FrameOwner {
        principal: format!("principal-{id}"),
        is_dev: false,
        browser_incarnation: "browser-1".into(),
        profile_epoch: 1,
        logical_session_id: format!("logical-{id}"),
        native_target_id: format!("target-{id}"),
        attachment_generation,
    }
}

fn node(id: &str, parent: Option<&str>) -> FrameSnapshotNode {
    FrameSnapshotNode {
        frame_id: id.into(),
        parent_frame_id: parent.map(str::to_owned),
    }
}

fn seed(fence: &OwnershipFence, token: ValidityToken, session: &str, id: &str, owner: FrameOwner) -> bool {
    fence.seed_snapshot(token, session, owner, &[node(id, None)])
}

#[test]
fn complete_snapshot_resolves_unordered_descendants_and_detaches_them() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "s", expected.clone(), &[
        node("grandchild", Some("child")), node("root", None), node("child", Some("root")),
    ]));
    for id in ["root", "child", "grandchild"] {
        assert_eq!(fence.lookup(token, "s", id), Some(expected.clone()));
    }
    assert!(!fence.attach_descendant(token, "s", "orphan", "missing"));
    assert!(fence.attach_descendant(token, "s", "later", "child"));
    assert!(fence.detach_frame(token, "s", "child"));
    assert_eq!(fence.lookup(token, "s", "grandchild"), None);
    assert_eq!(fence.lookup(token, "s", "later"), None);
    assert_eq!(fence.lookup(token, "s", "root"), Some(expected));
}

#[test]
fn child_snapshot_resolves_external_parent_and_detaches_with_it() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "parent", expected.clone(), &[
        node("root", None), node("frame", Some("root")),
    ]));
    assert!(fence.seed_child_snapshot(token, "child", "parent", "frame", "child-root", &expected, &[
        node("nested", Some("child-root")), node("child-root", None),
    ]));
    assert_eq!(fence.lookup(token, "child", "child-root"), Some(expected.clone()));
    assert_eq!(fence.lookup(token, "child", "nested"), Some(expected));
    let detached = fence.detach_frame_and_sessions(token, "parent", "frame").unwrap();
    assert_eq!(
        detached,
        (
            std::collections::HashSet::from(["parent".to_string(), "child".to_string()]),
            false,
        ),
    );
    assert_eq!(fence.lookup(token, "child", "child-root"), None);
    assert_eq!(fence.lookup(token, "child", "nested"), None);
}
#[test]
fn oopif_swap_reseeds_child_under_live_containing_frame() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "parent", expected.clone(), &[
        node("root", None), node("container", Some("root")), node("iframe", Some("container")),
    ]));

    let (sessions, root_retired) = fence
        .detach_frame_and_sessions(token, "parent", "iframe")
        .unwrap();
    assert!(!root_retired);
    assert_eq!(sessions, std::collections::HashSet::from(["parent".to_string()]));
    assert_eq!(fence.lookup(token, "parent", "iframe"), None);
    assert_eq!(fence.lookup(token, "parent", "container"), Some(expected.clone()));

    assert!(fence.seed_child_snapshot(
        token, "oopif", "parent", "container", "iframe", &expected,
        &[node("iframe", None), node("nested", Some("iframe"))],
    ));
    assert_eq!(fence.lookup(token, "oopif", "iframe"), Some(expected.clone()));
    assert_eq!(fence.lookup(token, "oopif", "nested"), Some(expected));
}

#[test]
fn detaching_oopif_session_root_marks_that_session_unproven() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "parent", expected.clone(), &[
        node("root", None), node("frame", Some("root")),
    ]));
    assert!(fence.seed_child_snapshot(token, "child", "parent", "frame", "child-root", &expected, &[
        node("child-root", None),
    ]));

    let (sessions, root_retired) = fence
        .detach_frame_and_sessions(token, "child", "child-root")
        .unwrap();

    assert!(root_retired);
    assert_eq!(sessions, std::collections::HashSet::from(["child".to_string()]));
    assert_eq!(fence.lookup(token, "child", "child-root"), None);
    assert_eq!(fence.lookup(token, "parent", "frame"), Some(expected));
}

#[test]
fn malformed_snapshots_clear_existing_authority_without_partial_facts() {
    let cases = vec![
        vec![],
        vec![node("root", None), node("root", Some("root"))],
        vec![node("root", None), node("other", None)],
        vec![node("root", None), node("orphan", Some("missing"))],
        vec![node("root", None), node("a", Some("b")), node("b", Some("a"))],
        vec![node("", None)],
        vec![node("root", None), node("child", Some(""))],
        vec![node(&"x".repeat(257), None)],
        vec![node("root", None), node("child", Some(&"x".repeat(257)))],
    ];
    for nodes in cases {
        let fence = OwnershipFence::new();
        let conn = connection(&fence, 1);
        let token = fence.token(conn).unwrap();
        assert!(seed(&fence, token, "existing", "old", owner("a", 1)));
        assert!(!fence.seed_snapshot(token, "new", owner("a", 1), &nodes));
        let fresh = fence.token(conn).unwrap();
        assert_ne!(token, fresh);
        assert_eq!(fence.lookup(token, "existing", "old"), None);
        assert_eq!(fence.lookup(fresh, "existing", "old"), None);
        assert_eq!(fence.lookup(fresh, "new", "root"), None);
        assert!(!fence.seed_snapshot(token, "new", owner("a", 1), &[node("root", None)]));
    }
}

#[test]
fn invalid_initial_snapshot_never_publishes_and_child_failure_is_atomic() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(!fence.seed_snapshot(token, "s", expected.clone(), &[
        node("root", None), node("orphan", Some("missing")),
    ]));
    let fresh = fence.token(conn).unwrap();
    assert!(!fence.commit(fresh, || {}));
    assert_eq!(fence.lookup(fresh, "s", "root"), None);
    assert!(fence.seed_snapshot(fresh, "parent", expected.clone(), &[
        node("root", None), node("frame", Some("root")),
    ]));
    assert!(!fence.seed_child_snapshot(fresh, "child", "parent", "frame", "child-root", &expected, &[
        node("child-root", None), node("orphan", Some("missing")),
    ]));
    let replacement = fence.token(conn).unwrap();
    assert_eq!(fence.lookup(replacement, "parent", "frame"), None);
    assert_eq!(fence.lookup(replacement, "child", "child-root"), None);
}

#[test]
fn child_snapshot_rejects_wrong_external_parent_missing_parent_and_owner() {
    for scenario in 0..5 {
        let fence = OwnershipFence::new();
        let conn = connection(&fence, 1);
        let token = fence.token(conn).unwrap();
        let expected = owner("a", 1);
        assert!(fence.seed_snapshot(token, "parent", expected.clone(), &[
            node("root", None), node("frame", Some("root")),
        ]));
        let nodes = vec![node("child-root", None), node("nested", Some("child-root"))];
        let parent = if scenario == 2 { "missing" } else { "frame" };
        let child = if scenario == 3 { "parent" } else { "child" };
        let supplied = if scenario == 4 { owner("b", 1) } else { expected.clone() };
        let root_id = if scenario == 0 { "wrong-root" } else { "child-root" };
        if scenario == 1 {
            assert!(fence.seed_child_snapshot(token, child, "parent", parent, root_id, &supplied, &nodes));
            assert_eq!(fence.lookup(token, "child", "nested"), Some(expected));
            continue;
        }
        assert!(!fence.seed_child_snapshot(token, child, "parent", parent, root_id, &supplied, &nodes));
        let fresh = fence.token(conn).unwrap();
        assert_eq!(fence.lookup(fresh, "parent", "frame"), None);
        assert_eq!(fence.lookup(fresh, "child", "child-root"), None);
    }
}

#[test]
fn retiring_child_session_preserves_parent_and_sibling_ownership() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "page", expected.clone(), &[
        node("root", None), node("frame-a", Some("root")), node("frame-b", Some("root")),
    ]));
    assert!(fence.seed_child_snapshot(
        token, "child-a", "page", "frame-a", "iframe-a", &expected,
        &[node("iframe-a", None), node("nested-a", Some("iframe-a"))],
    ));
    assert!(fence.seed_child_snapshot(
        token, "child-b", "page", "frame-b", "iframe-b", &expected,
        &[node("iframe-b", None)],
    ));
    assert!(fence.retire_session(token, "child-a"));
    assert_eq!(fence.lookup(token, "page", "root"), Some(expected.clone()));
    assert_eq!(fence.lookup(token, "child-a", "nested-a"), None);
    assert_eq!(fence.lookup(token, "child-b", "iframe-b"), Some(expected));
}

#[test]
fn conflicting_batch_invalidates_without_publishing_earlier_nodes() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    assert!(fence.seed_snapshot(token, "s", expected.clone(), &[
        node("root", None), node("existing", Some("root")),
    ]));
    assert!(!fence.seed_snapshot(token, "s", expected, &[
        node("root", None), node("new", Some("root")), node("existing", Some("new")),
    ]));
    let fresh = fence.token(conn).unwrap();
    for id in ["root", "new", "existing"] {
        assert_eq!(fence.lookup(fresh, "s", id), None);
    }
}

#[test]
fn snapshot_capacity_limits_clear_all_facts_without_eviction() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);
    let mut nodes = vec![node("root", None)];
    nodes.extend((1..MAX_FRAME_FACTS).map(|n| node(&format!("frame-{n}"), Some("root"))));
    assert!(fence.seed_snapshot(token, "s", expected.clone(), &nodes));
    assert_eq!(fence.lookup(token, "s", "frame-4095"), Some(expected.clone()));
    assert!(!fence.seed_snapshot(token, "other", expected.clone(), &[node("overflow", None)]));
    let fresh = fence.token(conn).unwrap();
    assert_eq!(fence.lookup(fresh, "s", "root"), None);
    assert_eq!(fence.lookup(fresh, "other", "overflow"), None);
    nodes.push(node("too-many", Some("root")));
    assert!(!fence.seed_snapshot(fresh, "s", expected, &nodes));
    assert_eq!(fence.lookup(fence.token(conn).unwrap(), "s", "root"), None);
}

#[test]
fn identifier_and_owner_bounds_fail_closed() {
    for scenario in 0..7 {
        let fence = OwnershipFence::new();
        let conn = connection(&fence, 1);
        let token = fence.token(conn).unwrap();
        let mut candidate = owner("a", 1);
        let large = "x".repeat(257);
        match scenario {
            1 => candidate.principal = large.clone(),
            2 => candidate.browser_incarnation = large.clone(),
            3 => candidate.logical_session_id = large.clone(),
            4 => candidate.native_target_id = large.clone(),
            5 => candidate.principal.clear(),
            _ => {}
        }
        let session = if scenario == 0 { large.as_str() } else if scenario == 6 { "" } else { "s" };
        assert!(!fence.seed_snapshot(token, session, candidate, &[node("root", None)]));
        assert_eq!(fence.lookup(fence.token(conn).unwrap(), "s", "root"), None);
    }
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let id = "x".repeat(256);
    assert!(fence.seed_snapshot(token, &id, owner("a", 1), &[node(&id, None)]));
    assert!(fence.lookup(token, &id, &id).is_some());
}

#[test]
fn distinct_owners_and_generations_do_not_alias_or_revive() {
    let fence = OwnershipFence::new();
    let first_conn = connection(&fence, 1);
    let token = fence.token(first_conn).unwrap();
    let first = owner("a", 1);
    let second = owner("b", 2);
    assert!(seed(&fence, token, "s1", "shared", first.clone()));
    assert!(seed(&fence, token, "s2", "shared", second.clone()));
    assert!(fence.retire_owner(token, &first));
    assert_eq!(fence.lookup(token, "s1", "shared"), None);
    assert_eq!(fence.lookup(token, "s2", "shared"), Some(second));
    assert!(fence.invalidate(first_conn));
    let fresh = fence.token(first_conn).unwrap();
    assert!(fence.install(fresh, || true, || {}));
    assert_eq!(fence.lookup(fresh, "s2", "shared"), None);
    assert!(!seed(&fence, token, "s1", "shared", first));
    assert!(fence.disconnect(first_conn));
    let next = connection(&fence, 2);
    let next_token = fence.token(next).unwrap();
    let replacement = owner("a", 2);
    assert!(seed(&fence, next_token, "s1", "shared", replacement.clone()));
    assert_eq!(fence.lookup(token, "s1", "shared"), None);
    assert_eq!(fence.lookup(next_token, "s1", "shared"), Some(replacement));
}

#[test]
fn conflicting_parent_edge_and_retired_owner_fence_descendants() {
    let fence = OwnershipFence::new();
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let first = owner("a", 1);
    assert!(fence.seed_snapshot(token, "s", first.clone(), &[
        node("root", None), node("left", Some("root")), node("right", Some("root")),
        node("child", Some("left")),
    ]));
    assert!(!fence.attach_descendant(token, "s", "child", "right"));
    let fresh = fence.token(conn).unwrap();
    assert_eq!(fence.lookup(fresh, "s", "root"), None);
    assert!(seed(&fence, fresh, "s", "root", first.clone()));
    assert!(fence.seed_child_snapshot(fresh, "child", "s", "root", "child-root", &first, &[node("child-root", None), node("frame", Some("child-root"))]));
    let replacement = owner("a", 2);
    assert!(seed(&fence, fresh, "other", "root", replacement.clone()));
    assert!(fence.retire_owner(fresh, &first));
    assert_eq!(fence.lookup(fresh, "child", "frame"), None);
    assert_eq!(fence.lookup(fresh, "other", "root"), Some(replacement));
}

#[test]
fn worst_case_snapshot_and_retained_map_capacity_are_accounted() {
    use super::super::diagnostics::MemoryAdmissionController;
    use super::{FRAME_MAP_SLOT_RESERVATION_BYTES, MAX_ID_BYTES};

    let controller = MemoryAdmissionController::new(16 * 1024 * 1024);
    let fence = OwnershipFence::with_memory_controller(controller.clone());
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);

    let session_id = "s".repeat(MAX_ID_BYTES);
    let root_id = format!("r{:0>width$}", "", width = MAX_ID_BYTES - 1);
    let mut nodes = vec![node(&root_id, None)];
    nodes.extend((1..MAX_FRAME_FACTS).map(|n| {
        let id = format!("f{n:0>width$}", width = MAX_ID_BYTES - 1);
        node(&id, Some(&root_id))
    }));

    assert!(fence.seed_snapshot(token, &session_id, expected.clone(), &nodes));
    let expected_map_bytes = MAX_FRAME_FACTS * FRAME_MAP_SLOT_RESERVATION_BYTES;
    let root_fact_bytes = 256 + session_id.len() + root_id.len();
    let child_fact_bytes = 256 + session_id.len() + MAX_ID_BYTES + session_id.len() + root_id.len();
    let expected_total = expected_map_bytes + root_fact_bytes + (MAX_FRAME_FACTS - 1) * child_fact_bytes;
    assert_eq!(controller.current_reserved_bytes(), expected_total);

    // Clearing frames on invalidation releases per-fact reservations while preserving the
    // retained HashMap capacity reservation until the fence itself is dropped.
    assert!(fence.invalidate(conn));
    assert_eq!(controller.current_reserved_bytes(), expected_map_bytes);
    assert_eq!(fence.lookup(token, &session_id, &root_id), None);

    drop(fence);
    assert_eq!(controller.current_reserved_bytes(), 0);
}

#[test]
fn memory_exhaustion_during_snapshot_or_attach_fails_closed() {
    use super::super::diagnostics::MemoryAdmissionController;
    use super::FRAME_MAP_SLOT_RESERVATION_BYTES;

    let min_map_bytes = 8 * FRAME_MAP_SLOT_RESERVATION_BYTES;
    let fact_bytes = 256 + "s".len() + "root".len();
    let controller = MemoryAdmissionController::new(min_map_bytes + fact_bytes + 32);
    let fence = OwnershipFence::with_memory_controller(controller.clone());
    let conn = connection(&fence, 1);
    let token = fence.token(conn).unwrap();
    let expected = owner("a", 1);

    assert!(seed(&fence, token, "s", "root", expected.clone()));
    assert_eq!(controller.current_reserved_bytes(), min_map_bytes + fact_bytes);

    // Attaching a descendant beyond the remaining ceiling fails closed and clears prior facts.
    assert!(!fence.attach_descendant(token, "s", "child", "root"));
    let fresh = fence.token(conn).unwrap();
    assert_ne!(token, fresh);
    assert_eq!(fence.lookup(fresh, "s", "root"), None);
    assert_eq!(controller.current_reserved_bytes(), min_map_bytes);

    // A multi-node snapshot exceeding memory also fails closed without partial installation.
    assert!(!fence.seed_snapshot(
        fresh,
        "s",
        expected,
        &[node("root", None), node("child", Some("root"))],
    ));
    let after_fail = fence.token(conn).unwrap();
    assert_eq!(fence.lookup(after_fail, "s", "root"), None);
    assert_eq!(controller.current_reserved_bytes(), min_map_bytes);

    drop(fence);
    assert_eq!(controller.current_reserved_bytes(), 0);
}
