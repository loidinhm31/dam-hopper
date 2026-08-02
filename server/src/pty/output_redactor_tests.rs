use super::{output_control_parser::Utf8StreamDecoder, output_redactor::ExactValueRedactor};

#[test]
fn redacts_split_and_ansi_interleaved_values() {
    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut output = redactor.redact(b"before marker-\x1b[0m");
    output.extend(redactor.redact(b"secret after"));
    output.extend(redactor.finish());
    assert_eq!(
        String::from_utf8(output).unwrap(),
        "before [redacted-correlation-marker] after"
    );
}

#[test]
fn flushes_non_secret_prefix_at_eof() {
    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    assert!(redactor.redact(b"ordinary m").ends_with(b"ordinary "));
    assert_eq!(redactor.finish(), b"m");
}

#[test]
fn redacts_string_controls_and_c1_forms_between_marker_bytes() {
    for control in [b'P', b'^', b'_'] {
        let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
        let input = format!("marker-\x1b{}hidden\x1b\\secret", control as char);
        let mut output = redactor.redact(input.as_bytes());
        output.extend(redactor.finish());
        assert!(!String::from_utf8_lossy(&output).contains("marker-secret"));
        assert!(String::from_utf8_lossy(&output).contains("redacted-correlation-marker"));
    }
    for input in [
        b"marker-\x90hidden\x9csecret".as_slice(),
        b"marker-\x90hidden\xc2\x9csecret".as_slice(),
    ] {
        let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
        let mut output = redactor.redact(input);
        output.extend(redactor.finish());
        assert!(!output
            .windows(b"marker-secret".len())
            .any(|window| window == b"marker-secret"));
        assert!(output
            .windows(b"redacted-correlation-marker".len())
            .any(|window| { window == b"redacted-correlation-marker" }));
    }

    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut output = redactor.redact(b"marker-\x90hidden\xc2");
    output.extend(redactor.redact(b"\x9csecret"));
    output.extend(redactor.finish());
    assert!(output
        .windows(b"redacted-correlation-marker".len())
        .any(|window| window == b"redacted-correlation-marker"));

    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut output = redactor.redact(b"marker-\x90hidden\xc2xsecret");
    output.extend(redactor.finish());
    assert!(output
        .windows(b"xsecret".len())
        .any(|window| window == b"xsecret"));
}

#[test]
fn overflow_bounds_controls_without_releasing_visible_prefix() {
    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut input = b"marker-".to_vec();
    input.extend(std::iter::repeat_n(b'\x1b', 9000));
    input.extend_from_slice(b"ordinary");
    let mut output = redactor.redact(&input);
    output.extend(redactor.finish());
    assert!(output.ends_with(b"ordinary"));
    assert!(!output.ends_with(b"redacted-correlation-marker"));

    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut prefix = b"marker-".to_vec();
    prefix.extend(std::iter::repeat_n(b'\x1b', 9000));
    let mut output = redactor.redact(&prefix);
    output.extend(redactor.redact(b"secret"));
    output.extend(redactor.finish());
    assert!(output
        .windows(b"redacted-correlation-marker".len())
        .any(|window| { window == b"redacted-correlation-marker" }));
    assert!(!output
        .windows(b"marker-secret".len())
        .any(|window| window == b"marker-secret"));
}

#[test]
fn preserves_multibyte_glyphs_with_c1_range_continuations() {
    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let mut output = redactor.redact("model · ✦/workspace · ↳Ready · ⛸Context · 😀".as_bytes());
    output.extend(redactor.finish());

    assert_eq!(
        String::from_utf8(output).unwrap(),
        "model · ✦/workspace · ↳Ready · ⛸Context · 😀"
    );
}

#[test]
fn preserves_multibyte_glyphs_split_across_stream_chunks() {
    let mut redactor = ExactValueRedactor::new(Some("marker-secret".to_string()));
    let glyph = "✦".as_bytes();
    let mut output = redactor.redact(&glyph[..2]);
    output.extend(redactor.redact(&glyph[2..]));
    output.extend(redactor.finish());

    assert_eq!(String::from_utf8(output).unwrap(), "✦");
}

#[test]
fn utf8_stream_decoder_preserves_split_glyphs() {
    let mut decoder = Utf8StreamDecoder::default();
    let glyph = "😀".as_bytes();
    let mut output = decoder.decode(&glyph[..2]);
    output.push_str(&decoder.decode(&glyph[2..]));
    output.push_str(&decoder.finish());

    assert_eq!(output, "😀");
}
