//! Linux `NETLINK_SOCK_DIAG` transport, request encoding, and multipart parser.
//!
//! Directly interacts with the kernel socket diagnostic subsystem using unprivileged
//! netlink dumps to classify sockets and read cumulative TCP byte counters.
//!
//! Uses checked slice arithmetic and 4-byte alignment; does not cast raw buffers
//! to local C structs.

use std::collections::HashSet;
use std::time::Instant;

use crate::idle_suspend::activity::tcp_info::{self, TcpCounters};
use crate::idle_suspend::activity::{ActivityUnavailable, ActivityUnavailableReason};

// ---------------------------------------------------------------------------
// Linux UAPI constants
// ---------------------------------------------------------------------------

/// Protocol family for socket monitoring.
pub(crate) const NETLINK_SOCK_DIAG: libc::c_int = 4;

/// Netlink message type for family-specific socket diagnostics.
pub(crate) const SOCK_DIAG_BY_FAMILY: u16 = 20;

/// Netlink control message types.
pub(crate) const NLMSG_NOOP: u16 = 1;
pub(crate) const NLMSG_ERROR: u16 = 2;
pub(crate) const NLMSG_DONE: u16 = 3;
pub(crate) const NLMSG_OVERRUN: u16 = 4;

/// Netlink message flags.
pub(crate) const NLM_F_REQUEST: u16 = 1;
#[allow(dead_code)]
pub(crate) const NLM_F_MULTI: u16 = 2;
pub(crate) const NLM_F_ROOT: u16 = 0x100;
pub(crate) const NLM_F_MATCH: u16 = 0x200;
pub(crate) const NLM_F_DUMP: u16 = NLM_F_ROOT | NLM_F_MATCH; // 0x300
pub(crate) const NLM_F_DUMP_INTR: u16 = 0x10;

/// `inet_diag` attribute types.
pub(crate) const INET_DIAG_INFO: u16 = 2;

/// Cookie value indicating no cookie is assigned.
pub(crate) const INET_DIAG_NOCOOKIE: [u32; 2] = [u32::MAX, u32::MAX];

/// Linux TCP state for listening sockets.
pub(crate) const TCP_LISTEN: u8 = 10;

/// Production hard limit for total netlink response bytes across all dumps in one sample (16 MiB).
pub(crate) const MAX_NETLINK_RESPONSE_BYTES_LIMIT: usize = 16 * 1024 * 1024;

/// Minimum header lengths in bytes.
pub(crate) const NLMSGHDR_SIZE: usize = 16;
#[allow(dead_code)]
pub(crate) const NLMSGERR_SIZE: usize = 20;
#[allow(dead_code)]
pub(crate) const INET_DIAG_REQ_V2_SIZE: usize = 56;
#[allow(dead_code)]
pub(crate) const UNIX_DIAG_REQ_SIZE: usize = 24;
pub(crate) const INET_DIAG_MSG_SIZE: usize = 72;
pub(crate) const UNIX_DIAG_MSG_SIZE: usize = 16;
pub(crate) const RTATTR_HEADER_SIZE: usize = 4;

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

/// Netlink message 4-byte alignment.
#[inline]
pub(crate) fn nlmsg_align(len: usize) -> usize {
    (len + 3) & !3
}

/// Netlink routing/diagnostic attribute 4-byte alignment.
#[inline]
pub(crate) fn rta_align(len: usize) -> usize {
    (len + 3) & !3
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Address family for observed TCP sockets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum TcpFamily {
    V4,
    V6,
}

impl TcpFamily {
    #[inline]
    pub(crate) fn af_code(self) -> u8 {
        match self {
            Self::V4 => libc::AF_INET as u8,
            Self::V6 => libc::AF_INET6 as u8,
        }
    }
}

/// Parsed raw TCP diagnostic record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawTcpRecord {
    pub(crate) family: TcpFamily,
    pub(crate) state: u8,
    pub(crate) cookie: [u32; 2],
    pub(crate) inode: u32,
    pub(crate) counters: Option<TcpCounters>,
    pub(crate) has_duplicate_info: bool,
    pub(crate) corrupt_info: bool,
}

/// Kind of socket diagnostic dump request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DumpKind {
    Tcp4,
    Tcp6,
    Udp4,
    Udp6,
    Unix,
}

// ---------------------------------------------------------------------------
// Request encoders
// ---------------------------------------------------------------------------

/// Encode a netlink `inet_diag_req_v2` dump request for TCP.
pub(crate) fn encode_tcp_dump_request(family: TcpFamily, seq: u32) -> [u8; 72] {
    let mut buf = [0u8; 72];
    let total_len: u32 = 72;

    // nlmsghdr (16 bytes)
    buf[0..4].copy_from_slice(&total_len.to_ne_bytes());
    buf[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
    buf[6..8].copy_from_slice(&(NLM_F_REQUEST | NLM_F_DUMP).to_ne_bytes());
    buf[8..12].copy_from_slice(&seq.to_ne_bytes());
    buf[12..16].copy_from_slice(&0u32.to_ne_bytes()); // nlmsg_pid = 0 (kernel)

    // inet_diag_req_v2 (56 bytes)
    buf[16] = family.af_code();
    buf[17] = libc::IPPROTO_TCP as u8;
    buf[18] = 1 << (INET_DIAG_INFO - 1); // idiag_ext = 2
    buf[19] = 0; // pad
    buf[20..24].copy_from_slice(&u32::MAX.to_ne_bytes()); // idiag_states = all states
    // buf[24..72] is already 0 (id / inet_diag_sockid)

    buf
}

/// Encode a netlink `inet_diag_req_v2` dump request for UDP.
pub(crate) fn encode_udp_dump_request(family: TcpFamily, seq: u32) -> [u8; 72] {
    let mut buf = [0u8; 72];
    let total_len: u32 = 72;

    // nlmsghdr (16 bytes)
    buf[0..4].copy_from_slice(&total_len.to_ne_bytes());
    buf[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
    buf[6..8].copy_from_slice(&(NLM_F_REQUEST | NLM_F_DUMP).to_ne_bytes());
    buf[8..12].copy_from_slice(&seq.to_ne_bytes());
    buf[12..16].copy_from_slice(&0u32.to_ne_bytes());

    // inet_diag_req_v2 (56 bytes)
    buf[16] = family.af_code();
    buf[17] = libc::IPPROTO_UDP as u8;
    buf[18] = 0; // idiag_ext = 0
    buf[19] = 0; // pad
    buf[20..24].copy_from_slice(&u32::MAX.to_ne_bytes()); // idiag_states = all states

    buf
}

/// Encode a netlink `unix_diag_req` dump request for AF_UNIX sockets.
pub(crate) fn encode_unix_dump_request(seq: u32) -> [u8; 40] {
    let mut buf = [0u8; 40];
    let total_len: u32 = 40;

    // nlmsghdr (16 bytes)
    buf[0..4].copy_from_slice(&total_len.to_ne_bytes());
    buf[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
    buf[6..8].copy_from_slice(&(NLM_F_REQUEST | NLM_F_DUMP).to_ne_bytes());
    buf[8..12].copy_from_slice(&seq.to_ne_bytes());
    buf[12..16].copy_from_slice(&0u32.to_ne_bytes());

    // unix_diag_req (24 bytes)
    buf[16] = libc::AF_UNIX as u8;
    buf[17] = 0; // sdiag_protocol
    buf[18..20].copy_from_slice(&0u16.to_ne_bytes()); // pad
    buf[20..24].copy_from_slice(&u32::MAX.to_ne_bytes()); // udiag_states = all states
    buf[24..28].copy_from_slice(&0u32.to_ne_bytes()); // udiag_ino = 0
    buf[28..32].copy_from_slice(&0u32.to_ne_bytes()); // udiag_show = 0
    // buf[32..40] is udiag_cookie = [0, 0]

    buf
}

// ---------------------------------------------------------------------------
// Netlink datagram parsing
// ---------------------------------------------------------------------------

/// Outcome of parsing a single netlink datagram.
#[derive(Debug)]
pub(crate) struct DatagramParseOutcome {
    pub(crate) is_done: bool,
    pub(crate) tcp_records: Vec<RawTcpRecord>,
    pub(crate) udp_inodes: Vec<u32>,
    pub(crate) unix_inodes: Vec<u32>,
}

/// Parse messages in a netlink datagram for a given dump kind.
///
/// Validates sender PID (0), sequence number match, message types, and 4-byte alignments.
/// Filters owned records when `owned_u32_inodes` is provided. Unowned records have their
/// framing validated, but attributes are not interpreted.
pub(crate) fn parse_netlink_datagram(
    datagram: &[u8],
    expected_seq: u32,
    expected_pid: u32,
    dump_kind: DumpKind,
    owned_u32_inodes: &HashSet<u32>,
) -> Result<DatagramParseOutcome, ActivityUnavailable> {
    let mut offset = 0;
    let mut is_done = false;
    let mut tcp_records = Vec::new();
    let mut udp_inodes = Vec::new();
    let mut unix_inodes = Vec::new();

    while offset < datagram.len() {
        if is_done {
            // Trailing records after NLMSG_DONE are strictly invalid.
            tracing::debug!("Netlink stream contained records after NLMSG_DONE");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        // Must have at least a complete nlmsghdr
        if offset + NLMSGHDR_SIZE > datagram.len() {
            tracing::debug!("Netlink message header truncated in datagram");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        let nlmsg_len = u32::from_ne_bytes(
            datagram[offset..offset + 4]
                .try_into()
                .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
        ) as usize;

        let nlmsg_type = u16::from_ne_bytes(
            datagram[offset + 4..offset + 6]
                .try_into()
                .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
        );

        let nlmsg_flags = u16::from_ne_bytes(
            datagram[offset + 6..offset + 8]
                .try_into()
                .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
        );

        let nlmsg_seq = u32::from_ne_bytes(
            datagram[offset + 8..offset + 12]
                .try_into()
                .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
        );

        let nlmsg_pid = u32::from_ne_bytes(
            datagram[offset + 12..offset + 16]
                .try_into()
                .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
        );

        // Basic header validation
        if nlmsg_len < NLMSGHDR_SIZE || offset + nlmsg_len > datagram.len() {
            tracing::debug!("Netlink nlmsg_len out of bounds: {nlmsg_len}");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        let aligned_len = nlmsg_align(nlmsg_len);
        if offset + aligned_len > datagram.len() && offset + nlmsg_len < datagram.len() {
            // Trailing bytes exist that do not cover the aligned boundary
            tracing::debug!("Netlink message alignment extends past datagram with trailing data");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        // Validate sequence and sender PID
        if nlmsg_seq != expected_seq {
            tracing::debug!("Netlink sequence mismatch: got {nlmsg_seq}, expected {expected_seq}");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        if nlmsg_pid != expected_pid {
            tracing::debug!("Netlink PID mismatch: got {nlmsg_pid}, expected {expected_pid}");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        let payload = &datagram[offset + NLMSGHDR_SIZE..offset + nlmsg_len];

        match nlmsg_type {
            NLMSG_DONE => {
                // Check for dump interruption flag
                if nlmsg_flags & NLM_F_DUMP_INTR != 0 {
                    tracing::debug!("Netlink dump interrupted (NLM_F_DUMP_INTR)");
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::SocketDiagnostics,
                    ));
                }

                // NLMSG_DONE may contain an optional error code (i32)
                if payload.len() >= 4 {
                    let err_code = i32::from_ne_bytes(
                        payload[0..4].try_into().map_err(|_| {
                            ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                        })?,
                    );
                    if err_code < 0 {
                        tracing::debug!("Netlink NLMSG_DONE reported error code: {err_code}");
                        return Err(ActivityUnavailable::new(
                            ActivityUnavailableReason::SocketDiagnostics,
                        ));
                    }
                }

                is_done = true;
            }
            NLMSG_ERROR => {
                if payload.len() < 4 {
                    tracing::debug!("Netlink NLMSG_ERROR truncated");
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::SocketDiagnostics,
                    ));
                }
                let err_code = i32::from_ne_bytes(
                    payload[0..4].try_into().map_err(|_| {
                        ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                    })?,
                );
                if err_code != 0 {
                    tracing::debug!("Netlink NLMSG_ERROR code: {err_code}");
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::SocketDiagnostics,
                    ));
                }
            }
            NLMSG_NOOP => {
                // No-op, ignore payload
            }
            NLMSG_OVERRUN => {
                tracing::debug!("Netlink NLMSG_OVERRUN received");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }
            SOCK_DIAG_BY_FAMILY => {
                match dump_kind {
                    DumpKind::Tcp4 | DumpKind::Tcp6 => {
                        let family = if dump_kind == DumpKind::Tcp4 {
                            TcpFamily::V4
                        } else {
                            TcpFamily::V6
                        };
                        if let Some(record) =
                            parse_tcp_record(payload, family, owned_u32_inodes)?
                        {
                            tcp_records.push(record);
                        }
                    }
                    DumpKind::Udp4 | DumpKind::Udp6 => {
                        if let Some(inode) = parse_udp_record(payload, owned_u32_inodes)? {
                            udp_inodes.push(inode);
                        }
                    }
                    DumpKind::Unix => {
                        if let Some(inode) = parse_unix_record(payload, owned_u32_inodes)? {
                            unix_inodes.push(inode);
                        }
                    }
                }
            }
            other => {
                tracing::debug!("Unexpected netlink message type: {other}");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }
        }

        // Advance to next aligned message boundary
        offset += aligned_len.min(datagram.len() - offset);
    }

    Ok(DatagramParseOutcome {
        is_done,
        tcp_records,
        udp_inodes,
        unix_inodes,
    })
}

/// Parse a single `inet_diag_msg` for TCP and extract `INET_DIAG_INFO` if owned.
fn parse_tcp_record(
    payload: &[u8],
    family: TcpFamily,
    owned_u32_inodes: &HashSet<u32>,
) -> Result<Option<RawTcpRecord>, ActivityUnavailable> {
    if payload.len() < INET_DIAG_MSG_SIZE {
        tracing::debug!("inet_diag_msg truncated: {} < 72", payload.len());
        return Err(ActivityUnavailable::new(
            ActivityUnavailableReason::SocketDiagnostics,
        ));
    }

    let idiag_family = payload[0];
    let idiag_state = payload[1];

    // Family verification
    if idiag_family != family.af_code() {
        tracing::debug!(
            "inet_diag_msg family mismatch: got {}, expected {}",
            idiag_family,
            family.af_code()
        );
        return Err(ActivityUnavailable::new(
            ActivityUnavailableReason::SocketDiagnostics,
        ));
    }

    // Cookie is at offset 44..52 in inet_diag_msg (id.idiag_cookie)
    let cookie_0 = u32::from_ne_bytes(
        payload[44..48]
            .try_into()
            .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
    );
    let cookie_1 = u32::from_ne_bytes(
        payload[48..52]
            .try_into()
            .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
    );
    let cookie = [cookie_0, cookie_1];

    // Inode is at offset 68..72 in inet_diag_msg
    let inode = u32::from_ne_bytes(
        payload[68..72]
            .try_into()
            .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
    );

    let is_owned = owned_u32_inodes.contains(&inode);

    // Validate attribute framing
    let mut attr_offset = INET_DIAG_MSG_SIZE;
    let mut counters = None;
    let mut has_duplicate_info = false;
    let mut corrupt_info = false;

    while attr_offset < payload.len() {
        if attr_offset + RTATTR_HEADER_SIZE > payload.len() {
            tracing::debug!("Netlink attribute header truncated");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        let rta_len = u16::from_ne_bytes(
            payload[attr_offset..attr_offset + 2]
                .try_into()
                .map_err(|_| {
                    ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                })?,
        ) as usize;

        let rta_type = u16::from_ne_bytes(
            payload[attr_offset + 2..attr_offset + 4]
                .try_into()
                .map_err(|_| {
                    ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                })?,
        );

        if rta_len < RTATTR_HEADER_SIZE || attr_offset + rta_len > payload.len() {
            tracing::debug!("Netlink attribute length invalid: {rta_len}");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        let attr_payload = &payload[attr_offset + RTATTR_HEADER_SIZE..attr_offset + rta_len];

        if is_owned && rta_type == INET_DIAG_INFO {
            if counters.is_some() {
                has_duplicate_info = true;
            } else {
                match tcp_info::parse_counters(attr_payload) {
                    Ok(c) => counters = Some(c),
                    Err(_) => corrupt_info = true,
                }
            }
        }

        let aligned_attr = rta_align(rta_len);
        if attr_offset + aligned_attr > payload.len() && attr_offset + rta_len < payload.len() {
            tracing::debug!("Netlink attribute alignment extends past message payload");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        attr_offset += aligned_attr.min(payload.len() - attr_offset);
    }

    if !is_owned {
        return Ok(None);
    }

    Ok(Some(RawTcpRecord {
        family,
        state: idiag_state,
        cookie,
        inode,
        counters,
        has_duplicate_info,
        corrupt_info,
    }))
}

/// Parse a single `inet_diag_msg` for UDP and return inode if owned.
fn parse_udp_record(
    payload: &[u8],
    owned_u32_inodes: &HashSet<u32>,
) -> Result<Option<u32>, ActivityUnavailable> {
    if payload.len() < INET_DIAG_MSG_SIZE {
        tracing::debug!("inet_diag_msg truncated for UDP: {} < 72", payload.len());
        return Err(ActivityUnavailable::new(
            ActivityUnavailableReason::SocketDiagnostics,
        ));
    }

    let inode = u32::from_ne_bytes(
        payload[68..72]
            .try_into()
            .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
    );

    // Validate attribute framing
    let mut attr_offset = INET_DIAG_MSG_SIZE;
    while attr_offset < payload.len() {
        if attr_offset + RTATTR_HEADER_SIZE > payload.len() {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let rta_len = u16::from_ne_bytes(
            payload[attr_offset..attr_offset + 2]
                .try_into()
                .map_err(|_| {
                    ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                })?,
        ) as usize;

        if rta_len < RTATTR_HEADER_SIZE || attr_offset + rta_len > payload.len() {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let aligned_attr = rta_align(rta_len);
        attr_offset += aligned_attr.min(payload.len() - attr_offset);
    }

    if owned_u32_inodes.contains(&inode) {
        Ok(Some(inode))
    } else {
        Ok(None)
    }
}

/// Parse a single `unix_diag_msg` and return inode if owned.
fn parse_unix_record(
    payload: &[u8],
    owned_u32_inodes: &HashSet<u32>,
) -> Result<Option<u32>, ActivityUnavailable> {
    if payload.len() < UNIX_DIAG_MSG_SIZE {
        tracing::debug!("unix_diag_msg truncated: {} < 16", payload.len());
        return Err(ActivityUnavailable::new(
            ActivityUnavailableReason::SocketDiagnostics,
        ));
    }

    let inode = u32::from_ne_bytes(
        payload[4..8]
            .try_into()
            .map_err(|_| ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics))?,
    );

    // Validate attribute framing
    let mut attr_offset = UNIX_DIAG_MSG_SIZE;
    while attr_offset < payload.len() {
        if attr_offset + RTATTR_HEADER_SIZE > payload.len() {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let rta_len = u16::from_ne_bytes(
            payload[attr_offset..attr_offset + 2]
                .try_into()
                .map_err(|_| {
                    ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
                })?,
        ) as usize;

        if rta_len < RTATTR_HEADER_SIZE || attr_offset + rta_len > payload.len() {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let aligned_attr = rta_align(rta_len);
        attr_offset += aligned_attr.min(payload.len() - attr_offset);
    }

    if owned_u32_inodes.contains(&inode) {
        Ok(Some(inode))
    } else {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Linux socket diagnostics transport
// ---------------------------------------------------------------------------

/// RAII wrapper around a raw Linux netlink socket file descriptor.
#[derive(Debug)]
pub(crate) struct NetlinkSocket {
    fd: libc::c_int,
    port_id: u32,
}

impl NetlinkSocket {
    /// Open and bind an unprivileged nonblocking netlink socket for socket diagnostics.
    pub(crate) fn open() -> Result<Self, ActivityUnavailable> {
        let fd = unsafe {
            libc::socket(
                libc::AF_NETLINK,
                libc::SOCK_RAW | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
                NETLINK_SOCK_DIAG,
            )
        };
        if fd < 0 {
            let err = std::io::Error::last_os_error();
            tracing::debug!("Failed to open NETLINK_SOCK_DIAG socket: {err}");
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let mut addr: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
        addr.nl_family = libc::AF_NETLINK as u16;
        addr.nl_pid = 0; // Kernel assigns port ID
        addr.nl_groups = 0;

        let bind_ret = unsafe {
            libc::bind(
                fd,
                &addr as *const _ as *const libc::sockaddr,
                std::mem::size_of::<libc::sockaddr_nl>() as libc::socklen_t,
            )
        };

        if bind_ret < 0 {
            let err = std::io::Error::last_os_error();
            tracing::debug!("Failed to bind netlink socket: {err}");
            unsafe { libc::close(fd) };
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }
        let mut bound_addr: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
        let mut addr_len = std::mem::size_of::<libc::sockaddr_nl>() as libc::socklen_t;

        let sockname_ret = unsafe {
            libc::getsockname(
                fd,
                &mut bound_addr as *mut _ as *mut libc::sockaddr,
                &mut addr_len,
            )
        };

        if sockname_ret < 0 {
            let err = std::io::Error::last_os_error();
            tracing::debug!("Failed getsockname on netlink socket: {err}");
            unsafe { libc::close(fd) };
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::SocketDiagnostics,
            ));
        }

        Ok(Self {
            fd,
            port_id: bound_addr.nl_pid,
        })
    }

    #[inline]
    pub(crate) fn port_id(&self) -> u32 {
        self.port_id
    }

    /// Wait for the socket to become readable or writable using poll with deadline.
    fn poll_socket(
        &self,
        events: libc::c_short,
        deadline: Instant,
    ) -> Result<(), ActivityUnavailable> {
        loop {
            let now = Instant::now();
            if now >= deadline {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ScanTimeout,
                ));
            }
            let remaining = deadline.saturating_duration_since(now);
            let timeout_ms = remaining.as_millis().min(i32::MAX as u128) as i32;

            let mut pfd = libc::pollfd {
                fd: self.fd,
                events,
                revents: 0,
            };

            let ret = unsafe { libc::poll(&mut pfd, 1, timeout_ms) };
            if ret < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::Interrupted {
                    continue; // Check deadline and retry poll
                }
                tracing::debug!("Netlink poll failed: {err}");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            } else if ret == 0 {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ScanTimeout,
                ));
            }

            if pfd.revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
                tracing::debug!("Netlink poll reported error revents: 0x{:X}", pfd.revents);
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }

            if pfd.revents & events != 0 {
                return Ok(());
            }
        }
    }

    /// Send a request to the kernel with deadline check.
    pub(crate) fn send_request(
        &self,
        request: &[u8],
        deadline: Instant,
    ) -> Result<(), ActivityUnavailable> {
        let mut sent = 0;
        while sent < request.len() {
            self.poll_socket(libc::POLLOUT, deadline)?;

            let ret = unsafe {
                libc::send(
                    self.fd,
                    request[sent..].as_ptr() as *const libc::c_void,
                    request.len() - sent,
                    0,
                )
            };

            if ret < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                tracing::debug!("Netlink send failed: {err}");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }
            sent += ret as usize;
        }
        Ok(())
    }

    /// Receive the next netlink datagram using MSG_PEEK | MSG_TRUNC sizing,
    /// enforcing remaining response byte budget and the monotonic deadline.
    pub(crate) fn receive_datagram(
        &self,
        buf: &mut Vec<u8>,
        total_received: &mut usize,
        max_response_bytes: usize,
        deadline: Instant,
    ) -> Result<(), ActivityUnavailable> {
        loop {
            self.poll_socket(libc::POLLIN, deadline)?;

            // Peek real datagram size
            let mut peek_buf = [0u8; 16];
            let peek_ret = unsafe {
                libc::recv(
                    self.fd,
                    peek_buf.as_mut_ptr() as *mut libc::c_void,
                    peek_buf.len(),
                    libc::MSG_PEEK | libc::MSG_TRUNC,
                )
            };

            if peek_ret < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                if err.kind() == std::io::ErrorKind::WouldBlock {
                    continue;
                }
                tracing::debug!("Netlink recv peek failed: {err}");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }

            let datagram_len = peek_ret as usize;
            let remaining_budget = max_response_bytes.saturating_sub(*total_received);

            if datagram_len > remaining_budget {
                tracing::debug!(
                    "Netlink datagram of {datagram_len} bytes exceeds remaining budget of {remaining_budget} bytes (max {max_response_bytes})"
                );
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ScanLimit,
                ));
            }

            // Allocate buffer and receive exact datagram without MSG_TRUNC
            buf.resize(datagram_len, 0);
            let recv_ret = unsafe {
                libc::recv(
                    self.fd,
                    buf.as_mut_ptr() as *mut libc::c_void,
                    datagram_len,
                    0,
                )
            };

            if recv_ret < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::Interrupted || err.kind() == std::io::ErrorKind::WouldBlock {
                    continue;
                }
                tracing::debug!("Netlink actual recv failed: {err}");
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }

            let actual_len = recv_ret as usize;
            if actual_len != datagram_len {
                tracing::debug!(
                    "Netlink receive length mismatch: expected {datagram_len}, got {actual_len}"
                );
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }

            *total_received += datagram_len;
            return Ok(());
        }
    }
}

impl Drop for NetlinkSocket {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.fd);
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn test_encode_tcp_dump_request_v4_layout() {
        let seq = 42;
        let req = encode_tcp_dump_request(TcpFamily::V4, seq);
        assert_eq!(req.len(), 72);

        // Header checks
        let len = u32::from_ne_bytes(req[0..4].try_into().unwrap());
        assert_eq!(len, 72);
        let msg_type = u16::from_ne_bytes(req[4..6].try_into().unwrap());
        assert_eq!(msg_type, SOCK_DIAG_BY_FAMILY);
        let flags = u16::from_ne_bytes(req[6..8].try_into().unwrap());
        assert_eq!(flags, NLM_F_REQUEST | NLM_F_DUMP);
        let req_seq = u32::from_ne_bytes(req[8..12].try_into().unwrap());
        assert_eq!(req_seq, seq);
        let pid = u32::from_ne_bytes(req[12..16].try_into().unwrap());
        assert_eq!(pid, 0);

        // Payload checks
        assert_eq!(req[16], libc::AF_INET as u8);
        assert_eq!(req[17], libc::IPPROTO_TCP as u8);
        assert_eq!(req[18], 1 << (INET_DIAG_INFO - 1));
        assert_eq!(req[19], 0);
        let states = u32::from_ne_bytes(req[20..24].try_into().unwrap());
        assert_eq!(states, u32::MAX);
    }

    #[test]
    fn test_encode_tcp_dump_request_v6_layout() {
        let seq = 100;
        let req = encode_tcp_dump_request(TcpFamily::V6, seq);
        assert_eq!(req.len(), 72);
        assert_eq!(req[16], libc::AF_INET6 as u8);
        assert_eq!(req[17], libc::IPPROTO_TCP as u8);
    }

    #[test]
    fn test_encode_udp_dump_request_layout() {
        let seq = 77;
        let req = encode_udp_dump_request(TcpFamily::V4, seq);
        assert_eq!(req.len(), 72);
        assert_eq!(req[16], libc::AF_INET as u8);
        assert_eq!(req[17], libc::IPPROTO_UDP as u8);
        assert_eq!(req[18], 0); // No info extension requested
    }

    #[test]
    fn test_encode_unix_dump_request_layout() {
        let seq = 88;
        let req = encode_unix_dump_request(seq);
        assert_eq!(req.len(), 40);

        let len = u32::from_ne_bytes(req[0..4].try_into().unwrap());
        assert_eq!(len, 40);
        assert_eq!(req[16], libc::AF_UNIX as u8);
        assert_eq!(req[17], 0);
    }

    #[test]
    fn test_parse_netlink_datagram_done() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 16;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes()); // seq = 1

        let owned = HashSet::new();
        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect("valid NLMSG_DONE must succeed");
        assert!(outcome.is_done);
        assert!(outcome.tcp_records.is_empty());
    }

    #[test]
    fn test_parse_netlink_datagram_records_after_done_rejected() {
        let mut datagram = vec![0u8; 32];
        let len: u32 = 16;
        // First msg: NLMSG_DONE
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        // Second msg: NLMSG_NOOP
        datagram[16..20].copy_from_slice(&len.to_ne_bytes());
        datagram[20..22].copy_from_slice(&NLMSG_NOOP.to_ne_bytes());
        datagram[24..28].copy_from_slice(&1u32.to_ne_bytes());

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("records after NLMSG_DONE must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_sequence_mismatch_rejected() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 16;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[8..12].copy_from_slice(&99u32.to_ne_bytes()); // seq 99 != 1

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("seq mismatch must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_interrupted_dump_rejected() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 16;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[6..8].copy_from_slice(&NLM_F_DUMP_INTR.to_ne_bytes()); // NLM_F_DUMP_INTR
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("dump intr must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_error_code_rejected() {
        let mut datagram = vec![0u8; 20];
        let len: u32 = 20;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_ERROR.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());
        // Error code -1 (e.g. -EPERM)
        let err_code: i32 = -1;
        datagram[16..20].copy_from_slice(&err_code.to_ne_bytes());

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("nonzero NLMSG_ERROR must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_error_zero_accepted() {
        let mut datagram = vec![0u8; 36];
        // First msg: NLMSG_ERROR with code 0 (ACK)
        let len1: u32 = 20;
        datagram[0..4].copy_from_slice(&len1.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_ERROR.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());
        let err_code: i32 = 0;
        datagram[16..20].copy_from_slice(&err_code.to_ne_bytes());

        // Second msg: NLMSG_DONE
        let len2: u32 = 16;
        datagram[20..24].copy_from_slice(&len2.to_ne_bytes());
        datagram[24..26].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[28..32].copy_from_slice(&1u32.to_ne_bytes());

        let owned = HashSet::new();
        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect("NLMSG_ERROR with code 0 followed by NLMSG_DONE must succeed");
        assert!(outcome.is_done);
    }

    #[test]
    fn test_parse_netlink_datagram_overrun_rejected() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 16;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_OVERRUN.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("NLMSG_OVERRUN must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_short_header_rejected() {
        let datagram = vec![0u8; 12]; // Less than 16 bytes
        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("datagram shorter than header must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_overflowing_len_rejected() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 32; // Claims 32 bytes, only 16 present
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_NOOP.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("overflowing nlmsg_len must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_wrong_sender_pid_rejected() {
        let mut datagram = vec![0u8; 16];
        let len: u32 = 16;
        datagram[0..4].copy_from_slice(&len.to_ne_bytes());
        datagram[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());
        datagram[12..16].copy_from_slice(&999u32.to_ne_bytes()); // PID 999 != 0

        let owned = HashSet::new();
        let err = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect_err("non-zero sender PID must be rejected");
        assert_eq!(err.reason, ActivityUnavailableReason::SocketDiagnostics);
    }

    #[test]
    fn test_parse_netlink_datagram_valid_tcp_record() {
        let total_len: usize = 16 + 72 + 212; // 300 bytes
        let mut datagram = vec![0u8; total_len];

        // nlmsghdr
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes()); // seq = 1

        // inet_diag_msg at offset 16
        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_INET as u8; // idiag_family
        datagram[msg_offset + 1] = 1; // idiag_state = TCP_ESTABLISHED
        // cookie at offset 16 + 44
        datagram[msg_offset + 44..msg_offset + 48].copy_from_slice(&111u32.to_ne_bytes());
        datagram[msg_offset + 48..msg_offset + 52].copy_from_slice(&222u32.to_ne_bytes());
        // inode at offset 16 + 68
        datagram[msg_offset + 68..msg_offset + 72].copy_from_slice(&12345u32.to_ne_bytes());

        // rtattr at offset 16 + 72 = 88
        let attr_offset = 88;
        let rta_len: u16 = 212;
        datagram[attr_offset..attr_offset + 2].copy_from_slice(&rta_len.to_ne_bytes());
        datagram[attr_offset + 2..attr_offset + 4].copy_from_slice(&INET_DIAG_INFO.to_ne_bytes());

        // tcp_info counters at attr_offset + 4 = 92
        let expected_rx: u64 = 42_000;
        let expected_tx: u64 = 84_000;
        datagram[92 + 128..92 + 136].copy_from_slice(&expected_rx.to_ne_bytes());
        datagram[92 + 200..92 + 208].copy_from_slice(&expected_tx.to_ne_bytes());

        let mut owned = HashSet::new();
        owned.insert(12345u32);

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect("valid TCP record must parse");
        assert_eq!(outcome.tcp_records.len(), 1);
        let rec = &outcome.tcp_records[0];
        assert_eq!(rec.inode, 12345);
        assert_eq!(rec.family, TcpFamily::V4);
        assert_eq!(rec.state, 1);
        assert_eq!(rec.cookie, [111, 222]);
        assert_eq!(
            rec.counters,
            Some(TcpCounters {
                bytes_received: expected_rx,
                bytes_sent: expected_tx,
            })
        );
        assert!(!rec.has_duplicate_info);
        assert!(!rec.corrupt_info);
    }

    #[test]
    fn test_parse_netlink_datagram_unowned_tcp_record_ignored() {
        let total_len: usize = 16 + 72 + 212;
        let mut datagram = vec![0u8; total_len];
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_INET as u8;
        datagram[msg_offset + 1] = 1;
        datagram[msg_offset + 68..msg_offset + 72].copy_from_slice(&99999u32.to_ne_bytes()); // Inode 99999

        let attr_offset = 88;
        let rta_len: u16 = 212;
        datagram[attr_offset..attr_offset + 2].copy_from_slice(&rta_len.to_ne_bytes());
        datagram[attr_offset + 2..attr_offset + 4].copy_from_slice(&INET_DIAG_INFO.to_ne_bytes());

        let owned = HashSet::new(); // Inode 99999 is NOT owned

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned)
            .expect("unowned record must be safely ignored without error");
        assert!(outcome.tcp_records.is_empty());
    }

    #[test]
    fn test_parse_netlink_datagram_valid_udp_record() {
        let total_len: usize = 16 + 72;
        let mut datagram = vec![0u8; total_len];
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_INET as u8;
        datagram[msg_offset + 68..msg_offset + 72].copy_from_slice(&7777u32.to_ne_bytes());

        let mut owned = HashSet::new();
        owned.insert(7777u32);

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Udp4, &owned)
            .expect("valid UDP record must parse");
        assert_eq!(outcome.udp_inodes, vec![7777]);
    }

    #[test]
    fn test_parse_netlink_datagram_valid_unix_record() {
        let total_len: usize = 16 + 16;
        let mut datagram = vec![0u8; total_len];
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_UNIX as u8;
        datagram[msg_offset + 4..msg_offset + 8].copy_from_slice(&8888u32.to_ne_bytes()); // udiag_ino

        let mut owned = HashSet::new();
        owned.insert(8888u32);

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Unix, &owned)
            .expect("valid UNIX record must parse");
        assert_eq!(outcome.unix_inodes, vec![8888]);
    }

    #[test]
    fn test_parse_netlink_datagram_duplicate_info_flagged() {
        let total_len: usize = 16 + 72 + 212 + 212; // 512 bytes
        let mut datagram = vec![0u8; total_len];
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_INET as u8;
        datagram[msg_offset + 1] = 1;
        datagram[msg_offset + 68..msg_offset + 72].copy_from_slice(&12345u32.to_ne_bytes());

        // First INET_DIAG_INFO
        let attr1_offset = 88;
        let rta_len: u16 = 212;
        datagram[attr1_offset..attr1_offset + 2].copy_from_slice(&rta_len.to_ne_bytes());
        datagram[attr1_offset + 2..attr1_offset + 4].copy_from_slice(&INET_DIAG_INFO.to_ne_bytes());

        // Second INET_DIAG_INFO
        let attr2_offset = 88 + 212;
        datagram[attr2_offset..attr2_offset + 2].copy_from_slice(&rta_len.to_ne_bytes());
        datagram[attr2_offset + 2..attr2_offset + 4].copy_from_slice(&INET_DIAG_INFO.to_ne_bytes());

        let mut owned = HashSet::new();
        owned.insert(12345u32);

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned).unwrap();
        assert_eq!(outcome.tcp_records.len(), 1);
        assert!(outcome.tcp_records[0].has_duplicate_info);
    }

    #[test]
    fn test_parse_netlink_datagram_corrupt_info_flagged() {
        let total_len: usize = 16 + 72 + 64; // Only 60 bytes of info payload (< 208)
        let mut datagram = vec![0u8; total_len];
        datagram[0..4].copy_from_slice(&(total_len as u32).to_ne_bytes());
        datagram[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        datagram[8..12].copy_from_slice(&1u32.to_ne_bytes());

        let msg_offset = 16;
        datagram[msg_offset] = libc::AF_INET as u8;
        datagram[msg_offset + 1] = 1;
        datagram[msg_offset + 68..msg_offset + 72].copy_from_slice(&12345u32.to_ne_bytes());

        let attr_offset = 88;
        let rta_len: u16 = 64; // 4 header + 60 payload
        datagram[attr_offset..attr_offset + 2].copy_from_slice(&rta_len.to_ne_bytes());
        datagram[attr_offset + 2..attr_offset + 4].copy_from_slice(&INET_DIAG_INFO.to_ne_bytes());

        let mut owned = HashSet::new();
        owned.insert(12345u32);

        let outcome = parse_netlink_datagram(&datagram, 1, 0, DumpKind::Tcp4, &owned).unwrap();
        assert_eq!(outcome.tcp_records.len(), 1);
        assert!(outcome.tcp_records[0].corrupt_info);
    }
}
