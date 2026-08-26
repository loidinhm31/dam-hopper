use std::{collections::BTreeMap, path::Path};

use crate::system::{
    platform::{read_bounded_text, ReadTextError},
    Availability, MemorySnapshot,
};

pub fn collect(proc_root: &Path, sampled_at: u64) -> MemorySnapshot {
    let path = proc_root.join("meminfo");
    match read_bounded_text(&path) {
        Ok(input) => match parse(&input) {
            Ok(values) => snapshot(values, sampled_at),
            Err(code) => unavailable(sampled_at, code),
        },
        Err(ReadTextError::TooLarge) => unavailable(sampled_at, "meminfoTooLarge"),
        Err(ReadTextError::Io(std::io::ErrorKind::PermissionDenied)) => denied(sampled_at),
        Err(_) => unavailable(sampled_at, "meminfoUnavailable"),
    }
}

pub fn parse(input: &str) -> Result<BTreeMap<String, u64>, &'static str> {
    let mut values = BTreeMap::new();
    let known_fields = [
        "MemTotal",
        "MemAvailable",
        "AnonPages",
        "Cached",
        "SReclaimable",
        "SwapTotal",
        "SwapFree",
    ];
    for line in input.lines() {
        let Some((name, raw_value)) = line.split_once(':') else {
            continue;
        };
        let mut parts = raw_value.split_ascii_whitespace();
        let Some(value) = parts.next() else { continue };
        if parts.next().is_some_and(|unit| unit != "kB") {
            continue;
        }
        let Ok(kib) = value.parse::<u64>() else {
            if known_fields.contains(&name) {
                return Err("meminfoMalformed");
            }
            continue;
        };
        let Some(bytes) = kib.checked_mul(1024) else {
            if known_fields.contains(&name) {
                return Err("meminfoOverflow");
            }
            continue;
        };
        values.entry(name.to_string()).or_insert(bytes);
    }
    if values.contains_key("MemTotal") {
        Ok(values)
    } else {
        Err("meminfoMissingTotal")
    }
}

fn snapshot(values: BTreeMap<String, u64>, sampled_at: u64) -> MemorySnapshot {
    MemorySnapshot {
        total_bytes: values.get("MemTotal").copied(),
        available_bytes: values.get("MemAvailable").copied(),
        anon_bytes: values.get("AnonPages").copied(),
        // `Cached` and `SReclaimable` are separate accounting categories. Do
        // not add the latter to page cache: it is exposed independently below.
        file_cache_bytes: values.get("Cached").copied(),
        reclaimable_slab_bytes: values.get("SReclaimable").copied(),
        swap_used_bytes: values
            .get("SwapTotal")
            .copied()
            .zip(values.get("SwapFree").copied())
            .and_then(|(total, free)| total.checked_sub(free)),
        availability: Availability::available(sampled_at),
    }
}

fn unavailable(sampled_at: u64, code: &'static str) -> MemorySnapshot {
    MemorySnapshot {
        availability: Availability::unavailable(sampled_at, code),
        ..MemorySnapshot::empty()
    }
}
fn denied(sampled_at: u64) -> MemorySnapshot {
    MemorySnapshot {
        availability: Availability::denied(sampled_at),
        ..MemorySnapshot::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_reordered_unknown_fields() {
        let parsed = parse(include_str!("../fixtures/linux/meminfo/happy.txt")).unwrap();
        assert_eq!(parsed["MemTotal"], 4 * 1024 * 1024);
    }
    #[test]
    fn rejects_byte_overflow() {
        assert_eq!(
            parse(include_str!("../fixtures/linux/meminfo/overflow.txt")),
            Err("meminfoOverflow")
        );
    }

    #[test]
    fn keeps_file_cache_and_reclaimable_slab_non_overlapping() {
        let values = parse(include_str!("../fixtures/linux/meminfo/happy.txt")).unwrap();
        let snapshot = snapshot(values, 7);
        assert_eq!(snapshot.file_cache_bytes, Some(2048 * 1024));
        assert_eq!(snapshot.reclaimable_slab_bytes, Some(512 * 1024));
    }

    #[test]
    fn ignores_malformed_unknown_fields_and_keeps_missing_swap_unavailable() {
        let values = parse("MemTotal: 1 kB\nUnknown: not-a-number\n").unwrap();
        let snapshot = snapshot(values, 7);
        assert_eq!(snapshot.swap_used_bytes, None);
    }
}
