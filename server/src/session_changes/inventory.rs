pub fn is_binary_buffer(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}
