use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, MutexGuard,
};

static NEXT_FENCE_NAMESPACE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ConnectionToken {
    namespace: u64,
    generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ValidityToken {
    namespace: u64,
    generation: u64,
    epoch: u64,
}
impl ValidityToken {
    pub(crate) fn belongs_to_same_connection(self, other: Self) -> bool {
        self.namespace == other.namespace && self.generation == other.generation
    }
}

const MAX_FRAME_FACTS: usize = 4096;
const MAX_ID_BYTES: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrameSnapshotNode {
    pub(crate) frame_id: String,
    pub(crate) parent_frame_id: Option<String>,
}

/// Identity supplied by the authoritative session manager, not inferred from CDP identifiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrameOwner {
    pub(crate) principal: String,
    pub(crate) is_dev: bool,
    pub(crate) browser_incarnation: String,
    pub(crate) profile_epoch: u64,
    pub(crate) logical_session_id: String,
    pub(crate) native_target_id: String,
    pub(crate) attachment_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FrameKey {
    generation: u64,
    session_id: String,
    frame_id: String,
}

impl FrameKey {
    fn new(token: ValidityToken, session_id: &str, frame_id: &str) -> Self {
        Self {
            generation: token.generation,
            session_id: session_id.to_owned(),
            frame_id: frame_id.to_owned(),
        }
    }
}

#[derive(Debug)]
struct FrameFact {
    owner: Arc<FrameOwner>,
    parent: Option<FrameKey>,
    _reservation: super::diagnostics::MemoryReservation,
}


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Disconnected,
    Unavailable,
    Available,
    Retired,
}

#[derive(Debug)]
struct State {
    namespace: Option<u64>,
    generation: u64,
    epoch: u64,
    phase: Phase,
    frames: HashMap<FrameKey, FrameFact>,
    frame_map_reservation: Option<super::diagnostics::MemoryReservation>,
    memory_controller: Arc<super::diagnostics::MemoryAdmissionController>,
}

/// Serializes actor invalidation with staged observations and ownership commits.
///
/// Every operation under this mutex must be bounded and synchronous. In particular, callers must
/// not await, perform I/O, schedule deferred publication, or re-enter the actor from a closure.
pub(crate) struct OwnershipFence {
    state: Mutex<State>,
}

impl OwnershipFence {
    pub(crate) fn new() -> Self {
        Self::create_with_memory_controller(super::diagnostics::global_memory_controller().clone())
    }

    #[cfg(test)]
    pub(crate) fn with_memory_controller(
        memory_controller: Arc<super::diagnostics::MemoryAdmissionController>,
    ) -> Self {
        Self::create_with_memory_controller(memory_controller)
    }

    fn create_with_memory_controller(
        memory_controller: Arc<super::diagnostics::MemoryAdmissionController>,
    ) -> Self {
        let namespace = NEXT_FENCE_NAMESPACE
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |next| next.checked_add(1))
            .ok();
        Self {
            state: Mutex::new(State {
                namespace,
                generation: 0,
                epoch: 0,
                frames: HashMap::new(),
                frame_map_reservation: None,
                memory_controller,
                phase: if namespace.is_some() {
                    Phase::Disconnected
                } else {
                    Phase::Retired
                },
            }),
        }
    }
    /// Atomically allocates the next connection generation, refusing overlap or exhaustion.
    pub(crate) fn start_next_generation(&self) -> Option<ConnectionToken> {
        let mut state = self.lock();
        if !matches!(state.phase, Phase::Disconnected) {
            if !matches!(state.phase, Phase::Retired) {
                state.phase = Phase::Retired;
            }
            return None;
        }
        let Some(generation) = state.generation.checked_add(1) else {
            state.phase = Phase::Retired;
            return None;
        };
        if !advance_epoch(&mut state) {
            state.phase = Phase::Retired;
            return None;
        }
        let Some(namespace) = state.namespace else {
            state.phase = Phase::Retired;
            return None;
        };
        state.generation = generation;
        state.phase = Phase::Unavailable;
        Some(ConnectionToken { namespace, generation })
    }


    #[cfg(test)]
    /// Starts the next actor generation. Stale callbacks are harmless; overlap or skipped generations fail closed.
    pub(crate) fn start_generation(&self, generation: u64) -> Option<ConnectionToken> {
        let mut state = self.lock();
        if matches!(state.phase, Phase::Retired) || generation <= state.generation {
            return None;
        }
        if !matches!(state.phase, Phase::Disconnected)
            || state.generation.checked_add(1) != Some(generation)
            || !advance_epoch(&mut state)
        {
            state.phase = Phase::Retired;
            return None;
        }
        let Some(namespace) = state.namespace else {
            state.phase = Phase::Retired;
            return None;
        };
        state.generation = generation;
        state.phase = Phase::Unavailable;
        Some(ConnectionToken { namespace, generation })
    }


    #[cfg(test)]
    pub(crate) fn token(&self, connection: ConnectionToken) -> Option<ValidityToken> {
        let state = self.lock();
        if state.namespace != Some(connection.namespace)
            || state.generation != connection.generation
            || matches!(state.phase, Phase::Disconnected | Phase::Retired)
        {
            return None;
        }
        Some(ValidityToken {
            namespace: connection.namespace,
            generation: connection.generation,
            epoch: state.epoch,
        })
    }

    /// Runs queue admission under the fence. A full/closed queue advances the epoch before return.
    pub(crate) fn publish(
        &self,
        connection: ConnectionToken,
        enqueue: impl FnOnce(ValidityToken) -> bool,
    ) -> bool {
        let mut state = self.lock();
        if state.namespace != Some(connection.namespace)
            || state.generation != connection.generation
            || matches!(state.phase, Phase::Disconnected | Phase::Retired)
        {
            return false;
        }
        let token = ValidityToken {
            namespace: connection.namespace,
            generation: connection.generation,
            epoch: state.epoch,
        };
        if enqueue(token) {
            return true;
        }
        if advance_epoch(&mut state) {
            state.phase = Phase::Unavailable;
        } else {
            state.phase = Phase::Retired;
        }
        false
    }

    /// Invalidates only the current actor connection; ordinary loss permits a fresh generation.
    pub(crate) fn invalidate(&self, connection: ConnectionToken) -> bool {
        let mut state = self.lock();
        if state.namespace != Some(connection.namespace)
            || state.generation != connection.generation
            || matches!(state.phase, Phase::Disconnected | Phase::Retired)
        {
            return false;
        }
        if !advance_epoch(&mut state) {
            state.phase = Phase::Retired;
            return false;
        }
        state.phase = Phase::Unavailable;
        true
    }

    /// Fences a dead actor so it cannot publish or install on its old connection.
    pub(crate) fn disconnect(&self, connection: ConnectionToken) -> bool {
        let mut state = self.lock();
        if state.namespace != Some(connection.namespace)
            || state.generation != connection.generation
            || matches!(state.phase, Phase::Disconnected | Phase::Retired)
        {
            return false;
        }
        if !advance_epoch(&mut state) {
            state.phase = Phase::Retired;
            return false;
        }
        state.phase = Phase::Disconnected;
        true
    }

    /// Permanently retires this fence for the current connection (browser/profile retirement).
    pub(crate) fn retire(&self, connection: ConnectionToken) {
        let mut state = self.lock();
        if state.namespace == Some(connection.namespace)
            && state.generation == connection.generation
        {
            state.phase = Phase::Retired;
        }
    }

    /// Synchronously revokes every token issued by this connection before its task is canceled.
    pub(crate) fn retire_current(&self) {
        let mut state = self.lock();
        let _ = advance_epoch(&mut state);
        state.phase = Phase::Retired;
    }

    /// Installs a complete top-level frame tree before publishing availability.
    pub(crate) fn seed_snapshot(
        &self,
        token: ValidityToken,
        session_id: &str,
        owner: FrameOwner,
        nodes: &[FrameSnapshotNode],
    ) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token)
            || !matches!(state.phase, Phase::Unavailable | Phase::Available)
        {
            return false;
        }
        if !valid_id(session_id) || !valid_owner(&owner) {
            fail_projection(&mut state);
            return false;
        }
        install_snapshot(&mut state, token, session_id, Arc::new(owner), nodes, None, None)
    }

    /// Attach a same-session frame only through its already-known parent frame.
    pub(crate) fn attach_descendant(
        &self,
        token: ValidityToken,
        session_id: &str,
        frame_id: &str,
        parent_frame_id: &str,
    ) -> bool {
        self.attach_frame(token, session_id, frame_id, session_id, parent_frame_id, None)
    }

    /// Installs a child-session tree only when its root matches explicit frame evidence.
    pub(crate) fn seed_child_snapshot(
        &self,
        token: ValidityToken,
        child_session_id: &str,
        parent_session_id: &str,
        expected_parent_frame_id: &str,
        expected_child_root_frame_id: &str,
        owner: &FrameOwner,
        nodes: &[FrameSnapshotNode],
    ) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        if !valid_id(child_session_id) || !valid_id(parent_session_id)
            || !valid_id(expected_parent_frame_id) || !valid_id(expected_child_root_frame_id)
            || !valid_owner(owner) || child_session_id == parent_session_id
        {
            fail_projection(&mut state);
            return false;
        }
        let parent = FrameKey::new(token, parent_session_id, expected_parent_frame_id);
        let Some(parent_owner) = resolve_frame(&state, &parent).cloned() else {
            fail_projection(&mut state);
            return false;
        };
        if parent_owner.as_ref() != owner {
            fail_projection(&mut state);
            return false;
        }
        install_snapshot(
            &mut state, token, child_session_id, parent_owner, nodes,
            Some(parent), Some(expected_child_root_frame_id),
        )
    }

    fn attach_frame(
        &self,
        token: ValidityToken,
        session_id: &str,
        frame_id: &str,
        parent_session_id: &str,
        parent_frame_id: &str,
        expected_owner: Option<&FrameOwner>,
    ) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        if !valid_id(session_id) || !valid_id(frame_id)
            || !valid_id(parent_session_id) || !valid_id(parent_frame_id)
        {
            fail_projection(&mut state);
            return false;
        }
        let parent = FrameKey::new(token, parent_session_id, parent_frame_id);
        let Some(owner) = resolve_frame(&state, &parent).cloned() else {
            return false;
        };
        if expected_owner.is_some_and(|expected| expected != owner.as_ref()) {
            fail_projection(&mut state);
            return false;
        }
        let key = FrameKey::new(token, session_id, frame_id);
        insert_frame(&mut state, key, owner, Some(parent))
    }

    /// Returns only an exact frame with an intact chain to a seeded root.
    pub(crate) fn lookup(
        &self,
        token: ValidityToken,
        session_id: &str,
        frame_id: &str,
    ) -> Option<FrameOwner> {
        let state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return None;
        }
        resolve_frame(&state, &FrameKey::new(token, session_id, frame_id))
            .map(|owner| owner.as_ref().clone())
    }

    #[cfg(test)]
    pub(crate) fn detach_frame(&self, token: ValidityToken, session_id: &str, frame_id: &str) -> bool {
        self.detach_frame_and_sessions(token, session_id, frame_id).is_some()
    }

    /// Atomically removes a frame subtree and returns its CDP sessions plus root-retirement status.
    pub(crate) fn detach_frame_and_sessions(
        &self,
        token: ValidityToken,
        session_id: &str,
        frame_id: &str,
    ) -> Option<(HashSet<String>, bool)> {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return None;
        }
        let root = FrameKey::new(token, session_id, frame_id);
        let is_session_root = state.frames.get(&root).is_some_and(|fact| {
            fact.parent.as_ref().is_none_or(|parent| parent.session_id != session_id)
        });
        if !state.frames.contains_key(&root) {
            return None;
        }
        let Some(removed) = descendant_keys(&state, std::iter::once(root)) else {
            fail_projection(&mut state);
            return None;
        };
        let sessions = removed.iter().map(|key| key.session_id.clone()).collect();
        for key in removed {
            state.frames.remove(&key);
        }
        Some((sessions, is_session_root))
    }

    /// Retire only facts for this exact authoritative owner tuple.
    pub(crate) fn retire_owner(&self, token: ValidityToken, owner: &FrameOwner) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        state.frames.retain(|_, fact| fact.owner.as_ref() != owner);
        true
    }

    /// Retire one CDP session and every child session rooted in its frame facts.
    pub(crate) fn retire_session(&self, token: ValidityToken, session_id: &str) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        let roots: Vec<_> = state.frames.keys()
            .filter(|key| key.session_id == session_id)
            .cloned()
            .collect();
        if roots.is_empty() {
            return true;
        }
        let Some(removed) = descendant_keys(&state, roots.into_iter()) else {
            fail_projection(&mut state);
            return false;
        };
        for key in removed {
            state.frames.remove(&key);
        }
        true
    }
    /// Retire a set of CDP sessions and all projected descendants in one bounded traversal.
    pub(crate) fn retire_sessions(
        &self,
        token: ValidityToken,
        session_ids: &HashSet<String>,
    ) -> bool {
        let mut state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        let roots: Vec<_> = state.frames.keys()
            .filter(|key| session_ids.contains(&key.session_id))
            .cloned()
            .collect();
        if roots.is_empty() {
            return true;
        }
        let Some(removed) = descendant_keys(&state, roots.into_iter()) else {
            fail_projection(&mut state);
            return false;
        };
        for key in removed {
            state.frames.remove(&key);
        }
        true
    }


    /// Validates and installs projection state before atomically publishing availability.
    #[cfg(test)]
    pub(crate) fn install(
        &self,
        token: ValidityToken,
        validate: impl FnOnce() -> bool,
        operation: impl FnOnce(),
    ) -> bool {
        let mut state = self.lock();
        if !matches!(state.phase, Phase::Unavailable | Phase::Available)
            || !token_matches(&state, token)
            || !validate()
        {
            return false;
        }
        operation();
        state.phase = Phase::Available;
        true

    }
    /// Applies an observation while it is fresh; this is for staging, not ownership authorization.
    pub(crate) fn observe(&self, token: ValidityToken, operation: impl FnOnce()) -> bool {
        let state = self.lock();
        if !token_matches(&state, token)
            || matches!(state.phase, Phase::Disconnected | Phase::Retired)
        {
            return false;
        }
        operation();
        true
    }

    /// Applies an owner mutation at the same linearization point as actor invalidation.
    pub(crate) fn commit(&self, token: ValidityToken, operation: impl FnOnce()) -> bool {
        let state = self.lock();
        if !token_matches(&state, token) || !matches!(state.phase, Phase::Available) {
            return false;
        }
        operation();
        true
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.phase = Phase::Retired;
                guard
            }
        }
    }
}

fn token_matches(state: &State, token: ValidityToken) -> bool {
    state.namespace == Some(token.namespace)
        && state.generation == token.generation
        && state.epoch == token.epoch
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_BYTES
}

fn valid_owner(owner: &FrameOwner) -> bool {
    [&owner.principal, &owner.browser_incarnation, &owner.logical_session_id, &owner.native_target_id]
        .iter().all(|value| valid_id(value))
}

fn install_snapshot(
    state: &mut State,
    token: ValidityToken,
    session_id: &str,
    owner: Arc<FrameOwner>,
    nodes: &[FrameSnapshotNode],
    external_parent: Option<FrameKey>,
    expected_external_root_id: Option<&str>,
) -> bool {
    let valid = (|| {
        if nodes.is_empty() || nodes.len() > MAX_FRAME_FACTS {
            return false;
        }
        let mut indices = HashMap::new();
        if indices.try_reserve(nodes.len()).is_err() {
            return false;
        }
        for (index, node) in nodes.iter().enumerate() {
            if !valid_id(&node.frame_id)
                || node.parent_frame_id.as_deref().is_some_and(|id| !valid_id(id))
                || indices.insert(node.frame_id.as_str(), index).is_some()
            {
                return false;
            }
        }
        let mut parents = Vec::new();
        if parents.try_reserve(nodes.len()).is_err() {
            return false;
        }
        let mut root = None;
        for (index, node) in nodes.iter().enumerate() {
            if node.parent_frame_id.is_none() {
                if root.replace(index).is_some() {
                    return false;
                }
                parents.push(None);
            } else if let Some(parent_index) = node.parent_frame_id.as_deref()
                .and_then(|id| indices.get(id)).copied()
            {
                parents.push(Some(parent_index));
            } else {
                return false;
            }
        }
        let Some(root) = root else { return false };
        if expected_external_root_id.is_some_and(|expected| nodes[root].frame_id != expected)
            || external_parent.is_some() != expected_external_root_id.is_some()
        {
            return false;
        }
        // Each parent chain must terminate at the one root, not a disconnected cycle.
        let mut marks = Vec::new();
        if marks.try_reserve(nodes.len()).is_err() {
            return false;
        }
        marks.resize(nodes.len(), 0u8);
        marks[root] = 2;
        for start in 0..nodes.len() {
            let mut current = start;
            while marks[current] == 0 {
                marks[current] = 1;
                let Some(parent) = parents[current] else { return false };
                current = parent;
            }
            if marks[current] == 1 {
                return false;
            }
            current = start;
            while marks[current] == 1 {
                marks[current] = 2;
                current = parents[current].unwrap();
            }
        }
        let mut staged = Vec::new();
        if staged.try_reserve(nodes.len()).is_err() {
            return false;
        }
        let mut additional = 0;
        for (index, node) in nodes.iter().enumerate() {
            let key = FrameKey::new(token, session_id, &node.frame_id);
            let parent = match parents[index] {
                Some(parent) => Some(FrameKey::new(token, session_id, &nodes[parent].frame_id)),
                None => external_parent.clone(),
            };
            if let Some(existing) = state.frames.get(&key) {
                if existing.owner != owner || existing.parent != parent {
                    return false;
                }
            } else {
                additional += 1;
                let Some(reservation) = reserve_frame_fact(&state.memory_controller, &key, parent.as_ref()) else { return false };
                staged.push((key, FrameFact { owner: owner.clone(), parent, _reservation: reservation }));
            }
        }
        if additional > MAX_FRAME_FACTS - state.frames.len()
            || !reserve_frame_map_capacity(state, additional)
        {
            return false;
        }
        state.frames.extend(staged);
        state.phase = Phase::Available;
        true
    })();
    if !valid {
        fail_projection(state);
    }
    valid
}

fn resolve_frame<'a>(state: &'a State, key: &FrameKey) -> Option<&'a Arc<FrameOwner>> {
    let first = state.frames.get(key)?;
    let mut current = first;
    for _ in 0..state.frames.len() {
        match &current.parent {
            None => return Some(&first.owner),
            Some(parent) => {
                current = state.frames.get(parent)?;
                if current.owner != first.owner {
                    return None;
                }
            }
        }
    }
    None
}

/// Collect a descendant closure in O(V + E), bounded by the projection's frame cap.
fn descendant_keys(
    state: &State,
    roots: impl IntoIterator<Item = FrameKey>,
) -> Option<Vec<FrameKey>> {
    let mut children: HashMap<FrameKey, Vec<FrameKey>> = HashMap::new();
    children.try_reserve(state.frames.len()).ok()?;
    for (key, fact) in &state.frames {
        if let Some(parent) = &fact.parent {
            let descendants = children.entry(parent.clone()).or_default();
            descendants.try_reserve(1).ok()?;
            descendants.push(key.clone());
        }
    }
    let mut pending = VecDeque::new();
    pending.try_reserve(state.frames.len()).ok()?;
    let mut removed = Vec::new();
    removed.try_reserve(state.frames.len()).ok()?;
    let mut seen = HashSet::new();
    seen.try_reserve(state.frames.len()).ok()?;
    for root in roots {
        if state.frames.contains_key(&root) && seen.insert(root.clone()) {
            pending.push_back(root);
        }
    }
    while let Some(key) = pending.pop_front() {
        if let Some(descendants) = children.get(&key) {
            for child in descendants {
                if seen.insert(child.clone()) {
                    pending.push_back(child.clone());
                }
            }
        }
        removed.push(key);
    }
    Some(removed)
}

fn insert_frame(state: &mut State, key: FrameKey, owner: Arc<FrameOwner>, parent: Option<FrameKey>) -> bool {
    if let Some(existing) = state.frames.get(&key) {
        if existing.owner == owner && existing.parent == parent {
            return true;
        }
        fail_projection(state);
        return false;
    }
    if state.frames.len() >= MAX_FRAME_FACTS || !reserve_frame_map_capacity(state, 1) {
        fail_projection(state);
        return false;
    }
    let Some(reservation) = reserve_frame_fact(&state.memory_controller, &key, parent.as_ref()) else {
        fail_projection(state);
        return false;
    };
    state.frames.insert(key, FrameFact { owner, parent, _reservation: reservation });
    true
}

const FRAME_MAP_SLOT_RESERVATION_BYTES: usize = 256;

fn reserve_frame_map_capacity(state: &mut State, additional: usize) -> bool {
    let required = match state.frames.len().checked_add(additional) {
        Some(required) if required <= MAX_FRAME_FACTS => required,
        _ => return false,
    };
    let desired_capacity = required.max(8).next_power_of_two();
    let desired_bytes = match desired_capacity.checked_mul(FRAME_MAP_SLOT_RESERVATION_BYTES) {
        Some(bytes) => bytes,
        None => return false,
    };
    let current_bytes = state.frame_map_reservation.as_ref().map_or(0, |reservation| reservation.bytes());
    if desired_bytes > current_bytes {
        if let Some(reservation) = state.frame_map_reservation.as_mut() {
            if reservation.adjust(desired_bytes).is_err() {
                return false;
            }
        } else {
            let Ok(reservation) = state.memory_controller.try_reserve(desired_bytes) else {
                return false;
            };
            state.frame_map_reservation = Some(reservation);
        }
    }
    if state.frames.try_reserve(additional).is_err() {
        if let Some(reservation) = state.frame_map_reservation.as_mut() {
            let _ = reservation.adjust(current_bytes);
            if current_bytes == 0 {
                state.frame_map_reservation = None;
            }
        }
        return false;
    }
    true
}

fn reserve_frame_fact(
    memory_controller: &Arc<super::diagnostics::MemoryAdmissionController>,
    key: &FrameKey,
    parent: Option<&FrameKey>,
) -> Option<super::diagnostics::MemoryReservation> {
    // Covers the fact, hash-table entry, and owned session/frame identifiers. Owner identity is
    // shared through Arc and accounted once by its originating session state.
    let bytes = 256usize
        .checked_add(key.session_id.len())?
        .checked_add(key.frame_id.len())?
        .checked_add(parent.map_or(0, |parent| parent.session_id.len() + parent.frame_id.len()))?;
    memory_controller.try_reserve(bytes).ok()
}

fn fail_projection(state: &mut State) {
    state.phase = if advance_epoch(state) { Phase::Unavailable } else { Phase::Retired };
}


fn advance_epoch(state: &mut State) -> bool {
    state.frames.clear();
    let Some(next) = state.epoch.checked_add(1) else {
        return false;
    };
    state.epoch = next;
    true
}

#[cfg(test)]
#[path = "target_ownership_tests.rs"]
mod tests;
