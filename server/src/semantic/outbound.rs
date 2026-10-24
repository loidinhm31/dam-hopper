//! Serialized semantic output: message admission and byte reservations cover queued
//! frames and the active socket send. Waiting producers remain separately bounded
//! by the gateway's in-flight cap and single reader, with send deadlines.

use super::resources::{MAX_QUEUED_BYTES, MAX_QUEUED_MESSAGES};
use std::sync::Arc;
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};

#[derive(Debug)]
pub enum SendError {
    Closed,
    Oversized,
}

pub struct OutboundFrame {
    text: String,
    bytes: OwnedSemaphorePermit,
}
impl OutboundFrame {
    pub fn into_parts(self) -> (String, OwnedSemaphorePermit) {
        (self.text, self.bytes)
    }
}

#[derive(Clone)]
pub struct OutboundSender {
    sender: mpsc::Sender<OutboundFrame>,
    budget: Arc<Semaphore>,
    max_bytes: usize,
}

pub struct OutboundReceiver {
    receiver: mpsc::Receiver<OutboundFrame>,
    budget: Arc<Semaphore>,
    max_bytes: usize,
}

pub fn channel() -> (OutboundSender, OutboundReceiver) {
    bounded_channel(MAX_QUEUED_MESSAGES, MAX_QUEUED_BYTES)
}

fn bounded_channel(messages: usize, bytes: usize) -> (OutboundSender, OutboundReceiver) {
    let (sender, receiver) = mpsc::channel(messages);
    let budget = Arc::new(Semaphore::new(bytes));
    (
        OutboundSender {
            sender,
            budget: budget.clone(),
            max_bytes: bytes,
        },
        OutboundReceiver {
            receiver,
            budget,
            max_bytes: bytes,
        },
    )
}

impl OutboundSender {
    pub fn is_closed(&self) -> bool {
        self.sender.is_closed()
    }
    pub async fn closed(&self) {
        self.sender.closed().await;
    }
    pub async fn send(&self, text: String) -> Result<(), SendError> {
        if text.len() > self.max_bytes {
            return Err(SendError::Oversized);
        }
        let slot = self.sender.reserve().await.map_err(|_| SendError::Closed)?;
        let bytes = tokio::select! {
            biased;
            _ = self.sender.closed() => return Err(SendError::Closed),
            permit = self.budget.clone().acquire_many_owned(text.len() as u32) =>
                permit.map_err(|_| SendError::Closed)?,
        };
        slot.send(OutboundFrame { text, bytes });
        Ok(())
    }
}
impl OutboundReceiver {
    pub async fn recv(&mut self) -> Option<OutboundFrame> {
        self.receiver.recv().await
    }
    pub fn reserved_bytes(&self) -> usize {
        self.max_bytes - self.budget.available_permits()
    }
    pub fn try_reserve_extra(&self, bytes: usize) -> Option<OwnedSemaphorePermit> {
        self.budget
            .clone()
            .try_acquire_many_owned(bytes.try_into().ok()?)
            .ok()
    }
    pub fn close(&mut self) {
        self.budget.close();
        self.receiver.close();
    }
}
impl Drop for OutboundReceiver {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn utf8_capacity_covers_queued_and_active_send_until_drop() {
        let (sender, mut receiver) = bounded_channel(2, 8);
        sender.send("🚀".into()).await.unwrap();
        sender.send("éé".into()).await.unwrap();
        let (text, active_bytes) = receiver.recv().await.unwrap().into_parts();
        assert_eq!(text, "🚀");
        let pending = sender.send("x".into());
        tokio::pin!(pending);
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        drop(active_bytes);
        pending.await.unwrap();
        let (second, second_bytes) = receiver.recv().await.unwrap().into_parts();
        assert_eq!(second, "éé");
        drop(second_bytes);
        let (third, _) = receiver.recv().await.unwrap().into_parts();
        assert_eq!(third, "x");
    }

    #[tokio::test]
    async fn oversized_and_closed_budget_waits_fail_without_retained_reservations() {
        let (sender, mut receiver) = bounded_channel(2, 4);
        assert!(matches!(
            sender.send("🚀x".into()).await,
            Err(SendError::Oversized)
        ));
        sender.send("🚀".into()).await.unwrap();
        let active = receiver.recv().await.unwrap();
        let pending = sender.send("x".into());
        tokio::pin!(pending);
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        receiver.close();
        assert!(matches!(pending.await, Err(SendError::Closed)));
        drop(active);
        assert_eq!(sender.budget.available_permits(), 4);
    }

    #[tokio::test]
    async fn cancelling_message_or_byte_wait_releases_admission() {
        let (sender, mut receiver) = bounded_channel(1, 4);
        sender.send("abcd".into()).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), sender.send("x".into()))
                .await
                .is_err()
        );
        let active = receiver.recv().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), sender.send("x".into()))
                .await
                .is_err()
        );
        drop(active);
        sender.send("next".into()).await.unwrap();
        let (next, bytes) = receiver.recv().await.unwrap().into_parts();
        assert_eq!(next, "next");
        drop(bytes);
        assert_eq!(sender.budget.available_permits(), 4);
    }
}
