use std::io::ErrorKind;

use crate::system::{platform::ReadTextError, AvailabilityState, BatteryStatus};

use super::{
    power_supply::{collect, map_read_error, FieldError},
    power_supply_tests::add_supply,
};

#[test]
fn preserves_independent_energy_only_and_power_only_measurements() {
    let energy_only = tempfile::tempdir().unwrap();
    add_supply(
        energy_only.path(),
        "BAT0",
        "Battery",
        &[("energy_now", "12500000")],
    );
    let energy = collect(energy_only.path(), 42);
    assert_eq!(energy.remaining_energy_wh, Some(12.5));
    assert!(energy.remaining_energy_wh.unwrap().is_finite());
    assert_eq!(energy.instantaneous_power_w, None);
    assert_eq!(energy.capacity_percent, None);
    assert_eq!(energy.availability.state, AvailabilityState::Available);

    let power_only = tempfile::tempdir().unwrap();
    add_supply(
        power_only.path(),
        "BAT0",
        "Battery",
        &[("power_now", "3250000")],
    );
    let power = collect(power_only.path(), 42);
    assert_eq!(power.remaining_energy_wh, None);
    assert_eq!(power.instantaneous_power_w, Some(3.25));
    assert!(power.instantaneous_power_w.unwrap().is_finite());
    assert_eq!(power.capacity_percent, None);
    assert_eq!(power.availability.state, AvailabilityState::Available);
}

#[test]
fn degrades_unrecognized_status_but_accepts_kernel_unknown() {
    let malformed = tempfile::tempdir().unwrap();
    add_supply(malformed.path(), "BAT0", "Battery", &[("status", "BROKEN")]);
    let snapshot = collect(malformed.path(), 42);
    assert_eq!(snapshot.status, None);
    assert_eq!(
        snapshot.availability.detail_code.as_deref(),
        Some("powerSupplyMalformed")
    );

    let unknown = tempfile::tempdir().unwrap();
    add_supply(unknown.path(), "BAT0", "Battery", &[("status", "Unknown")]);
    let snapshot = collect(unknown.path(), 42);
    assert_eq!(snapshot.status, Some(BatteryStatus::Unknown));
    assert_eq!(snapshot.availability.state, AvailabilityState::Available);
}

#[test]
fn rejects_an_invalid_individual_energy_pair_before_aggregation() {
    let temp = tempfile::tempdir().unwrap();
    add_supply(
        temp.path(),
        "BAT0",
        "Battery",
        &[("energy_now", "60000000"), ("energy_full", "50000000")],
    );
    add_supply(
        temp.path(),
        "BAT1",
        "Battery",
        &[("energy_now", "20000000"), ("energy_full", "50000000")],
    );

    let snapshot = collect(temp.path(), 42);

    assert_eq!(snapshot.remaining_energy_wh, Some(80.0));
    assert_eq!(snapshot.capacity_percent, None);
    assert_eq!(
        snapshot.availability.detail_code.as_deref(),
        Some("powerSupplyMalformed")
    );
}

#[test]
fn maps_permission_errors_separately_from_other_read_failures() {
    assert_eq!(
        map_read_error(ReadTextError::Io(ErrorKind::PermissionDenied)),
        FieldError::PermissionDenied
    );
    assert_eq!(
        map_read_error(ReadTextError::Io(ErrorKind::NotFound)),
        FieldError::Invalid
    );
    assert_eq!(
        map_read_error(ReadTextError::InvalidUtf8),
        FieldError::Invalid
    );
}
