#[derive(Default)]
pub(super) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(super) fn decode(&mut self, input: &[u8]) -> String {
        if input.is_empty() && self.pending.is_empty() {
            return String::new();
        }

        let mut bytes = std::mem::take(&mut self.pending);
        bytes.extend_from_slice(input);
        let mut output = String::new();
        let mut remaining = bytes.as_slice();

        loop {
            match std::str::from_utf8(remaining) {
                Ok(text) => {
                    output.push_str(text);
                    return output;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    let (valid, invalid) = remaining.split_at(valid_up_to);
                    output.push_str(std::str::from_utf8(valid).expect("UTF-8 prefix is valid"));
                    let Some(error_len) = error.error_len() else {
                        self.pending.extend_from_slice(invalid);
                        return output;
                    };
                    output.push_str(&String::from_utf8_lossy(&invalid[..error_len]));
                    remaining = &invalid[error_len..];
                }
            }
        }
    }

    pub(super) fn finish(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned()
    }
}
