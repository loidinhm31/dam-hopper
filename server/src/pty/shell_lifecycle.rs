//! Bounded observer for OSC 633 lifecycle markers. It never consumes PTY bytes.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use subtle::ConstantTimeEq;

const PREFIX: &[u8] = b"\x1b]633;";
const MAX: usize = 8 * 1024;
const ALT_BUFFER_ENTER: &[u8] = b"\x1b[?1049h";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleState {
    Unverified,
    Prompt,
    Editing,
    Submitted,
    Opaque,
    Finished,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleEvent {
    pub state: LifecycleState,
    pub command: Option<String>,
}

#[derive(Debug)]
pub struct ShellLifecycle {
    nonce: String,
    generation: u64,
    state: LifecycleState,
    marker: Option<Vec<u8>>,
    pending_prefix: Vec<u8>,
}

impl ShellLifecycle {
    pub fn new(nonce: String, generation: u64) -> Self {
        Self {
            nonce,
            generation,
            state: LifecycleState::Unverified,
            marker: None,
            pending_prefix: Vec::new(),
        }
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn nonce(&self) -> &str {
        &self.nonce
    }
    pub fn reset(&mut self) -> LifecycleEvent {
        self.marker = None;
        self.pending_prefix.clear();
        self.state = LifecycleState::Unverified;
        LifecycleEvent {
            state: self.state,
            command: None,
        }
    }

    pub fn feed(&mut self, input: &[u8]) -> Vec<LifecycleEvent> {
        self.feed_visible(input).1
    }

    /// Alternate buffers are TUI territory, never a trustworthy shell edit line.
    pub fn observe_alternate_buffer(&mut self, input: &[u8]) -> Option<LifecycleEvent> {
        input
            .windows(ALT_BUFFER_ENTER.len())
            .any(|window| window == ALT_BUFFER_ENTER)
            .then(|| self.reset())
    }

    pub fn feed_visible(&mut self, input: &[u8]) -> (Vec<u8>, Vec<LifecycleEvent>) {
        let mut visible = Vec::with_capacity(input.len());
        let mut events = Vec::new();
        let mut index = 0;
        while index < input.len() {
            if self.marker.is_some() {
                let byte = input[index];
                if byte == 0x07 {
                    let marker = self.marker.take().unwrap();
                    let (valid, marker_events) = self.handle(&marker);
                    if !valid {
                        visible.extend_from_slice(PREFIX);
                        visible.extend_from_slice(&marker);
                        visible.push(byte);
                    }
                    events.extend(marker_events);
                } else if byte == 0x1b && input.get(index + 1) == Some(&b'\\') {
                    let marker = self.marker.take().unwrap();
                    let (valid, marker_events) = self.handle(&marker);
                    if !valid {
                        visible.extend_from_slice(PREFIX);
                        visible.extend_from_slice(&marker);
                        visible.extend_from_slice(b"\x1b\\");
                    }
                    events.extend(marker_events);
                    index += 1;
                } else {
                    let marker = self.marker.as_mut().unwrap();
                    marker.push(byte);
                    if marker.len() > MAX {
                        let marker = self.marker.take().unwrap();
                        visible.extend_from_slice(PREFIX);
                        visible.extend_from_slice(&marker);
                        events.push(self.reset());
                    }
                }
                index += 1;
                continue;
            }
            self.pending_prefix.push(input[index]);
            index += 1;
            loop {
                if PREFIX.starts_with(&self.pending_prefix) {
                    if self.pending_prefix.len() == PREFIX.len() {
                        self.marker = Some(Vec::new());
                        self.pending_prefix.clear();
                    }
                    break;
                }
                visible.push(self.pending_prefix.remove(0));
                if self.pending_prefix.is_empty() {
                    break;
                }
            }
        }
        (visible, events)
    }

    fn handle(&mut self, marker: &[u8]) -> (bool, Vec<LifecycleEvent>) {
        let marker = match std::str::from_utf8(marker) {
            Ok(value) => value,
            Err(_) => return (false, vec![self.reset()]),
        };
        let mut parts = marker.split(';');
        let kind = parts.next().unwrap_or_default();
        let event = match kind {
            "A" if self.valid(parts.next())
                && parts.next().is_none()
                && matches!(
                    self.state,
                    LifecycleState::Unverified | LifecycleState::Finished
                ) =>
            {
                self.state = LifecycleState::Prompt;
                None
            }
            "B" if self.valid(parts.next())
                && parts.next().is_none()
                && self.state == LifecycleState::Prompt =>
            {
                self.state = LifecycleState::Editing;
                Some(LifecycleEvent {
                    state: self.state,
                    command: None,
                })
            }
            "E" if self.state == LifecycleState::Editing => {
                let command = parts
                    .next()
                    .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
                    .and_then(|value| String::from_utf8(value).ok());
                if command.as_ref().is_some_and(|value| value.len() <= MAX)
                    && self.valid(parts.next())
                    && parts.next().is_none()
                {
                    self.state = LifecycleState::Submitted;
                    Some(LifecycleEvent {
                        state: self.state,
                        command,
                    })
                } else {
                    return (false, vec![self.reset()]);
                }
            }
            "C" if self.valid(parts.next())
                && parts.next().is_none()
                && self.state == LifecycleState::Submitted =>
            {
                self.state = LifecycleState::Opaque;
                Some(LifecycleEvent {
                    state: self.state,
                    command: None,
                })
            }
            // A shell may abandon an edit before it can emit an exact E/C pair
            // (for example Bash compound syntax, Ctrl-C, or an empty submit).
            // Treat the next trusted prompt boundary as a private reset so the
            // marker is not replayed into visible terminal output.
            "D" if self.valid(parts.next())
                && parts.next().is_none()
                && matches!(
                    self.state,
                    LifecycleState::Prompt | LifecycleState::Editing | LifecycleState::Submitted
                ) =>
            {
                Some(self.reset())
            }
            "D" if self.valid(parts.next())
                && parts.next().is_none()
                && self.state == LifecycleState::Opaque =>
            {
                self.state = LifecycleState::Finished;
                Some(LifecycleEvent {
                    state: LifecycleState::Unverified,
                    command: None,
                })
            }
            _ => return (false, vec![self.reset()]),
        };
        (true, event.into_iter().collect())
    }

    fn valid(&self, candidate: Option<&str>) -> bool {
        candidate
            .map(|value| self.nonce.as_bytes().ct_eq(value.as_bytes()).into())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn marker(value: &str) -> Vec<u8> {
        format!("\x1b]633;{value}\x07").into_bytes()
    }
    #[test]
    fn validates_order_nonce_and_exact_command() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        assert!(lifecycle.feed(&marker("A;nonce")).is_empty());
        assert_eq!(
            lifecycle.feed(&marker("B;nonce"))[0].state,
            LifecycleState::Editing
        );
        let command = URL_SAFE_NO_PAD.encode(" echo  two\n");
        assert_eq!(
            lifecycle.feed(&marker(&format!("E;{command};nonce")))[0]
                .command
                .as_deref(),
            Some(" echo  two\n")
        );
        assert_eq!(
            lifecycle.feed(&marker("C;nonce"))[0].state,
            LifecycleState::Opaque
        );
        assert_eq!(
            lifecycle.feed(&marker("D;nonce"))[0].state,
            LifecycleState::Unverified
        );
        assert_eq!(
            lifecycle.feed(&marker("B;wrong"))[0].state,
            LifecycleState::Unverified
        );
    }
    #[test]
    fn accepts_chunked_st_termination() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        assert!(lifecycle.feed(b"\x1b]633;A;non").is_empty());
        assert!(lifecycle.feed(b"ce\x1b\\").is_empty());
        assert_eq!(
            lifecycle.feed(&marker("B;nonce"))[0].state,
            LifecycleState::Editing
        );
    }

    #[test]
    fn accepts_a_prefix_split_across_output_chunks() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        assert!(lifecycle.feed(b"\x1b]63").is_empty());
        assert!(lifecycle.feed(b"3;A;nonce\x07").is_empty());
        assert_eq!(
            lifecycle.feed(&marker("B;nonce"))[0].state,
            LifecycleState::Editing
        );
    }

    #[test]
    fn removes_private_marker_bytes_from_visible_output() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        let (visible, _) = lifecycle.feed_visible(b"before\x1b]633;A;nonce\x07after");
        assert_eq!(visible, b"beforeafter");
    }

    #[test]
    fn preserves_invalid_marker_bytes_while_resetting_trust() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        let raw = b"\x1b]633;B;wrong\x07";
        let (visible, events) = lifecycle.feed_visible(raw);
        assert_eq!(visible, raw);
        assert_eq!(events[0].state, LifecycleState::Unverified);
    }

    #[test]
    fn preserves_oversized_marker_bytes_while_resetting_trust() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        let mut raw = PREFIX.to_vec();
        raw.extend(std::iter::repeat_n(b'x', MAX + 1));
        let (visible, events) = lifecycle.feed_visible(&raw);
        assert_eq!(visible, raw);
        assert_eq!(events[0].state, LifecycleState::Unverified);
    }

    #[test]
    fn alternate_buffer_entry_resets_editing_state() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        lifecycle.feed(&marker("A;nonce"));
        lifecycle.feed(&marker("B;nonce"));
        assert_eq!(
            lifecycle
                .observe_alternate_buffer(b"\x1b[?1049h")
                .unwrap()
                .state,
            LifecycleState::Unverified
        );
    }

    #[test]
    fn abandoned_prompt_boundary_resets_without_marker_leak() {
        let mut lifecycle = ShellLifecycle::new("nonce".into(), 7);
        lifecycle.feed(&marker("A;nonce"));
        lifecycle.feed(&marker("B;nonce"));

        let (visible, events) = lifecycle.feed_visible(&marker("D;nonce"));

        assert!(visible.is_empty());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].state, LifecycleState::Unverified);
    }
}
