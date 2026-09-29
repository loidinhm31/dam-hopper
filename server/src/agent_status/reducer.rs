use std::collections::{BTreeMap, VecDeque};

use super::types::{
    validate_opaque_id, validate_safe_integer, AgentAttentionEvent, AgentKind,
    AgentObservationSource, AgentState, AgentStatusAvailability, AgentStatusError,
    AgentStatusRemovedPayload, AgentStatusSnapshotV1, AttentionKind, BlockedReason,
    PrivateHookEnvelope, ReporterEventKind, ReporterHello, ReporterReport, TerminalAgentStatusRow,
    TurnOutcome, AGENT_STATUS_PROTOCOL_VERSION, DEFAULT_LEASE_MS,
};

/// Result of applying an event to an agent reducer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReducerOutput {
    /// True when the semantic state or availability changed, requiring a snapshot revision increment.
    pub state_changed: bool,
    /// Current public row for the terminal, or None if retired.
    pub row: Option<TerminalAgentStatusRow>,
    /// Any attention event produced by the transition.
    pub attention: Option<AgentAttentionEvent>,
}

/// Maximum number of recent event IDs retained for deduplication.
pub const MAX_SEEN_EVENT_IDS: usize = 512;

/// Maximum number of retired turn identifiers retained to reject late events.
pub const MAX_RETIRED_TURN_IDS: usize = 128;

/// Maximum number of retired session identifiers retained to reject late events.
pub const MAX_RETIRED_SESSION_IDS: usize = 32;

/// Maximum number of retired native root process identities retained to reject late events.
pub const MAX_RETIRED_ROOTS: usize = 32;

/// Off-lock process-exit evidence is valid only for this exact native owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeOwner {
    pub root: crate::pty::activity::ProcessIdentity,
    pub generation: u64,
}

/// Minimum duration (ms) between bounded freshness updates for same-state native lease renewal.
pub const MIN_FRESHNESS_UPDATE_INTERVAL_MS: u64 = 1_000;
/// Maximum number of distinct blocked tool call identifiers retained per turn.
pub const MAX_BLOCKED_TOOL_CALL_IDS: usize = 32;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalAgentReducer {
    // Identity
    pub terminal_id: String,
    pub incarnation: u64,
    pub server_epoch: u64,

    // Reporter connection
    pub agent_kind: AgentKind,
    pub native_root: Option<crate::pty::activity::ProcessIdentity>,
    pub reporter_id: String,
    pub reporter_epoch: u64,
    pub adapter_version: String,
    pub last_accepted_seq: u64,
    pub last_report: Option<ReporterReport>,
    pub reporter_lease_active: bool,
    pub last_report_time_ms: u64,
    pub observed_at_ms: Option<u64>,

    // Semantic state
    pub state: AgentState,
    pub agent_session_id: String,
    pub current_turn_id: Option<String>,
    pub blocked_reason: Option<BlockedReason>,
    pub blocked_tool_call_ids: VecDeque<String>,
    pub last_outcome: Option<TurnOutcome>,
    // Attention
    pub attention_revision: u64,
    pub latest_attention: Option<AgentAttentionEvent>,

    // Deduplication and causal ordering
    pub seen_event_ids: VecDeque<String>,
    pub retired_turn_ids: VecDeque<String>,
    pub retired_session_ids: VecDeque<String>,
    pub retired_native_roots: VecDeque<crate::pty::activity::ProcessIdentity>,
    pub last_published_freshness_ms: u64,
}
impl TerminalAgentReducer {
    /// Create a new reducer for an admitted reporter.
    pub fn new(
        server_epoch: u64,
        terminal_id: String,
        incarnation: u64,
        reporter_epoch: u64,
        hello: &ReporterHello,
        now_ms: u64,
    ) -> Result<Self, AgentStatusError> {
        validate_safe_integer("server_epoch", server_epoch)?;
        validate_safe_integer("incarnation", incarnation)?;
        validate_safe_integer("reporter_epoch", reporter_epoch)?;

        if hello.version != AGENT_STATUS_PROTOCOL_VERSION {
            return Err(AgentStatusError::VersionMismatch {
                expected: AGENT_STATUS_PROTOCOL_VERSION,
                actual: hello.version,
            });
        }

        validate_opaque_id("terminal_id", &terminal_id)?;
        validate_opaque_id("reporter_id", &hello.reporter_id)?;
        validate_opaque_id("agent_session_id", &hello.agent_session_id)?;
        validate_opaque_id("adapter_version", &hello.adapter_version)?;

        Ok(Self {
            terminal_id,
            native_root: None,
            incarnation,
            server_epoch,
            agent_kind: hello.agent_kind,
            reporter_id: hello.reporter_id.clone(),
            reporter_epoch,
            adapter_version: hello.adapter_version.clone(),
            last_accepted_seq: 0,
            last_report: None,
            reporter_lease_active: true,
            last_report_time_ms: now_ms,
            observed_at_ms: None,
            state: AgentState::Unknown,
            agent_session_id: hello.agent_session_id.clone(),
            current_turn_id: None,
            blocked_reason: None,
            blocked_tool_call_ids: VecDeque::new(),
            last_outcome: None,
            attention_revision: 0,
            latest_attention: None,
            seen_event_ids: VecDeque::new(),
            retired_turn_ids: VecDeque::new(),
            retired_session_ids: VecDeque::new(),
            retired_native_roots: VecDeque::new(),
            last_published_freshness_ms: now_ms,
        })
    }
    /// Create a new reducer initialized for native hook reporting.
    pub fn new_for_hook(
        server_epoch: u64,
        terminal_id: String,
        incarnation: u64,
        reporter_epoch: u64,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
    ) -> Result<Self, AgentStatusError> {
        validate_safe_integer("server_epoch", server_epoch)?;
        validate_safe_integer("incarnation", incarnation)?;
        validate_safe_integer("reporter_epoch", reporter_epoch)?;

        validate_opaque_id("terminal_id", &terminal_id)?;
        validate_opaque_id("agent_session_id", &envelope.agent_session_id)?;
        validate_opaque_id("adapter_version", &envelope.adapter_version)?;

        Ok(Self {
            terminal_id,
            incarnation,
            server_epoch,
            agent_kind: envelope.agent_kind,
            native_root: Some(envelope.root_process),
            reporter_id: format!("hook:{}", envelope.agent_session_id),
            reporter_epoch,
            adapter_version: envelope.adapter_version.clone(),
            last_accepted_seq: 0,
            last_report: None,
            reporter_lease_active: false,
            last_report_time_ms: now_ms,
            observed_at_ms: Some(now_ms),
            state: AgentState::Unknown,
            agent_session_id: envelope.agent_session_id.clone(),
            current_turn_id: None,
            blocked_reason: None,
            blocked_tool_call_ids: VecDeque::new(),
            last_outcome: None,
            attention_revision: 0,
            latest_attention: None,
            seen_event_ids: VecDeque::new(),
            retired_turn_ids: VecDeque::new(),
            retired_session_ids: VecDeque::new(),
            retired_native_roots: VecDeque::new(),
            last_published_freshness_ms: now_ms,
        })
    }

    /// Helper resolving tool blockers in PreToolUse and PostToolUse transitions.
    fn resolve_tool_blocker(&mut self, tool_call_id: Option<&str>) {
        if self.state == AgentState::Blocked {
            if !self.blocked_tool_call_ids.is_empty() {
                if let Some(tool_id) = tool_call_id {
                    if self.blocked_tool_call_ids.iter().any(|id| id == tool_id) {
                        self.blocked_tool_call_ids.retain(|id| id != tool_id);
                        if self.blocked_tool_call_ids.is_empty() {
                            self.state = AgentState::Working;
                            self.blocked_reason = None;
                        }
                    }
                    // Otherwise unrelated parallel tool: blocker remains active
                } else {
                    // Without correlation, prefer Unknown
                    self.state = AgentState::Unknown;
                    self.blocked_reason = None;
                    self.blocked_tool_call_ids.clear();
                }
            } else if tool_call_id.is_some() {
                self.state = AgentState::Working;
                self.blocked_reason = None;
            } else {
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
            }
        } else {
            self.state = AgentState::Working;
            self.blocked_reason = None;
        }
    }

    /// Process a native command hook event payload.
    pub fn apply_hook(
        &mut self,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
    ) -> Result<ReducerOutput, AgentStatusError> {
        self.apply_hook_with_prior_exited(envelope, now_ms, false)
    }

    /// Registry callers must bind off-lock exit evidence to the current owner.
    fn apply_hook_with_prior_exited(
        &mut self,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
        prior_exited: bool,
    ) -> Result<ReducerOutput, AgentStatusError> {
        // 1. Process identity and root fencing: reject any callback from a retired root
        if self
            .retired_native_roots
            .iter()
            .any(|r| r == &envelope.root_process)
        {
            return Ok(ReducerOutput {
                state_changed: false,
                row: Some(self.to_row()),
                attention: None,
            });
        }

        // 2. Deduplication: check if event_id has already been processed
        if self
            .seen_event_ids
            .iter()
            .any(|id| id == &envelope.event_id)
        {
            return Ok(ReducerOutput {
                state_changed: false,
                row: Some(self.to_row()),
                attention: None,
            });
        }
        // 3. Session verification and causal correlation
        if self
            .retired_session_ids
            .iter()
            .any(|id| id == &envelope.agent_session_id)
        {
            // Callback from a retired session is ignored
            return Ok(ReducerOutput {
                state_changed: false,
                row: Some(self.to_row()),
                attention: None,
            });
        }

        let is_qualifying_baseline = envelope.event == "SessionStart"
            || (envelope.event == "UserPromptSubmit" && envelope.turn_id.is_some());

        match self.native_root {
            Some(existing_root) => {
                if existing_root == envelope.root_process {
                    if self.agent_kind != envelope.agent_kind {
                        return Err(AgentStatusError::AuthorityLost(
                            "native root claim does not match terminal owner".to_string(),
                        ));
                    }
                } else if prior_exited && is_qualifying_baseline {
                    // Prior process identity proven exited and callback is qualifying baseline:
                    // Retire prior root, session, turn fencing.
                    self.retired_native_roots.push_back(existing_root);
                    if self.retired_native_roots.len() > MAX_RETIRED_ROOTS {
                        self.retired_native_roots.pop_front();
                    }
                    if let Some(turn) = self.current_turn_id.take() {
                        self.retired_turn_ids.push_back(turn);
                        if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                            self.retired_turn_ids.pop_front();
                        }
                    }
                    if !self.agent_session_id.is_empty()
                        && self.agent_session_id != envelope.agent_session_id
                    {
                        self.retired_session_ids
                            .push_back(self.agent_session_id.clone());
                        if self.retired_session_ids.len() > MAX_RETIRED_SESSION_IDS {
                            self.retired_session_ids.pop_front();
                        }
                    }
                    // Turn IDs are scoped to an owner; the retired root fence
                    // prevents callbacks from the previous process.
                    self.retired_turn_ids.clear();
                    self.native_root = Some(envelope.root_process);
                    self.agent_kind = envelope.agent_kind;
                    self.reporter_id = format!("hook:{}", envelope.agent_session_id);
                    self.agent_session_id = envelope.agent_session_id.clone();
                    self.current_turn_id = None;
                    self.state = AgentState::Unknown;
                    self.blocked_reason = None;
                    self.blocked_tool_call_ids.clear();
                    self.last_outcome = None;
                } else {
                    return Err(AgentStatusError::AuthorityLost(
                        "native root claim does not match terminal owner".to_string(),
                    ));
                }
            }
            None => {
                // SessionEnd retired the native root, or OMP disconnected.
                if is_qualifying_baseline {
                    self.retired_turn_ids.clear();
                    self.native_root = Some(envelope.root_process);
                    self.agent_kind = envelope.agent_kind;
                    self.reporter_id = format!("hook:{}", envelope.agent_session_id);
                    self.agent_session_id = envelope.agent_session_id.clone();
                    self.current_turn_id = None;
                    self.state = AgentState::Unknown;
                    self.blocked_reason = None;
                    self.blocked_tool_call_ids.clear();
                    self.last_outcome = None;
                } else {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
            }
        }

        self.seen_event_ids.push_back(envelope.event_id.clone());
        if self.seen_event_ids.len() > MAX_SEEN_EVENT_IDS {
            self.seen_event_ids.pop_front();
        }

        if self.agent_session_id != envelope.agent_session_id {
            // A callback for an unestablished session cannot invalidate or revive
            // the current session. Only a startup baseline with no active turn
            // establishes a new session on the same live root.
            if envelope.event != "SessionStart" || self.current_turn_id.is_some() {
                return Ok(ReducerOutput {
                    state_changed: false,
                    row: Some(self.to_row()),
                    attention: None,
                });
            }
            if !self.agent_session_id.is_empty() {
                self.retired_session_ids
                    .push_back(self.agent_session_id.clone());
                if self.retired_session_ids.len() > MAX_RETIRED_SESSION_IDS {
                    self.retired_session_ids.pop_front();
                }
            }
            self.retired_turn_ids.clear();
            self.agent_session_id = envelope.agent_session_id.clone();
            self.current_turn_id = None;
            self.blocked_reason = None;
            self.blocked_tool_call_ids.clear();
            self.last_outcome = None;
            self.latest_attention = None;
            self.state = AgentState::Unknown;
            self.last_report_time_ms = now_ms;
            self.observed_at_ms = Some(now_ms);
            self.last_accepted_seq = self.last_accepted_seq.saturating_add(1);
            self.last_published_freshness_ms = now_ms;
            return Ok(ReducerOutput {
                state_changed: true,
                row: Some(self.to_row()),
                attention: None,
            });
        }

        let old_state = self.state;
        let old_reason = self.blocked_reason;
        let old_turn_id = self.current_turn_id.clone();
        let old_outcome = self.last_outcome;

        let mut attention = None;

        // 4. Conservative event qualification against provider inventory
        match self.agent_kind {
            AgentKind::Codex => {
                if super::codex_hooks::normalize_codex_event(&envelope.event).is_none() {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
            }
            AgentKind::Claude => {
                if super::claude_hooks::normalize_claude_event(&envelope.event).is_none() {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
            }
            AgentKind::Omp => {
                return Err(AgentStatusError::AuthorityLost(
                    "unsupported agent kind for hook ingress".to_string(),
                ));
            }
        }

        match envelope.event.as_str() {
            "SessionStart" => {
                // A delayed startup callback cannot reset an already observed turn.
                if self.current_turn_id.is_some() {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
                self.last_outcome = None;
            }

            "UserPromptSubmit" => {
                let Some(turn_id) = &envelope.turn_id else {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                };
                if self.retired_turn_ids.iter().any(|id| id == turn_id) {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                if let Some(cur_turn) = &self.current_turn_id {
                    if cur_turn == turn_id {
                        // Duplicate prompt delivery is not fresh progress, even
                        // when a provider gives it a different delivery ID.
                        return Ok(ReducerOutput {
                            state_changed: false,
                            row: Some(self.to_row()),
                            attention: None,
                        });
                    }
                    if cur_turn != turn_id {
                        if self.state == AgentState::Working || self.state == AgentState::Blocked {
                            // Native IDs are opaque. Receipt order cannot prove whether this
                            // prompt is newer or a delayed callback from an unseen old turn.
                            self.retired_turn_ids.push_back(cur_turn.clone());
                            self.retired_turn_ids.push_back(turn_id.clone());
                            while self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                                self.retired_turn_ids.pop_front();
                            }
                            self.current_turn_id = None;
                            self.state = AgentState::Unknown;
                            self.blocked_reason = None;
                            self.blocked_tool_call_ids.clear();
                            self.observed_at_ms = None;
                            self.latest_attention = None;
                            return Ok(ReducerOutput {
                                state_changed: true,
                                row: Some(self.to_row()),
                                attention: None,
                            });
                        } else {
                            // Previous turn was already settled/stopped to Unknown:
                            // retire it cleanly and establish the new turn.
                            self.retired_turn_ids.push_back(cur_turn.clone());
                            while self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                                self.retired_turn_ids.pop_front();
                            }
                        }
                    }
                }
                self.current_turn_id = Some(turn_id.clone());
                self.state = AgentState::Working;
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
                self.last_outcome = None;
            }

            "PreToolUse" => {
                if envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                // Check if this PreToolUse is a question candidate (Claude AskUserQuestion)
                if self.agent_kind == AgentKind::Claude
                    && envelope.notification_type.as_deref() == Some("question_candidate")
                {
                    self.state = AgentState::Unknown;
                    self.blocked_reason = None;
                    self.blocked_tool_call_ids.clear();
                } else {
                    self.resolve_tool_blocker(envelope.tool_call_id.as_deref());
                }
            }

            "PostToolUse" | "PostToolUseFailure" => {
                if envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                self.resolve_tool_blocker(envelope.tool_call_id.as_deref());
            }
            "PreCompact" | "PostCompact" => {
                if envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                self.state = AgentState::Working;
                self.blocked_reason = None;
            }

            "PermissionRequest" => {
                if envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
            }

            "Notification" => {
                if self.agent_kind != AgentKind::Claude
                    || envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                match envelope.notification_type.as_deref() {
                    Some("permission_prompt") => {
                        let was_blocked = self.state == AgentState::Blocked
                            && self.blocked_reason == Some(BlockedReason::Approval);
                        self.state = AgentState::Blocked;
                        self.blocked_reason = Some(BlockedReason::Approval);
                        if let Some(tool_id) = &envelope.tool_call_id {
                            if !self.blocked_tool_call_ids.iter().any(|id| id == tool_id) {
                                self.blocked_tool_call_ids.push_back(tool_id.clone());
                                while self.blocked_tool_call_ids.len() > MAX_BLOCKED_TOOL_CALL_IDS {
                                    self.blocked_tool_call_ids.pop_front();
                                }
                            }
                        }
                        if !was_blocked {
                            self.attention_revision = self.attention_revision.saturating_add(1);
                            attention = Some(AgentAttentionEvent {
                                id: AgentAttentionEvent::format_id(
                                    self.server_epoch,
                                    &self.terminal_id,
                                    self.incarnation,
                                    self.attention_revision,
                                ),
                                kind: AttentionKind::NeedsAttention,
                                terminal_id: self.terminal_id.clone(),
                                incarnation: self.incarnation,
                                agent_kind: self.agent_kind,
                                agent_session_id: self.agent_session_id.clone(),
                                turn_id: self.current_turn_id.clone(),
                                reason: Some(BlockedReason::Approval),
                                outcome: None,
                                attention_revision: self.attention_revision,
                                timestamp_ms: now_ms,
                            });
                        }
                    }
                    Some("agent_needs_input") => {
                        let was_blocked = self.state == AgentState::Blocked
                            && self.blocked_reason == Some(BlockedReason::Question);
                        self.state = AgentState::Blocked;
                        self.blocked_reason = Some(BlockedReason::Question);
                        if let Some(tool_id) = &envelope.tool_call_id {
                            if !self.blocked_tool_call_ids.iter().any(|id| id == tool_id) {
                                self.blocked_tool_call_ids.push_back(tool_id.clone());
                            }
                        }
                        if !was_blocked {
                            self.attention_revision = self.attention_revision.saturating_add(1);
                            attention = Some(AgentAttentionEvent {
                                id: AgentAttentionEvent::format_id(
                                    self.server_epoch,
                                    &self.terminal_id,
                                    self.incarnation,
                                    self.attention_revision,
                                ),
                                kind: AttentionKind::NeedsAttention,
                                terminal_id: self.terminal_id.clone(),
                                incarnation: self.incarnation,
                                agent_kind: self.agent_kind,
                                agent_session_id: self.agent_session_id.clone(),
                                turn_id: self.current_turn_id.clone(),
                                reason: Some(BlockedReason::Question),
                                outcome: None,
                                attention_revision: self.attention_revision,
                                timestamp_ms: now_ms,
                            });
                        }
                    }
                    _ => {
                        return Ok(ReducerOutput {
                            state_changed: false,
                            row: Some(self.to_row()),
                            attention: None,
                        });
                    }
                }
            }

            "StopFailure" => {
                if self.agent_kind != AgentKind::Claude
                    || envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                let was_error = self.state == AgentState::Blocked
                    && self.blocked_reason == Some(BlockedReason::Error);
                self.state = AgentState::Blocked;
                self.blocked_reason = Some(BlockedReason::Error);
                self.blocked_tool_call_ids.clear();
                if !was_error {
                    self.attention_revision = self.attention_revision.saturating_add(1);
                    attention = Some(AgentAttentionEvent {
                        id: AgentAttentionEvent::format_id(
                            self.server_epoch,
                            &self.terminal_id,
                            self.incarnation,
                            self.attention_revision,
                        ),
                        kind: AttentionKind::NeedsAttention,
                        terminal_id: self.terminal_id.clone(),
                        incarnation: self.incarnation,
                        agent_kind: self.agent_kind,
                        agent_session_id: self.agent_session_id.clone(),
                        turn_id: self.current_turn_id.clone(),
                        reason: Some(BlockedReason::Error),
                        outcome: None,
                        attention_revision: self.attention_revision,
                        timestamp_ms: now_ms,
                    });
                }
            }

            "Interrupt" => {
                if self.agent_kind != AgentKind::Codex
                    || envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                let turn_id = self.current_turn_id.take().expect("checked current turn");
                self.retired_turn_ids.push_back(turn_id);
                if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                    self.retired_turn_ids.pop_front();
                }
                self.state = AgentState::Idle;
                self.last_outcome = Some(TurnOutcome::Interrupted);
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
            }

            "Stop" => {
                if envelope.turn_id.as_ref() != self.current_turn_id.as_ref()
                    || self.current_turn_id.is_none()
                {
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                }
                // Stop invalidates turn certainty to Unknown, but preserves current_turn_id
                // so that a continuation can resume/refresh observed work.
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
            }

            "SessionEnd" => {
                if let Some(root) = self.native_root.take() {
                    self.retired_native_roots.push_back(root);
                    if self.retired_native_roots.len() > MAX_RETIRED_ROOTS {
                        self.retired_native_roots.pop_front();
                    }
                }
                if let Some(turn) = self.current_turn_id.take() {
                    self.retired_turn_ids.push_back(turn);
                    if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                        self.retired_turn_ids.pop_front();
                    }
                }
                self.retired_session_ids
                    .push_back(self.agent_session_id.clone());
                if self.retired_session_ids.len() > MAX_RETIRED_SESSION_IDS {
                    self.retired_session_ids.pop_front();
                }
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
                self.blocked_tool_call_ids.clear();
                self.last_outcome = None;
                self.latest_attention = None;
                self.observed_at_ms = None;
                attention = None;
            }

            _ => {
                // Unsupported event: no-op, does not renew lease
                return Ok(ReducerOutput {
                    state_changed: false,
                    row: Some(self.to_row()),
                    attention: None,
                });
            }
        }

        self.last_accepted_seq = self.last_accepted_seq.saturating_add(1);
        self.last_report_time_ms = now_ms;
        self.observed_at_ms = self.native_root.map(|_| now_ms);

        if attention.is_some() {
            self.latest_attention = attention.clone();
        }

        let semantic_changed = old_state != self.state
            || old_reason != self.blocked_reason
            || old_turn_id != self.current_turn_id
            || old_outcome != self.last_outcome
            || attention.is_some();

        let state_changed = if semantic_changed {
            self.last_published_freshness_ms = now_ms;
            true
        } else if self.state != AgentState::Unknown
            && now_ms.saturating_sub(self.last_published_freshness_ms)
                >= MIN_FRESHNESS_UPDATE_INTERVAL_MS
        {
            self.last_published_freshness_ms = now_ms;
            true
        } else {
            false
        };

        Ok(ReducerOutput {
            state_changed,
            row: Some(self.to_row()),
            attention,
        })
    }

    /// Read public representation omitting capabilities, connection handles, and session file paths.
    pub fn to_row(&self) -> TerminalAgentStatusRow {
        TerminalAgentStatusRow {
            id: self.terminal_id.clone(),
            incarnation: self.incarnation,
            agent_kind: self.agent_kind,
            agent_session_id: self.agent_session_id.clone(),
            reporter_epoch: self.reporter_epoch,
            state: self.state,
            source: if self.agent_kind == AgentKind::Omp {
                AgentObservationSource::Lifecycle
            } else {
                AgentObservationSource::Hook
            },
            observed_at_ms: self.observed_at_ms,
            expires_at_ms: if self.agent_kind == AgentKind::Omp || self.state == AgentState::Unknown
            {
                None
            } else {
                self.observed_at_ms
                    .map(|at| at.saturating_add(DEFAULT_LEASE_MS))
            },
            reason: self.blocked_reason,
            turn_id: self.current_turn_id.clone(),
            attention_revision: self.attention_revision,
            last_outcome: self.last_outcome,
        }
    }

    /// Check if reporter connection is actively authoritative (not unknown).
    pub fn is_authoritative(&self) -> bool {
        self.state != AgentState::Unknown
    }

    /// Re-admit reporter on reconnect.
    pub fn reconnect(
        &mut self,
        reporter_epoch: u64,
        hello: &ReporterHello,
        now_ms: u64,
    ) -> Result<bool, AgentStatusError> {
        validate_safe_integer("reporter_epoch", reporter_epoch)?;

        if hello.version != AGENT_STATUS_PROTOCOL_VERSION {
            return Err(AgentStatusError::VersionMismatch {
                expected: AGENT_STATUS_PROTOCOL_VERSION,
                actual: hello.version,
            });
        }

        if reporter_epoch <= self.reporter_epoch {
            return Err(AgentStatusError::StaleReporterEpoch {
                current: self.reporter_epoch,
                got: reporter_epoch,
            });
        }

        validate_opaque_id("reporter_id", &hello.reporter_id)?;
        validate_opaque_id("agent_session_id", &hello.agent_session_id)?;
        validate_opaque_id("adapter_version", &hello.adapter_version)?;
        // OMP takeover: an incoming OMP reporter evicts and retires any native owner.
        if self.agent_kind != AgentKind::Omp && hello.agent_kind == AgentKind::Omp {
            if let Some(root) = self.native_root.take() {
                self.retired_native_roots.push_back(root);
                if self.retired_native_roots.len() > MAX_RETIRED_ROOTS {
                    self.retired_native_roots.pop_front();
                }
            }
            if let Some(turn) = self.current_turn_id.take() {
                self.retired_turn_ids.push_back(turn);
                if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                    self.retired_turn_ids.pop_front();
                }
            }
            if !self.agent_session_id.is_empty() {
                self.retired_session_ids
                    .push_back(self.agent_session_id.clone());
                if self.retired_session_ids.len() > MAX_RETIRED_SESSION_IDS {
                    self.retired_session_ids.pop_front();
                }
            }
        } else if self.is_authoritative() && self.reporter_id != hello.reporter_id {
            // A different reporter is rejected while the old one is live and authoritative.
            return Err(AgentStatusError::ReporterOccupied {
                active: self.reporter_id.clone(),
            });
        }

        self.agent_kind = hello.agent_kind;
        self.reporter_id = hello.reporter_id.clone();
        self.reporter_epoch = reporter_epoch;
        self.adapter_version = hello.adapter_version.clone();
        self.last_accepted_seq = 0;
        self.last_report = None;
        self.reporter_lease_active = true;
        self.last_report_time_ms = now_ms;
        self.observed_at_ms = None;
        self.agent_session_id = hello.agent_session_id.clone();
        self.state = AgentState::Unknown;
        self.current_turn_id = None;
        self.blocked_reason = None;
        self.latest_attention = None;
        self.last_outcome = None;

        // A new owner generation is publicly observable even while Unknown.
        Ok(true)
    }

    /// Process a report received from the reporter socket.
    pub fn apply_report(
        &mut self,
        reporter_epoch: u64,
        report: ReporterReport,
        now_ms: u64,
    ) -> Result<ReducerOutput, AgentStatusError> {
        // Reporter epoch fence
        if reporter_epoch != self.reporter_epoch {
            return Err(AgentStatusError::StaleReporterEpoch {
                current: self.reporter_epoch,
                got: reporter_epoch,
            });
        }
        if !self.reporter_lease_active
            || now_ms.saturating_sub(self.last_report_time_ms) >= DEFAULT_LEASE_MS
        {
            return Err(AgentStatusError::AuthorityLost(
                "reporter lease is no longer active".to_string(),
            ));
        }

        validate_safe_integer("seq", report.seq)?;

        // Sequence fence
        if let Some(last) = &self.last_report {
            if report.seq < self.last_accepted_seq {
                // Stale sequence is ignored
                return Ok(ReducerOutput {
                    state_changed: false,
                    row: Some(self.to_row()),
                    attention: None,
                });
            }

            if report.seq == self.last_accepted_seq {
                // Duplicate sequence check
                if last == &report {
                    // Idempotent duplicate: no-op, no re-alert
                    return Ok(ReducerOutput {
                        state_changed: false,
                        row: Some(self.to_row()),
                        attention: None,
                    });
                } else {
                    return Err(AgentStatusError::ConflictingDuplicateSequence { seq: report.seq });
                }
            }
        }

        // Validate payload
        validate_opaque_id("agent_session_id", &report.agent_session_id)?;
        if let Some(turn_id) = &report.turn_id {
            validate_opaque_id("turn_id", turn_id)?;
        }

        self.validate_report_consistency(&report)?;
        // The persistent reporter protocol is OMP-only. Native hook events require
        // separate admission and correlation; never interpret Stop as TurnEnded.
        if self.agent_kind != AgentKind::Omp {
            return Err(AgentStatusError::AuthorityLost(
                "native hook events require private hook admission".to_string(),
            ));
        }

        // Record accepted sequence and report
        self.last_accepted_seq = report.seq;
        self.last_report = Some(report.clone());
        self.last_report_time_ms = now_ms;

        let old_state = self.state;
        let old_reason = self.blocked_reason;
        let old_turn_id = self.current_turn_id.clone();
        let old_session_id = self.agent_session_id.clone();
        let old_outcome = self.last_outcome;

        let mut attention: Option<AgentAttentionEvent> = None;

        match report.event {
            ReporterEventKind::Snapshot => {
                // Silent baseline install: never emits attention
                if self.agent_session_id != report.agent_session_id {
                    self.current_turn_id = None;
                    self.blocked_reason = None;
                }
                self.agent_session_id = report.agent_session_id;
                self.state = report.state;
                self.blocked_reason = report.blocked_reason;
                self.current_turn_id = report.turn_id;
                self.last_outcome = report.outcome;
            }

            ReporterEventKind::SessionChanged => {
                // Session switch resets turn/blocker history without completion alert
                self.agent_session_id = report.agent_session_id;
                self.current_turn_id = None;
                self.blocked_reason = report.blocked_reason;
                self.state = report.state;
                self.last_outcome = None;
            }

            ReporterEventKind::TurnStarted => {
                if self.current_turn_id.as_deref() == report.turn_id.as_deref()
                    && self.state == AgentState::Working
                {
                    // Same active start is idempotent
                } else {
                    self.current_turn_id = report.turn_id;
                    self.state = AgentState::Working;
                    self.blocked_reason = None;
                    self.last_outcome = None;
                }
            }

            ReporterEventKind::StateChanged => {
                if report.state == AgentState::Blocked {
                    let was_blocked = self.state == AgentState::Blocked;
                    self.state = AgentState::Blocked;
                    self.blocked_reason = report.blocked_reason;

                    // Transition into blocked produces one needs-attention; changing blocker count does not re-notify
                    if !was_blocked {
                        self.attention_revision = self.attention_revision.saturating_add(1);
                        validate_safe_integer("attention_revision", self.attention_revision)?;

                        let event = AgentAttentionEvent {
                            id: AgentAttentionEvent::format_id(
                                self.server_epoch,
                                &self.terminal_id,
                                self.incarnation,
                                self.attention_revision,
                            ),
                            kind: AttentionKind::NeedsAttention,
                            terminal_id: self.terminal_id.clone(),
                            incarnation: self.incarnation,
                            agent_kind: self.agent_kind,
                            agent_session_id: self.agent_session_id.clone(),
                            turn_id: self.current_turn_id.clone(),
                            reason: self.blocked_reason,
                            outcome: None,
                            attention_revision: self.attention_revision,
                            timestamp_ms: now_ms,
                        };
                        self.latest_attention = Some(event.clone());
                        attention = Some(event);
                    }
                } else {
                    self.state = report.state;
                    self.blocked_reason = None;
                }
            }

            ReporterEventKind::TurnEnded => {
                let outcome = report.outcome.ok_or(AgentStatusError::MissingTurnOutcome)?;
                let matches_turn =
                    self.current_turn_id.is_some() && self.current_turn_id == report.turn_id;

                self.current_turn_id = None;
                self.last_outcome = Some(outcome);

                match outcome {
                    TurnOutcome::Ended => {
                        self.state = AgentState::Idle;
                        self.blocked_reason = None;

                        if matches_turn {
                            // Observed turn start + matching settled turn end => turn-ended attention
                            self.attention_revision = self.attention_revision.saturating_add(1);
                            validate_safe_integer("attention_revision", self.attention_revision)?;

                            let event = AgentAttentionEvent {
                                id: AgentAttentionEvent::format_id(
                                    self.server_epoch,
                                    &self.terminal_id,
                                    self.incarnation,
                                    self.attention_revision,
                                ),
                                kind: AttentionKind::TurnEnded,
                                terminal_id: self.terminal_id.clone(),
                                incarnation: self.incarnation,
                                agent_kind: self.agent_kind,
                                agent_session_id: self.agent_session_id.clone(),
                                turn_id: report.turn_id,
                                reason: None,
                                outcome: Some(TurnOutcome::Ended),
                                attention_revision: self.attention_revision,
                                timestamp_ms: now_ms,
                            };
                            self.latest_attention = Some(event.clone());
                            attention = Some(event);
                        }
                    }

                    TurnOutcome::Interrupted => {
                        // Interrupted => idle without normal finish
                        self.state = AgentState::Idle;
                        self.blocked_reason = None;
                    }

                    TurnOutcome::Error => {
                        // Error => blocked/error attention
                        self.state = AgentState::Blocked;
                        self.blocked_reason = Some(BlockedReason::Error);

                        if matches_turn {
                            self.attention_revision = self.attention_revision.saturating_add(1);
                            validate_safe_integer("attention_revision", self.attention_revision)?;

                            let event = AgentAttentionEvent {
                                id: AgentAttentionEvent::format_id(
                                    self.server_epoch,
                                    &self.terminal_id,
                                    self.incarnation,
                                    self.attention_revision,
                                ),
                                kind: AttentionKind::NeedsAttention,
                                terminal_id: self.terminal_id.clone(),
                                incarnation: self.incarnation,
                                agent_kind: self.agent_kind,
                                agent_session_id: self.agent_session_id.clone(),
                                turn_id: report.turn_id,
                                reason: Some(BlockedReason::Error),
                                outcome: Some(TurnOutcome::Error),
                                attention_revision: self.attention_revision,
                                timestamp_ms: now_ms,
                            };
                            self.latest_attention = Some(event.clone());
                            attention = Some(event);
                        }
                    }

                    TurnOutcome::Unknown => {
                        // Unknown => unknown without finish
                        self.state = AgentState::Unknown;
                        self.blocked_reason = None;
                    }
                }
            }

            ReporterEventKind::Heartbeat => {
                if self.state != report.state {
                    self.state = report.state;
                    self.blocked_reason = report.blocked_reason;
                }
            }

            ReporterEventKind::Release => {
                self.state = AgentState::Unknown;
                self.blocked_reason = None;
                self.current_turn_id = None;
            }
        }

        let state_changed = self.state != old_state
            || self.blocked_reason != old_reason
            || self.current_turn_id != old_turn_id
            || self.agent_session_id != old_session_id
            || self.last_outcome != old_outcome;
        if state_changed {
            self.observed_at_ms = Some(now_ms);
        }

        Ok(ReducerOutput {
            state_changed,
            row: Some(self.to_row()),
            attention,
        })
    }

    /// Mark agent status unknown due to disconnect, authority loss, or lease expiry.
    /// Never emits a turn-ended completion notification.
    pub fn mark_unknown(&mut self) -> ReducerOutput {
        let state_changed = self.state != AgentState::Unknown
            || self.blocked_reason.is_some()
            || self.current_turn_id.is_some()
            || self.observed_at_ms.is_some();
        let state_changed = state_changed || self.reporter_lease_active;
        self.reporter_lease_active = false;

        if self.agent_kind != AgentKind::Omp {
            if let Some(root) = self.native_root.take() {
                self.retired_native_roots.push_back(root);
                if self.retired_native_roots.len() > MAX_RETIRED_ROOTS {
                    self.retired_native_roots.pop_front();
                }
            }
            if let Some(turn) = self.current_turn_id.take() {
                self.retired_turn_ids.push_back(turn);
                if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                    self.retired_turn_ids.pop_front();
                }
            }
            if !self.agent_session_id.is_empty() {
                self.retired_session_ids
                    .push_back(self.agent_session_id.clone());
                if self.retired_session_ids.len() > MAX_RETIRED_SESSION_IDS {
                    self.retired_session_ids.pop_front();
                }
            }
        }

        self.state = AgentState::Unknown;
        self.blocked_reason = None;
        self.current_turn_id = None;
        self.observed_at_ms = None;
        self.latest_attention = None;
        self.last_outcome = None;
        ReducerOutput {
            state_changed,
            row: Some(self.to_row()),
            attention: None,
        }
    }

    /// Expiry retires native turn evidence, not the still-live process/session.
    /// Fresh baselines can recover that owner; old turn callbacks cannot.
    pub fn check_lease(&mut self, now_ms: u64, lease_ms: u64) -> Option<ReducerOutput> {
        let has_evidence = self.reporter_lease_active
            || self.observed_at_ms.is_some()
            || self.current_turn_id.is_some();
        if !has_evidence || now_ms.saturating_sub(self.last_report_time_ms) < lease_ms {
            return None;
        }
        if self.agent_kind == AgentKind::Omp {
            return Some(self.mark_unknown());
        }
        if let Some(turn) = self.current_turn_id.take() {
            self.retired_turn_ids.push_back(turn);
            if self.retired_turn_ids.len() > MAX_RETIRED_TURN_IDS {
                self.retired_turn_ids.pop_front();
            }
        }
        self.state = AgentState::Unknown;
        self.blocked_reason = None;
        self.blocked_tool_call_ids.clear();
        self.last_outcome = None;
        self.latest_attention = None;
        self.observed_at_ms = None;
        Some(ReducerOutput {
            state_changed: true,
            row: Some(self.to_row()),
            attention: None,
        })
    }

    /// Validate report event, state, outcome, and blocked reason combinations.
    fn validate_report_consistency(&self, report: &ReporterReport) -> Result<(), AgentStatusError> {
        if report.kind != "report" {
            return Err(AgentStatusError::InvalidIdentifier(format!(
                "expected report kind 'report', got '{}'",
                report.kind
            )));
        }

        match report.event {
            ReporterEventKind::TurnStarted => {
                if report.state != AgentState::Working {
                    return Err(AgentStatusError::InconsistentEventState {
                        event: report.event,
                        state: report.state,
                    });
                }
                if report.turn_id.is_none() {
                    return Err(AgentStatusError::MissingTurnStartId);
                }
                if report.outcome.is_some() {
                    return Err(AgentStatusError::UnexpectedTurnOutcome(report.event));
                }
                if report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }

            ReporterEventKind::TurnEnded => {
                if report.turn_id.is_none() {
                    return Err(AgentStatusError::MissingTurnId);
                }
                let outcome = report.outcome.ok_or(AgentStatusError::MissingTurnOutcome)?;
                match outcome {
                    TurnOutcome::Ended | TurnOutcome::Interrupted => {
                        if report.state != AgentState::Idle {
                            return Err(AgentStatusError::InconsistentEventState {
                                event: report.event,
                                state: report.state,
                            });
                        }
                    }
                    TurnOutcome::Error => {
                        if report.state != AgentState::Blocked {
                            return Err(AgentStatusError::InconsistentEventState {
                                event: report.event,
                                state: report.state,
                            });
                        }
                    }
                    TurnOutcome::Unknown => {
                        if report.state != AgentState::Unknown {
                            return Err(AgentStatusError::InconsistentEventState {
                                event: report.event,
                                state: report.state,
                            });
                        }
                    }
                }
            }

            ReporterEventKind::StateChanged => {
                if report.outcome.is_some() {
                    return Err(AgentStatusError::UnexpectedTurnOutcome(report.event));
                }
                if report.state == AgentState::Blocked {
                    if report.blocked_reason.is_none() {
                        return Err(AgentStatusError::MissingBlockedReason);
                    }
                } else if report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }

            ReporterEventKind::Snapshot => {
                if report.state == AgentState::Blocked && report.blocked_reason.is_none() {
                    return Err(AgentStatusError::MissingBlockedReason);
                }
                if report.state != AgentState::Blocked && report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }

            ReporterEventKind::Heartbeat => {
                if report.outcome.is_some() {
                    return Err(AgentStatusError::UnexpectedTurnOutcome(report.event));
                }
                if report.state == AgentState::Blocked && report.blocked_reason.is_none() {
                    return Err(AgentStatusError::MissingBlockedReason);
                }
                if report.state != AgentState::Blocked && report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }

            ReporterEventKind::Release => {
                if report.state != AgentState::Unknown {
                    return Err(AgentStatusError::InconsistentEventState {
                        event: report.event,
                        state: report.state,
                    });
                }
                if report.outcome.is_some() {
                    return Err(AgentStatusError::UnexpectedTurnOutcome(report.event));
                }
                if report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }

            ReporterEventKind::SessionChanged => {
                if report.outcome.is_some() {
                    return Err(AgentStatusError::UnexpectedTurnOutcome(report.event));
                }
                if report.state == AgentState::Blocked && report.blocked_reason.is_none() {
                    return Err(AgentStatusError::MissingBlockedReason);
                }
                if report.state != AgentState::Blocked && report.blocked_reason.is_some() {
                    return Err(AgentStatusError::UnexpectedBlockedReason(report.state));
                }
            }
        }

        Ok(())
    }
}

/// Global registry of terminal agent status reducers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentStatusRegistry {
    pub server_epoch: u64,
    pub revision: u64,
    pub availability: AgentStatusAvailability,
    terminals: BTreeMap<(String, u64), TerminalAgentReducer>,
    next_reporter_epoch: u64,
}

impl AgentStatusRegistry {
    /// Create a new registry.
    pub fn new(server_epoch: u64, availability: AgentStatusAvailability) -> Self {
        Self {
            server_epoch,
            revision: 1,
            availability,
            terminals: BTreeMap::new(),
            next_reporter_epoch: 0,
        }
    }

    /// Read public snapshot.
    pub fn snapshot(&self) -> AgentStatusSnapshotV1 {
        AgentStatusSnapshotV1 {
            version: AGENT_STATUS_PROTOCOL_VERSION,
            server_epoch: self.server_epoch,
            revision: self.revision,
            availability: self.availability,
            terminals: self.terminals.values().map(|r| r.to_row()).collect(),
        }
    }

    /// Set subsystem availability. Increments snapshot revision if changed.
    pub fn set_availability(
        &mut self,
        availability: AgentStatusAvailability,
    ) -> Result<bool, AgentStatusError> {
        if self.availability != availability {
            self.availability = availability;
            self.advance_revision()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Admit a reporter for a terminal incarnation.
    pub fn admit_reporter(
        &mut self,
        terminal_id: String,
        incarnation: u64,
        hello: &ReporterHello,
        now_ms: u64,
    ) -> Result<TerminalAgentStatusRow, AgentStatusError> {
        let reporter_epoch = self.allocate_owner_generation()?;
        let key = (terminal_id.clone(), incarnation);
        if let Some(existing) = self.terminals.get_mut(&key) {
            let changed = existing.reconnect(reporter_epoch, hello, now_ms)?;
            let row = existing.to_row();
            if changed {
                self.advance_revision()?;
            }
            Ok(row)
        } else {
            let reducer = TerminalAgentReducer::new(
                self.server_epoch,
                terminal_id,
                incarnation,
                reporter_epoch,
                hello,
                now_ms,
            )?;
            let row = reducer.to_row();
            self.terminals.insert(key, reducer);
            self.advance_revision()?;
            Ok(row)
        }
    }

    /// Apply a report from an admitted reporter.
    pub fn apply_report(
        &mut self,
        terminal_id: &str,
        incarnation: u64,
        reporter_epoch: u64,
        report: ReporterReport,
        now_ms: u64,
    ) -> Result<ReducerOutput, AgentStatusError> {
        let key = (terminal_id.to_string(), incarnation);
        let reducer = self
            .terminals
            .get_mut(&key)
            .ok_or_else(|| AgentStatusError::AuthorityLost("terminal not found".to_string()))?;

        let output = reducer.apply_report(reporter_epoch, report, now_ms)?;
        if output.state_changed {
            self.advance_revision()?;
        }
        Ok(output)
    }
    /// Apply a native hook event to the registry.
    pub fn apply_hook(
        &mut self,
        terminal_id: &str,
        incarnation: u64,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
    ) -> Result<ReducerOutput, AgentStatusError> {
        self.apply_hook_with_prior_exited(terminal_id, incarnation, envelope, now_ms, None)
    }

    /// Apply a native hook event with proof that prior root process has exited.
    pub fn apply_hook_with_prior_exited(
        &mut self,
        terminal_id: &str,
        incarnation: u64,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
        exited_owner: Option<NativeOwner>,
    ) -> Result<ReducerOutput, AgentStatusError> {
        let key = (terminal_id.to_string(), incarnation);
        if exited_owner.is_some() && self.get_native_owner(terminal_id, incarnation) != exited_owner
        {
            return Err(AgentStatusError::AuthorityLost(
                "native owner changed while checking process exit".to_string(),
            ));
        }
        let candidate_generation = self.next_reporter_epoch.saturating_add(1);
        validate_safe_integer("reporter_epoch", candidate_generation)?;
        let output = if let Some(existing) = self.terminals.get_mut(&key) {
            if existing.agent_kind == AgentKind::Omp && existing.reporter_lease_active {
                return Err(AgentStatusError::AuthorityLost(
                    "terminal is occupied by OMP reporter".to_string(),
                ));
            }
            let prior_root = existing.native_root;
            let expired = existing.check_lease(now_ms, DEFAULT_LEASE_MS).is_some();
            let mut output =
                existing.apply_hook_with_prior_exited(envelope, now_ms, exited_owner.is_some())?;
            output.state_changed |= expired;
            if existing.native_root != prior_root {
                self.next_reporter_epoch = candidate_generation;
                existing.reporter_epoch = candidate_generation;
                existing.reporter_lease_active = false;
                existing.latest_attention = None;
                output.row = Some(existing.to_row());
                output.state_changed = true;
            }
            output
        } else {
            // Candidate/unknown hooks cannot claim a terminal or manufacture freshness.
            if envelope.event != "SessionStart"
                && !(envelope.event == "UserPromptSubmit" && envelope.turn_id.is_some())
            {
                return Ok(ReducerOutput {
                    state_changed: false,
                    row: None,
                    attention: None,
                });
            }
            let mut reducer = TerminalAgentReducer::new_for_hook(
                self.server_epoch,
                terminal_id.to_string(),
                incarnation,
                candidate_generation,
                envelope,
                now_ms,
            )?;
            let mut output =
                reducer.apply_hook_with_prior_exited(envelope, now_ms, exited_owner.is_some())?;
            self.next_reporter_epoch = candidate_generation;
            // Inserting an Unknown baseline still publishes a new terminal row.
            output.state_changed = true;
            self.terminals.insert(key, reducer);
            output
        };

        if output.state_changed {
            self.advance_revision()?;
        }
        Ok(output)
    }

    /// Capture the root and generation together before checking process exit.
    pub fn get_native_owner(&self, terminal_id: &str, incarnation: u64) -> Option<NativeOwner> {
        let key = (terminal_id.to_string(), incarnation);
        self.terminals.get(&key).and_then(|reducer| {
            reducer.native_root.map(|root| NativeOwner {
                root,
                generation: reducer.reporter_epoch,
            })
        })
    }

    /// Mark a terminal's agent status as unknown.
    pub fn mark_unknown(
        &mut self,
        terminal_id: &str,
        incarnation: u64,
        reporter_epoch: u64,
    ) -> Result<ReducerOutput, AgentStatusError> {
        let key = (terminal_id.to_string(), incarnation);
        let reducer = self
            .terminals
            .get_mut(&key)
            .ok_or_else(|| AgentStatusError::AuthorityLost("terminal not found".to_string()))?;

        // Reporter epoch fence on disconnect/close: old socket cannot clear new epoch
        if reducer.reporter_epoch != reporter_epoch {
            return Err(AgentStatusError::StaleReporterEpoch {
                current: reducer.reporter_epoch,
                got: reporter_epoch,
            });
        }

        let retiring_native_root = reducer.native_root.is_some();
        let next_generation = self.next_reporter_epoch.saturating_add(1);
        if retiring_native_root {
            validate_safe_integer("reporter_epoch", next_generation)?;
        }
        let mut output = reducer.mark_unknown();
        if retiring_native_root {
            self.next_reporter_epoch = next_generation;
            reducer.reporter_epoch = next_generation;
            output.row = Some(reducer.to_row());
            output.state_changed = true;
        }
        if output.state_changed {
            self.advance_revision()?;
        }
        Ok(output)
    }

    /// Check leases across all managed terminals.
    pub fn check_leases(
        &mut self,
        now_ms: u64,
        lease_ms: u64,
    ) -> Result<Vec<ReducerOutput>, AgentStatusError> {
        let mut expired_outputs = Vec::new();
        for reducer in self.terminals.values_mut() {
            if let Some(output) = reducer.check_lease(now_ms, lease_ms) {
                expired_outputs.push(output);
            }
        }
        if !expired_outputs.is_empty() {
            self.advance_revision()?;
        }
        Ok(expired_outputs)
    }

    /// Explicitly remove a terminal on PTY exit/retirement.
    /// Increments snapshot revision and returns an AgentStatusRemovedPayload.
    pub fn remove_terminal(
        &mut self,
        terminal_id: &str,
        incarnation: u64,
    ) -> Result<Option<AgentStatusRemovedPayload>, AgentStatusError> {
        let key = (terminal_id.to_string(), incarnation);
        if self.terminals.remove(&key).is_some() {
            self.advance_revision()?;
            Ok(Some(AgentStatusRemovedPayload {
                server_epoch: self.server_epoch,
                revision: self.revision,
                terminal_id: terminal_id.to_string(),
                incarnation,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get current row for a terminal incarnation.
    pub fn get_row(&self, terminal_id: &str, incarnation: u64) -> Option<TerminalAgentStatusRow> {
        let key = (terminal_id.to_string(), incarnation);
        self.terminals.get(&key).map(|r| r.to_row())
    }

    fn allocate_owner_generation(&mut self) -> Result<u64, AgentStatusError> {
        let next = self.next_reporter_epoch.saturating_add(1);
        validate_safe_integer("reporter_epoch", next)?;
        self.next_reporter_epoch = next;
        Ok(next)
    }

    /// Advance snapshot revision monotonically.
    fn advance_revision(&mut self) -> Result<(), AgentStatusError> {
        self.revision = self.revision.saturating_add(1);
        validate_safe_integer("revision", self.revision)?;
        Ok(())
    }
}
