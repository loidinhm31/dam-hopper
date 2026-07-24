use super::*;

fn selection() -> BrowserSelectionV1 {
    BrowserSelectionV1 {
        version: 1,
        tag: "button".into(),
        role: Some("button".into()),
        accessible_name: Some("Save".into()),
        text: Some("Save changes".into()),
        attributes: [("data-testid".into(), "save".into())].into(),
        locator: "main > button".into(),
        bounds: BrowserSelectionBoundsV1 {
            x: 1.0,
            y: 2.0,
            width: 80.0,
            height: 32.0,
        },
    }
}

#[tokio::test]
async fn sweep_removes_expired_artifact_files() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let response = manager
        .create("shell:test".into(), selection())
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
    manager
        .entries
        .write()
        .await
        .get_mut(&id)
        .unwrap()
        .expires_at = 0;
    manager.sweep_expired().await;
    assert!(!std::path::Path::new(&response.json_path).exists());
    assert!(matches!(
        manager.upload_png(id, png()).await,
        Err(BrowserDebugError::NotFound)
    ));
}

#[tokio::test]
async fn upload_delete_race_leaves_no_orphan_files() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let response = manager
        .create("shell:test".into(), selection())
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
    let (_, _) = tokio::join!(manager.upload_png(id, png()), manager.delete(id));
    assert!(std::fs::read_dir(manager.root.path())
        .unwrap()
        .next()
        .is_none());
}

#[tokio::test]
async fn disposal_removes_the_private_root() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let response = manager
        .create("shell:test".into(), selection())
        .await
        .unwrap();
    let root = std::path::Path::new(&response.json_path)
        .parent()
        .unwrap()
        .to_path_buf();
    manager.dispose_all().await;
    assert!(!root.exists());
}

#[tokio::test]
async fn rejects_semantically_invalid_png_variants() {
    for bytes in [
        invalid_compressed_png(),
        nonconsecutive_idat_png(),
        repeated_ihdr_png(),
        decoded_output_over_cap_png(),
    ] {
        let manager = BrowserDebugArtifactManager::new().unwrap();
        let response = manager
            .create("shell:test".into(), selection())
            .await
            .unwrap();
        let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
        assert!(matches!(
            manager.upload_png(id, axum::body::Bytes::from(bytes)).await,
            Err(BrowserDebugError::InvalidPng)
        ));
    }
}

fn png() -> axum::body::Bytes {
    axum::body::Bytes::from(valid_png())
}

fn valid_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_chunk(
        &mut png,
        b"IDAT",
        &[
            0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x00, 0x01,
        ],
    );
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn invalid_compressed_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_chunk(&mut png, b"IDAT", &[0x78, 0x01, 0xff]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn nonconsecutive_idat_png() -> Vec<u8> {
    let mut png = valid_png();
    let iend = png.split_off(png.len() - 12);
    append_chunk(&mut png, b"tEXt", b"note");
    append_chunk(&mut png, b"IDAT", &[0]);
    png.extend_from_slice(&iend);
    png
}

fn repeated_ihdr_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_ihdr(&mut png, 1, 1);
    append_chunk(&mut png, b"IDAT", &[0x78, 0x01, 0xff]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn decoded_output_over_cap_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 5_000, 5_000);
    append_chunk(&mut png, b"IDAT", &[0x78]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn append_ihdr(target: &mut Vec<u8>, width: u32, height: u32) {
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    append_chunk(target, b"IHDR", &ihdr);
}

fn append_chunk(target: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    target.extend_from_slice(&(data.len() as u32).to_be_bytes());
    target.extend_from_slice(kind);
    target.extend_from_slice(data);
    target.extend_from_slice(&crc32(&[kind.as_slice(), data].concat()).to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}
