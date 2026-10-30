//! Environment-selected authentication backend.
//!
//! DamHopper supports two authenticated backends within the same compiled binary:
//!
//! - **SQLite**: Default for unconfigured startup (when both `MONGODB_URI` and
//!   `MONGODB_DATABASE` are unset), or explicitly forced via
//!   `DAM_HOPPER_LITE_MODE=true` (or `1`). Database location defaults to `auth.db`
//!   under the global DamHopper configuration directory, overridable via
//!   `DAM_HOPPER_AUTH_SQLITE_PATH`.
//! - **MongoDB**: Selected automatically when both `MONGODB_URI` and
//!   `MONGODB_DATABASE` are set and non-blank, or explicitly enforced with
//!   `DAM_HOPPER_LITE_MODE=false` (or `0`).
//!
//! Partial, empty, or whitespace-only MongoDB variables are treated as malformed
//! configuration errors and abort startup. There is no runtime fallback from
//! an unreachable MongoDB server to SQLite.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use thiserror::Error;

/// Environment variable selecting SQLite (lite) authentication.
pub const LITE_MODE_ENV: &str = "DAM_HOPPER_LITE_MODE";
/// Environment variable locating the SQLite authentication database.
pub const SQLITE_PATH_ENV: &str = "DAM_HOPPER_AUTH_SQLITE_PATH";
/// Environment variable for MongoDB connection URI.
pub const MONGODB_URI_ENV: &str = "MONGODB_URI";
/// Environment variable for MongoDB database name.
pub const MONGODB_DATABASE_ENV: &str = "MONGODB_DATABASE";
/// File name used under the global DamHopper config directory by default.
pub const DEFAULT_SQLITE_FILE: &str = "auth.db";

/// Backend chosen at startup.
#[derive(Clone, PartialEq, Eq)]
pub enum AuthBackendConfig {
    /// MongoDB from validated connection URI and database name.
    Mongo { uri: String, database: String },
    /// SQLite file at an absolute, startup-resolved path.
    /// `explicit` is true when forced via `DAM_HOPPER_LITE_MODE=true/1`,
    /// or false when automatically selected as the default unconfigured store.
    Sqlite { path: PathBuf, explicit: bool },
}

impl std::fmt::Debug for AuthBackendConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Mongo { database, .. } => f
                .debug_struct("Mongo")
                .field("uri", &"[REDACTED]")
                .field("database", database)
                .finish(),
            Self::Sqlite { path, explicit } => f
                .debug_struct("Sqlite")
                .field("path", path)
                .field("explicit", explicit)
                .finish(),
        }
    }
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
    #[error("{0} is not valid UTF-8")]
    NonUnicodeMongoConfig(&'static str),
    #[error(
        "{0} is set but empty or whitespace-only; provide a non-blank value or unset it completely"
    )]
    MalformedMongoConfig(&'static str),
    #[error("both {MONGODB_URI_ENV} and {MONGODB_DATABASE_ENV} must be configured for MongoDB, or both genuinely unset for default SQLite (missing {0})")]
    IncompleteMongoConfig(&'static str),
    #[error("{LITE_MODE_ENV} was set to false/0 to enforce MongoDB, but MongoDB configuration is missing: set {MONGODB_URI_ENV} and {MONGODB_DATABASE_ENV}, or unset {LITE_MODE_ENV} for default SQLite")]
    EnforcedMongoMissing,
}

/// Process facts needed to resolve a path, injected so resolution is pure.
pub struct PathContext<'a> {
    pub home: Option<&'a Path>,
    pub cwd: &'a Path,
    pub config_dir: &'a Path,
}

#[derive(Debug, PartialEq, Eq)]
enum MongoInput<'a> {
    Unset,
    Configured(&'a str),
    EmptyOrWhitespace,
    NonUnicode,
}

fn classify_mongo_input<'a>(value: Option<&'a OsStr>) -> MongoInput<'a> {
    let Some(raw) = value else {
        return MongoInput::Unset;
    };
    let Some(text) = raw.to_str() else {
        return MongoInput::NonUnicode;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        MongoInput::EmptyOrWhitespace
    } else {
        MongoInput::Configured(trimmed)
    }
}

impl AuthBackendConfig {
    /// Read selector, path, and MongoDB variables from the process environment.
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
            std::env::var_os(MONGODB_URI_ENV).as_deref(),
            std::env::var_os(MONGODB_DATABASE_ENV).as_deref(),
            &PathContext {
                home: home.as_deref(),
                cwd: &cwd,
                config_dir: &config_dir,
            },
        )
    }

    /// Pure selection and path resolution according to the Precedence Matrix.
    pub fn resolve(
        lite_mode: Option<&OsStr>,
        sqlite_path: Option<&OsStr>,
        mongodb_uri: Option<&OsStr>,
        mongodb_database: Option<&OsStr>,
        context: &PathContext<'_>,
    ) -> Result<Self, AuthConfigError> {
        let selector = parse_lite_mode(lite_mode)?;
        if selector == Some(true) {
            let path = resolve_sqlite_path(sqlite_path, context)?;
            return Ok(Self::Sqlite {
                path,
                explicit: true,
            });
        }

        let uri_state = classify_mongo_input(mongodb_uri);
        let db_state = classify_mongo_input(mongodb_database);

        // Non-Unicode check
        if uri_state == MongoInput::NonUnicode {
            return Err(AuthConfigError::NonUnicodeMongoConfig(MONGODB_URI_ENV));
        }
        if db_state == MongoInput::NonUnicode {
            return Err(AuthConfigError::NonUnicodeMongoConfig(MONGODB_DATABASE_ENV));
        }

        // Empty / whitespace check
        if uri_state == MongoInput::EmptyOrWhitespace {
            return Err(AuthConfigError::MalformedMongoConfig(MONGODB_URI_ENV));
        }
        if db_state == MongoInput::EmptyOrWhitespace {
            return Err(AuthConfigError::MalformedMongoConfig(MONGODB_DATABASE_ENV));
        }

        match (selector, uri_state, db_state) {
            (Some(false), MongoInput::Configured(uri), MongoInput::Configured(database)) => {
                Ok(Self::Mongo {
                    uri: uri.to_string(),
                    database: database.to_string(),
                })
            }
            (Some(false), _, _) => Err(AuthConfigError::EnforcedMongoMissing),
            (None, MongoInput::Configured(uri), MongoInput::Configured(database)) => {
                Ok(Self::Mongo {
                    uri: uri.to_string(),
                    database: database.to_string(),
                })
            }
            (None, MongoInput::Unset, MongoInput::Unset) => {
                let path = resolve_sqlite_path(sqlite_path, context)?;
                Ok(Self::Sqlite {
                    path,
                    explicit: false,
                })
            }
            (None, MongoInput::Configured(_), MongoInput::Unset) => {
                Err(AuthConfigError::IncompleteMongoConfig(MONGODB_DATABASE_ENV))
            }
            (None, MongoInput::Unset, MongoInput::Configured(_)) => {
                Err(AuthConfigError::IncompleteMongoConfig(MONGODB_URI_ENV))
            }
            _ => unreachable!(),
        }
    }

    /// Reject an auth database that is the same file as another SQLite
    /// database this process owns (session or telemetry), so no subsystem
    /// ever opens another's file. Mongo selects no file and always passes.
    pub fn ensure_distinct_from(
        &self,
        others: &[(&'static str, &Path)],
    ) -> Result<(), AuthConfigError> {
        let Self::Sqlite { path, .. } = self else {
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

fn parse_lite_mode(value: Option<&OsStr>) -> Result<Option<bool>, AuthConfigError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let Some(text) = raw.to_str() else {
        return Err(AuthConfigError::InvalidLiteMode);
    };
    let trimmed = text.trim();
    match trimmed.to_ascii_lowercase().as_str() {
        "" => Ok(None),
        "false" | "0" => Ok(Some(false)),
        "true" | "1" => Ok(Some(true)),
        _ => Err(AuthConfigError::InvalidLiteMode),
    }
}

pub fn resolve_sqlite_path(
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
pub(crate) mod tests {
    use super::*;

    fn ctx<'a>(home: Option<&'a Path>, cwd: &'a Path, config: &'a Path) -> PathContext<'a> {
        PathContext {
            home,
            cwd,
            config_dir: config,
        }
    }

    fn resolve_full(
        lite: Option<&str>,
        path: Option<&str>,
        uri: Option<&str>,
        db: Option<&str>,
    ) -> Result<AuthBackendConfig, AuthConfigError> {
        let (home, cwd, config) = (
            Path::new("/home/u"),
            Path::new("/work/dir"),
            Path::new("/home/u/.config/dam-hopper"),
        );
        AuthBackendConfig::resolve(
            lite.map(OsStr::new),
            path.map(OsStr::new),
            uri.map(OsStr::new),
            db.map(OsStr::new),
            &ctx(Some(home), cwd, config),
        )
    }

    fn default_sqlite(path: &str) -> AuthBackendConfig {
        AuthBackendConfig::Sqlite {
            path: PathBuf::from(path),
            explicit: false,
        }
    }

    fn explicit_sqlite(path: &str) -> AuthBackendConfig {
        AuthBackendConfig::Sqlite {
            path: PathBuf::from(path),
            explicit: true,
        }
    }

    #[test]
    fn unconfigured_defaults_to_sqlite() {
        for lite in [None, Some(""), Some("   \t")] {
            assert_eq!(
                resolve_full(lite, None, None, None),
                Ok(default_sqlite("/home/u/.config/dam-hopper/auth.db")),
                "selector {lite:?}"
            );
            assert_eq!(
                resolve_full(lite, Some("/custom/auth.db"), None, None),
                Ok(default_sqlite("/custom/auth.db")),
                "selector {lite:?} with custom path"
            );
        }
    }

    #[test]
    fn valid_mongo_vars_auto_select_mongo_when_selector_unset() {
        for lite in [None, Some(""), Some("  \t")] {
            assert_eq!(
                resolve_full(
                    lite,
                    Some("/ignored/auth.db"),
                    Some("mongodb://127.0.0.1:27017"),
                    Some("damHopper")
                ),
                Ok(AuthBackendConfig::Mongo {
                    uri: "mongodb://127.0.0.1:27017".into(),
                    database: "damHopper".into(),
                }),
                "selector {lite:?}"
            );
        }
    }

    #[test]
    fn explicit_true_selects_sqlite_and_ignores_mongo_vars() {
        for lite in ["true", "TRUE", " True ", "1"] {
            // Unset Mongo
            assert_eq!(
                resolve_full(Some(lite), Some("/data/auth.db"), None, None),
                Ok(explicit_sqlite("/data/auth.db")),
                "selector {lite:?}"
            );
            // Even with valid Mongo vars, explicit true selects SQLite
            assert_eq!(
                resolve_full(
                    Some(lite),
                    Some("/data/auth.db"),
                    Some("mongodb://localhost"),
                    Some("test")
                ),
                Ok(explicit_sqlite("/data/auth.db")),
                "selector {lite:?}"
            );
            // Even with malformed or blank Mongo vars, explicit true selects SQLite
            assert_eq!(
                resolve_full(Some(lite), Some("/data/auth.db"), Some(""), Some("   ")),
                Ok(explicit_sqlite("/data/auth.db")),
                "selector {lite:?}"
            );
        }
    }

    #[test]
    fn explicit_false_enforces_mongo() {
        for lite in ["false", "FALSE", " 0 "] {
            // Valid Mongo succeeds
            assert_eq!(
                resolve_full(
                    Some(lite),
                    None,
                    Some("mongodb://127.0.0.1"),
                    Some("prodDb")
                ),
                Ok(AuthBackendConfig::Mongo {
                    uri: "mongodb://127.0.0.1".into(),
                    database: "prodDb".into(),
                }),
                "selector {lite:?}"
            );
            // Missing Mongo vars fails with EnforcedMongoMissing
            assert_eq!(
                resolve_full(Some(lite), None, None, None),
                Err(AuthConfigError::EnforcedMongoMissing),
                "selector {lite:?}"
            );
            assert_eq!(
                resolve_full(Some(lite), None, Some("mongodb://127.0.0.1"), None),
                Err(AuthConfigError::EnforcedMongoMissing),
                "selector {lite:?}"
            );
        }
    }

    #[test]
    fn partial_mongo_when_unconfigured_selector_is_an_error() {
        assert_eq!(
            resolve_full(None, None, Some("mongodb://localhost"), None),
            Err(AuthConfigError::IncompleteMongoConfig(MONGODB_DATABASE_ENV))
        );
        assert_eq!(
            resolve_full(None, None, None, Some("damHopper")),
            Err(AuthConfigError::IncompleteMongoConfig(MONGODB_URI_ENV))
        );
    }

    #[test]
    fn empty_or_whitespace_mongo_is_malformed_error() {
        assert_eq!(
            resolve_full(None, None, Some(""), Some("db")),
            Err(AuthConfigError::MalformedMongoConfig(MONGODB_URI_ENV))
        );
        assert_eq!(
            resolve_full(None, None, Some("  \t"), Some("db")),
            Err(AuthConfigError::MalformedMongoConfig(MONGODB_URI_ENV))
        );
        assert_eq!(
            resolve_full(None, None, Some("mongodb://localhost"), Some("")),
            Err(AuthConfigError::MalformedMongoConfig(MONGODB_DATABASE_ENV))
        );
        assert_eq!(
            resolve_full(None, None, Some(""), None),
            Err(AuthConfigError::MalformedMongoConfig(MONGODB_URI_ENV))
        );
    }

    #[test]
    fn any_invalid_selector_is_an_error() {
        for lite in ["yes", "on", "2", "enabled", "t"] {
            assert_eq!(
                resolve_full(Some(lite), None, None, None),
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
                AuthBackendConfig::resolve(Some(bad), None, None, None, &context),
                Err(AuthConfigError::InvalidLiteMode)
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_unicode_mongo_inputs_are_rejected() {
        use std::os::unix::ffi::OsStrExt;
        let bad = OsStr::from_bytes(&[0x66, 0xff]);
        let context = ctx(None, Path::new("/"), Path::new("/c"));
        assert_eq!(
            AuthBackendConfig::resolve(None, None, Some(bad), Some(OsStr::new("db")), &context),
            Err(AuthConfigError::NonUnicodeMongoConfig(MONGODB_URI_ENV))
        );
        assert_eq!(
            AuthBackendConfig::resolve(None, None, Some(OsStr::new("uri")), Some(bad), &context),
            Err(AuthConfigError::NonUnicodeMongoConfig(MONGODB_DATABASE_ENV))
        );
        // Explicit true still ignores non-Unicode Mongo
        assert!(matches!(
            AuthBackendConfig::resolve(
                Some(OsStr::new("true")),
                None,
                Some(bad),
                Some(bad),
                &context
            ),
            Ok(AuthBackendConfig::Sqlite { explicit: true, .. })
        ));
    }

    #[test]
    fn debug_output_redacts_credentials() {
        let config = AuthBackendConfig::Mongo {
            uri: "mongodb://user:supersecretpass@localhost:27017".into(),
            database: "prodDb".into(),
        };
        let debug_str = format!("{config:?}");
        assert!(!debug_str.contains("supersecretpass"));
        assert!(!debug_str.contains("user"));
        assert!(debug_str.contains("[REDACTED]"));
        assert!(debug_str.contains("prodDb"));
    }

    #[test]
    fn missing_or_blank_path_defaults_to_auth_db_in_global_config_dir() {
        for path in [None, Some(""), Some("   ")] {
            assert_eq!(
                resolve_full(Some("true"), path, None, None),
                Ok(explicit_sqlite("/home/u/.config/dam-hopper/auth.db"))
            );
        }
    }

    #[test]
    fn relative_and_tilde_config_dir_defaults_resolve_to_absolute_paths() {
        let home = Path::new("/home/u");
        let cwd = Path::new("/work/dir");
        let rel_ctx = ctx(Some(home), cwd, Path::new("custom/config"));
        assert_eq!(
            AuthBackendConfig::resolve(Some(OsStr::new("true")), None, None, None, &rel_ctx),
            Ok(explicit_sqlite("/work/dir/custom/config/auth.db"))
        );
        let tilde_ctx = ctx(Some(home), cwd, Path::new("~/custom/config"));
        assert_eq!(
            AuthBackendConfig::resolve(Some(OsStr::new("true")), None, None, None, &tilde_ctx),
            Ok(explicit_sqlite("/home/u/custom/config/auth.db"))
        );
    }

    #[test]
    fn path_forms_resolve_once_at_startup() {
        assert_eq!(
            resolve_full(Some("1"), Some("/abs/a.db"), None, None),
            Ok(explicit_sqlite("/abs/a.db"))
        );
        assert_eq!(
            resolve_full(Some("1"), Some("~/priv/a.db"), None, None),
            Ok(explicit_sqlite("/home/u/priv/a.db"))
        );
        assert_eq!(
            resolve_full(Some("1"), Some("rel/a.db"), None, None),
            Ok(explicit_sqlite("/work/dir/rel/a.db"))
        );
    }
    #[test]
    #[cfg(windows)]
    fn windows_path_conventions_and_config_dir_resolve_correctly() {
        let home = Path::new(r"C:\Users\operator");
        let cwd = Path::new(r"C:\work\dam-hopper");
        let win_config = Path::new(r"C:\Users\operator\.config\dam-hopper");
        let win_ctx = ctx(Some(home), cwd, win_config);

        // Default path under Windows config dir
        assert_eq!(
            AuthBackendConfig::resolve(Some(OsStr::new("true")), None, None, None, &win_ctx),
            Ok(explicit_sqlite(
                r"C:\Users\operator\.config\dam-hopper\auth.db"
            ))
        );

        // Explicit absolute Windows drive path
        assert_eq!(
            AuthBackendConfig::resolve(
                Some(OsStr::new("true")),
                Some(OsStr::new(r"D:\Data\custom_auth.db")),
                None,
                None,
                &win_ctx
            ),
            Ok(explicit_sqlite(r"D:\Data\custom_auth.db"))
        );

        // Windows relative path resolves against cwd
        assert_eq!(
            AuthBackendConfig::resolve(
                Some(OsStr::new("true")),
                Some(OsStr::new(r"data\auth.db")),
                None,
                None,
                &win_ctx
            ),
            Ok(explicit_sqlite(r"C:\work\dam-hopper\data\auth.db"))
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
                    resolve_full(Some("1"), Some(path), None, None),
                    Err(AuthConfigError::UnsupportedPath(_))
                ),
                "{path:?}"
            );
        }
        let context = ctx(None, Path::new("/"), Path::new("/c"));
        assert!(matches!(
            AuthBackendConfig::resolve(
                Some(OsStr::new("1")),
                Some(OsStr::new("~/a.db")),
                None,
                None,
                &context
            ),
            Err(AuthConfigError::Unresolvable(_))
        ));
    }

    #[test]
    fn invalid_path_is_ignored_when_mongo_is_selected() {
        assert_eq!(
            resolve_full(
                Some("false"),
                Some(":memory:"),
                Some("mongodb://localhost"),
                Some("db")
            ),
            Ok(AuthBackendConfig::Mongo {
                uri: "mongodb://localhost".into(),
                database: "db".into(),
            })
        );
        assert_eq!(
            resolve_full(
                None,
                Some("~root/x"),
                Some("mongodb://localhost"),
                Some("db")
            ),
            Ok(AuthBackendConfig::Mongo {
                uri: "mongodb://localhost".into(),
                database: "db".into(),
            })
        );
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
            explicit: false,
        };
        assert_eq!(distinct.ensure_distinct_from(&others), Ok(()));

        let same = AuthBackendConfig::Sqlite {
            path: session.clone(),
            explicit: true,
        };
        assert_eq!(
            same.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("session"))
        );

        let alias = dir.path().join("alias.db");
        std::fs::hard_link(&session, &alias).unwrap();
        let hard = AuthBackendConfig::Sqlite {
            path: alias,
            explicit: false,
        };
        assert_eq!(
            hard.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("session"))
        );

        let tel = AuthBackendConfig::Sqlite {
            path: telemetry.clone(),
            explicit: false,
        };
        assert_eq!(
            tel.ensure_distinct_from(&others),
            Err(AuthConfigError::PathCollision("telemetry"))
        );

        let mongo = AuthBackendConfig::Mongo {
            uri: "mongodb://localhost".into(),
            database: "db".into(),
        };
        assert_eq!(mongo.ensure_distinct_from(&others), Ok(()));
    }
}
