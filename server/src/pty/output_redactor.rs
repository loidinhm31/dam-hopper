use super::output_control_parser::{EscapeParser, Token};

/// Streaming redactor that recognizes a protected visible value even when a
/// process inserts zero-width ANSI controls between its bytes.
pub struct ExactValueRedactor {
    protected: Vec<u8>,
    candidate: Vec<Token>,
    candidate_visible: Vec<u8>,
    candidate_bytes: usize,
    escape: EscapeParser,
}

const REDACTED: &[u8] = b"[redacted-correlation-marker]";
const MAX_CANDIDATE_BYTES: usize = 8192;

impl ExactValueRedactor {
    pub fn new(protected: Option<String>) -> Self {
        Self {
            protected: protected.unwrap_or_default().into_bytes(),
            candidate: Vec::new(),
            candidate_visible: Vec::new(),
            candidate_bytes: 0,
            escape: EscapeParser::default(),
        }
    }

    pub fn redact(&mut self, input: &[u8]) -> Vec<u8> {
        if self.protected.is_empty() {
            return input.to_vec();
        }
        let mut output = Vec::with_capacity(input.len());
        for byte in input {
            for token in self.escape.feed(*byte) {
                self.accept(token, &mut output);
            }
        }
        output
    }

    pub fn finish(&mut self) -> Vec<u8> {
        let mut output = Vec::new();
        if let Some(control) = self.escape.finish() {
            self.accept(control, &mut output);
        }
        for token in self.candidate.drain(..) {
            append_token(token, &self.protected, &mut output);
        }
        self.candidate_visible.clear();
        self.candidate_bytes = 0;
        output
    }

    fn accept(&mut self, token: Token, output: &mut Vec<u8>) {
        if matches!(token, Token::Control(_)) && self.candidate.is_empty() {
            append_token(token, &self.protected, output);
            return;
        }
        self.candidate.push(token);
        self.candidate_bytes += token_bytes(self.candidate.last().unwrap());
        if let Some(Token::Visible(byte)) = self.candidate.last() {
            self.candidate_visible.push(*byte);
        }
        if self.candidate_bytes > MAX_CANDIDATE_BYTES {
            // Keep the visible marker prefix private, but flush zero-width
            // controls so candidate memory remains bounded.
            let mut visible_tokens = Vec::with_capacity(self.candidate_visible.len());
            for token in self.candidate.drain(..) {
                match token {
                    Token::Visible(byte) => visible_tokens.push(Token::Visible(byte)),
                    control => append_token(control, &self.protected, output),
                }
            }
            self.candidate = visible_tokens;
            self.candidate_bytes = self.candidate_visible.len();
            return;
        }
        loop {
            if self.candidate_visible == self.protected {
                output.extend_from_slice(REDACTED);
                self.candidate.clear();
                self.candidate_visible.clear();
                self.candidate_bytes = 0;
                return;
            }
            if self.protected.starts_with(&self.candidate_visible) {
                return;
            }
            while !self.candidate.is_empty() {
                let token = self.candidate.remove(0);
                self.candidate_bytes -= token_bytes(&token);
                let visible = matches!(token, Token::Visible(_));
                append_token(token, &self.protected, output);
                if visible {
                    self.candidate_visible.remove(0);
                    break;
                }
            }
        }
    }
}

fn token_bytes(token: &Token) -> usize {
    match token {
        Token::Visible(_) => 1,
        Token::Control(bytes) => bytes.len(),
    }
}

fn append_token(token: Token, protected: &[u8], output: &mut Vec<u8>) {
    match token {
        Token::Visible(byte) => output.push(byte),
        Token::Control(bytes) => replace_contiguous(&bytes, protected, output),
    }
}

fn replace_contiguous(input: &[u8], protected: &[u8], output: &mut Vec<u8>) {
    let mut remaining = input;
    while let Some(index) = remaining
        .windows(protected.len())
        .position(|window| window == protected)
    {
        output.extend_from_slice(&remaining[..index]);
        output.extend_from_slice(REDACTED);
        remaining = &remaining[index + protected.len()..];
    }
    output.extend_from_slice(remaining);
}
