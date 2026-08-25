use std::path::Path;

use crate::system::{AvailabilityState, BatteryStatus};

use super::power_supply::collect;

pub(super) fn add_supply(root: &Path, name: &str, kind: &str, attributes: &[(&str, &str)]) {
    let directory = root.join("class/power_supply").join(name);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("type"), format!("{kind}\n")).unwrap();
    for (field, value) in attributes {
        std::fs::write(directory.join(field), format!("{value}\n")).unwrap();
    }
}

#[test]
fn collects_direct_single_battery_measurements_and_ignores_mains() {
    let temp = tempfile::tempdir().unwrap();
    add_supply(temp.path(), "AC", "Mains", &[("online", "1")]);
    add_supply(
        temp.path(),
        "BAT0",
        "Battery",
        &[
            ("capacity", "75"),
            ("status", "Discharging"),
            ("energy_now", "42500000"),
            ("energy_full", "60000000"),
            ("power_now", "8500000"),
        ],
    );

    let snapshot = collect(temp.path(), 42);

    assert_eq!(snapshot.count, 1);
    assert_eq!(snapshot.capacity_percent, Some(75.0));
    assert_eq!(snapshot.status, Some(BatteryStatus::Discharging));
    assert_eq!(snapshot.remaining_energy_wh, Some(42.5));
    assert_eq!(snapshot.instantaneous_power_w, Some(8.5));
    assert_eq!(snapshot.availability.state, AvailabilityState::Available);
}

#[test]
fn aggregates_complete_multi_battery_values_and_mixed_status() {
    let temp = tempfile::tempdir().unwrap();
    add_supply(
        temp.path(),
        "BAT0",
        "Battery",
        &[
            ("status", "Charging"),
            ("energy_now", "20000000"),
            ("energy_full", "40000000"),
            ("power_now", "5000000"),
        ],
    );
    add_supply(
        temp.path(),
        "BAT1",
        "Battery",
        &[
            ("status", "Discharging"),
            ("energy_now", "30000000"),
            ("energy_full", "60000000"),
            ("power_now", "7000000"),
        ],
    );

    let snapshot = collect(temp.path(), 42);

    assert_eq!(snapshot.count, 2);
    assert_eq!(snapshot.capacity_percent, Some(50.0));
    assert_eq!(snapshot.status, Some(BatteryStatus::Mixed));
    assert_eq!(snapshot.remaining_energy_wh, Some(50.0));
    assert_eq!(snapshot.instantaneous_power_w, Some(12.0));
    assert_eq!(snapshot.availability.state, AvailabilityState::Available);
}

#[test]
fn omits_incomplete_multi_battery_totals_without_fabricating_values() {
    let temp = tempfile::tempdir().unwrap();
    add_supply(
        temp.path(),
        "BAT0",
        "Battery",
        &[("status", "Full"), ("energy_now", "20000000")],
    );
    add_supply(
        temp.path(),
        "BAT1",
        "Battery",
        &[("status", "Full"), ("power_now", "7000000")],
    );

    let snapshot = collect(temp.path(), 42);

    assert_eq!(snapshot.count, 2);
    assert_eq!(snapshot.status, Some(BatteryStatus::Full));
    assert_eq!(snapshot.capacity_percent, None);
    assert_eq!(snapshot.remaining_energy_wh, None);
    assert_eq!(snapshot.instantaneous_power_w, None);
    assert_eq!(snapshot.availability.state, AvailabilityState::Available);
}

#[test]
fn retains_valid_fields_but_degrades_malformed_or_overflowed_data() {
    let malformed = tempfile::tempdir().unwrap();
    add_supply(
        malformed.path(),
        "BAT0",
        "Battery",
        &[
            ("capacity", "101"),
            ("status", "Discharging"),
            ("energy_now", "invalid"),
            ("power_now", "2500000"),
        ],
    );
    let snapshot = collect(malformed.path(), 42);
    assert_eq!(snapshot.capacity_percent, None);
    assert_eq!(snapshot.remaining_energy_wh, None);
    assert_eq!(snapshot.instantaneous_power_w, Some(2.5));
    assert_eq!(
        snapshot.availability.state,
        AvailabilityState::TemporarilyUnavailable
    );
    assert_eq!(
        snapshot.availability.detail_code.as_deref(),
        Some("powerSupplyMalformed")
    );

    let overflow = tempfile::tempdir().unwrap();
    add_supply(
        overflow.path(),
        "BAT0",
        "Battery",
        &[("energy_now", &u64::MAX.to_string())],
    );
    add_supply(overflow.path(), "BAT1", "Battery", &[("energy_now", "1")]);
    let snapshot = collect(overflow.path(), 42);
    assert_eq!(snapshot.remaining_energy_wh, None);
    assert_eq!(
        snapshot.availability.detail_code.as_deref(),
        Some("powerSupplyMalformed")
    );
}

#[test]
fn reports_unsupported_missing_or_battery_free_trees_and_bounds_discovery() {
    let missing = tempfile::tempdir().unwrap();
    assert_eq!(
        collect(missing.path(), 42).availability.state,
        AvailabilityState::Unsupported
    );

    let mains_only = tempfile::tempdir().unwrap();
    add_supply(mains_only.path(), "AC", "Mains", &[]);
    assert_eq!(
        collect(mains_only.path(), 42).availability.state,
        AvailabilityState::Unsupported
    );

    let excessive = tempfile::tempdir().unwrap();
    for index in 0..65 {
        add_supply(excessive.path(), &format!("AC{index}"), "Mains", &[]);
    }
    assert_eq!(
        collect(excessive.path(), 42)
            .availability
            .detail_code
            .as_deref(),
        Some("powerSupplyLimitExceeded")
    );
}
