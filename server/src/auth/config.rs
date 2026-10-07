//! Environment-selected authentication backend.
//!
//! `DAM_HOPPER_LITE_MODE` alone selects the backend; `DAM_HOPPER_AUTH_SQLITE_PATH`
//! only locates the SQLite file once lite mode is on. There is no CLI/TOML
//! setting, no auto-detection and no fallback between backends: an
//! unrecognised selector or an unusable path is a startup error.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use thiserror::Error;

/// Environment variable selecting SQLite (lite) authentication.
pub const LITE_MODE_ENV: &str = "DAM_HOPPER_LITE_MODE";
/// Environment variable locating the SQLite authentication database.
pub const SQLITE_PATH_ENV: &str = "DAM_HOPPER_AUTH_SQLITE_PATH";
/// File name used under the global DamHopper config directory by default.
pub const DEFAULT_SQLITE_FILE: &str = "auth.db";

/// Backend chosen at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthBackendConfig {
    /// Existing default: MongoDB from `MONGODB_URI` / `MONGODB_DATABASE`.
    Mongo,
    /// Lite mode: SQLite file at an absolute, startup-resolved path.
    Sqlite { path: PathBuf },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuthConfigError {
    #[error("{LITE_MODE_ENV} must be one of true, false, 1, 0 (or unset/empty); got an unrecognised value")]
    InvalidLiteMode,
    #[error("{SQLITE_PATH_ENV} is not valid UTF-8")]
    NonUnicodePath,
    #[error("{SQLITE_PATH_ENV} {0}")]
    UnsupportedPath(&'static str),
    #[error("authentication database must differ from the {0} database")]
    PathCollision(&'static str),
    #[error("cannot resolve {SQLITE_PATH_ENV}: {0}")]
    Unresolvable(String),
}

/// Process facts needed to resolve a path, injected so resolution is pure.
pub struct PathContext<'a> {
    pub home: Option<&'a Path>,
    pub cwd: &'a Path,
    pub config_dir: &'a Path,
}

impl AuthBackendConfig {
    /// Read the selector and path from the process environment.
    ///
    /// Call after every `.env` file has been loaded and before any auth
    /// service is constructed. Relative paths resolve against the process CWD.
    pub fn from_env() -> Result<Self, AuthConfigError> {
        let cwd = std::env::current_dir()
            .map_err(|error| AuthConfigError::Unresolvable(error.to_string()))?;
        let home = dirs::home_dir();
        let config_dir = crate::config::dam_hopper_config_dir();
        Self::resolve(
            std::env::var_os(LITE_MODE_ENV).as_deref(),
            std::env::var_os(SQLITE_PATH_ENV).as_deref(),
            &PathContext {
                home: home.as_deref(),
                cwd: &cwd,
                config_dir: &config_dir,
            },
        )
    }

    /// Pure selection/path resolution; see the module docs for the contract.
    pub fn resolve(
        lite_mode: Option<&OsStr>,
        sqlite_path: Option<&OsStr>,
        context: &PathContext<'_>,
    ) -> Result<Self, AuthConfigError> {
        if !parse_lite_mode(lite_mode)? {
            return Ok(Self::Mongo);
        }
        let path = resolve_sqlite_path(sqlite_path, context)?;
        Ok(Self::Sqlite { path })
    }

    /// Reject an auth database that is the same file as another SQLite
    /// database this process owns (session or telemetry), so no subsystem
    /// ever opens another's file. Mongo selects no file and always passes.
    pub fn ensure_distinct_from(
        &self,
        others: &[(&'static str, &Path)],
    ) -> Result<(), AuthConfigError> {
        let Self::Sqlite { path } = self else {
            return Ok(());
        };
        for (label, other) in others {
            if crate::telemetry::runtime::ensure_distinct_database_paths(path, other).is_err() {
                return Err(AuthConfigError::PathCollision(label));
            }
        }
        Ok(())
    }
}

fn parse_lite_mode(value: Option<&OsStr>) -> Result<bool, AuthConfigError> {
    let Some(raw) = value else {
        return Ok(false);
    };
    let text = raw.to_str().ok_or(AuthConfigError::InvalidLiteMode)?.trim();
    match text.to_ascii_lowercase().as_str() {
        "" | "false" | "0" => Ok(false),
        "true" | "1" => Ok(true),
        _ => Err(AuthConfigError::InvalidLiteMode),
    }
}

fn resolve_sqlite_path(
    value: Option<&OsStr>,
    context: &PathContext<'_>,
) -> Result<PathBuf, AuthConfigError> {
    let text = match value {
        None => "",
        Some(raw) => raw.to_str().ok_or(AuthConfigError::NonUnicodePath)?.trim(),
    };
    if text.is_empty() {
        let default_dir = context.config_dir;
        let default_path =
            if let Some(suffix) = default_dir.to_str().and_then(|s| s.strip_prefix("~/")) {
                let home = context.home.ok_or_else(|| {
                    AuthConfigError::Unresolvable("home directory is unavailable for '~/'".into())
                })?;
                home.join(suffix).join(DEFAULT_SQLITE_FILE)
            } else if default_dir.is_absolute() {
                default_dir.join(DEFAULT_SQLITE_FILE)
            } else {
                context.cwd.join(default_dir).join(DEFAULT_SQLITE_FILE)
            };
        return Ok(default_path);
    }
    if text.contains('\0') {
        return Err(AuthConfigError::UnsupportedPath("contains a NUL byte"));
    }
    // SQLite treats these as special databases or URIs, not deployment files.
    if text == ":memory:" || text.starts_with("file:") {
        return Err(AuthConfigError::UnsupportedPath(
            "must be a file path, not an in-memory database or URI",
        ));
    }
    if let Some(suffix) = text.strip_prefix("~/") {
        let home = context.home.ok_or_else(|| {
            AuthConfigError::Unresolvable("home directory is unavailable for '~/'".into())
        })?;
        return Ok(home.join(suffix));
    }
    if text.starts_with('~') {
        return Err(AuthConfigError::UnsupportedPath(
            "supports only '~/' home expansion, not '~' or '~user'",
        ));
    }
    let path = Path::new(text);
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        context.cwd.join(path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(home: Option<&'a Path>, cwd: &'a Path, config: &'a Path) -> PathContext<'a> {
        PathContext {
            home,
            cwd,
            config_dir: config,
        }
    }

    fn resolve(
        lite: Option<&str>,
        path: Option<&str>,
    ) -> Result<AuthBackendConfig, AuthConfigError> {
        let (home, cwd, config) = (
            Path::new("/home/u"),
            Path::new("/work/dir"),
            Path::new("/home/u/.config/dam-hopper"),
        );
        AuthBackendConfig::resolve(
            lite.map(OsStr::new),
            path.map(OsStr::new),
            &ctx(Some(home), cwd, config),
        )
    }

    fn sqlite(path: &str) -> AuthBackendConfig {
        AuthBackendConfig::Sqlite {
            path: PathBuf::from(path),
        }
    }

    #[test]
    fn absent_empty_false_zero_select_mongo_even_with_a_path() {
        for lite in [
            None,
            Some(""),
            Some("  \t"),
            Some("false"),
            Some("FALSE"),
            Some(" 0 "),
        ] {
            assert_eq!(
                resolve(lite, Some("/data/auth.db")),
                Ok(AuthBackendConfig::Mongo),
                "selector {lite:?}"
            );
        }
    }

    #[test]
    fn true_and_one_select_sqlite_case_and_space_insensitively() {
        for lite in ["true", "TRUE", " True ", "1"] {
            assert_eq!(
                resolve(Some(lite), Some("/data/auth.db")),
                Ok(sqlite("/data/auth.db")),
                "selector {lite:?}"
            );
        }
    }

    #[test]
    fn any_other_selector_is_an_error_never_a_default() {
        for lite in ["yes", "on", "2", "enabled", "t"] {
            assert_eq!(
                resolve(Some(lite), None),
                Err(AuthConfigError::InvalidLiteMode),
                "{lite}"
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let bad = OsStr::from_bytes(&[0x66, 0xff]);
            let context = ctx(None, Path::new("/"), Path::new("/c"));
            assert_eq!(
                AuthBackendConfig::resolve(Some(bad), None, &context),
                Err(AuthConfigError::InvalidLiteMode)
            );
        }
    }

    #[test]
    fn missing_or_blank_path_defaults_to_auth_db_in_global_config_dir() {
        for path in [None, Some(""), Some("   ")] {
            assert_eq!(
                resolve(Some("true"), path),
                Ok(sqlite("/home/u/.config/dam-hopper/auth.db"))
            );
        }
    }

    #[test]
    fn relative_and_tilde_config_dir_defaults_resolve_to_absolute_paths() {
        let home = Path::new("/home/u");
        let cwd = Path::new("/work/dir");
        // Relative config dir (e.g. from relative XDG_CONFIG_HOME) resolves against CWD
        let rel_ctx = ctx(Some(home), cwd, Path::new("custom/config"));
        assert_eq!(
            AuthBackendConfig::resolve(Some(OsStr::new("true")), None, &rel_ctx),
            Ok(sqlite("/work/dir/custom/config/auth.db"))
        );
        // Tilde-prefixed config dir resolves against HOME
        let tilde_ctx = ctx(Some(home), cwd, Path::new("~/custom/config"));
        assert_eq!(
            AuthBackendConfig::resolve(Some(OsStr::new("true")), None, &tilde_ctx),
            Ok(sqlite("/home/u/custom/config/auth.db"))
        );
    }

    #[test]
    fn path_forms_resolve_once_at_startup() {
        assert_eq!(
            resolve(Some("1"), Some("/abs/a.db")),
            Ok(sqlite("/abs/a.db"))
        );
        assert_eq!(
            resolve(Some("1"), Some("~/priv/a.db")),
            Ok(sqlite("/home/u/priv/a.db"))
        );
        assert_eq!(
            resolve(Some("1"), Some("rel/a.db")),
            Ok(sqlite("/work/dir/rel/a.db"))
        );
    }

    #[test]
    fn unsupported_paths_are_rejected() {
        for path in [
            "~",
            "~root/a.db",
            ":memory:",
            "file:a.db?mode=memory",
            "a\0b",
        ] {
            assert!(
                matches!(
                    resolve(Some("1"), Some(path)),
                    Err(AuthConfigError::UnsupportedPath(_))
                ),
                "{path:?}"
            );
        }
        let context = ctx(None, Path::new("/"), Path::new("/c"));
        assert!(matches!(
            AuthBackendConfig::resolve(Some(OsStr::new("1")), Some(OsStr::new("~/a.db")), &context),
            Err(AuthConfigError::Unresolvable(_))
        ));
    }

    #[test]
    fn invalid_path_is_ignored_when_lite_mode_is_off() {
        assert_eq!(
            resolve(Some("false"), Some(":memory:")),
            Ok(AuthBackendConfig::Mongo)
        );
        assert_eq!(resolve(None, Some("~root/x")), Ok(AuthBackendConfig::Mongo));
    }

    #[test]
    fn auth_database_must_not_alias_another_subsystem_database() {
        let dir = tempfile::tempdir().unwrap();
        let session = dir.path().join("sessions.db");
        let telemetry = dir.path().join("telemetry.db");
        std::fs::write(&session, []).unwrap();
        let others = [
            ("session", session.as_path()),
            ("telemetry", telemetry.as_path()),
        ];

        let distinct = AuthBackendConfig::Sqlite {
            path: dir.path().join("auth.db"),
        };
        assert_eq!(distinct.ensure_distinct_from(&others), Ok(()));

        let same = AuthBackendConfig::Sqlite {
            path: session.clone(),
        };
        assert_eq!(
            same.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("session"))
        );

        let alias = dir.path().join("alias.db");
        std::fs::hard_link(&session, &alias).unwrap();
        let hard = AuthBackendConfig::Sqlite { path: alias };
        assert_eq!(
            hard.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("session"))
        );

        let tel = AuthBackendConfig::Sqlite {
            path: telemetry.clone(),
        };
        assert_eq!(
            tel.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("telemetry"))
        );

        assert_eq!(
            AuthBackendConfig::Mongo.ensure_distinct_from(&others),
            Ok(())
        );
    }
}
