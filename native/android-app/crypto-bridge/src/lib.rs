//! Native client OPAQUE PAKE and HKDF AES-256-GCM derivation bridge for DamHopper Android.
//!
//! Matches server implementation in `server/src/crypto/opaque.rs`:
//! - CipherSuite: Ristretto255 + TripleDH (Ristretto255, Sha512) + Identity KSF
//! - HKDF Salt: 32 zero bytes (Rust `hkdf::new(None, ...)` default for SHA-256)
//! - HKDF Info: `b"dam-hopper-aes-256-gcm-v1"`
//! - Key length: 32 bytes (AES-256-GCM)
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};

use hkdf::Hkdf;
use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jbyteArray, jlong, jobjectArray};
use jni::JNIEnv;
use opaque_ke::{
    CipherSuite, ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialResponse, RegistrationResponse,
};
use parking_lot::RwLock;
use rand::rngs::OsRng;
use sha2::Sha256;
use zeroize::Zeroizing;
// ---------------------------------------------------------------------------
// CipherSuite — exact parity with DamHopperOpaqueSuite on server
// ---------------------------------------------------------------------------

pub struct DamHopperOpaqueSuite;

impl CipherSuite for DamHopperOpaqueSuite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf = opaque_ke::ksf::Identity;
}

pub const HKDF_INFO: &[u8] = b"dam-hopper-aes-256-gcm-v1";
pub const AES_KEY_LEN: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum OpaqueBridgeError {
    #[error("Internal crypto error: {0}")]
    Crypto(String),
    #[error("Invalid message format: {0}")]
    Serialization(String),
    #[error("Handle not found or already closed: {0}")]
    InvalidHandle(i64),
    #[error("Capacity limit exceeded")]
    CapacityExceeded,
    #[error("HKDF key derivation failed")]
    HkdfFailed,
}

// ---------------------------------------------------------------------------
// Core Client Functions
// ---------------------------------------------------------------------------

pub fn client_register_start(
    password: &[u8],
) -> Result<(ClientRegistration<DamHopperOpaqueSuite>, Vec<u8>), OpaqueBridgeError> {
    let mut rng = OsRng;
    let start_result = ClientRegistration::<DamHopperOpaqueSuite>::start(&mut rng, password)
        .map_err(|e| OpaqueBridgeError::Crypto(format!("ClientRegistration start failed: {e}")))?;

    let request_bytes = start_result.message.serialize().to_vec();
    Ok((start_result.state, request_bytes))
}

pub fn client_register_finish(
    state: ClientRegistration<DamHopperOpaqueSuite>,
    password: &[u8],
    response_bytes: &[u8],
) -> Result<Vec<u8>, OpaqueBridgeError> {
    let mut rng = OsRng;
    let response = RegistrationResponse::<DamHopperOpaqueSuite>::deserialize(response_bytes)
        .map_err(|e| OpaqueBridgeError::Serialization(format!("Invalid RegistrationResponse: {e}")))?;

    let finish_result = state
        .finish(
            &mut rng,
            password,
            response,
            ClientRegistrationFinishParameters::default(),
        )
        .map_err(|e| OpaqueBridgeError::Crypto(format!("ClientRegistration finish failed: {e}")))?;

    Ok(finish_result.message.serialize().to_vec())
}

pub fn client_login_start(
    password: &[u8],
) -> Result<(ClientLogin<DamHopperOpaqueSuite>, Vec<u8>), OpaqueBridgeError> {
    let mut rng = OsRng;
    let start_result = ClientLogin::<DamHopperOpaqueSuite>::start(&mut rng, password)
        .map_err(|e| OpaqueBridgeError::Crypto(format!("ClientLogin start failed: {e}")))?;

    let request_bytes = start_result.message.serialize().to_vec();
    Ok((start_result.state, request_bytes))
}

pub fn client_login_finish(
    state: ClientLogin<DamHopperOpaqueSuite>,
    password: &[u8],
    response_bytes: &[u8],
) -> Result<(Vec<u8>, Zeroizing<[u8; AES_KEY_LEN]>), OpaqueBridgeError> {
    let mut rng = OsRng;
    let response = CredentialResponse::<DamHopperOpaqueSuite>::deserialize(response_bytes)
        .map_err(|e| OpaqueBridgeError::Serialization(format!("Invalid CredentialResponse: {e}")))?;

    let finish_result = state
        .finish(
            &mut rng,
            password,
            response,
            ClientLoginFinishParameters::default(),
        )
        .map_err(|e| OpaqueBridgeError::Crypto(format!("ClientLogin finish failed: {e}")))?;

    let finalization_bytes = finish_result.message.serialize().to_vec();
    let session_key = finish_result.session_key;
    let aes_key = derive_aes_key(session_key.as_ref())?;

    Ok((finalization_bytes, aes_key))
}

pub fn derive_aes_key(session_key: &[u8]) -> Result<Zeroizing<[u8; AES_KEY_LEN]>, OpaqueBridgeError> {
    // Rust hkdf::new(None, ...) defaults salt to 32 zero bytes for SHA-256
    let hkdf = Hkdf::<Sha256>::new(None, session_key);
    let mut aes_key = Zeroizing::new([0u8; AES_KEY_LEN]);
    hkdf.expand(HKDF_INFO, &mut *aes_key)
        .map_err(|_| OpaqueBridgeError::HkdfFailed)?;
    Ok(aes_key)
}
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

pub const IV_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const METADATA_MAX: usize = 4096;

pub fn encrypt_envelope(
    aes_key: &[u8],
    metadata_json: &str,
    content: &[u8],
) -> Result<Vec<u8>, OpaqueBridgeError> {
    if aes_key.len() != AES_KEY_LEN {
        return Err(OpaqueBridgeError::Crypto(format!("Invalid key length: {}", aes_key.len())));
    }
    let mut rng = OsRng;
    let mut iv = [0u8; IV_LEN];
    rand::RngCore::fill_bytes(&mut rng, &mut iv);

    let cipher = Aes256Gcm::new_from_slice(aes_key)
        .map_err(|e| OpaqueBridgeError::Crypto(format!("Invalid AES key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);

    let meta_bytes = metadata_json.as_bytes();
    let mut plaintext = Vec::with_capacity(meta_bytes.len() + 1 + content.len());
    plaintext.extend_from_slice(meta_bytes);
    plaintext.push(0x00);
    plaintext.extend_from_slice(content);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_slice())
        .map_err(|e| OpaqueBridgeError::Crypto(format!("AES-GCM encryption failed: {e}")))?;

    let mut envelope = Vec::with_capacity(IV_LEN + ciphertext.len());
    envelope.extend_from_slice(&iv);
    envelope.extend_from_slice(&ciphertext);

    Ok(envelope)
}

pub fn decrypt_envelope(
    aes_key: &[u8],
    envelope: &[u8],
) -> Result<(String, Vec<u8>), OpaqueBridgeError> {
    if envelope.len() < IV_LEN + TAG_LEN {
        return Err(OpaqueBridgeError::Serialization("Encrypted blob too short".into()));
    }
    if aes_key.len() != AES_KEY_LEN {
        return Err(OpaqueBridgeError::Crypto(format!("Invalid key length: {}", aes_key.len())));
    }

    let iv = &envelope[..IV_LEN];
    let ciphertext = &envelope[IV_LEN..];

    let cipher = Aes256Gcm::new_from_slice(aes_key)
        .map_err(|e| OpaqueBridgeError::Crypto(format!("Invalid AES key: {e}")))?;
    let nonce = Nonce::from_slice(iv);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| OpaqueBridgeError::Crypto("AES-GCM decryption failed — wrong key or corrupted data".into()))?;

    let sep_idx = plaintext
        .iter()
        .position(|&b| b == 0x00)
        .ok_or_else(|| OpaqueBridgeError::Serialization("Plaintext missing metadata separator (0x00)".into()))?;

    if sep_idx > METADATA_MAX {
        return Err(OpaqueBridgeError::Serialization(format!(
            "Metadata section too large: {sep_idx} bytes (max {METADATA_MAX})"
        )));
    }

    let meta_json = std::str::from_utf8(&plaintext[..sep_idx])
        .map_err(|e| OpaqueBridgeError::Serialization(format!("Metadata is not valid UTF-8: {e}")))?
        .to_string();

    let content = plaintext[sep_idx + 1..].to_vec();

    Ok((meta_json, content))
}

// ---------------------------------------------------------------------------
// Thread-Safe Handle Manager for JNI
// ---------------------------------------------------------------------------

struct StateStore<T> {
    next_id: AtomicI64,
    items: RwLock<HashMap<i64, T>>,
    max_capacity: usize,
}

impl<T> StateStore<T> {
    fn new(max_capacity: usize) -> Self {
        Self {
            next_id: AtomicI64::new(1),
            items: RwLock::new(HashMap::new()),
            max_capacity,
        }
    }

    fn insert(&self, item: T) -> Result<i64, OpaqueBridgeError> {
        let mut map = self.items.write();
        if map.len() >= self.max_capacity {
            return Err(OpaqueBridgeError::CapacityExceeded);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        map.insert(id, item);
        Ok(id)
    }

    fn remove(&self, id: i64) -> Result<T, OpaqueBridgeError> {
        let mut map = self.items.write();
        map.remove(&id).ok_or(OpaqueBridgeError::InvalidHandle(id))
    }
    #[cfg(test)]
    fn contains(&self, id: i64) -> bool {
        self.items.read().contains_key(&id)
    }
}
static REG_STORE: std::sync::LazyLock<StateStore<ClientRegistration<DamHopperOpaqueSuite>>> =
    std::sync::LazyLock::new(|| StateStore::new(64));

static LOGIN_STORE: std::sync::LazyLock<StateStore<ClientLogin<DamHopperOpaqueSuite>>> =
    std::sync::LazyLock::new(|| StateStore::new(64));
fn throw_jni_error(env: &mut JNIEnv, msg: &str) {
    let _ = env.throw_new("java/lang/IllegalStateException", msg);
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeRegisterStart(
    mut env: JNIEnv,
    _class: JClass,
    password: JString,
    out_handle: JByteArray,
) -> jbyteArray {
    let pw_str: String = match env.get_string(&password) {
        Ok(s) => s.into(),
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to get password string: {e}"));
            return std::ptr::null_mut();
        }
    };
    let pw_bytes = Zeroizing::new(pw_str.into_bytes());
    match client_register_start(&pw_bytes) {
        Ok((state, req_bytes)) => {
            let handle = match REG_STORE.insert(state) {
                Ok(h) => h,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Store error: {e}"));
                    return std::ptr::null_mut();
                }
            };

            // Write handle as 8 bytes big-endian into out_handle
            let handle_bytes = handle.to_be_bytes();
            if let Err(e) = env.set_byte_array_region(&out_handle, 0, bytemuck_cast(&handle_bytes)) {
                throw_jni_error(&mut env, &format!("Failed to write handle: {e}"));
                let _ = REG_STORE.remove(handle);
                return std::ptr::null_mut();
            }

            match env.byte_array_from_slice(&req_bytes) {
                Ok(arr) => arr.into_raw(),
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to allocate byte array: {e}"));
                    let _ = REG_STORE.remove(handle);
                    std::ptr::null_mut()
                }
            }
        }
        Err(e) => {
            throw_jni_error(&mut env, &format!("Registration start failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeRegisterFinish(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    password: JString,
    response_bytes: JByteArray,
) -> jbyteArray {
    let state = match REG_STORE.remove(handle) {
        Ok(s) => s,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Invalid handle: {e}"));
            return std::ptr::null_mut();
        }
    };

    let pw_str: String = match env.get_string(&password) {
        Ok(s) => s.into(),
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read password: {e}"));
            return std::ptr::null_mut();
        }
    };
    let pw_bytes = Zeroizing::new(pw_str.into_bytes());

    let resp_vec = match env.convert_byte_array(response_bytes) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read response bytes: {e}"));
            return std::ptr::null_mut();
        }
    };

    match client_register_finish(state, &pw_bytes, &resp_vec) {
        Ok(upload_bytes) => match env.byte_array_from_slice(&upload_bytes) {
            Ok(arr) => arr.into_raw(),
            Err(e) => {
                throw_jni_error(&mut env, &format!("Failed to create upload array: {e}"));
                std::ptr::null_mut()
            }
        },
        Err(e) => {
            throw_jni_error(&mut env, &format!("Register finish failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeLoginStart(
    mut env: JNIEnv,
    _class: JClass,
    password: JString,
    out_handle: JByteArray,
) -> jbyteArray {
    let pw_str: String = match env.get_string(&password) {
        Ok(s) => s.into(),
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to get password string: {e}"));
            return std::ptr::null_mut();
        }
    };
    let pw_bytes = Zeroizing::new(pw_str.into_bytes());

    match client_login_start(&pw_bytes) {
        Ok((state, req_bytes)) => {
            let handle = match LOGIN_STORE.insert(state) {
                Ok(h) => h,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Store error: {e}"));
                    return std::ptr::null_mut();
                }
            };

            let handle_bytes = handle.to_be_bytes();
            if let Err(e) = env.set_byte_array_region(&out_handle, 0, bytemuck_cast(&handle_bytes)) {
                throw_jni_error(&mut env, &format!("Failed to write handle: {e}"));
                let _ = LOGIN_STORE.remove(handle);
                return std::ptr::null_mut();
            }

            match env.byte_array_from_slice(&req_bytes) {
                Ok(arr) => arr.into_raw(),
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to allocate byte array: {e}"));
                    let _ = LOGIN_STORE.remove(handle);
                    std::ptr::null_mut()
                }
            }
        }
        Err(e) => {
            throw_jni_error(&mut env, &format!("Login start failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeLoginFinish(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    password: JString,
    response_bytes: JByteArray,
    out_aes_key: JByteArray,
) -> jbyteArray {
    let state = match LOGIN_STORE.remove(handle) {
        Ok(s) => s,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Invalid handle: {e}"));
            return std::ptr::null_mut();
        }
    };

    let pw_str: String = match env.get_string(&password) {
        Ok(s) => s.into(),
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read password: {e}"));
            return std::ptr::null_mut();
        }
    };
    let pw_bytes = Zeroizing::new(pw_str.into_bytes());

    let resp_vec = match env.convert_byte_array(response_bytes) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read response bytes: {e}"));
            return std::ptr::null_mut();
        }
    };

    match client_login_finish(state, &pw_bytes, &resp_vec) {
        Ok((finalization_bytes, aes_key)) => {
            if let Err(e) = env.set_byte_array_region(&out_aes_key, 0, bytemuck_cast(&*aes_key)) {
                throw_jni_error(&mut env, &format!("Failed to copy derived AES key: {e}"));
                return std::ptr::null_mut();
            }

            match env.byte_array_from_slice(&finalization_bytes) {
                Ok(arr) => arr.into_raw(),
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to create finalization array: {e}"));
                    std::ptr::null_mut()
                }
            }
        }
        Err(e) => {
            throw_jni_error(&mut env, &format!("Login finish failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeCloseHandle(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    is_login: jboolean,
) -> jboolean {
    if is_login != 0 {
        LOGIN_STORE.remove(handle).is_ok() as jboolean
    } else {
        REG_STORE.remove(handle).is_ok() as jboolean
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeEncryptEnvelope(
    mut env: JNIEnv,
    _class: JClass,
    aes_key: JByteArray,
    metadata_json: JString,
    content: JByteArray,
) -> jbyteArray {
    let key_vec = match env.convert_byte_array(aes_key) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read key bytes: {e}"));
            return std::ptr::null_mut();
        }
    };
    let meta_str: String = match env.get_string(&metadata_json) {
        Ok(s) => s.into(),
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read metadata string: {e}"));
            return std::ptr::null_mut();
        }
    };
    let content_vec = match env.convert_byte_array(content) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read content bytes: {e}"));
            return std::ptr::null_mut();
        }
    };

    match encrypt_envelope(&key_vec, &meta_str, &content_vec) {
        Ok(envelope) => match env.byte_array_from_slice(&envelope) {
            Ok(arr) => arr.into_raw(),
            Err(e) => {
                throw_jni_error(&mut env, &format!("Failed to allocate envelope byte array: {e}"));
                std::ptr::null_mut()
            }
        },
        Err(e) => {
            throw_jni_error(&mut env, &format!("Encryption failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeDecryptEnvelope(
    mut env: JNIEnv,
    _class: JClass,
    aes_key: JByteArray,
    envelope: JByteArray,
) -> jobjectArray {
    let key_vec = match env.convert_byte_array(aes_key) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read key bytes: {e}"));
            return std::ptr::null_mut();
        }
    };
    let env_vec = match env.convert_byte_array(envelope) {
        Ok(v) => v,
        Err(e) => {
            throw_jni_error(&mut env, &format!("Failed to read envelope bytes: {e}"));
            return std::ptr::null_mut();
        }
    };

    match decrypt_envelope(&key_vec, &env_vec) {
        Ok((meta, content)) => {
            let meta_jstr = match env.new_string(meta) {
                Ok(s) => s,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to create metadata string: {e}"));
                    return std::ptr::null_mut();
                }
            };
            let content_jbarr = match env.byte_array_from_slice(&content) {
                Ok(arr) => arr,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to create content byte array: {e}"));
                    return std::ptr::null_mut();
                }
            };
            let obj_class = match env.find_class("java/lang/Object") {
                Ok(c) => c,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to find Object class: {e}"));
                    return std::ptr::null_mut();
                }
            };
            let arr = match env.new_object_array(2, obj_class, &meta_jstr) {
                Ok(a) => a,
                Err(e) => {
                    throw_jni_error(&mut env, &format!("Failed to allocate object array: {e}"));
                    return std::ptr::null_mut();
                }
            };
            let _ = env.set_object_array_element(&arr, 0, meta_jstr);
            let _ = env.set_object_array_element(&arr, 1, content_jbarr);
            arr.into_raw()
        }
        Err(e) => {
            throw_jni_error(&mut env, &format!("Decryption failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

fn bytemuck_cast(bytes: &[u8]) -> &[i8] {
    // Safety: u8 and i8 have the same size and layout
    unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const i8, bytes.len()) }
}

// ---------------------------------------------------------------------------
// Unit & Server Interoperability Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    use opaque_ke::{
        CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
        ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
    };

    #[test]
    fn test_full_opaque_handshake_with_server_parity() {
        let mut rng = OsRng;
        let password = b"correct-horse-battery-staple";
        let identifier = b"test-user-session-42";

        // 1. Server generates long-term setup
        let server_setup = ServerSetup::<DamHopperOpaqueSuite>::new(&mut rng);

        // 2. Client initiates registration
        let (client_reg, reg_req_bytes) = client_register_start(password).unwrap();

        // 3. Server processes registration request
        let server_reg_req =
            RegistrationRequest::<DamHopperOpaqueSuite>::deserialize(&reg_req_bytes).unwrap();
        let server_reg_start =
            ServerRegistration::<DamHopperOpaqueSuite>::start(&server_setup, server_reg_req, identifier)
                .unwrap();
        let reg_resp_bytes = server_reg_start.message.serialize().to_vec();

        // 4. Client completes registration
        let reg_upload_bytes =
            client_register_finish(client_reg, password, &reg_resp_bytes).unwrap();

        // 5. Server stores registration
        let server_reg_upload =
            RegistrationUpload::<DamHopperOpaqueSuite>::deserialize(&reg_upload_bytes).unwrap();
        let stored_credential = ServerRegistration::finish(server_reg_upload);

        // 6. Client initiates login
        let (client_login, login_req_bytes) = client_login_start(password).unwrap();

        // 7. Server processes login request
        let server_login_req =
            CredentialRequest::<DamHopperOpaqueSuite>::deserialize(&login_req_bytes).unwrap();
        let server_login_start = ServerLogin::<DamHopperOpaqueSuite>::start(
            &mut rng,
            &server_setup,
            Some(stored_credential),
            server_login_req,
            identifier,
            ServerLoginParameters::default(),
        )
        .unwrap();
        let login_resp_bytes = server_login_start.message.serialize().to_vec();

        // 8. Client completes login and derives AES key
        let (finalization_bytes, client_aes_key) =
            client_login_finish(client_login, password, &login_resp_bytes).unwrap();

        // 9. Server completes login and derives AES key using server logic
        let server_finalization =
            CredentialFinalization::<DamHopperOpaqueSuite>::deserialize(&finalization_bytes).unwrap();
        let server_login_finish = server_login_start
            .state
            .finish(server_finalization, ServerLoginParameters::default())
            .unwrap();

        let server_session_key: &[u8] = server_login_finish.session_key.as_ref();
        let server_hkdf = Hkdf::<Sha256>::new(None, server_session_key);
        let mut server_aes_key = Zeroizing::new([0u8; AES_KEY_LEN]);
        server_hkdf.expand(HKDF_INFO, &mut *server_aes_key).unwrap();

        // 10. CRITICAL CHECK: Client AES key MUST exactly equal Server AES key!
        assert_eq!(
            *client_aes_key, *server_aes_key,
            "Client AES-256-GCM key derived from OPAQUE session key does not match server key!"
        );

        // 11. Verify real AES-256-GCM encryption/decryption with the derived key
        let cipher = Aes256Gcm::new_from_slice(&*client_aes_key).unwrap();
        let nonce = Nonce::from_slice(b"unique-nonce"); // 12-byte nonce
        let plaintext = b"Sensitive payload for encrypted-save in DamHopper";

        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();
        let server_cipher = Aes256Gcm::new_from_slice(&*server_aes_key).unwrap();
        let decrypted = server_cipher.decrypt(nonce, ciphertext.as_ref()).unwrap();

        assert_eq!(plaintext.as_ref(), &decrypted[..]);
    }

    #[test]
    fn test_wrong_password_rejection() {
        let mut rng = OsRng;
        let correct_password = b"real-password-123";
        let wrong_password = b"wrong-password-999";
        let identifier = b"alice";

        let server_setup = ServerSetup::<DamHopperOpaqueSuite>::new(&mut rng);

        // Registration with correct password
        let (client_reg, reg_req_bytes) = client_register_start(correct_password).unwrap();
        let server_reg_req =
            RegistrationRequest::<DamHopperOpaqueSuite>::deserialize(&reg_req_bytes).unwrap();
        let server_reg_start =
            ServerRegistration::<DamHopperOpaqueSuite>::start(&server_setup, server_reg_req, identifier)
                .unwrap();
        let reg_upload_bytes =
            client_register_finish(client_reg, correct_password, &server_reg_start.message.serialize()).unwrap();
        let stored_credential =
            ServerRegistration::finish(RegistrationUpload::deserialize(&reg_upload_bytes).unwrap());

        // Attempt login with wrong password
        let (client_login, login_req_bytes) = client_login_start(wrong_password).unwrap();
        let server_login_req =
            CredentialRequest::<DamHopperOpaqueSuite>::deserialize(&login_req_bytes).unwrap();
        let server_login_start = ServerLogin::<DamHopperOpaqueSuite>::start(
            &mut rng,
            &server_setup,
            Some(stored_credential),
            server_login_req,
            identifier,
            ServerLoginParameters::default(),
        )
        .unwrap();

        // Client finish with wrong password must either fail or produce a finalization the server rejects
        let finish_res =
            client_login_finish(client_login, wrong_password, &server_login_start.message.serialize());

        if let Ok((finalization_bytes, _)) = finish_res {
            let server_finalization =
                CredentialFinalization::<DamHopperOpaqueSuite>::deserialize(&finalization_bytes).unwrap();
            let server_finish_res = server_login_start
                .state
                .finish(server_finalization, ServerLoginParameters::default());
            assert!(
                server_finish_res.is_err(),
                "Server accepted login with wrong password!"
            );
        }
    }

    #[test]
    fn test_malformed_message_handling() {
        let malformed = vec![0xde, 0xad, 0xbe, 0xef];
        let (client_reg, _) = client_register_start(b"pw").unwrap();
        let res = client_register_finish(client_reg, b"pw", &malformed);
        assert!(res.is_err(), "Malformed registration response should fail");

        let (client_login, _) = client_login_start(b"pw").unwrap();
        let res = client_login_finish(client_login, b"pw", &malformed);
        assert!(res.is_err(), "Malformed credential response should fail");
    }

    #[test]
    fn test_ciphertext_tamper_rejection() {
        let session_key = [42u8; 32];
        let aes_key = derive_aes_key(&session_key).unwrap();

        let cipher = Aes256Gcm::new_from_slice(&*aes_key).unwrap();
        let nonce = Nonce::from_slice(b"123456789012");
        let plaintext = b"Unmodified file content";

        let mut ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();
        // Tamper with the ciphertext byte
        let last_idx = ciphertext.len() - 1;
        ciphertext[last_idx] ^= 0x01;

        let decrypt_res = cipher.decrypt(nonce, ciphertext.as_ref());
        assert!(
            decrypt_res.is_err(),
            "Decryption of tampered ciphertext MUST fail in AES-256-GCM!"
        );
    }

    #[test]
    fn test_handle_store_lifecycle_and_double_close() {
        let store = StateStore::<i64>::new(2);
        let h1 = store.insert(100).unwrap();
        let h2 = store.insert(200).unwrap();

        // Exceed capacity
        let h3_res = store.insert(300);
        assert!(h3_res.is_err(), "Should enforce store capacity limit");

        // Remove h1
        assert_eq!(store.remove(h1).unwrap(), 100);
        // Double close / removal should fail
        assert!(store.remove(h1).is_err(), "Double removal must fail");

        // Now capacity allows one insertion
        let h4 = store.insert(400).unwrap();
        assert!(store.contains(h4));
        assert_eq!(store.remove(h2).unwrap(), 200);
        assert_eq!(store.remove(h4).unwrap(), 400);
    }

    #[test]
    fn test_envelope_roundtrip_and_tamper_rejection() {
        let aes_key = [77u8; 32];
        let meta_json = r#"{"name":"test-file.txt","size":18,"type":"text/plain"}"#;
        let content = b"Secret payload 123";

        let envelope = encrypt_envelope(&aes_key, meta_json, content).unwrap();
        assert!(envelope.len() >= IV_LEN + TAG_LEN + meta_json.len() + 1 + content.len());

        // Successful roundtrip
        let (dec_meta, dec_content) = decrypt_envelope(&aes_key, &envelope).unwrap();
        assert_eq!(dec_meta, meta_json);
        assert_eq!(dec_content, content);

        // Tamper with envelope ciphertext
        let mut tampered = envelope.clone();
        let last_idx = tampered.len() - 1;
        tampered[last_idx] ^= 0x42;
        assert!(decrypt_envelope(&aes_key, &tampered).is_err());

        // Wrong key
        let wrong_key = [99u8; 32];
        assert!(decrypt_envelope(&wrong_key, &envelope).is_err());

        // Truncated envelope
        let truncated = &envelope[..20];
        assert!(decrypt_envelope(&aes_key, truncated).is_err());
    }

    #[test]
    fn test_envelope_metadata_max_and_separator_enforcement() {
        let aes_key = [88u8; 32];
        let content = b"Sample content";

        // Plaintext without 0x00 separator
        let cipher = Aes256Gcm::new_from_slice(&aes_key).unwrap();
        let nonce = Nonce::from_slice(b"123456789012");
        let invalid_plain = b"NoSeparatorHereAtAll";
        let ct = cipher.encrypt(nonce, invalid_plain.as_ref()).unwrap();
        let mut bad_env = Vec::new();
        bad_env.extend_from_slice(b"123456789012");
        bad_env.extend_from_slice(&ct);
        assert!(decrypt_envelope(&aes_key, &bad_env).is_err());

        // Huge metadata (> 4096 bytes)
        let huge_meta = "x".repeat(5000);
        let mut plain_huge = Vec::new();
        plain_huge.extend_from_slice(huge_meta.as_bytes());
        plain_huge.push(0x00);
        plain_huge.extend_from_slice(content);
        let ct_huge = cipher.encrypt(nonce, plain_huge.as_slice()).unwrap();
        let mut env_huge = Vec::new();
        env_huge.extend_from_slice(b"123456789012");
        env_huge.extend_from_slice(&ct_huge);
        assert!(decrypt_envelope(&aes_key, &env_huge).is_err());
    }
}
