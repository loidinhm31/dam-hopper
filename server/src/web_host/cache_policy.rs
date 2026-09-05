//! Cache-Control header classification for the static web host.

use axum::http::HeaderValue;

pub const CACHE_NO_STORE: &str = "no-store";
pub const CACHE_NO_CACHE: &str = "no-cache";
pub const CACHE_IMMUTABLE_HASHED: &str = "public,max-age=31536000,immutable";
pub const CACHE_BOUNDED_ONE_HOUR: &str = "public,max-age=3600";

/// Returns the deterministic `Cache-Control` header string for a given resource path.
pub fn cache_control_for_path(path: &str) -> &'static str {
    let clean = path.trim_start_matches('/');

    if clean == "__dam-hopper/health" || clean == "__dam-hopper/runtime-config.json" {
        return CACHE_NO_STORE;
    }

    if clean.is_empty() || clean == "index.html" {
        return CACHE_NO_CACHE;
    }

    if is_hashed_asset(clean) {
        CACHE_IMMUTABLE_HASHED
    } else {
        CACHE_BOUNDED_ONE_HOUR
    }
}

/// Returns a pre-parsed HeaderValue for Cache-Control.
pub fn cache_control_header_value(path: &str) -> HeaderValue {
    HeaderValue::from_static(cache_control_for_path(path))
}

/// Determines whether a path represents a content-hashed immutable asset.
///
/// Matches Vite release assets in `assets/` or files containing a content hash segment
/// before their final extension (e.g. `index-D8xK2l1P.js`, `vendor.a1b2c3d4.css`).
pub fn is_hashed_asset(path: &str) -> bool {
    let clean = path.trim_start_matches('/');

    // Vite standard asset directory output
    if clean.starts_with("assets/") {
        let filename = clean.strip_prefix("assets/").unwrap_or(clean);
        if has_content_hash(filename) {
            return true;
        }
    }

    // General hashed asset filename
    let filename = clean.rsplit('/').next().unwrap_or(clean);
    has_content_hash(filename)
}

/// Checks if a filename has a hash suffix (e.g., `-C8K1x9aB` or `.a1b2c3d4`) before the extension.
fn has_content_hash(filename: &str) -> bool {
    let Some((stem, ext)) = filename.rsplit_once('.') else {
        return false;
    };

    if ext.is_empty() {
        return false;
    }

    // Pattern 1: Vite dash-hash, e.g. "index-D8xK2l1P"
    if let Some((_, hash_part)) = stem.rsplit_once('-') {
        if is_valid_hash_segment(hash_part) {
            return true;
        }
    }

    // Pattern 2: Dot-hash, e.g. "vendor.a1b2c3d4"
    if let Some((_, hash_part)) = stem.rsplit_once('.') {
        if is_valid_hash_segment(hash_part) {
            return true;
        }
    }

    false
}

fn is_valid_hash_segment(segment: &str) -> bool {
    // Vite and bundler hashes are at least 8 alphanumeric / base64url characters
    segment.len() >= 8 && segment.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_and_runtime_config_no_store() {
        assert_eq!(cache_control_for_path("/__dam-hopper/health"), CACHE_NO_STORE);
        assert_eq!(
            cache_control_for_path("__dam-hopper/runtime-config.json"),
            CACHE_NO_STORE
        );
    }

    #[test]
    fn test_index_html_no_cache() {
        assert_eq!(cache_control_for_path("/"), CACHE_NO_CACHE);
        assert_eq!(cache_control_for_path(""), CACHE_NO_CACHE);
        assert_eq!(cache_control_for_path("/index.html"), CACHE_NO_CACHE);
        assert_eq!(cache_control_for_path("index.html"), CACHE_NO_CACHE);
    }

    #[test]
    fn test_hashed_assets_immutable() {
        assert_eq!(
            cache_control_for_path("assets/index-D8xK2l1P.js"),
            CACHE_IMMUTABLE_HASHED
        );
        assert_eq!(
            cache_control_for_path("/assets/style-C9x0Ab12.css"),
            CACHE_IMMUTABLE_HASHED
        );
        assert_eq!(
            cache_control_for_path("/assets/font.a1b2c3d4e5f6.woff2"),
            CACHE_IMMUTABLE_HASHED
        );
    }

    #[test]
    fn test_other_assets_bounded() {
        assert_eq!(cache_control_for_path("/favicon.ico"), CACHE_BOUNDED_ONE_HOUR);
        assert_eq!(cache_control_for_path("manifest.json"), CACHE_BOUNDED_ONE_HOUR);
        assert_eq!(cache_control_for_path("logo.svg"), CACHE_BOUNDED_ONE_HOUR);
        assert_eq!(
            cache_control_for_path("assets/raw-image.png"),
            CACHE_BOUNDED_ONE_HOUR
        );
    }
}
