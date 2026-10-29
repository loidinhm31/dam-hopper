#!/usr/bin/env node
/**
 * Direct offline administrator account creation for DamHopper SQLite auth store.
 *
 * Usage:
 *   node scripts/create-admin.mjs [username] [password] [--db <path>]
 *   pnpm create-admin
 *
 * Prompts for credentials if omitted from arguments.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

export const APPLICATION_ID = 0x44484155; // "DHAU"
export const SUPPORTED_SCHEMA_VERSION = 2;
export const DEFAULT_SQLITE_FILE = "auth.db";

/**
 * Resolve the global DamHopper configuration directory according to the
 * canonical cross-platform contract (matching Rust dam_hopper_config_dir()).
 */
export function resolveConfigDir(env = process.env, home = homedir()) {
  let xdg;
  if (
    Object.prototype.hasOwnProperty.call(env, "XDG_CONFIG_HOME") &&
    env.XDG_CONFIG_HOME !== undefined
  ) {
    xdg = env.XDG_CONFIG_HOME;
  } else if (home) {
    xdg = join(home, ".config");
  } else {
    xdg = "~/.config";
  }
  return join(xdg, "dam-hopper");
}

/**
 * Pure path resolution matching Rust AuthBackendConfig::resolve_sqlite_path().
 */
export function resolveDbPath(
  rawPath,
  env = process.env,
  cwd = process.cwd(),
  home = homedir(),
) {
  const value = rawPath ?? env.DAM_HOPPER_AUTH_SQLITE_PATH;
  const text = typeof value === "string" ? value.trim() : "";

  if (text === "") {
    const defaultDir = resolveConfigDir(env, home);
    if (defaultDir.startsWith("~/")) {
      if (!home) {
        throw new Error("home directory is unavailable for '~/'");
      }
      return resolve(home, defaultDir.slice(2), DEFAULT_SQLITE_FILE);
    } else if (isAbsolute(defaultDir)) {
      return resolve(defaultDir, DEFAULT_SQLITE_FILE);
    } else {
      return resolve(cwd, defaultDir, DEFAULT_SQLITE_FILE);
    }
  }

  if (text.includes("\0")) {
    throw new Error("DAM_HOPPER_AUTH_SQLITE_PATH contains a NUL byte");
  }
  if (text === ":memory:" || text.startsWith("file:")) {
    throw new Error(
      "DAM_HOPPER_AUTH_SQLITE_PATH must be a file path, not an in-memory database or URI",
    );
  }
  if (text.startsWith("~/")) {
    if (!home) {
      throw new Error("home directory is unavailable for '~/'");
    }
    return resolve(home, text.slice(2));
  }
  if (text.startsWith("~")) {
    throw new Error(
      "DAM_HOPPER_AUTH_SQLITE_PATH supports only '~/' home expansion, not '~' or '~user'",
    );
  }
  if (isAbsolute(text)) {
    return resolve(text);
  }
  return resolve(cwd, text);
}

export function parseArgs(args = process.argv.slice(2)) {
  let username = null;
  let password = null;
  let rawDbPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" || args[i] === "-d") {
      rawDbPath = args[++i];
    } else if (args[i] === "--username" || args[i] === "-u") {
      username = args[++i];
    } else if (args[i] === "--password" || args[i] === "-p") {
      password = args[++i];
    } else if (!username && !args[i].startsWith("-")) {
      username = args[i];
    } else if (!password && !args[i].startsWith("-")) {
      password = args[i];
    }
  }

  return {
    username,
    password,
    rawDbPath,
  };
}

/**
 * No-echo terminal password prompt with complete lifecycle cleanup.
 */
export function promptPassword(promptText) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    let password = "";

    const wasRaw = Boolean(process.stdin.isRaw);
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdout.write(promptText);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function cleanup() {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("error", onError);
      process.stdin.removeListener("end", onEnd);
      if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(wasRaw);
      }
      process.stdin.pause();
    }

    function onSignal(sig) {
      cleanup();
      process.stdout.write("\n");
      process.exit(sig === "SIGINT" ? 130 : 143);
    }

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    function onError(err) {
      cleanup();
      process.stdout.write("\n");
      rejectPrompt(err);
    }

    function onEnd() {
      cleanup();
      process.stdout.write("\n");
      resolvePrompt(password);
    }

    function onData(chunk) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolvePrompt(password);
          return;
        } else if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        } else if (char === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolvePrompt(password);
          return;
        } else if (char === "\u0008" || char === "\x7f") {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else if (char >= " " && char !== "\x7f") {
          password += char;
        }
      }
    }

    process.stdin.on("data", onData);
    process.stdin.on("error", onError);
    process.stdin.on("end", onEnd);
  });
}

export async function getCredentials(providedUsername, providedPassword) {
  let username = providedUsername;
  let password = providedPassword;

  if (username && password) {
    if (Buffer.byteLength(password, "utf8") > 72) {
      console.error("Error: Password exceeds bcrypt limit of 72 bytes.");
      process.exit(1);
    }
    return { username, password };
  }

  if (!process.stdin.isTTY) {
    const lines = [];
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lines.push(line);
    }
    if (!username && lines.length > 0) {
      username = lines.shift().trim();
    }
    if (!password && lines.length > 0) {
      // Preserve password whitespace; only strip trailing newline
      password = lines.shift().replace(/\r?\n$/, "");
    }
    if (
      !username ||
      password === undefined ||
      password === null ||
      password === ""
    ) {
      console.error(
        "Error: When piping stdin, both username and password must be provided.",
      );
      process.exit(1);
    }
    if (Buffer.byteLength(password, "utf8") > 72) {
      console.error("Error: Password exceeds bcrypt limit of 72 bytes.");
      process.exit(1);
    }
    return { username, password };
  }

  const rl = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!username) {
      username = (await rl.question("Enter admin username: ")).trim();
    }
    if (!username) {
      console.error("Error: Username cannot be empty.");
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  if (!password) {
    password = await promptPassword("Enter admin password: ");
  }
  if (!password || password.length === 0) {
    console.error("Error: Password cannot be empty.");
    process.exit(1);
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    console.error("Error: Password exceeds bcrypt limit of 72 bytes.");
    process.exit(1);
  }

  const confirm = await promptPassword("Confirm admin password: ");
  if (password !== confirm) {
    console.error("Error: Passwords do not match.");
    process.exit(1);
  }

  return { username, password };
}

/**
 * Validate or securely create directory and database file permissions
 * BEFORE SQLite opens the file, matching Rust prepare_file & create_private_dir.
 */
export function prepareDirectoryAndFile(dbPath) {
  const parentDir = dirname(dbPath);

  // 1. Prepare & validate parent directory
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      chmodSync(parentDir, 0o700);
    }
  } else {
    const dirStat = lstatSync(parentDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(
        `Authentication database parent "${parentDir}" is not a directory`,
      );
    }
    if (process.platform !== "win32") {
      if ((dirStat.mode & 0o022) !== 0) {
        throw new Error(
          `Authentication database directory must not be writable by group or others: ${parentDir}`,
        );
      }
    }
  }

  // 2. Prepare & validate database file
  if (existsSync(dbPath)) {
    const fileStat = lstatSync(dbPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(
        `Authentication database path is not a regular file: ${dbPath}`,
      );
    }
    if (process.platform !== "win32") {
      if ((fileStat.mode & 0o077) !== 0) {
        throw new Error(
          `Authentication database must not be accessible to group or others (expected mode 0600): ${dbPath}`,
        );
      }
    }
  } else if (process.platform !== "win32") {
    // Atomically create file with 0600 mode prior to SQLite opening
    const fd = openSync(
      dbPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    closeSync(fd);
  }
}

/**
 * Validate database identity and execute schema migrations transactionally.
 */
export function ensureDatabaseInitialized(db, dbPath, repoRoot) {
  const versionRow = db.prepare("PRAGMA user_version").get();
  const currentVersion = versionRow ? Number(versionRow.user_version) : 0;

  const appIdRow = db.prepare("PRAGMA application_id").get();
  const currentAppId = appIdRow ? Number(appIdRow.application_id) : 0;

  const objectsRow = db
    .prepare(
      "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name NOT GLOB 'sqlite_*') AS has_objects",
    )
    .get();
  const hasObjects = Boolean(
    objectsRow &&
    (objectsRow.has_objects === 1 || objectsRow.has_objects === 1n),
  );

  if (currentVersion === 0 && currentAppId === 0 && !hasObjects) {
    const migration1 = join(
      repoRoot,
      "server",
      "src",
      "auth",
      "store",
      "migrations",
      "001-auth.sql",
    );
    if (!existsSync(migration1)) {
      throw new Error(`Cannot find schema migration at ${migration1}`);
    }
    const sql1 = readFileSync(migration1, "utf-8");

    const migration2 = join(
      repoRoot,
      "server",
      "src",
      "auth",
      "store",
      "migrations",
      "002-session-user-agent.sql",
    );
    if (!existsSync(migration2)) {
      throw new Error(`Cannot find schema migration at ${migration2}`);
    }
    const sql2 = readFileSync(migration2, "utf-8");

    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = FULL;");
    db.exec("PRAGMA foreign_keys = ON;");

    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql1);
      db.exec(sql2);
      db.exec(`PRAGMA application_id = ${APPLICATION_ID};`);
      db.exec(`PRAGMA user_version = ${SUPPORTED_SCHEMA_VERSION};`);
      db.exec("COMMIT;");
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // Rollback best-effort
      }
      throw err;
    }
  } else {
    if (currentAppId !== APPLICATION_ID || currentVersion < 1) {
      throw new Error(
        `File is not a DamHopper authentication database: ${dbPath}`,
      );
    }
    if (currentVersion > SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `Authentication database schema version ${currentVersion} is newer than supported version ${SUPPORTED_SCHEMA_VERSION}`,
      );
    }

    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = FULL;");
    db.exec("PRAGMA foreign_keys = ON;");

    if (currentVersion === 1) {
      const migration2 = join(
        repoRoot,
        "server",
        "src",
        "auth",
        "store",
        "migrations",
        "002-session-user-agent.sql",
      );
      if (!existsSync(migration2)) {
        throw new Error(`Cannot find schema migration at ${migration2}`);
      }
      const sql2 = readFileSync(migration2, "utf-8");
      db.exec("BEGIN IMMEDIATE;");
      try {
        db.exec(sql2);
        db.exec(`PRAGMA user_version = ${SUPPORTED_SCHEMA_VERSION};`);
        db.exec("COMMIT;");
      } catch (err) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // Rollback best-effort
        }
        throw err;
      }
    }
  }
}

export async function main() {
  let DatabaseSync;
  try {
    const sqlite = await import("node:sqlite");
    DatabaseSync = sqlite.DatabaseSync;
    if (!DatabaseSync) {
      throw new Error("node:sqlite missing DatabaseSync");
    }
  } catch {
    console.error(
      `Error: node:sqlite is unavailable on Node.js ${process.version}. Node.js >= 22.5.0 is required.`,
    );
    process.exit(1);
  }

  const parsed = parseArgs();
  const { username, password } = await getCredentials(
    parsed.username,
    parsed.password,
  );

  let dbPath;
  try {
    dbPath = resolveDbPath(parsed.rawDbPath);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  try {
    prepareDirectoryAndFile(dbPath);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "..");

  const db = new DatabaseSync(dbPath);
  try {
    ensureDatabaseInitialized(db, dbPath, repoRoot);
  } catch (err) {
    db.close();
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let existing;
  try {
    existing = db
      .prepare("SELECT username FROM auth_users WHERE username = ?")
      .get(username);
  } catch (err) {
    db.close();
    console.error(`Error: Failed to query existing users: ${err.message}`);
    process.exit(1);
  }

  if (existing) {
    db.close();
    console.error(`Error: User "${username}" already exists in ${dbPath}`);
    process.exit(1);
  }

  const hexId = randomBytes(12).toString("hex");
  const passwordHash = bcrypt.hashSync(password, 10);

  const insert = db.prepare(`
    INSERT INTO auth_users (
      id, username, password_hash, is_enabled, role, auth_version,
      mfa_secret_ciphertext, mfa_nonce, mfa_key_id, mfa_enrolled_at_ms,
      mfa_last_accepted_step, mfa_attempt_window_started_at_ms,
      mfa_attempt_count, mfa_blocked_until_ms
    ) VALUES (
      ?, ?, ?, 1, 'admin', 0,
      NULL, NULL, NULL, NULL,
      NULL, NULL, 0, NULL
    )
  `);

  try {
    insert.run(hexId, username, passwordHash);
  } catch (err) {
    db.close();
    console.error(`Error: Failed to insert admin user: ${err.message}`);
    process.exit(1);
  }

  db.close();

  console.log("");
  console.log(`✓ Admin user "${username}" created successfully in:`);
  console.log(`  ${dbPath}`);
  console.log("");
  console.log("Configuration reminder:");
  console.log(
    "  Ensure DAM_HOPPER_MFA_KEY_FILE is configured before starting the server:",
  );
  console.log("    export DAM_HOPPER_MFA_KEY_FILE=/path/to/mfa-encryption.key");
  console.log(
    "  (Generate with: [ ! -f /path/to/mfa-encryption.key ] && (umask 077 && openssl rand -hex 32 > /path/to/mfa-encryption.key))",
  );
  console.log("");
  console.log("Next steps:");
  console.log("  1. Start DamHopper server:");
  console.log(
    "     DAM_HOPPER_MFA_KEY_FILE=/path/to/mfa-encryption.key cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4801",
  );
  console.log(
    "  2. Log in at http://127.0.0.1:4801/api/auth/login or via Web UI.",
  );
  console.log(
    "  3. Scan the TOTP QR code on first login to complete MFA enrollment.",
  );
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
