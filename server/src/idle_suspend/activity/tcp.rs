//! Owned TCP byte observation and baseline comparison.
//!
//! Classifies sockets owned by discovered agent lineages, reads IPv4/IPv6 cumulative
//! TCP byte counters via `NETLINK_SOCK_DIAG`, and tracks per-socket deltas.
//!
//! Production collection is unprivileged and read-only. Comparing each persistent socket key
//! independently prevents aggregate cancellations across changing socket sets.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use super::netlink::{
    encode_tcp_dump_request, encode_udp_dump_request, encode_unix_dump_request,
    parse_netlink_datagram, DumpKind, NetlinkSocket, TcpFamily, INET_DIAG_NOCOOKIE,
    MAX_NETLINK_RESPONSE_BYTES_LIMIT, TCP_LISTEN,
};
use super::tcp_info::TcpCounters;
use super::{
    ActivityUnavailable, ActivityUnavailableReason, FailureContext, NetworkNamespaceIdentity,
    OwnedSocketInode, OwnedSocketSet, MAX_OWNED_SOCKETS_LIMIT,
};

// ---------------------------------------------------------------------------
// Network change and sample types
// ---------------------------------------------------------------------------

/// Qualitative delta of attributable TCP network activity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NetworkChange {
    /// Baseline established on first observation or after invalidation.
    BaselineEstablished,
    /// Identical socket key set with identical cumulative counters.
    Unchanged,
    /// Sent/received counter increase, new socket, retired socket, or counter reset.
    Activity,
}

/// Qualified outcome of an attributable network observation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NetworkSample {
    pub(crate) change: NetworkChange,
}

// ---------------------------------------------------------------------------
// Persistent socket identity and baseline state
// ---------------------------------------------------------------------------

/// Persistent key identifying an active TCP connection.
///
/// Inode is intentionally excluded from the persistent key because inodes can be
/// reused after closing. The key consists of network namespace, address family,
/// and the two-word diagnostic cookie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct SocketKey {
    pub(crate) namespace: NetworkNamespaceIdentity,
    pub(crate) family: TcpFamily,
    pub(crate) cookie: [u32; 2],
}

/// Committed baseline state for a single persistent socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TcpBaselineEntry {
    pub(crate) counters: TcpCounters,
    pub(crate) join_inode: u64,
}

/// Committed snapshot of TCP baseline state across all observed sockets.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct TcpBaselineState {
    pub(crate) valid: bool,
    pub(crate) sockets: HashMap<SocketKey, TcpBaselineEntry>,
}

// ---------------------------------------------------------------------------
// Prepared sample (transactional stage)
// ---------------------------------------------------------------------------

/// Uncommitted network sample produced by `TcpObserver::prepare_sample`.
///
/// Dropping this struct aborts the sample without mutating committed observer state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedNetworkSample {
    sample: NetworkSample,
    next_state: TcpBaselineState,
}

impl PreparedNetworkSample {
    #[inline]
    pub(crate) fn sample(&self) -> &NetworkSample {
        &self.sample
    }
}

// ---------------------------------------------------------------------------
// Socket diagnostics source abstraction
// ---------------------------------------------------------------------------

/// Abstraction for collecting socket diagnostic records from the operating system.
pub(crate) trait SocketDiagnosticsSource: Send + Sync {
    /// Query the operating system for current TCP sockets matching `owned_sockets`.
    ///
    /// Returns a map of persistent `SocketKey` to current counters and join inode.
    fn diagnose_sockets(
        &self,
        owned_sockets: &OwnedSocketSet,
        deadline: Instant,
    ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable>;
}

// ---------------------------------------------------------------------------
// Linux production socket diagnostics
// ---------------------------------------------------------------------------

/// Production implementation of socket diagnostics using direct Linux `NETLINK_SOCK_DIAG`.
#[derive(Debug, Clone)]
pub(crate) struct LinuxSocketDiagnostics {
    pub(crate) max_response_bytes: usize,
}

impl Default for LinuxSocketDiagnostics {
    fn default() -> Self {
        Self {
            max_response_bytes: MAX_NETLINK_RESPONSE_BYTES_LIMIT,
        }
    }
}

impl LinuxSocketDiagnostics {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub(crate) fn with_limit(max_response_bytes: usize) -> Self {
        Self { max_response_bytes }
    }

    fn execute_dump(
        &self,
        dump_kind: DumpKind,
        nl_socket: &NetlinkSocket,
        next_seq: &mut u32,
        total_received_bytes: &mut usize,
        deadline: Instant,
        owned_u32_inodes: &HashSet<u32>,
        owned_u32_map: &HashMap<u32, OwnedSocketInode>,
        owned_namespace: NetworkNamespaceIdentity,
        unresolved_inodes: &mut HashSet<u32>,
        classified_tcp: &mut HashMap<SocketKey, (TcpCounters, u64)>,
    ) -> Result<(), ActivityUnavailable> {
        let seq = *next_seq;
        *next_seq = next_seq.wrapping_add(1).max(1);

        let req_bytes: Vec<u8> = match dump_kind {
            DumpKind::Tcp4 => encode_tcp_dump_request(TcpFamily::V4, seq).to_vec(),
            DumpKind::Tcp6 => encode_tcp_dump_request(TcpFamily::V6, seq).to_vec(),
            DumpKind::Udp4 => encode_udp_dump_request(TcpFamily::V4, seq).to_vec(),
            DumpKind::Udp6 => encode_udp_dump_request(TcpFamily::V6, seq).to_vec(),
            DumpKind::Unix => encode_unix_dump_request(seq).to_vec(),
        };

        nl_socket.send_request(&req_bytes, deadline)?;

        let mut datagram_buf = Vec::new();
        let mut is_done = false;

        while !is_done {
            nl_socket.receive_datagram(
                &mut datagram_buf,
                total_received_bytes,
                self.max_response_bytes,
                deadline,
            )?;

            let outcome = parse_netlink_datagram(
                &datagram_buf,
                seq,
                nl_socket.port_id(),
                dump_kind,
                owned_u32_inodes,
            )?;

            is_done = outcome.is_done;

            match dump_kind {
                DumpKind::Tcp4 | DumpKind::Tcp6 => {
                    let family = if dump_kind == DumpKind::Tcp4 {
                        TcpFamily::V4
                    } else {
                        TcpFamily::V6
                    };

                    for record in outcome.tcp_records {
                        let inode_u32 = record.inode;
                        let owned_item = match owned_u32_map.get(&inode_u32) {
                            Some(it) => it,
                            None => continue,
                        };

                        if !unresolved_inodes.contains(&inode_u32) {
                            tracing::debug!("Duplicate/conflicting diagnostic record for owned socket");
                            return Err(ActivityUnavailable::new(
                                ActivityUnavailableReason::SocketDiagnostics,
                            ));
                        }

                        if record.state == TCP_LISTEN {
                            unresolved_inodes.remove(&inode_u32);
                            continue;
                        }

                        if record.cookie == INET_DIAG_NOCOOKIE {
                            tracing::debug!("INET_DIAG_NOCOOKIE reported for owned TCP socket");
                            let mut ctx = FailureContext::default();
                            ctx.implicated_owned_inodes.push(owned_item.clone());
                            return Err(ActivityUnavailable {
                                reason: ActivityUnavailableReason::SocketDiagnostics,
                                retryable_close_race: false,
                                context: ctx,
                            });
                        }

                        if record.has_duplicate_info || record.corrupt_info || record.counters.is_none() {
                            tracing::debug!(
                                "Missing, duplicate, or corrupt TCP_INFO for owned socket"
                            );
                            let mut ctx = FailureContext::default();
                            ctx.implicated_owned_inodes.push(owned_item.clone());
                            return Err(ActivityUnavailable {
                                reason: ActivityUnavailableReason::SocketDiagnostics,
                                retryable_close_race: false,
                                context: ctx,
                            });
                        }

                        let counters = record.counters.unwrap();
                        let key = SocketKey {
                            namespace: owned_namespace,
                            family,
                            cookie: record.cookie,
                        };

                        if classified_tcp.contains_key(&key) {
                            tracing::debug!("Duplicate SocketKey in diagnostic dump");
                            return Err(ActivityUnavailable::new(
                                ActivityUnavailableReason::SocketDiagnostics,
                            ));
                        }

                        classified_tcp.insert(key, (counters, owned_item.inode));
                        unresolved_inodes.remove(&inode_u32);
                    }
                }
                DumpKind::Udp4 | DumpKind::Udp6 => {
                    if !outcome.udp_inodes.is_empty() {
                        let mut ctx = FailureContext::default();
                        for inode_u32 in outcome.udp_inodes {
                            if let Some(item) = owned_u32_map.get(&inode_u32) {
                                if ctx.implicated_owned_inodes.len() < MAX_OWNED_SOCKETS_LIMIT {
                                    ctx.implicated_owned_inodes.push(item.clone());
                                }
                            }
                        }
                        tracing::debug!(
                            "Owned UDP socket observed; reporting UnsupportedTransport"
                        );
                        return Err(ActivityUnavailable {
                            reason: ActivityUnavailableReason::UnsupportedTransport,
                            retryable_close_race: false,
                            context: ctx,
                        });
                    }
                }
                DumpKind::Unix => {
                    for inode_u32 in outcome.unix_inodes {
                        unresolved_inodes.remove(&inode_u32);
                    }
                }
            }
        }

        Ok(())
    }
}

impl SocketDiagnosticsSource for LinuxSocketDiagnostics {
    fn diagnose_sockets(
        &self,
        owned_sockets: &OwnedSocketSet,
        deadline: Instant,
    ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable> {
        // 1. Validate observing thread network namespace immediately before collection
        let current_ns = NetworkNamespaceIdentity::current_thread()?;
        if current_ns != owned_sockets.namespace {
            tracing::debug!("Initial thread namespace mismatch with owned sockets");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::NamespaceMismatch,
            ));
        }

        // 2. Empty owned socket set prepares valid empty baseline without opening netlink
        if owned_sockets.is_empty() {
            return Ok(HashMap::new());
        }

        // 3. Map owned inodes to u32 representation; reject unrepresentable inodes (> u32::MAX)
        let mut owned_u32_map = HashMap::with_capacity(owned_sockets.len());
        for item in &owned_sockets.inodes {
            if item.inode > u32::MAX as u64 {
                tracing::debug!("Owned socket inode exceeds u32::MAX representable diagnostic limit");
                let mut ctx = FailureContext::default();
                ctx.implicated_owned_inodes.push(item.clone());
                return Err(ActivityUnavailable {
                    reason: ActivityUnavailableReason::SocketDiagnostics,
                    retryable_close_race: false,
                    context: ctx,
                });
            }
            owned_u32_map.insert(item.inode as u32, item.clone());
        }

        let owned_u32_inodes: HashSet<u32> = owned_u32_map.keys().copied().collect();
        let mut unresolved_inodes = owned_u32_inodes.clone();
        let mut classified_tcp = HashMap::new();
        let mut total_received_bytes = 0usize;
        let mut next_seq = 1u32;

        // 4. Open fresh unprivileged netlink socket
        let nl_socket = NetlinkSocket::open()?;

        self.execute_dump(
            DumpKind::Tcp4,
            &nl_socket,
            &mut next_seq,
            &mut total_received_bytes,
            deadline,
            &owned_u32_inodes,
            &owned_u32_map,
            owned_sockets.namespace,
            &mut unresolved_inodes,
            &mut classified_tcp,
        )?;

        if !unresolved_inodes.is_empty() {
            self.execute_dump(
                DumpKind::Tcp6,
                &nl_socket,
                &mut next_seq,
                &mut total_received_bytes,
                deadline,
                &owned_u32_inodes,
                &owned_u32_map,
                owned_sockets.namespace,
                &mut unresolved_inodes,
                &mut classified_tcp,
            )?;
        }

        if !unresolved_inodes.is_empty() {
            self.execute_dump(
                DumpKind::Udp4,
                &nl_socket,
                &mut next_seq,
                &mut total_received_bytes,
                deadline,
                &owned_u32_inodes,
                &owned_u32_map,
                owned_sockets.namespace,
                &mut unresolved_inodes,
                &mut classified_tcp,
            )?;
        }

        if !unresolved_inodes.is_empty() {
            self.execute_dump(
                DumpKind::Udp6,
                &nl_socket,
                &mut next_seq,
                &mut total_received_bytes,
                deadline,
                &owned_u32_inodes,
                &owned_u32_map,
                owned_sockets.namespace,
                &mut unresolved_inodes,
                &mut classified_tcp,
            )?;
        }

        if !unresolved_inodes.is_empty() {
            self.execute_dump(
                DumpKind::Unix,
                &nl_socket,
                &mut next_seq,
                &mut total_received_bytes,
                deadline,
                &owned_u32_inodes,
                &owned_u32_map,
                owned_sockets.namespace,
                &mut unresolved_inodes,
                &mut classified_tcp,
            )?;
        }

        // 7. Validate observing thread network namespace immediately after final dump
        let final_ns = NetworkNamespaceIdentity::current_thread()?;
        if final_ns != owned_sockets.namespace {
            tracing::debug!("Final thread namespace mismatch with owned sockets");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::NamespaceMismatch,
            ));
        }

        // 8. If any owned inodes remain unresolved, report retryable close race
        if !unresolved_inodes.is_empty() {
            tracing::debug!(
                "{} owned sockets remained unresolved after all dumps",
                unresolved_inodes.len()
            );
            let mut ctx = FailureContext::default();
            for inode_u32 in unresolved_inodes {
                if let Some(item) = owned_u32_map.get(&inode_u32) {
                    if ctx.implicated_owned_inodes.len() < MAX_OWNED_SOCKETS_LIMIT {
                        ctx.implicated_owned_inodes.push(item.clone());
                    }
                }
            }
            return Err(ActivityUnavailable {
                reason: ActivityUnavailableReason::SocketDiagnostics,
                retryable_close_race: true,
                context: ctx,
            });
        }

        Ok(classified_tcp)
    }
}

// ---------------------------------------------------------------------------
// TCP Observer
// ---------------------------------------------------------------------------

/// Evaluates network activity on attributable agent lineages.
pub(crate) struct TcpObserver<D = LinuxSocketDiagnostics> {
    diagnostics: D,
    committed: TcpBaselineState,
}

impl TcpObserver<LinuxSocketDiagnostics> {
    /// Create a new `TcpObserver` with the production Linux netlink diagnostics source.
    #[allow(dead_code)]
    pub(crate) fn new() -> Self {
        Self {
            diagnostics: LinuxSocketDiagnostics::new(),
            committed: TcpBaselineState::default(),
        }
    }
}

impl<D: SocketDiagnosticsSource> TcpObserver<D> {
    /// Create a new `TcpObserver` with a custom diagnostic source (e.g. for testing).
    pub(crate) fn with_diagnostics(diagnostics: D) -> Self {
        Self {
            diagnostics,
            committed: TcpBaselineState::default(),
        }
    }

    /// Prepare a network activity sample comparing current socket states against committed baseline.
    ///
    /// This method is purely read-only and does not mutate `self`.
    pub(crate) fn prepare_sample(
        &self,
        owned: &OwnedSocketSet,
        deadline: Instant,
    ) -> Result<PreparedNetworkSample, ActivityUnavailable> {
        let current_sockets = self.diagnostics.diagnose_sockets(owned, deadline)?;

        // Build next baseline state map
        let mut next_sockets = HashMap::with_capacity(current_sockets.len());
        for (key, (counters, join_inode)) in &current_sockets {
            next_sockets.insert(
                *key,
                TcpBaselineEntry {
                    counters: *counters,
                    join_inode: *join_inode,
                },
            );
        }

        let change = if !self.committed.valid {
            NetworkChange::BaselineEstablished
        } else {
            self.compare_baselines(&self.committed.sockets, &next_sockets)
        };

        let next_state = TcpBaselineState {
            valid: true,
            sockets: next_sockets,
        };

        Ok(PreparedNetworkSample {
            sample: NetworkSample { change },
            next_state,
        })
    }

    /// Infallibly commit a prepared network sample, advancing the baseline state.
    pub(crate) fn commit_sample(
        &mut self,
        prepared: PreparedNetworkSample,
    ) -> NetworkSample {
        self.committed = prepared.next_state;
        prepared.sample
    }

    /// Invalidate the committed baseline state.
    ///
    /// Preserves the committed socket map as historical identity reference, but marks
    /// validity false so that the next successful preparation yields `BaselineEstablished`.
    pub(crate) fn invalidate(&mut self) {
        self.committed.valid = false;
    }

    /// Compare committed sockets against next sockets per persistent socket key.
    fn compare_baselines(
        &self,
        committed: &HashMap<SocketKey, TcpBaselineEntry>,
        current: &HashMap<SocketKey, TcpBaselineEntry>,
    ) -> NetworkChange {
        // Any difference in key set membership indicates activity
        if committed.len() != current.len() {
            return NetworkChange::Activity;
        }

        for (key, current_entry) in current {
            let committed_entry = match committed.get(key) {
                Some(entry) => entry,
                None => return NetworkChange::Activity, // New socket
            };

            // Join inode replacement for identical key is activity
            if current_entry.join_inode != committed_entry.join_inode {
                return NetworkChange::Activity;
            }

            // Received byte count increase or reset (decrease)
            if current_entry.counters.bytes_received != committed_entry.counters.bytes_received {
                return NetworkChange::Activity;
            }

            // Sent byte count increase or reset (decrease)
            if current_entry.counters.bytes_sent != committed_entry.counters.bytes_sent {
                return NetworkChange::Activity;
            }
        }

        NetworkChange::Unchanged
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Fake diagnostics source for unit tests.
    #[derive(Debug, Default)]
    pub(crate) struct FakeDiagnosticsSource {
        pub(crate) result: Option<Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable>>,
    }

    impl SocketDiagnosticsSource for FakeDiagnosticsSource {
        fn diagnose_sockets(
            &self,
            _owned_sockets: &OwnedSocketSet,
            _deadline: Instant,
        ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable> {
            match &self.result {
                Some(res) => res.clone(),
                None => Ok(HashMap::new()),
            }
        }
    }

    fn test_key(family: TcpFamily, cookie_0: u32, cookie_1: u32) -> SocketKey {
        SocketKey {
            namespace: NetworkNamespaceIdentity {
                device: 10,
                inode: 100,
            },
            family,
            cookie: [cookie_0, cookie_1],
        }
    }

    #[test]
    fn test_initial_sample_yields_baseline_established() {
        let fake = FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(
                test_key(TcpFamily::V4, 1, 2),
                (
                    TcpCounters {
                        bytes_received: 100,
                        bytes_sent: 200,
                    },
                    1234,
                ),
            )]))),
        };

        let observer = TcpObserver::with_diagnostics(fake);
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let prepared = observer
            .prepare_sample(&owned, Instant::now() + std::time::Duration::from_secs(1))
            .expect("prepare must succeed");

        assert_eq!(
            prepared.sample().change,
            NetworkChange::BaselineEstablished
        );
    }

    #[test]
    fn test_unchanged_counters_yields_unchanged() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let fake = FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters, 5555))]))),
        };

        let mut observer = TcpObserver::with_diagnostics(fake);
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep1.sample().change, NetworkChange::BaselineEstablished);
        observer.commit_sample(prep1);

        // Second sample with identical socket and counters
        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Unchanged);
    }

    #[test]
    fn test_rx_increase_yields_activity() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters1 = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let fake = FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters1, 5555))]))),
        };

        let mut observer = TcpObserver::with_diagnostics(fake);
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Increase bytes_received
        let counters2 = TcpCounters {
            bytes_received: 600,
            bytes_sent: 1000,
        };
        observer.diagnostics.result = Some(Ok(HashMap::from([(key, (counters2, 5555))])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_tx_increase_yields_activity() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters1 = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters1, 5555))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Increase bytes_sent
        let counters2 = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1050,
        };
        observer.diagnostics.result = Some(Ok(HashMap::from([(key, (counters2, 5555))])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_counter_decrease_yields_activity() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters1 = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters1, 5555))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Counter reset / decrease: conservatively counts as activity
        let counters2 = TcpCounters {
            bytes_received: 10,
            bytes_sent: 1000,
        };
        observer.diagnostics.result = Some(Ok(HashMap::from([(key, (counters2, 5555))])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_inode_replacement_for_same_key_yields_activity() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters, 5555))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Inode replaced (e.g. socket recreated with reused cookie)
        observer.diagnostics.result = Some(Ok(HashMap::from([(key, (counters, 9999))])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_new_socket_yields_activity() {
        let key1 = test_key(TcpFamily::V4, 1, 2);
        let key2 = test_key(TcpFamily::V6, 3, 4);
        let counters = TcpCounters {
            bytes_received: 10,
            bytes_sent: 20,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key1, (counters, 1000))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Add second socket
        observer.diagnostics.result = Some(Ok(HashMap::from([
            (key1, (counters, 1000)),
            (key2, (counters, 2000)),
        ])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_retired_socket_yields_activity() {
        let key1 = test_key(TcpFamily::V4, 1, 2);
        let key2 = test_key(TcpFamily::V6, 3, 4);
        let counters = TcpCounters {
            bytes_received: 10,
            bytes_sent: 20,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([
                (key1, (counters, 1000)),
                (key2, (counters, 2000)),
            ]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Retire key2
        observer.diagnostics.result = Some(Ok(HashMap::from([(key1, (counters, 1000))])));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_invalidate_forces_baseline_established() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters, 5555))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Invalidate observer
        observer.invalidate();

        // Next preparation must establish baseline
        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(
            prep2.sample().change,
            NetworkChange::BaselineEstablished
        );
    }

    #[test]
    fn test_abort_by_drop_preserves_committed_baseline() {
        let key = test_key(TcpFamily::V4, 1, 2);
        let counters1 = TcpCounters {
            bytes_received: 500,
            bytes_sent: 1000,
        };

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(HashMap::from([(key, (counters1, 5555))]))),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Prepare a new sample with activity, but drop it without committing
        let counters2 = TcpCounters {
            bytes_received: 9999,
            bytes_sent: 9999,
        };
        observer.diagnostics.result = Some(Ok(HashMap::from([(key, (counters2, 5555))])));
        let prep_uncommitted = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep_uncommitted.sample().change, NetworkChange::Activity);
        drop(prep_uncommitted);

        // Committed baseline must still have counters1!
        assert_eq!(
            observer.committed.sockets.get(&key).unwrap().counters,
            counters1
        );
    }

    #[test]
    fn test_aggregate_cancellation_still_yields_activity() {
        let key1 = test_key(TcpFamily::V4, 1, 1);
        let key2 = test_key(TcpFamily::V4, 2, 2);

        let initial = HashMap::from([
            (
                key1,
                (
                    TcpCounters {
                        bytes_received: 1000,
                        bytes_sent: 1000,
                    },
                    111,
                ),
            ),
            (
                key2,
                (
                    TcpCounters {
                        bytes_received: 1000,
                        bytes_sent: 1000,
                    },
                    222,
                ),
            ),
        ]);

        let mut observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource {
            result: Some(Ok(initial)),
        });
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let prep1 = observer.prepare_sample(&owned, deadline).unwrap();
        observer.commit_sample(prep1);

        // Socket 1 increases by 500, Socket 2 decreases by 500
        // Aggregate sum would be unchanged (2000 -> 2000), but per-socket comparison detects activity!
        let updated = HashMap::from([
            (
                key1,
                (
                    TcpCounters {
                        bytes_received: 1500,
                        bytes_sent: 1000,
                    },
                    111,
                ),
            ),
            (
                key2,
                (
                    TcpCounters {
                        bytes_received: 500,
                        bytes_sent: 1000,
                    },
                    222,
                ),
            ),
        ]);
        observer.diagnostics.result = Some(Ok(updated));

        let prep2 = observer.prepare_sample(&owned, deadline).unwrap();
        assert_eq!(prep2.sample().change, NetworkChange::Activity);
    }

    #[test]
    fn test_empty_owned_sockets_prepares_valid_baseline_without_error() {
        let observer = TcpObserver::with_diagnostics(FakeDiagnosticsSource::default());
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });
        let deadline = Instant::now() + std::time::Duration::from_secs(1);

        let prep = observer
            .prepare_sample(&owned, deadline)
            .expect("empty socket set must prepare successfully");
        assert_eq!(prep.sample().change, NetworkChange::BaselineEstablished);
    }

    #[test]
    fn test_unrepresentable_inode_yields_nonretryable_socket_diagnostics() {
        // Setup LinuxSocketDiagnostics
        let diag = LinuxSocketDiagnostics::new();
        let current_ns = NetworkNamespaceIdentity::current_thread()
            .expect("must read thread netns in Linux test");

        let mut owned = OwnedSocketSet::empty(current_ns);
        let invalid_inode = (u32::MAX as u64) + 100;
        let invalid_socket = OwnedSocketInode {
            inode: invalid_inode,
            representative_owner: crate::pty::activity::ProcessIdentity {
                pid: 1234,
                start_ticks: 5678,
            },
            has_additional_owners: false,
        };
        owned.inodes.push(invalid_socket.clone());

        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let err = diag
            .diagnose_sockets(&owned, deadline)
            .expect_err("inode > u32::MAX must return error");

        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
        assert!(!err.retryable_close_race);
        assert_eq!(err.context.implicated_owned_inodes, vec![invalid_socket]);
    }

    #[test]
    fn test_namespace_mismatch_yields_namespace_mismatch() {
        let diag = LinuxSocketDiagnostics::new();
        // Fabricate mismatched namespace
        let mismatched_ns = NetworkNamespaceIdentity {
            device: 999_999,
            inode: 888_888,
        };
        let owned = OwnedSocketSet::empty(mismatched_ns);
        let deadline = Instant::now() + std::time::Duration::from_secs(1);

        let err = diag
            .diagnose_sockets(&owned, deadline)
            .expect_err("mismatched namespace must return error");
        assert_eq!(err.reason, ActivityUnavailableReason::NamespaceMismatch);
    }

    #[test]
    fn test_unsupported_transport_preserves_failure_context() {
        let socket_inode = OwnedSocketInode {
            inode: 5555,
            representative_owner: crate::pty::activity::ProcessIdentity {
                pid: 100,
                start_ticks: 200,
            },
            has_additional_owners: false,
        };
        let mut ctx = FailureContext::default();
        ctx.implicated_owned_inodes.push(socket_inode.clone());

        let fake = FakeDiagnosticsSource {
            result: Some(Err(ActivityUnavailable {
                reason: ActivityUnavailableReason::UnsupportedTransport,
                retryable_close_race: false,
                context: ctx,
            })),
        };

        let observer = TcpObserver::with_diagnostics(fake);
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });
        let deadline = Instant::now() + std::time::Duration::from_secs(1);

        let err = observer
            .prepare_sample(&owned, deadline)
            .expect_err("unsupported transport must error");
        assert_eq!(err.reason, ActivityUnavailableReason::UnsupportedTransport);
        assert!(!err.retryable_close_race);
        assert_eq!(err.context.implicated_owned_inodes, vec![socket_inode]);
    }

    #[test]
    fn test_retryable_close_race_error_preserved() {
        let socket_inode = OwnedSocketInode {
            inode: 7777,
            representative_owner: crate::pty::activity::ProcessIdentity {
                pid: 300,
                start_ticks: 400,
            },
            has_additional_owners: false,
        };
        let mut ctx = FailureContext::default();
        ctx.implicated_owned_inodes.push(socket_inode.clone());

        let fake = FakeDiagnosticsSource {
            result: Some(Err(ActivityUnavailable {
                reason: ActivityUnavailableReason::SocketDiagnostics,
                retryable_close_race: true,
                context: ctx,
            })),
        };

        let observer = TcpObserver::with_diagnostics(fake);
        let owned = OwnedSocketSet::empty(NetworkNamespaceIdentity {
            device: 10,
            inode: 100,
        });
        let deadline = Instant::now() + std::time::Duration::from_secs(1);

        let err = observer
            .prepare_sample(&owned, deadline)
            .expect_err("close race must error");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
        assert!(err.retryable_close_race);
        assert_eq!(err.context.implicated_owned_inodes, vec![socket_inode]);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_real_linux_socket_diagnostics_against_kernel() {
        use std::net::TcpListener;
        use std::os::fd::AsRawFd;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let fd = listener.as_raw_fd();
        let fd_path = format!("/proc/self/fd/{fd}");
        let link = std::fs::read_link(&fd_path).unwrap();
        let link_str = link.to_string_lossy();
        let inode_str = link_str
            .strip_prefix("socket:[")
            .and_then(|r| r.strip_suffix(']'))
            .unwrap();
        let inode: u64 = inode_str.parse().unwrap();

        let ns = NetworkNamespaceIdentity::current_thread().unwrap();
        let mut owned = OwnedSocketSet::empty(ns);
        owned.inodes.push(OwnedSocketInode {
            inode,
            representative_owner: crate::pty::activity::ProcessIdentity {
                pid: std::process::id(),
                start_ticks: 0,
            },
            has_additional_owners: false,
        });

        let diag = LinuxSocketDiagnostics::new();
        let deadline = Instant::now() + std::time::Duration::from_secs(1);
        let res = diag.diagnose_sockets(&owned, deadline);
        assert!(res.is_ok(), "diagnose_sockets failed: {res:?}");
    }
}
