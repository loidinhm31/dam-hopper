#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

import {
  APPLICATION_ID,
  SUPPORTED_SCHEMA_VERSION,
  DEFAULT_SQLITE_FILE,
  resolveConfigDir,
  resolveDbPath,
  prepareDirectoryAndFile,
  ensureDatabaseInitialized,
  parseArgs,
  getCredentials,
} from "../scripts/create-admin.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("resolveConfigDir follows canonical cross-platform contract", () => {
  // 1. Unset XDG_CONFIG_HOME
  assert.equal(
    resolveConfigDir({}, "/home/testuser"),
    join("/home/testuser", ".config", "dam-hopper"),
  );

  // 2. Custom XDG_CONFIG_HOME
  assert.equal(
    resolveConfigDir({ XDG_CONFIG_HOME: "/custom/xdg" }, "/home/testuser"),
    join("/custom/xdg", "dam-hopper"),
  );

  // 3. Empty string XDG_CONFIG_HOME (preserves env presence like Rust std::env::var().ok())
  assert.equal(
    resolveConfigDir({ XDG_CONFIG_HOME: "" }, "/home/testuser"),
    join("", "dam-hopper"),
  );

  // 4. Windows simulation: XDG unset, homedir is C:\Users\testuser
  assert.equal(
    resolveConfigDir({}, "C:\\Users\\testuser"),
    join("C:\\Users\\testuser", ".config", "dam-hopper"),
  );
});

test("resolveDbPath handles default, overrides, tilde, and invalid inputs", () => {
  const home = "/home/testuser";
  const cwd = "/work/dir";

  // Default empty path
  assert.equal(
    resolveDbPath("", {}, cwd, home),
    join(home, ".config", "dam-hopper", DEFAULT_SQLITE_FILE),
  );
  assert.equal(
    resolveDbPath(null, { DAM_HOPPER_AUTH_SQLITE_PATH: "   " }, cwd, home),
    join(home, ".config", "dam-hopper", DEFAULT_SQLITE_FILE),
  );

  // Absolute path
  assert.equal(
    resolveDbPath("/var/lib/dam-hopper/auth.db", {}, cwd, home),
    "/var/lib/dam-hopper/auth.db",
  );

  // Relative path against cwd
  assert.equal(
    resolveDbPath("custom/auth.db", {}, cwd, home),
    resolve(cwd, "custom/auth.db"),
  );

  // Tilde expansion (~/)
  assert.equal(
    resolveDbPath("~/my-db/auth.db", {}, cwd, home),
    resolve(home, "my-db/auth.db"),
  );

  // Invalid tilde prefix (~user)
  assert.throws(
    () => resolveDbPath("~otheruser/auth.db", {}, cwd, home),
    /supports only '~\/' home expansion/,
  );

  // NUL byte
  assert.throws(
    () => resolveDbPath("/path/with\0/null", {}, cwd, home),
    /contains a NUL byte/,
  );

  // Special SQLite names (:memory:, file:)
  assert.throws(
    () => resolveDbPath(":memory:", {}, cwd, home),
    /must be a file path/,
  );
  assert.throws(
    () => resolveDbPath("file:auth.db?mode=memory", {}, cwd, home),
    /must be a file path/,
  );
});

test("prepareDirectoryAndFile creates secure permissions for new directories and files", (t) => {
  if (process.platform === "win32") {
    t.skip("Unix permissions test");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const targetDir = join(tmp, "secure-dir");
    const dbPath = join(targetDir, "auth.db");

    prepareDirectoryAndFile(dbPath);

    const dirStat = statSync(targetDir);
    assert.equal(dirStat.mode & 0o777, 0o700, "Directory must have 0700 mode");

    const fileStat = statSync(dbPath);
    assert.equal(fileStat.mode & 0o777, 0o600, "File must have 0600 mode");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("prepareDirectoryAndFile rejects group/world-writable existing parent directory without mutating mode", (t) => {
  if (process.platform === "win32") {
    t.skip("Unix permissions test");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const parentDir = join(tmp, "insecure-dir");
    mkdirSync(parentDir, { mode: 0o777 });
    chmodSync(parentDir, 0o777);

    const dbPath = join(parentDir, "auth.db");

    assert.throws(
      () => prepareDirectoryAndFile(dbPath),
      /must not be writable by group or others/,
    );

    // Verify mode was NOT changed by the failed validation
    const dirStat = statSync(parentDir);
    assert.equal(
      dirStat.mode & 0o777,
      0o777,
      "Existing directory mode must remain unchanged",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("prepareDirectoryAndFile rejects group/world-accessible existing database file without mutating mode", (t) => {
  if (process.platform === "win32") {
    t.skip("Unix permissions test");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const parentDir = join(tmp, "secure-dir");
    mkdirSync(parentDir, { mode: 0o700 });
    chmodSync(parentDir, 0o700);

    const dbPath = join(parentDir, "insecure-auth.db");
    writeFileSync(dbPath, "not an auth db", { mode: 0o644 });
    chmodSync(dbPath, 0o644);

    assert.throws(
      () => prepareDirectoryAndFile(dbPath),
      /must not be accessible to group or others \(expected mode 0600\)/,
    );

    const fileStat = statSync(dbPath);
    assert.equal(
      fileStat.mode & 0o777,
      0o644,
      "Existing file mode must remain unchanged",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("prepareDirectoryAndFile rejects symlink directory and file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const realDir = join(tmp, "real-dir");
    mkdirSync(realDir, { mode: 0o700 });
    const symlinkDir = join(tmp, "symlink-dir");
    symlinkSync(realDir, symlinkDir);

    const dbPath = join(symlinkDir, "auth.db");
    assert.throws(
      () => prepareDirectoryAndFile(dbPath),
      /parent .* is not a directory/,
    );

    const realFile = join(realDir, "real-auth.db");
    writeFileSync(realFile, "");
    if (process.platform !== "win32") {
      chmodSync(realFile, 0o600);
    }
    const symlinkFile = join(realDir, "symlink-auth.db");
    symlinkSync(realFile, symlinkFile);

    assert.throws(
      () => prepareDirectoryAndFile(symlinkFile),
      /path is not a regular file/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureDatabaseInitialized initializes fresh DB transactionally with application_id and version", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "test-fresh.db");
    const db = new DatabaseSync(dbPath);

    ensureDatabaseInitialized(db, dbPath, REPO_ROOT);

    const versionRow = db.prepare("PRAGMA user_version").get();
    assert.equal(versionRow.user_version, SUPPORTED_SCHEMA_VERSION);

    const appIdRow = db.prepare("PRAGMA application_id").get();
    assert.equal(appIdRow.application_id, APPLICATION_ID);

    // Verify auth_users and auth_sessions exist
    const usersTable = db
      .prepare(
        "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='auth_users'",
      )
      .get();
    assert.equal(usersTable.count, 1);

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureDatabaseInitialized rejects foreign database with existing objects", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "foreign.db");
    const db = new DatabaseSync(dbPath);

    // Create foreign table
    db.exec("CREATE TABLE foreign_table (id INTEGER PRIMARY KEY, note TEXT);");
    db.exec("INSERT INTO foreign_table VALUES (1, 'unrelated database');");

    assert.throws(
      () => ensureDatabaseInitialized(db, dbPath, REPO_ROOT),
      /File is not a DamHopper authentication database/,
    );

    // Verify foreign table untouched and auth_users was NOT created
    const usersTable = db
      .prepare(
        "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='auth_users'",
      )
      .get();
    assert.equal(usersTable.count, 0);

    const foreignCount = db
      .prepare("SELECT count(*) as count FROM foreign_table")
      .get();
    assert.equal(foreignCount.count, 1);

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureDatabaseInitialized rejects database with sqlitex table (GLOB exact prefix)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "sqlitex.db");
    const db = new DatabaseSync(dbPath);

    // Create table starting with 'sqlite' but NOT sqlite_ system prefix
    db.exec("CREATE TABLE sqlitex (id INTEGER PRIMARY KEY, secret TEXT);");
    db.exec("INSERT INTO sqlitex VALUES (1, 'sensitive');");

    assert.throws(
      () => ensureDatabaseInitialized(db, dbPath, REPO_ROOT),
      /File is not a DamHopper authentication database/,
    );

    // Verify sqlitex untouched and auth_users was NOT created
    const usersTable = db
      .prepare(
        "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='auth_users'",
      )
      .get();
    assert.equal(usersTable.count, 0);

    const sqlitexCount = db
      .prepare("SELECT count(*) as count FROM sqlitex")
      .get();
    assert.equal(sqlitexCount.count, 1);

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureDatabaseInitialized rejects invalid application_id and future user_version", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "invalid-app.db");
    const db = new DatabaseSync(dbPath);

    db.exec("PRAGMA application_id = 12345;");
    db.exec("PRAGMA user_version = 1;");
    assert.throws(
      () => ensureDatabaseInitialized(db, dbPath, REPO_ROOT),
      /File is not a DamHopper authentication database/,
    );

    // Future version
    db.exec(`PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec("PRAGMA user_version = 99;");
    assert.throws(
      () => ensureDatabaseInitialized(db, dbPath, REPO_ROOT),
      /newer than supported version/,
    );

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureDatabaseInitialized upgrades schema v1 to v2 transactionally", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "v1-upgrade.db");
    const db = new DatabaseSync(dbPath);

    // Apply only migration 1 manually and stamp version 1
    const sql1 = readFileSync(
      join(REPO_ROOT, "server/src/auth/store/migrations/001-auth.sql"),
      "utf-8",
    );
    db.exec(sql1);
    db.exec(`PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec("PRAGMA user_version = 1;");

    // Reopen and ensureDatabaseInitialized
    ensureDatabaseInitialized(db, dbPath, REPO_ROOT);

    const versionRow = db.prepare("PRAGMA user_version").get();
    assert.equal(versionRow.user_version, 2);

    // Verify user_agent column exists on auth_sessions
    const cols = db.prepare("PRAGMA table_info(auth_sessions)").all();
    assert.ok(cols.some((c) => c.name === "user_agent"));

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("create-admin.mjs executes successfully in repository path containing spaces", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper test spaces-"));
  try {
    // Copy scripts and server migrations to space-containing directory
    const repoWithSpaces = join(tmp, "dam hopper space repo");
    mkdirSync(join(repoWithSpaces, "scripts"), { recursive: true });
    mkdirSync(join(repoWithSpaces, "server/src/auth/store/migrations"), {
      recursive: true,
    });

    cpSync(
      join(REPO_ROOT, "scripts/create-admin.mjs"),
      join(repoWithSpaces, "scripts/create-admin.mjs"),
    );
    cpSync(
      join(REPO_ROOT, "server/src/auth/store/migrations"),
      join(repoWithSpaces, "server/src/auth/store/migrations"),
      { recursive: true },
    );
    symlinkSync(
      join(REPO_ROOT, "node_modules"),
      join(repoWithSpaces, "node_modules"),
      "junction",
    );

    const dbPath = join(tmp, "space-test-auth.db");
    const scriptPath = join(repoWithSpaces, "scripts/create-admin.mjs");

    const result = spawnSync(
      process.execPath,
      [scriptPath, "space_admin", "PasswordWithSpaces123!", "--db", dbPath],
      {
        encoding: "utf-8",
        cwd: repoWithSpaces,
      },
    );

    assert.equal(
      result.status,
      0,
      `Script failed with output:\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`,
    );
    assert.ok(result.stdout.includes("created successfully"));

    const db = new DatabaseSync(dbPath);
    const user = db
      .prepare(
        "SELECT username, role, is_enabled FROM auth_users WHERE username = ?",
      )
      .get("space_admin");
    assert.ok(user);
    assert.equal(user.username, "space_admin");
    assert.equal(user.role, "admin");
    assert.equal(user.is_enabled, 1);
    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("create-admin.mjs piped input preserves password whitespace without trimming", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "piped-auth.db");
    const scriptPath = join(REPO_ROOT, "scripts/create-admin.mjs");
    const passwordWithSpaces = "  password with leading and trailing spaces  ";

    const input = `piped_user\n${passwordWithSpaces}\n`;

    const result = spawnSync(process.execPath, [scriptPath, "--db", dbPath], {
      input,
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });

    assert.equal(
      result.status,
      0,
      `Script failed with output:\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`,
    );

    const db = new DatabaseSync(dbPath);
    const user = db
      .prepare(
        "SELECT username, password_hash FROM auth_users WHERE username = ?",
      )
      .get("piped_user");
    assert.ok(user);

    // Verify that the hash matches the un-trimmed password
    // Compare with bcrypt
    assert.ok(
      bcrypt.compareSync(passwordWithSpaces, user.password_hash),
      "Password must retain whitespace when piped",
    );
    assert.ok(
      !bcrypt.compareSync(passwordWithSpaces.trim(), user.password_hash),
      "Password must NOT match trimmed version",
    );

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("create-admin.mjs does not echo password in interactive PTY terminal", (t) => {
  if (process.platform === "win32") {
    t.skip("PTY test requires POSIX openpty");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "pty-auth.db");
    const scriptPath = join(REPO_ROOT, "scripts/create-admin.mjs");

    const pythonCode = `
import os, pty, select, subprocess, sys, termios, time

node_bin = sys.argv[1]
script = sys.argv[2]
db = sys.argv[3]
master, slave = pty.openpty()
init_attrs = termios.tcgetattr(slave)

proc = subprocess.Popen([node_bin, script, '--db', db], stdin=slave, stdout=slave, stderr=slave, close_fds=True)

def read_until(prompt, timeout=5.0):
    buf = b""
    start = time.time()
    while time.time() - start < timeout:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try:
                chunk = os.read(master, 1024)
                if not chunk: break
                buf += chunk
                if prompt in buf:
                    return buf
            except OSError:
                break
    return buf

out = b""
out += read_until(b"username: ")
os.write(master, b"pty_admin\\n")
out += read_until(b"password: ")
os.write(master, b"SuperSecretPass999!\\n")
out += read_until(b"password: ")
os.write(master, b"SuperSecretPass999!\\n")

start = time.time()
while time.time() - start < 5.0:
    r, _, _ = select.select([master], [], [], 0.1)
    if r:
        try:
            chunk = os.read(master, 1024)
            if not chunk: break
            out += chunk
        except OSError:
            break
    if proc.poll() is not None:
        break

proc.wait(timeout=5)

# Verify terminal attributes restored on the pty
final_attrs = termios.tcgetattr(slave)
os.close(slave)
os.close(master)

if not (final_attrs[3] & termios.ECHO):
    sys.stderr.write("TERMINAL ECHO NOT RESTORED AFTER SUCCESS\\n")
    sys.exit(3)

text = out.decode('utf-8', errors='replace')
if "SuperSecretPass999!" in text:
    sys.stderr.write("LEAKED PASSWORD IN PTY OUTPUT:\\n" + text)
    sys.exit(1)
if "created successfully" not in text:
    sys.stderr.write("DID NOT CREATE USER:\\n" + text)
    sys.exit(2)
sys.exit(0)
`;

    const result = spawnSync(
      "python3",
      ["-c", pythonCode, process.execPath, scriptPath, dbPath],
      {
        encoding: "utf-8",
        cwd: REPO_ROOT,
        timeout: 10000,
      },
    );

    assert.equal(
      result.status,
      0,
      `PTY test failed: stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const db = new DatabaseSync(dbPath);
    const user = db
      .prepare("SELECT username, role FROM auth_users WHERE username = ?")
      .get("pty_admin");
    assert.ok(user);
    assert.equal(user.username, "pty_admin");
    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("create-admin.mjs exits cleanly with 130 on SIGINT during password prompt", (t) => {
  if (process.platform === "win32") {
    t.skip("PTY test requires POSIX openpty");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "dam-hopper-test-"));
  try {
    const dbPath = join(tmp, "sigint-auth.db");
    const scriptPath = join(REPO_ROOT, "scripts/create-admin.mjs");

    const pythonCode = `
import os, pty, select, signal, subprocess, sys, termios, time

node_bin = sys.argv[1]
script = sys.argv[2]
db = sys.argv[3]
test_sig = sys.argv[4] # "INT" or "TERM"

master, slave = pty.openpty()
proc = subprocess.Popen([node_bin, script, '--db', db], stdin=slave, stdout=slave, stderr=slave, close_fds=True)

def read_until(prompt, timeout=5.0):
    buf = b""
    start = time.time()
    while time.time() - start < timeout:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try:
                chunk = os.read(master, 1024)
                if not chunk: break
                buf += chunk
                if prompt in buf:
                    return buf
            except OSError:
                break
    return buf

read_until(b"username: ")
os.write(master, b"sig_user\\n")
read_until(b"password: ")
time.sleep(0.1)

sig_to_send = signal.SIGINT if test_sig == "INT" else signal.SIGTERM
proc.send_signal(sig_to_send)
ret = proc.wait(timeout=5)

final_attrs = termios.tcgetattr(slave)
os.close(slave)
os.close(master)

# Verify ECHO was restored after signal termination
if not (final_attrs[3] & termios.ECHO):
    sys.stderr.write("TERMINAL ECHO NOT RESTORED AFTER " + test_sig + "\\n")
    sys.exit(2)

expected_ret = 130 if test_sig == "INT" else 143
if ret != expected_ret:
    sys.stderr.write("UNEXPECTED EXIT CODE: got " + str(ret) + ", expected " + str(expected_ret) + "\\n")
    sys.exit(1)

sys.exit(0)
`;

    // Test SIGINT
    const resultInt = spawnSync(
      "python3",
      ["-c", pythonCode, process.execPath, scriptPath, dbPath, "INT"],
      {
        encoding: "utf-8",
        cwd: REPO_ROOT,
        timeout: 10000,
      },
    );

    assert.equal(
      resultInt.status,
      0,
      `SIGINT test failed: stdout: ${resultInt.stdout}, stderr: ${resultInt.stderr}`,
    );

    // Test SIGTERM
    const resultTerm = spawnSync(
      "python3",
      ["-c", pythonCode, process.execPath, scriptPath, dbPath, "TERM"],
      {
        encoding: "utf-8",
        cwd: REPO_ROOT,
        timeout: 10000,
      },
    );

    assert.equal(
      resultTerm.status,
      0,
      `SIGTERM test failed: stdout: ${resultTerm.stdout}, stderr: ${resultTerm.stderr}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
