//! Distinguishes trusted app-config path components from managed store names.

use std::io;

pub(super) fn validate_root_component(name: &str) -> io::Result<()> {
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.encode_utf16().count() > 255
        || name
            .chars()
            .any(|character| character == '\0' || character == '\\' || character == '/')
    {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe_root_component",
        ))
    } else {
        Ok(())
    }
}

pub(super) fn validate_managed_component(name: &str) -> io::Result<()> {
    if name.is_empty()
        || name.len() > 255
        || name.ends_with(['.', ' '])
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe_component",
        ))
    } else {
        Ok(())
    }
}
