#[derive(Clone)]
pub(super) enum Token {
    Visible(u8),
    Control(Vec<u8>),
}

#[derive(Default)]
pub(super) struct EscapeParser {
    bytes: Vec<u8>,
    kind: EscapeKind,
}

#[derive(Clone, Copy, Default)]
enum EscapeKind {
    #[default]
    None,
    Start,
    Csi,
    Osc,
    String,
    StringEscape {
        osc: bool,
    },
    Utf8C1,
    Utf8StringTerminator {
        osc: bool,
    },
}

const MAX_CONTROL_BYTES: usize = 4096;

impl EscapeParser {
    pub(super) fn feed(&mut self, byte: u8) -> Vec<Token> {
        if matches!(self.kind, EscapeKind::None) {
            return self.feed_initial(byte);
        }
        self.bytes.push(byte);
        self.kind = match self.kind {
            EscapeKind::Start if byte == b'[' => EscapeKind::Csi,
            EscapeKind::Start if byte == b']' => EscapeKind::Osc,
            EscapeKind::Start if matches!(byte, b'P' | b'X' | b'^' | b'_') => EscapeKind::String,
            EscapeKind::Start => return self.take_control(),
            EscapeKind::Csi if (0x40..=0x7e).contains(&byte) => return self.take_control(),
            EscapeKind::Csi => EscapeKind::Csi,
            EscapeKind::Osc if byte == 0x07 || byte == 0x9c => return self.take_control(),
            EscapeKind::Osc if byte == 0x1b => EscapeKind::StringEscape { osc: true },
            EscapeKind::Osc if byte == 0xc2 => EscapeKind::Utf8StringTerminator { osc: true },
            EscapeKind::Osc => EscapeKind::Osc,
            EscapeKind::String if byte == 0x9c => return self.take_control(),
            EscapeKind::String if byte == 0x1b => EscapeKind::StringEscape { osc: false },
            EscapeKind::String if byte == 0xc2 => EscapeKind::Utf8StringTerminator { osc: false },
            EscapeKind::String => EscapeKind::String,
            EscapeKind::StringEscape { .. } if byte == b'\\' => return self.take_control(),
            EscapeKind::StringEscape { osc } => string_kind(osc),
            EscapeKind::Utf8C1 if (0x80..=0x9f).contains(&byte) => {
                return self.start_c1(c1_kind(byte).unwrap_or(C1Kind::Control))
            }
            EscapeKind::Utf8C1 => {
                let first = self.bytes.remove(0);
                self.kind = EscapeKind::None;
                let mut tokens = vec![Token::Visible(first)];
                tokens.extend(self.feed(byte));
                return tokens;
            }
            EscapeKind::Utf8StringTerminator { .. } if byte == 0x9c => return self.take_control(),
            EscapeKind::Utf8StringTerminator { osc } => {
                // Malformed UTF-8 C1 remains opaque string payload.
                self.kind = string_kind(osc);
                return Vec::new();
            }
            EscapeKind::None => unreachable!(),
        };
        if self.bytes.len() >= MAX_CONTROL_BYTES {
            return self.take_control();
        }
        Vec::new()
    }

    pub(super) fn finish(&mut self) -> Option<Token> {
        (!self.bytes.is_empty()).then(|| {
            self.kind = EscapeKind::None;
            Token::Control(std::mem::take(&mut self.bytes))
        })
    }

    fn feed_initial(&mut self, byte: u8) -> Vec<Token> {
        if byte == 0x1b {
            self.bytes.push(byte);
            self.kind = EscapeKind::Start;
            return Vec::new();
        }
        if byte == 0xc2 {
            self.bytes.push(byte);
            self.kind = EscapeKind::Utf8C1;
            return Vec::new();
        }
        if let Some(kind) = c1_kind(byte) {
            self.bytes.push(byte);
            return self.start_c1(kind);
        }
        if byte.is_ascii_control() && !matches!(byte, b'\n' | b'\r' | b'\t' | 0x08) {
            return vec![Token::Control(vec![byte])];
        }
        vec![Token::Visible(byte)]
    }

    fn take_control(&mut self) -> Vec<Token> {
        self.kind = EscapeKind::None;
        vec![Token::Control(std::mem::take(&mut self.bytes))]
    }

    fn start_c1(&mut self, kind: C1Kind) -> Vec<Token> {
        match kind {
            C1Kind::Csi => self.kind = EscapeKind::Csi,
            C1Kind::Osc => self.kind = EscapeKind::Osc,
            C1Kind::String => self.kind = EscapeKind::String,
            C1Kind::Control => return self.take_control(),
        }
        Vec::new()
    }
}

#[derive(Clone, Copy)]
enum C1Kind {
    Csi,
    Osc,
    String,
    Control,
}

fn c1_kind(byte: u8) -> Option<C1Kind> {
    match byte {
        0x90 | 0x98 | 0x9e | 0x9f => Some(C1Kind::String),
        0x9b => Some(C1Kind::Csi),
        0x9d => Some(C1Kind::Osc),
        0x80..=0x9f => Some(C1Kind::Control),
        _ => None,
    }
}

fn string_kind(osc: bool) -> EscapeKind {
    if osc {
        EscapeKind::Osc
    } else {
        EscapeKind::String
    }
}
