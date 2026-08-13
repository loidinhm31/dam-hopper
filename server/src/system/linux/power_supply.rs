use std::{fs, io::ErrorKind, path::Path};

use crate::system::{
    platform::{read_bounded_text, ReadTextError},
    Availability, BatterySnapshot, BatteryStatus,
};

use super::power_supply_aggregation::aggregate;

const MAX_POWER_SUPPLIES: usize = 64;

#[derive(Default)]
pub(super) struct BatteryReading {
    pub(super) capacity_percent: Option<u64>,
    pub(super) status: Option<BatteryStatus>,
    pub(super) energy_now: Option<u64>,
    pub(super) energy_full: Option<u64>,
    pub(super) power_now: Option<u64>,
    pub(super) malformed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum FieldError {
    PermissionDenied,
    Invalid,
}

pub(super) fn collect(sys_root: &Path, sampled_at: u64) -> BatterySnapshot {
    let root = sys_root.join("class/power_supply");
    let entries = match bounded_sorted_entries(&root) {
        Ok(entries) => entries,
        Err(ReadTextError::Io(ErrorKind::NotFound)) => {
            return BatterySnapshot::unsupported(sampled_at);
        }
        Err(ReadTextError::Io(ErrorKind::PermissionDenied)) => {
            return denied_snapshot(sampled_at);
        }
        Err(ReadTextError::TooLarge) => {
            return BatterySnapshot::unavailable(sampled_at, "powerSupplyLimitExceeded");
        }
        Err(_) => return BatterySnapshot::unavailable(sampled_at, "powerSupplyUnavailable"),
    };

    let mut batteries = Vec::new();
    for path in entries {
        match read_required_text(&path.join("type")) {
            Ok(kind) if kind == "Battery" => match read_battery(&path) {
                Ok(reading) => batteries.push(reading),
                Err(FieldError::PermissionDenied) => return denied_snapshot(sampled_at),
                Err(FieldError::Invalid) => {
                    return BatterySnapshot::unavailable(sampled_at, "powerSupplyUnavailable");
                }
            },
            Ok(_) => {}
            Err(FieldError::PermissionDenied) => return denied_snapshot(sampled_at),
            Err(FieldError::Invalid) => {
                return BatterySnapshot::unavailable(sampled_at, "powerSupplyUnavailable");
            }
        }
    }

    aggregate(batteries, sampled_at)
}

fn bounded_sorted_entries(root: &Path) -> Result<Vec<std::path::PathBuf>, ReadTextError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| ReadTextError::Io(error.kind()))? {
        let entry = entry.map_err(|error| ReadTextError::Io(error.kind()))?;
        if paths.len() == MAX_POWER_SUPPLIES {
            return Err(ReadTextError::TooLarge);
        }
        paths.push(entry.path());
    }
    paths.sort();
    Ok(paths)
}

fn read_battery(path: &Path) -> Result<BatteryReading, FieldError> {
    let (capacity_percent, capacity_invalid) = read_optional_u64(&path.join("capacity"))?;
    let (status_text, status_invalid) = read_optional_text(&path.join("status"))?;
    let (energy_now, energy_now_invalid) = read_optional_u64(&path.join("energy_now"))?;
    let (energy_full, energy_full_invalid) = read_optional_u64(&path.join("energy_full"))?;
    let (power_now, power_now_invalid) = read_optional_u64(&path.join("power_now"))?;
    let capacity_valid = capacity_percent.filter(|value| *value <= 100);
    let status = status_text.as_deref().and_then(normalize_status);
    let status_unrecognized = status_text.is_some() && status.is_none();

    Ok(BatteryReading {
        capacity_percent: capacity_valid,
        status,
        energy_now,
        energy_full,
        power_now,
        malformed: capacity_invalid
            || capacity_percent != capacity_valid
            || status_invalid
            || status_unrecognized
            || energy_now_invalid
            || energy_full_invalid
            || power_now_invalid,
    })
}

fn read_required_text(path: &Path) -> Result<String, FieldError> {
    let value = read_bounded_text(path).map_err(map_read_error)?;
    let value = value.trim();
    if value.is_empty() {
        Err(FieldError::Invalid)
    } else {
        Ok(value.to_owned())
    }
}

fn read_optional_text(path: &Path) -> Result<(Option<String>, bool), FieldError> {
    match read_bounded_text(path) {
        Ok(value) if value.trim().is_empty() => Ok((None, true)),
        Ok(value) => Ok((Some(value.trim().to_owned()), false)),
        Err(ReadTextError::Io(ErrorKind::NotFound)) => Ok((None, false)),
        Err(error) => match map_read_error(error) {
            FieldError::PermissionDenied => Err(FieldError::PermissionDenied),
            FieldError::Invalid => Ok((None, true)),
        },
    }
}

fn read_optional_u64(path: &Path) -> Result<(Option<u64>, bool), FieldError> {
    let (value, invalid) = read_optional_text(path)?;
    match value {
        Some(value) => match value.parse() {
            Ok(value) => Ok((Some(value), invalid)),
            Err(_) => Ok((None, true)),
        },
        None => Ok((None, invalid)),
    }
}

pub(super) fn map_read_error(error: ReadTextError) -> FieldError {
    match error {
        ReadTextError::Io(ErrorKind::PermissionDenied) => FieldError::PermissionDenied,
        _ => FieldError::Invalid,
    }
}

fn normalize_status(value: &str) -> Option<BatteryStatus> {
    Some(match value.to_ascii_lowercase().as_str() {
        "charging" => BatteryStatus::Charging,
        "discharging" => BatteryStatus::Discharging,
        "full" => BatteryStatus::Full,
        "not charging" => BatteryStatus::NotCharging,
        "unknown" => BatteryStatus::Unknown,
        _ => return None,
    })
}

fn denied_snapshot(sampled_at: u64) -> BatterySnapshot {
    let mut snapshot = BatterySnapshot::unsupported(sampled_at);
    snapshot.availability = Availability::denied(sampled_at);
    snapshot
}
