use std::collections::BTreeMap;

use super::types::{
    validate_opaque_id, validate_safe_integer, AgentAttentionEvent, AgentKind, AgentObservationSource, AgentState,
    AgentStatusAvailability, AgentStatusError, AgentStatusRemovedPayload, AgentStatusSnapshotV1,
    AttentionKind, BlockedReason, ReporterEventKind, ReporterHello, ReporterReport,
    TerminalAgentStatusRow, TurnOutcome, AGENT_STATUS_PROTOCOL_VERSION, DEFAULT_LEASE_MS,
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

/// Reducer managing agent status transitions for a specific terminal incarnation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalAgentReducer {
    // Identity
    pub terminal_id: String,
    pub incarnation: u64,
    pub server_epoch: u64,

    // Reporter connection
    pub agent_kind: AgentKind,
    pub reporter_id: String,
    pub reporter_epoch: u64,
    pub adapter_version: String,
    pub last_accepted_seq: u64,
    pub last_report: Option<ReporterReport>,
    pub last_report_time_ms: u64,
    pub observed_at_ms: Option<u64>,

    // Semantic state
    pub state: AgentState,
    pub agent_session_id: String,
    pub current_turn_id: Option<String>,
    pub blocked_reason: Option<BlockedReason>,
    pub last_outcome: Option<TurnOutcome>,

    // Attention
    pub attention_revision: u64,
    pub latest_attention: Option<AgentAttentionEvent>,
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
            incarnation,
            server_epoch,
            agent_kind: hello.agent_kind,
            reporter_id: hello.reporter_id.clone(),
            reporter_epoch,
            adapter_version: hello.adapter_version.clone(),
            last_accepted_seq: 0,
            last_report: None,
            last_report_time_ms: now_ms,
            observed_at_ms: None,
            state: AgentState::Unknown,
            agent_session_id: hello.agent_session_id.clone(),
            current_turn_id: None,
            blocked_reason: None,
            last_outcome: None,
            attention_revision: 0,
            latest_attention: None,
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
            expires_at_ms: if self.agent_kind == AgentKind::Omp {
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

        // A different reporter is rejected while the old one is live and authoritative.
        if self.is_authoritative() && self.reporter_id != hello.reporter_id {
            return Err(AgentStatusError::ReporterOccupied {
                active: self.reporter_id.clone(),
            });
        }

        validate_opaque_id("reporter_id", &hello.reporter_id)?;
        validate_opaque_id("agent_session_id", &hello.agent_session_id)?;
        validate_opaque_id("adapter_version", &hello.adapter_version)?;

        let state_changed = self.state != AgentState::Unknown || self.observed_at_ms.is_some();

        self.agent_kind = hello.agent_kind;
        self.reporter_id = hello.reporter_id.clone();
        self.reporter_epoch = reporter_epoch;
        self.adapter_version = hello.adapter_version.clone();
        self.last_accepted_seq = 0;
        self.last_report = None;
        self.last_report_time_ms = now_ms;
        self.observed_at_ms = None;
        self.agent_session_id = hello.agent_session_id.clone();
        self.state = AgentState::Unknown;
        self.current_turn_id = None;
        self.blocked_reason = None;

        Ok(state_changed)
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

        self.state = AgentState::Unknown;
        self.blocked_reason = None;
        self.current_turn_id = None;
        self.observed_at_ms = None;

        ReducerOutput {
            state_changed,
            row: Some(self.to_row()),
            attention: None,
        }
    }

    /// Check lease expiration. If expired, transition to unknown without completion alert.
    pub fn check_lease(&mut self, now_ms: u64, lease_ms: u64) -> Option<ReducerOutput> {
        if self.state == AgentState::Unknown {
            return None;
        }

        if now_ms.saturating_sub(self.last_report_time_ms) >= lease_ms {
            Some(self.mark_unknown())
        } else {
            None
        }
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
}

impl AgentStatusRegistry {
    /// Create a new registry.
    pub fn new(server_epoch: u64, availability: AgentStatusAvailability) -> Self {
        Self {
            server_epoch,
            revision: 1,
            availability,
            terminals: BTreeMap::new(),
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
        reporter_epoch: u64,
        hello: &ReporterHello,
        now_ms: u64,
    ) -> Result<TerminalAgentStatusRow, AgentStatusError> {
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

        let output = reducer.mark_unknown();
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

    /// Advance snapshot revision monotonically.
    fn advance_revision(&mut self) -> Result<(), AgentStatusError> {
        self.revision = self.revision.saturating_add(1);
        validate_safe_integer("revision", self.revision)?;
        Ok(())
    }
}
