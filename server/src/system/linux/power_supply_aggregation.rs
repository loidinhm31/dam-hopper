use crate::system::{Availability, BatterySnapshot, BatteryStatus};

use super::power_supply::BatteryReading;

const MICRO_UNITS_PER_UNIT: f64 = 1_000_000.0;

pub(super) fn aggregate(readings: Vec<BatteryReading>, sampled_at: u64) -> BatterySnapshot {
    if readings.is_empty() {
        return BatterySnapshot::unsupported(sampled_at);
    }

    let count = readings.len();
    let mut malformed = readings.iter().any(|reading| reading.malformed);
    let status = complete_status(&readings);
    let (energy_now, energy_overflow) = complete_sum(&readings, |item| item.energy_now);
    let (power_now, power_overflow) = complete_sum(&readings, |item| item.power_now);
    let capacity_percent = if count == 1 {
        readings[0].capacity_percent.map(|value| value as f64)
    } else {
        let (energy_pair, pair_invalid) = complete_energy_pair(&readings);
        malformed |= pair_invalid;
        energy_pair.map(|(now, full)| (now as f64 / full as f64) * 100.0)
    };
    malformed |= energy_overflow || power_overflow;

    let remaining_energy_wh = energy_now.map(|value| value as f64 / MICRO_UNITS_PER_UNIT);
    let instantaneous_power_w = power_now.map(|value| value as f64 / MICRO_UNITS_PER_UNIT);
    let has_measurement = capacity_percent.is_some()
        || status.is_some()
        || remaining_energy_wh.is_some()
        || instantaneous_power_w.is_some();
    let availability = if malformed {
        Availability::unavailable(sampled_at, "powerSupplyMalformed")
    } else if !has_measurement {
        Availability::unavailable(sampled_at, "batteryMetricsUnavailable")
    } else {
        Availability::available(sampled_at)
    };

    BatterySnapshot {
        count,
        capacity_percent,
        status,
        remaining_energy_wh,
        instantaneous_power_w,
        availability,
    }
}

fn complete_energy_pair(readings: &[BatteryReading]) -> (Option<(u64, u64)>, bool) {
    let mut total_now = 0_u64;
    let mut total_full = 0_u64;
    for reading in readings {
        let (Some(now), Some(full)) = (reading.energy_now, reading.energy_full) else {
            return (None, false);
        };
        if full == 0 || now > full {
            return (None, true);
        }
        let (Some(next_now), Some(next_full)) =
            (total_now.checked_add(now), total_full.checked_add(full))
        else {
            return (None, true);
        };
        total_now = next_now;
        total_full = next_full;
    }
    (Some((total_now, total_full)), false)
}

fn complete_sum(
    readings: &[BatteryReading],
    field: impl Fn(&BatteryReading) -> Option<u64>,
) -> (Option<u64>, bool) {
    let mut total = 0_u64;
    for reading in readings {
        let Some(value) = field(reading) else {
            return (None, false);
        };
        let Some(next) = total.checked_add(value) else {
            return (None, true);
        };
        total = next;
    }
    (Some(total), false)
}

fn complete_status(readings: &[BatteryReading]) -> Option<BatteryStatus> {
    let statuses = readings
        .iter()
        .map(|reading| reading.status)
        .collect::<Option<Vec<_>>>()?;
    let first = *statuses.first()?;
    Some(if statuses.iter().all(|status| *status == first) {
        first
    } else {
        BatteryStatus::Mixed
    })
}
