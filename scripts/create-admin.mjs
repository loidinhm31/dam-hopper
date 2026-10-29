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
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import bcrypt from "bcryptjs";

function resolveDefaultDbPath() {
  if (process.env.DAM_HOPPER_AUTH_SQLITE_PATH) {
    return resolve(process.env.DAM_HOPPER_AUTH_SQLITE_PATH);
  }
  const configDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "dam-hopper")
    : process.platform === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "dam-hopper")
      : join(homedir(), ".config", "dam-hopper");
  return join(configDir, "auth.db");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let username = null;
  let password = null;
  let dbPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" || args[i] === "-d") {
      dbPath = resolve(args[++i]);
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
    dbPath: dbPath || resolveDefaultDbPath(),
  };
}

async function getCredentials(providedUsername, providedPassword) {
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
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      lines.push(line.trim());
    }
    if (!username && lines.length > 0) {
      username = lines.shift();
    }
    if (!password && lines.length > 0) {
      password = lines.shift();
    }
    if (!username || !password) {
      console.error("Error: When piping stdin, both username and password must be provided.");
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

    if (!password) {
      password = await rl.question("Enter admin password: ");
    }
    if (!password || password.trim().length === 0) {
      console.error("Error: Password cannot be empty.");
      process.exit(1);
    }
    if (Buffer.byteLength(password, "utf8") > 72) {
      console.error("Error: Password exceeds bcrypt limit of 72 bytes.");
      process.exit(1);
    }

    const confirm = await rl.question("Confirm admin password: ");
    if (password !== confirm) {
      console.error("Error: Passwords do not match.");
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  return { username, password };
}

function ensureDatabaseInitialized(db, dbPath, repoRoot) {
  const versionRow = db.prepare("PRAGMA user_version").get();
  const currentVersion = versionRow ? versionRow.user_version : 0;

  if (currentVersion === 0) {
    const migration1 = join(
      repoRoot,
      "server",
      "src",
      "auth",
      "store",
      "migrations",
      "001-auth.sql"
    );
    if (existsSync(migration1)) {
      const sql = readFileSync(migration1, "utf-8");
      db.exec(sql);
    } else {
      console.error(`Error: Cannot find schema migration at ${migration1}`);
      process.exit(1);
    }

    const migration2 = join(
      repoRoot,
      "server",
      "src",
      "auth",
      "store",
      "migrations",
      "002-session-user-agent.sql"
    );
    if (existsSync(migration2)) {
      const sql = readFileSync(migration2, "utf-8");
      db.exec(sql);
    }

    // Configure WAL mode and stamp application_id ("DHAU") and user_version
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = FULL;");
    db.exec("PRAGMA application_id = 0x44484155;"); // "DHAU"
    db.exec("PRAGMA user_version = 2;");
  }

  if (process.platform !== "win32") {
    try {
      chmodSync(dirname(dbPath), 0o700);
      chmodSync(dbPath, 0o600);
    } catch {
      // Best-effort if not owned by current process user
    }
  }
}

async function main() {
  let DatabaseSync;
  try {
    const sqlite = await import("node:sqlite");
    DatabaseSync = sqlite.DatabaseSync;
    if (!DatabaseSync) {
      throw new Error("node:sqlite missing DatabaseSync");
    }
  } catch {
    console.error(
      `Error: node:sqlite is unavailable on Node.js ${process.version}. Node.js >= 22.5.0 is required.`
    );
    process.exit(1);
  }

  const parsed = parseArgs();
  const { username, password } = await getCredentials(
    parsed.username,
    parsed.password
  );

  const dbPath = parsed.dbPath;
  mkdirSync(dirname(dbPath), { recursive: true });

  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const repoRoot = resolve(scriptDir, "..");

  const db = new DatabaseSync(dbPath);
  ensureDatabaseInitialized(db, dbPath, repoRoot);

  const existing = db
    .prepare("SELECT username FROM auth_users WHERE username = ?")
    .get(username);

  if (existing) {
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

  insert.run(hexId, username, passwordHash);
  db.close();

  console.log("");
  console.log(`✓ Admin user "${username}" created successfully in:`);
  console.log(`  ${dbPath}`);
  console.log("");
  console.log("Configuration reminder:");
  console.log("  Ensure DAM_HOPPER_MFA_KEY_FILE is set before starting the server:");
  console.log("    export DAM_HOPPER_MFA_KEY_FILE=/path/to/mfa-encryption.key");
  console.log("  (Generate with: [ ! -f /path/to/key ] && openssl rand -hex 32 > /path/to/key && chmod 600 /path/to/key)");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Start DamHopper server (if not already running):");
  console.log("     cargo run --bin dam-hopper-server -- --host 127.0.0.1 --port 4801");
  console.log("  2. Log in at http://127.0.0.1:4801/api/auth/login or via Web UI.");
  console.log("  3. Scan the TOTP QR code on first login to complete MFA enrollment.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
