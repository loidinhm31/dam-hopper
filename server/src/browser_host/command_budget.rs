//! Shared admission budget for CDP commands.
//!
//! One slot and a growing byte allowance are reserved *before* a command is serialized or
//! enqueued, and stay reserved while the command is queued for the writer and while it is in
//! flight awaiting its response. Release is RAII: dropping the reservation on any exit path
//! (response, deadline sweep, caller cancellation, connection teardown) returns slot and bytes.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::cdp::CdpError;
use super::diagnostics::{MemoryAdmissionController, MemoryReservation};

#[derive(Debug)]
pub(super) struct CommandBudget {
    max_slots: usize,
    max_bytes: usize,
    slots: AtomicUsize,
    bytes: AtomicUsize,
    /// When set, every reserved command byte is also charged to the global payload budget.
    memory: Option<Arc<MemoryAdmissionController>>,
}

impl CommandBudget {
    /// Local-only budget without the global payload charge (unit tests).
    #[cfg(test)]
    pub(super) fn new(max_slots: usize, max_bytes: usize) -> Arc<Self> {
        Self::build(max_slots, max_bytes, None)
    }

    pub(super) fn with_memory(
        max_slots: usize,
        max_bytes: usize,
        memory: Arc<MemoryAdmissionController>,
    ) -> Arc<Self> {
        Self::build(max_slots, max_bytes, Some(memory))
    }

    fn build(
        max_slots: usize,
        max_bytes: usize,
        memory: Option<Arc<MemoryAdmissionController>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            max_slots,
            max_bytes,
            slots: AtomicUsize::new(0),
            bytes: AtomicUsize::new(0),
            memory,
        })
    }

    /// Non-waiting reservation of one total (queued + in-flight) command slot.
    pub(super) fn reserve_slot(self: &Arc<Self>) -> Result<CommandReservation, CdpError> {
        let mut current = self.slots.load(Ordering::Acquire);
        loop {
            if current >= self.max_slots {
                return Err(CdpError::TooManyPendingCommands {
                    current,
                    max: self.max_slots,
                });
            }
            match self.slots.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Ok(CommandReservation {
                        budget: Arc::clone(self),
                        bytes: 0,
                        memory: None,
                    })
                }
                Err(observed) => current = observed,
            }
        }
    }

    pub(super) fn bytes_in_use(&self) -> usize {
        self.bytes.load(Ordering::Acquire)
    }

    fn try_reserve_bytes(&self, additional: usize) -> Result<usize, CdpError> {
        let mut current = self.bytes.load(Ordering::Acquire);
        loop {
            let next = current
                .checked_add(additional)
                .filter(|n| *n <= self.max_bytes);
            let Some(next) = next else {
                return Err(CdpError::WriterQueueFull {
                    messages: self.slots.load(Ordering::Acquire),
                    bytes: current,
                });
            };
            match self.bytes.compare_exchange_weak(
                current,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(next),
                Err(observed) => current = observed,
            }
        }
    }
}

/// Holds one command slot plus the payload bytes reserved so far. Released on drop.
#[derive(Debug)]
pub(super) struct CommandReservation {
    budget: Arc<CommandBudget>,
    bytes: usize,
    memory: Option<MemoryReservation>,
}

impl CommandReservation {
    /// Reserve `additional` payload bytes ahead of writing them. Returns the global bytes
    /// in use after the reservation.
    pub(super) fn grow(&mut self, additional: usize) -> Result<usize, CdpError> {
        let total = self.budget.try_reserve_bytes(additional)?;
        if let Some(controller) = &self.budget.memory {
            let target = self.bytes + additional;
            let charged = match self.memory.as_mut() {
                Some(held) => held.adjust(target).is_ok(),
                None => match controller.try_reserve(target) {
                    Ok(held) => {
                        self.memory = Some(held);
                        true
                    }
                    Err(_) => false,
                },
            };
            if !charged {
                // Failed growth must not leak the local reservation either.
                self.budget.bytes.fetch_sub(additional, Ordering::AcqRel);
                return Err(CdpError::WriterQueueFull {
                    messages: self.budget.slots.load(Ordering::Acquire),
                    bytes: total - additional,
                });
            }
        }
        self.bytes += additional;
        Ok(total)
    }

    #[cfg(test)]
    pub(super) fn reserved_bytes(&self) -> usize {
        self.bytes
    }
}

impl Drop for CommandReservation {
    fn drop(&mut self) {
        self.budget.bytes.fetch_sub(self.bytes, Ordering::AcqRel);
        self.budget.slots.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_and_bytes_release_on_drop_and_cap_holds() {
        let budget = CommandBudget::new(2, 100);
        let mut a = budget.reserve_slot().unwrap();
        let mut b = budget.reserve_slot().unwrap();
        assert!(matches!(
            budget.reserve_slot(),
            Err(CdpError::TooManyPendingCommands { current: 2, max: 2 })
        ));

        assert_eq!(a.grow(60).unwrap(), 60);
        assert!(matches!(
            b.grow(41),
            Err(CdpError::WriterQueueFull { bytes: 60, .. })
        ));
        // Failed growth must not leak a partial reservation.
        assert_eq!(b.reserved_bytes(), 0);
        assert_eq!(b.grow(40).unwrap(), 100);

        drop(a);
        assert_eq!(budget.bytes_in_use(), 40);
        let c = budget.reserve_slot().unwrap();
        assert!(budget.reserve_slot().is_err());
        drop(c);
        drop(b);
        assert_eq!(budget.bytes_in_use(), 0);

        // After dropping all reservations, prove ALL slots can be simultaneously held
        // and full byte budget reused.
        let mut all = Vec::new();
        for _ in 0..2 {
            all.push(budget.reserve_slot().unwrap());
        }
        assert!(matches!(
            budget.reserve_slot(),
            Err(CdpError::TooManyPendingCommands { current: 2, max: 2 })
        ));
        all[0].grow(50).unwrap();
        all[1].grow(50).unwrap();
        assert_eq!(budget.bytes_in_use(), 100);
        drop(all);
        assert_eq!(budget.bytes_in_use(), 0);
    }
}
