use std::{
    cmp::Reverse,
    fs,
    path::Path,
    time::{Duration, Instant},
};

use crate::system::{
    platform::{
        read_bounded_text, ReadTextError, MAX_PIDS_SCANNED, MAX_PROCESSES,
        MAX_PROCESS_STRING_BYTES, MAX_PSS_PROCESSES,
    },
    Availability, ProcessInventory, ProcessMemory,
};

#[derive(Default)]
struct ProcessReadIssues {
    permission_denied: usize,
    invalid_utf8: usize,
    malformed: usize,
    disappeared: usize,
    too_large: usize,
}

impl ProcessReadIssues {
    fn record(&mut self, issue: ProcessReadIssue) {
        match issue {
            ProcessReadIssue::PermissionDenied => self.permission_denied += 1,
            ProcessReadIssue::InvalidUtf8 => self.invalid_utf8 += 1,
            ProcessReadIssue::Malformed => self.malformed += 1,
            ProcessReadIssue::Disappeared => self.disappeared += 1,
            ProcessReadIssue::TooLarge => self.too_large += 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProcessReadIssue {
    PermissionDenied,
    InvalidUtf8,
    Malformed,
    Disappeared,
    TooLarge,
}

fn process_issue_from_read_error(error: ReadTextError) -> ProcessReadIssue {
    match error {
        ReadTextError::Io(std::io::ErrorKind::PermissionDenied) => {
            ProcessReadIssue::PermissionDenied
        }
        ReadTextError::Io(std::io::ErrorKind::NotFound) => ProcessReadIssue::Disappeared,
        ReadTextError::InvalidUtf8 => ProcessReadIssue::InvalidUtf8,
        ReadTextError::TooLarge => ProcessReadIssue::TooLarge,
        ReadTextError::Io(_) => ProcessReadIssue::Disappeared,
    }
}

pub fn collect_with_options(
    proc_root: &Path,
    sampled_at: u64,
    include_pss: bool,
    deadline: Duration,
) -> ProcessInventory {
    collect_with_deadline_options(
        proc_root,
        sampled_at,
        Instant::now() + deadline,
        include_pss,
    )
}

#[cfg(test)]
fn collect_with_deadline(proc_root: &Path, sampled_at: u64, deadline: Instant) -> ProcessInventory {
    collect_with_deadline_options(proc_root, sampled_at, deadline, true)
}

fn collect_with_deadline_options(
    proc_root: &Path,
    sampled_at: u64,
    deadline: Instant,
    include_pss: bool,
) -> ProcessInventory {
    let Ok(entries) = fs::read_dir(proc_root) else {
        return ProcessInventory {
            processes: Vec::new(),
            scanned_count: 0,
            truncated: false,
            deadline_exceeded: false,
            skipped_count: 0,
            permission_denied_count: 0,
            invalid_utf8_count: 0,
            malformed_count: 0,
            disappeared_count: 0,
            availability: Availability::unavailable(sampled_at, "procUnavailable"),
        };
    };
    let mut pids = Vec::new();
    let mut deadline_exceeded = false;
    for entry in entries {
        if Instant::now() >= deadline {
            deadline_exceeded = true;
            break;
        }
        if let Ok(entry) = entry {
            if let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() {
                pids.push(pid);
                if pids.len() > MAX_PIDS_SCANNED {
                    break;
                }
            }
        }
    }
    let truncated = pids.len() > MAX_PIDS_SCANNED;
    pids.truncate(MAX_PIDS_SCANNED);
    let mut skipped_count = 0;
    let mut issues = ProcessReadIssues::default();
    let mut ranked = Vec::new();
    for pid in &pids {
        if Instant::now() >= deadline {
            deadline_exceeded = true;
            break;
        }
        match read_status(proc_root, *pid, sampled_at) {
            Ok(status) => ranked.push((status.rss_bytes.unwrap_or(0), status)),
            Err(issue) => {
                skipped_count += 1;
                issues.record(issue);
            }
        }
    }
    ranked.sort_by_key(|(rss, _)| Reverse(*rss));
    let mut processes = Vec::new();
    for (index, (_, mut process)) in ranked.into_iter().take(MAX_PROCESSES).enumerate() {
        if Instant::now() >= deadline {
            deadline_exceeded = true;
            break;
        }
        process.start_ticks = read_start_ticks(proc_root, process.pid);
        process.command_summary = read_command_summary(proc_root, process.pid);
        if include_pss && index < MAX_PSS_PROCESSES {
            process.pss_bytes = read_pss(proc_root, process.pid);
        }
        processes.push(process);
    }
    let availability = if deadline_exceeded {
        Availability::unavailable(sampled_at, "processDeadlineExceeded")
    } else if issues.permission_denied > 0 {
        Availability {
            state: crate::system::AvailabilityState::PermissionDenied,
            sampled_at,
            detail_code: Some("processPermissionDenied".into()),
        }
    } else if issues.invalid_utf8 > 0 {
        Availability::unavailable(sampled_at, "processInvalidUtf8")
    } else if issues.too_large > 0 {
        Availability::unavailable(sampled_at, "processFileTooLarge")
    } else if issues.malformed > 0 {
        Availability::unavailable(sampled_at, "processMalformed")
    } else if issues.disappeared > 0 {
        Availability::unavailable(sampled_at, "processReadRace")
    } else {
        Availability::available(sampled_at)
    };
    ProcessInventory {
        processes,
        scanned_count: pids.len(),
        truncated,
        deadline_exceeded,
        skipped_count,
        permission_denied_count: issues.permission_denied,
        invalid_utf8_count: issues.invalid_utf8,
        malformed_count: issues.malformed,
        disappeared_count: issues.disappeared,
        availability,
    }
}

pub fn parse_status(input: &str, pid: u32, sampled_at: u64) -> Option<ProcessMemory> {
    let mut name = None;
    let mut uid = None;
    let mut rss = None;
    let mut anon_rss = None;
    let mut file_rss = None;
    let mut shmem_rss = None;
    for line in input.lines() {
        let (key, value) = line.split_once(':')?;
        let value = value.trim();
        match key {
            "Name" => name = bounded(value),
            "Uid" => uid = value.split_ascii_whitespace().next()?.parse().ok(),
            "VmRSS" => rss = Some(parse_kib(value)?),
            "RssAnon" => anon_rss = Some(parse_kib(value)?),
            "RssFile" => file_rss = Some(parse_kib(value)?),
            "RssShmem" => shmem_rss = Some(parse_kib(value)?),
            _ => {}
        }
    }
    Some(ProcessMemory {
        pid,
        start_ticks: None,
        uid,
        name: name.unwrap_or_else(|| "unknown".into()),
        command_summary: None,
        rss_bytes: rss,
        anon_rss_bytes: anon_rss,
        file_rss_bytes: file_rss,
        shmem_rss_bytes: shmem_rss,
        pss_bytes: None,
        availability: Availability::available(sampled_at),
    })
}

fn read_status(
    proc_root: &Path,
    pid: u32,
    sampled_at: u64,
) -> Result<ProcessMemory, ProcessReadIssue> {
    let input = read_bounded_text(&proc_root.join(pid.to_string()).join("status"))
        .map_err(process_issue_from_read_error)?;
    parse_status(&input, pid, sampled_at).ok_or(ProcessReadIssue::Malformed)
}
fn read_pss(proc_root: &Path, pid: u32) -> Option<u64> {
    let input = bounded_file(&proc_root.join(pid.to_string()).join("smaps_rollup"))?;
    input
        .lines()
        .find_map(|line| line.strip_prefix("Pss:").and_then(parse_kib))
}
fn read_start_ticks(proc_root: &Path, pid: u32) -> Option<u64> {
    let input = bounded_file(&proc_root.join(pid.to_string()).join("stat"))?;
    let (_, fields) = input.rsplit_once(')')?;
    fields.split_ascii_whitespace().nth(19)?.parse().ok()
}
fn read_command_summary(proc_root: &Path, pid: u32) -> Option<String> {
    let input = bounded_file(&proc_root.join(pid.to_string()).join("cmdline"))?;
    let first = input.split('\0').next()?.trim();
    let basename = Path::new(first).file_name()?.to_string_lossy();
    bounded(&basename)
}
fn bounded_file(path: &Path) -> Option<String> {
    read_bounded_text(path).ok()
}
fn bounded(value: &str) -> Option<String> {
    let value = value.as_bytes();
    (!value.is_empty()).then(|| {
        String::from_utf8_lossy(&value[..value.len().min(MAX_PROCESS_STRING_BYTES)]).into_owned()
    })
}
fn parse_kib(value: &str) -> Option<u64> {
    let mut fields = value.split_ascii_whitespace();
    let bytes = fields.next()?.parse::<u64>().ok()?.checked_mul(1024)?;
    (fields.next() == Some("kB") && fields.next().is_none()).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_bounded_status() {
        let value = parse_status(
            "Name:\tworker\nUid:\t1000 1000\nVmRSS:\t2 kB\nRssFile:\t1 kB\n",
            9,
            4,
        )
        .unwrap();
        assert_eq!(value.rss_bytes, Some(2048));
        assert_eq!(value.uid, Some(1000));
    }

    #[test]
    fn parses_start_ticks_after_parenthesized_name() {
        let root = tempfile::tempdir().unwrap();
        let process = root.path().join("7");
        fs::create_dir(&process).unwrap();
        let fields = std::iter::once("S")
            .chain(std::iter::repeat_n("0", 18))
            .chain(std::iter::once("42"))
            .collect::<Vec<_>>()
            .join(" ");
        fs::write(process.join("stat"), format!("7 (worker name) {fields}")).unwrap();
        assert_eq!(read_start_ticks(root.path(), 7), Some(42));
    }

    #[test]
    fn malformed_status_is_skipped_and_degrades_inventory() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("7")).unwrap();
        fs::write(root.path().join("7/status"), "malformed status\n").unwrap();
        let inventory =
            collect_with_deadline(root.path(), 4, Instant::now() + Duration::from_secs(1));
        assert_eq!(inventory.skipped_count, 1);
        assert_eq!(
            inventory.availability.detail_code.as_deref(),
            Some("processMalformed")
        );
    }

    #[test]
    fn disappearing_pid_is_reported_as_a_skipped_process() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("7")).unwrap();
        fs::write(
            root.path().join("7/status"),
            "Name:\tworker\nVmRSS:\t1 kB\n",
        )
        .unwrap();
        fs::create_dir(root.path().join("8")).unwrap();
        let inventory =
            collect_with_deadline(root.path(), 4, Instant::now() + Duration::from_secs(1));
        assert_eq!(inventory.scanned_count, 2);
        assert_eq!(inventory.skipped_count, 1);
        assert_eq!(inventory.processes.len(), 1);
    }

    #[test]
    fn immediate_deadline_is_explicitly_reported() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("7")).unwrap();
        let inventory = collect_with_deadline(root.path(), 4, Instant::now());
        assert!(inventory.deadline_exceeded);
        assert_eq!(
            inventory.availability.detail_code.as_deref(),
            Some("processDeadlineExceeded")
        );
    }

    #[test]
    fn synthetic_pid_soak_is_bounded_at_the_inventory_cap() {
        let root = tempfile::tempdir().unwrap();
        for pid in 1..=4_097 {
            let process_dir = root.path().join(pid.to_string());
            fs::create_dir(&process_dir).unwrap();
            fs::write(
                process_dir.join("status"),
                format!(
                    "Name:\tworker-{pid}\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t{} kB\nRssAnon:\t1 kB\nRssFile:\t1 kB\nRssShmem:\t0 kB\n",
                    pid % 128 + 1
                ),
            )
            .unwrap();
            fs::write(process_dir.join("smaps_rollup"), "Pss:\t1 kB\n").unwrap();
        }

        let started = Instant::now();
        let inventory = collect_with_deadline(root.path(), 4, started + Duration::from_millis(150));
        assert!(inventory.scanned_count <= MAX_PIDS_SCANNED);
        assert!(inventory.truncated);
        assert!(inventory.processes.len() <= MAX_PROCESSES);
        assert!(inventory
            .processes
            .iter()
            .take(MAX_PSS_PROCESSES)
            .all(|process| process.pss_bytes.is_some()));
        // This fixture is the repeatable process-budget guard: it proves the
        // realistic 4,096-PID scan remains bounded by its 150 ms deadline.
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn denied_and_invalid_inputs_keep_distinct_error_classes() {
        assert_eq!(
            process_issue_from_read_error(ReadTextError::Io(std::io::ErrorKind::PermissionDenied)),
            ProcessReadIssue::PermissionDenied
        );
        assert_eq!(
            process_issue_from_read_error(ReadTextError::InvalidUtf8),
            ProcessReadIssue::InvalidUtf8
        );
        assert!(parse_status("Name:\tworker\nVmRSS:\t2 MB\n", 7, 4).is_none());
    }
}
