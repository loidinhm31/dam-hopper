#![allow(dead_code)]

use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};
use tar::{Builder, EntryType, Header};

pub fn create_tar_gz(entries: &[(&str, &[u8], u32, EntryType)]) -> (Vec<u8>, String) {
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut tar = Builder::new(&mut enc);
        for &(path, data, mode, entry_type) in entries {
            let mut header = Header::new_gnu();
            header.set_entry_type(entry_type);
            header.set_size(data.len() as u64);
            header.set_mode(mode);
            header.set_cksum();
            tar.append_data(&mut header, path, data).unwrap();
        }
        tar.finish().unwrap();
    }
    let bytes = enc.finish().unwrap();
    let digest = hex::encode(Sha256::digest(&bytes));
    (bytes, digest)
}

pub fn create_regular_tar_gz(entries: &[(&str, &[u8], u32)]) -> (Vec<u8>, String) {
    let full: Vec<(&str, &[u8], u32, EntryType)> = entries
        .iter()
        .map(|&(p, d, m)| (p, d, m, EntryType::Regular))
        .collect();
    create_tar_gz(&full)
}

pub fn build_manifest_json(id: &str, version: &str, files: &[(&str, &[u8], u32)]) -> String {
    let mut inventory = Vec::new();
    for &(path, data, mode) in files {
        let sha256 = hex::encode(Sha256::digest(data));
        inventory.push(serde_json::json!({
            "path": path,
            "size": data.len(),
            "sha256": sha256,
            "mode": mode & 0o777,
        }));
    }

    let manifest = serde_json::json!({
        "manifestVersion": 1,
        "id": id,
        "version": version,
        "publisher": "test-publisher",
        "hostVersionRange": ">=0.4.0",
        "contracts": {
            "runnerProtocol": "1.0.0",
            "workerSdk": "1.0.0",
            "uiBridge": "1.0.0",
            "manifest": 1,
            "dataApi": "1.0.0"
        },
        "capabilities": ["advisor.scan"],
        "entrypoints": {
            "backend": {
                "runtime": "node",
                "range": ">=22.0.0",
                "entry": "backend/worker.cjs"
            }
        },
        "inventory": inventory
    });

    serde_json::to_string_pretty(&manifest).unwrap()
}
