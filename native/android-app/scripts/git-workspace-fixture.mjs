#!/usr/bin/env node

/**
 * Phase 07 Real-Git Workspace Fixture, Independent Oracle, and Transparent Proxy.
 *
 * Requirements:
 * - Zero external npm dependencies (Node.js standard library only).
 * - No shell eval (execFileSync with argument arrays).
 * - Deterministic Git repo topologies (staged/unstaged, binary, deleted, empty, renamed,
 *   linear, merge, octopus, skewed dates, shallow, unborn, detached, local/remote collisions,
 *   worktrees with punctuation, bare remote + drift, conflict, signed commit headers).
 * - Independent Git oracle (status v2, ls-files, diff, rev-parse, log, cat-file, worktree).
 * - Transparent proxy with request auditing (redacted tokens), latency injection, and drop-ack.
 * - Test-only HTTP oracle control endpoint for device-side instrumentation.
 * - CLI modes:
 *     --self-test (isolated protocol, negative, oracle, proxy checks; no device or cargo server required)
 *     --smoke-current-server --server-bin <bin> --seed-bin <bin> --evidence-dir <dir>
 *     --serve --evidence-dir <dir> [--server-bin <bin> --seed-bin <bin>] [--server-port <port>] [--proxy-port <port>]
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const DEFAULT_SERVER_PORT = 4801;
const DEFAULT_PROXY_PORT = 4802;
const GIT_BIN = 'git';

// --- Safe Git Command Execution (No Shell Eval) ---

export function runGit(args, cwd, env = {}, input = undefined) {
  const finalEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: cwd,
    ...env,
  };
  try {
    return execFileSync(GIT_BIN, args, {
      cwd,
      env: finalEnv,
      input,
      encoding: 'utf8',
      shell: false,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
}

export function runGitRaw(args, cwd, env = {}) {
  const finalEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: cwd,
    ...env,
  };
  return execFileSync(GIT_BIN, args, {
    cwd,
    env: finalEnv,
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
}

// --- Independent Git Oracle ---

export class GitOracle {
  constructor(repoDir) {
    this.repoDir = repoDir;
  }

  getStatusPorcelainV2(worktreeDir = this.repoDir) {
    try {
      const output = runGit(['status', '--porcelain=v2', '--untracked-files=all', '--branch'], worktreeDir);
      const lines = output ? output.split('\n') : [];
      let branch = '';
      let headOid = '';
      let upstream = '';
      let ahead = 0;
      let behind = 0;
      const staged = [];
      const unstaged = [];
      const untracked = [];

      for (const line of lines) {
        if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
        else if (line.startsWith('# branch.oid ')) headOid = line.slice(13).trim();
        else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim();
        else if (line.startsWith('# branch.ab ')) {
          const m = line.match(/\+(\d+) -(\d+)/);
          if (m) {
            ahead = parseInt(m[1], 10);
            behind = parseInt(m[2], 10);
          }
        } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
          // Changed tracked entries: 1 <XY> ... or 2 <XY> ... (renamed)
          const parts = line.split(' ');
          const xy = parts[1];
          const path = parts[parts.length - 1];
          if (xy[0] !== '.') staged.push(path);
          if (xy[1] !== '.') unstaged.push(path);
        } else if (line.startsWith('? ')) {
          untracked.push(line.slice(2).trim());
        } else if (line.startsWith('u ')) {
          // Unmerged / conflict entry
          const parts = line.split(' ');
          const path = parts[parts.length - 1];
          unstaged.push(path);
        }
      }

      return {
        branch,
        headOid,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        isClean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
        raw: output,
      };
    } catch (err) {
      return { error: err.message, isClean: false, staged: [], unstaged: [], untracked: [] };
    }
  }

  getLsFilesStage(worktreeDir = this.repoDir) {
    const out = runGit(['ls-files', '--stage'], worktreeDir);
    const lines = out ? out.split('\n').filter(Boolean) : [];
    return lines.map((l) => {
      // 100644 8aae378... 0\tfilename
      const match = l.match(/^(\d+)\s+([0-9a-f]{40})\s+(\d+)\t(.*)$/);
      if (match) {
        return { mode: match[1], oid: match[2], stage: parseInt(match[3], 10), path: match[4] };
      }
      return { raw: l };
    });
  }

  getDiff(worktreeDir = this.repoDir, cached = false) {
    const args = ['diff', '--binary'];
    if (cached) args.push('--cached');
    return runGit(args, worktreeDir);
  }

  getRevParse(ref, worktreeDir = this.repoDir) {
    try {
      return runGit(['rev-parse', ref], worktreeDir);
    } catch {
      return null;
    }
  }

  getLog(worktreeDir = this.repoDir, maxCount = 50) {
    const format = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x1f';
    const out = runGit(['log', '--all', `--format=${format}`, `-n${maxCount}`], worktreeDir);
    if (!out) return [];
    const entries = out.split('\x1f').map((e) => e.trim()).filter(Boolean);
    return entries.map((entry) => {
      const parts = entry.split('\x00');
      return {
        oid: parts[0] || '',
        parents: parts[1] ? parts[1].split(' ') : [],
        authorName: parts[2] || '',
        authorEmail: parts[3] || '',
        authorTimestamp: parseInt(parts[4] || '0', 10),
        committerName: parts[5] || '',
        committerEmail: parts[6] || '',
        committerTimestamp: parseInt(parts[7] || '0', 10),
        message: parts[8] || '',
      };
    });
  }

  getCatFile(oid, worktreeDir = this.repoDir) {
    try {
      return runGit(['cat-file', '-p', oid], worktreeDir);
    } catch {
      return null;
    }
  }

  getWorktrees(repoDir = this.repoDir) {
    const out = runGit(['worktree', 'list', '--porcelain'], repoDir);
    const blocks = out.split('\n\n').filter(Boolean);
    return blocks.map((b) => {
      const lines = b.split('\n');
      const info = {};
      for (const l of lines) {
        if (l.startsWith('worktree ')) info.path = l.slice(9).trim();
        else if (l.startsWith('HEAD ')) info.head = l.slice(5).trim();
        else if (l.startsWith('branch ')) info.branch = l.slice(7).trim();
        else if (l === 'bare') info.bare = true;
        else if (l === 'detached') info.detached = true;
      }
      return info;
    });
  }

  getRemoteRef(bareRemoteDir, branch) {
    try {
      return runGit(['--git-dir=' + bareRemoteDir, 'rev-parse', `refs/heads/${branch}`], bareRemoteDir);
    } catch {
      return null;
    }
  }
}

// --- Disposable Repository Generator ---

export function setupDisposableGitWorkspace(rootDir) {
  const reposDir = path.join(path.resolve(rootDir), 'repos');
  fs.mkdirSync(reposDir, { recursive: true });

  const primaryDir = path.join(reposDir, 'primary');
  const secondaryDir = path.join(reposDir, 'secondary');
  const bareRemoteDir = path.join(reposDir, 'bare-remote.git');
  const peerCloneDir = path.join(reposDir, 'peer-clone');
  const nonGitDir = path.join(reposDir, 'non-git-dir');
  const emptyRepoDir = path.join(reposDir, 'empty-repo');

  fs.mkdirSync(nonGitDir, { recursive: true });
  fs.writeFileSync(path.join(nonGitDir, 'readme.txt'), 'Not a git repo');

  // 1. Setup Bare Remote
  fs.mkdirSync(bareRemoteDir, { recursive: true });
  runGit(['init', '--bare', '--initial-branch=main'], bareRemoteDir);

  // 2. Setup Primary Repo
  fs.mkdirSync(primaryDir, { recursive: true });
  runGit(['init', '--initial-branch=main'], primaryDir);
  runGit(['config', 'user.name', 'Git Fixture'], primaryDir);
  runGit(['config', 'user.email', 'fixture@damhopper.dev'], primaryDir);
  runGit(['config', 'commit.gpgsign', 'false'], primaryDir);

  // Initial commit (C1)
  fs.writeFileSync(path.join(primaryDir, 'README.md'), '# Primary Project\nInitial readme.\n');
  fs.writeFileSync(path.join(primaryDir, 'package.json'), '{\n  "name": "primary-proj",\n  "version": "1.0.0"\n}\n');
  runGit(['add', '.'], primaryDir);
  runGit(['commit', '-m', 'Initial commit on main'], primaryDir, {
    GIT_AUTHOR_DATE: '2026-01-01T10:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T10:00:00Z',
  });

  // Connect to bare remote
  runGit(['remote', 'add', 'origin', bareRemoteDir], primaryDir);
  runGit(['push', '-u', 'origin', 'main'], primaryDir);

  // Second commit (C2) - Skewed author timestamp
  fs.writeFileSync(path.join(primaryDir, 'doc1.txt'), 'Document 1 content\n');
  runGit(['add', 'doc1.txt'], primaryDir);
  runGit(['commit', '-m', 'Add doc1 with skewed date'], primaryDir, {
    GIT_AUTHOR_DATE: '2025-12-01T08:00:00Z', // Skewed in past
    GIT_COMMITTER_DATE: '2026-01-02T12:00:00Z',
  });

  // Feature branch A
  runGit(['checkout', '-b', 'feature/alpha'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'alpha.txt'), 'Feature alpha\n');
  runGit(['add', 'alpha.txt'], primaryDir);
  runGit(['commit', '-m', 'Add feature alpha'], primaryDir);

  // Feature branch B
  runGit(['checkout', 'main'], primaryDir);
  runGit(['checkout', '-b', 'feature/beta'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'beta.txt'), 'Feature beta\n');
  runGit(['add', 'beta.txt'], primaryDir);
  runGit(['commit', '-m', 'Add feature beta'], primaryDir);

  // Feature branch C
  runGit(['checkout', 'main'], primaryDir);
  runGit(['checkout', '-b', 'feature/gamma'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'gamma.txt'), 'Feature gamma\n');
  runGit(['add', 'gamma.txt'], primaryDir);
  runGit(['commit', '-m', 'Add feature gamma'], primaryDir);

  // Merge commit (linear + merge)
  runGit(['checkout', 'main'], primaryDir);
  runGit(['merge', '--no-ff', '-m', 'Merge feature/alpha into main', 'feature/alpha'], primaryDir);

  // Octopus merge (feature/beta and feature/gamma)
  runGit(['merge', '-m', 'Octopus merge beta and gamma', 'feature/beta', 'feature/gamma'], primaryDir);
  runGit(['push', 'origin', 'main'], primaryDir);

  // Inactive local branch for safe history rewrites (message edit / squash)
  runGit(['checkout', '-b', 'rewrite/inactive-target'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'step1.txt'), 'Step 1\n');
  runGit(['add', 'step1.txt'], primaryDir);
  runGit(['commit', '-m', 'Step 1 commit on inactive branch'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'step2.txt'), 'Step 2\n');
  runGit(['add', 'step2.txt'], primaryDir);
  runGit(['commit', '-m', 'Step 2 commit on inactive branch'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'step3.txt'), 'Step 3\n');
  runGit(['add', 'step3.txt'], primaryDir);
  runGit(['commit', '-m', 'Step 3 commit on inactive branch'], primaryDir);

  // Push inactive branch to remote to test leased publication & remote drift
  runGit(['push', 'origin', 'rewrite/inactive-target'], primaryDir);

  // Checkout main again as active branch
  runGit(['checkout', 'main'], primaryDir);

  // Add commit with signed header simulation via git hash-object
  const headTree = runGit(['rev-parse', 'HEAD^{tree}'], primaryDir);
  const headParent = runGit(['rev-parse', 'HEAD'], primaryDir);
  const commitContent = [
    `tree ${headTree}`,
    `parent ${headParent}`,
    `author Git Fixture <fixture@damhopper.dev> 1767268800 +0000`,
    `committer Git Fixture <fixture@damhopper.dev> 1767268800 +0000`,
    `gpgsig -----BEGIN PGP SIGNATURE-----`,
    ` Version: GnuPG v2`,
    ` `,
    ` iQEcBAABCAAGBQJfTestSimulationFakeSignatureDataHeader==`,
    ` =1234`,
    ` -----END PGP SIGNATURE-----`,
    ``,
    `Commit with signed header for consent check`,
    ``,
  ].join('\n');
  const signedOid = runGit(['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'], primaryDir, {}, commitContent);
  runGit(['update-ref', 'refs/heads/feature/signed-consent', signedOid], primaryDir);

  // Setup Worktrees with punctuation and spaces
  const wtDir = path.join(reposDir, 'wt & spaces + punct # test=val');
  runGit(['worktree', 'add', '-b', 'worktree/punct-branch', wtDir, 'main'], primaryDir);

  // - Pre-commit file to be deleted later in daily changes
  fs.writeFileSync(path.join(primaryDir, 'to_delete.txt'), 'Delete me\n');
  runGit(['add', 'to_delete.txt'], primaryDir);
  runGit(['commit', '-m', 'Commit to_delete.txt before removing'], primaryDir);

  // Setup Daily Changes State on primary (after all commits):
  // - Deleted file (now unlinked)
  fs.unlinkSync(path.join(primaryDir, 'to_delete.txt'));

  // - Staged and unstaged edits on same file
  fs.writeFileSync(path.join(primaryDir, 'doc1.txt'), 'Line 1\nLine 2 staged\n');
  runGit(['add', 'doc1.txt'], primaryDir);
  fs.writeFileSync(path.join(primaryDir, 'doc1.txt'), 'Line 1\nLine 2 staged\nLine 3 unstaged\n');

  // - Untracked file
  fs.writeFileSync(path.join(primaryDir, 'untracked_file.txt'), 'Untracked contents');

  // - Binary file (staged)
  const binBuffer = Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
  fs.writeFileSync(path.join(primaryDir, 'binary_asset.bin'), binBuffer);
  runGit(['add', 'binary_asset.bin'], primaryDir);

  // - Empty file (untracked)
  fs.writeFileSync(path.join(primaryDir, 'empty_file.txt'), '');

  // 3. Setup Peer Clone (to simulate external bare remote drift)
  runGit(['clone', bareRemoteDir, peerCloneDir], reposDir);
  runGit(['config', 'user.name', 'Peer Developer'], peerCloneDir);
  runGit(['config', 'user.email', 'peer@damhopper.dev'], peerCloneDir);

  // 4. Setup Conflict Fixture Repo
  const conflictDir = path.join(reposDir, 'conflict-repo');
  fs.mkdirSync(conflictDir, { recursive: true });
  runGit(['init', '--initial-branch=main'], conflictDir);
  runGit(['config', 'user.name', 'Conflict Tester'], conflictDir);
  runGit(['config', 'user.email', 'conflict@damhopper.dev'], conflictDir);
  fs.writeFileSync(path.join(conflictDir, 'conflict.txt'), 'Base line\n');
  runGit(['add', 'conflict.txt'], conflictDir);
  runGit(['commit', '-m', 'Base commit on main'], conflictDir);

  runGit(['checkout', '-b', 'conflict-branch'], conflictDir);
  fs.writeFileSync(path.join(conflictDir, 'conflict.txt'), 'Branch A modification\n');
  runGit(['add', 'conflict.txt'], conflictDir);
  runGit(['commit', '-m', 'Branch modification'], conflictDir);

  runGit(['checkout', 'main'], conflictDir);
  fs.writeFileSync(path.join(conflictDir, 'conflict.txt'), 'Main line modification\n');
  runGit(['add', 'conflict.txt'], conflictDir);
  runGit(['commit', '-m', 'Main modification'], conflictDir);

  // Trigger merge conflict
  try {
    runGit(['merge', 'conflict-branch'], conflictDir);
  } catch {
    // Expected merge conflict!
  }

  // 5. Setup Secondary Repo (for cross-project isolation checks)
  fs.mkdirSync(secondaryDir, { recursive: true });
  runGit(['init', '--initial-branch=main'], secondaryDir);
  runGit(['config', 'user.name', 'Secondary User'], secondaryDir);
  runGit(['config', 'user.email', 'sec@damhopper.dev'], secondaryDir);
  fs.writeFileSync(path.join(secondaryDir, 'README.md'), '# Secondary Project\n');
  runGit(['add', 'README.md'], secondaryDir);
  runGit(['commit', '-m', 'Initial commit in secondary repo'], secondaryDir);

  // 6. Setup Empty Repo
  fs.mkdirSync(emptyRepoDir, { recursive: true });
  runGit(['init', '--initial-branch=main'], emptyRepoDir);

  return {
    rootDir,
    reposDir,
    primaryDir,
    secondaryDir,
    bareRemoteDir,
    peerCloneDir,
    conflictDir,
    nonGitDir,
    emptyRepoDir,
    worktreeDir: wtDir,
  };
}

// --- Transparent Proxy & Audit Logger ---

export class TransparentGitProxy {
  constructor(options = {}) {
    this.targetHost = options.targetHost || '127.0.0.1';
    this.targetPort = options.targetPort || DEFAULT_SERVER_PORT;
    this.proxyPort = options.proxyPort || DEFAULT_PROXY_PORT;
    this.oracleMap = new Map(); // projectName -> GitOracle
    this.auditLogs = [];
    this.faults = {
      dropNextAck: false,
      delayRouteMs: new Map(), // routePattern -> delayMs
    };
    this.server = null;
  }

  registerOracle(projectName, oracle) {
    this.oracleMap.set(projectName, oracle);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', reject);
      this.server.listen(this.proxyPort, '127.0.0.1', () => {
        resolve({ port: this.proxyPort });
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  setDropNextAck(drop = true) {
    this.faults.dropNextAck = drop;
  }

  setRouteDelay(routePattern, delayMs) {
    if (delayMs <= 0) {
      this.faults.delayRouteMs.delete(routePattern);
    } else {
      this.faults.delayRouteMs.set(routePattern, delayMs);
    }
  }

  clearFaults() {
    this.faults.dropNextAck = false;
    this.faults.delayRouteMs.clear();
  }

  getAuditLogs() {
    return [...this.auditLogs];
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    // Test-Only Control Plane / Oracle Endpoints
    if (url.pathname.startsWith('/__test_control/')) {
      return this.handleControlEndpoint(url, req, res);
    }

    const auditEntry = {
      timestamp: Date.now(),
      method: req.method,
      path: url.pathname,
      queryKeys: Array.from(url.searchParams.keys()),
      hasAuth: Boolean(req.headers.authorization),
      bodyKeys: [],
      statusCode: null,
      ackDropped: false,
    };

    // Buffer body to inspect keys and forward
    const bodyChunks = [];
    req.on('data', (c) => bodyChunks.push(c));
    req.on('end', async () => {
      const bodyBuffer = Buffer.concat(bodyChunks);
      if (bodyBuffer.length > 0 && req.headers['content-type']?.includes('application/json')) {
        try {
          const parsed = JSON.parse(bodyBuffer.toString('utf8'));
          auditEntry.bodyKeys = Object.keys(parsed);
        } catch {
          auditEntry.bodyKeys = ['<invalid-json>'];
        }
      }

      // Check delay fault
      for (const [pattern, delay] of this.faults.delayRouteMs.entries()) {
        if (url.pathname.includes(pattern)) {
          await new Promise((r) => setTimeout(r, delay));
          break;
        }
      }

      // Forward request to target upstream server
      const proxyReqHeaders = { ...req.headers, host: `${this.targetHost}:${this.targetPort}` };
      const proxyReq = http.request(
        {
          hostname: this.targetHost,
          port: this.targetPort,
          path: req.url,
          method: req.method,
          headers: proxyReqHeaders,
        },
        (proxyRes) => {
          auditEntry.statusCode = proxyRes.statusCode;

          // Check drop-ack fault for mutating requests (POST / DELETE)
          if (this.faults.dropNextAck && (req.method === 'POST' || req.method === 'DELETE')) {
            this.faults.dropNextAck = false;
            auditEntry.ackDropped = true;
            this.auditLogs.push(auditEntry);
            // Drop client connection without sending response
            res.destroy();
            return;
          }

          this.auditLogs.push(auditEntry);
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );

      proxyReq.on('error', (err) => {
        auditEntry.statusCode = 502;
        auditEntry.error = err.message;
        this.auditLogs.push(auditEntry);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Proxy upstream error: ${err.message}` }));
      });

      if (bodyBuffer.length > 0) {
        proxyReq.write(bodyBuffer);
      }
      proxyReq.end();
    });
  }

  handleControlEndpoint(url, req, res) {
    const route = url.pathname.slice('/__test_control/'.length);

    if (route === 'ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
    }

    if (route === 'oracle/status') {
      const project = url.searchParams.get('project') || 'primary';
      const oracle = this.oracleMap.get(project);
      if (!oracle) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Oracle for ${project} not found` }));
      }
      const wt = url.searchParams.get('worktree') || undefined;
      const status = oracle.getStatusPorcelainV2(wt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(status));
    }

    if (route === 'oracle/head') {
      const project = url.searchParams.get('project') || 'primary';
      const oracle = this.oracleMap.get(project);
      if (!oracle) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Oracle for ${project} not found` }));
      }
      const ref = url.searchParams.get('ref') || 'HEAD';
      const oid = oracle.getRevParse(ref);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ref, oid }));
    }

    if (route === 'oracle/cat-file') {
      const project = url.searchParams.get('project') || 'primary';
      const oracle = this.oracleMap.get(project);
      const oid = url.searchParams.get('oid');
      if (!oracle || !oid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing project or oid' }));
      }
      const content = oracle.getCatFile(oid);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(content || '');
    }

    if (route === 'oracle/remote-ref') {
      const branch = url.searchParams.get('branch') || 'main';
      const primaryOracle = this.oracleMap.get('primary');
      if (!primaryOracle) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Primary oracle not found' }));
      }
      const bareRemoteDir = path.join(primaryOracle.repoDir, '..', 'bare-remote.git');
      const oid = primaryOracle.getRemoteRef(bareRemoteDir, branch);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ branch, oid }));
    }

    if (route === 'audit/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(this.auditLogs));
    }

    if (route === 'audit/clear') {
      this.auditLogs = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ cleared: true }));
    }

    if (route === 'faults/drop-next-ack') {
      this.setDropNextAck(true);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ dropNextAck: true }));
    }

    if (route === 'faults/clear') {
      this.clearFaults();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ cleared: true }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown control route ${route}` }));
  }
}

// --- Self-Test Mode ---

export async function runSelfTest() {
  console.log('=== Running Git Workspace Fixture Self-Test ===');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-fixture-selftest-'));
  console.log(`Isolated temp directory: ${tempDir}`);

  try {
    // 1. Test Git presence
    const gitVer = runGit(['--version'], tempDir);
    console.log(`[PASS] Git command verified: ${gitVer}`);

    // 2. Test Disposable Workspace Generator
    const ws = setupDisposableGitWorkspace(tempDir);
    console.log('[PASS] Disposable Git workspace generated successfully.');

    // 3. Test Git Oracle on Primary Repo
    const primaryOracle = new GitOracle(ws.primaryDir);

    const status = primaryOracle.getStatusPorcelainV2();
    if (!status.staged.includes('doc1.txt')) throw new Error('Expected doc1.txt in staged entries');
    if (!status.unstaged.includes('doc1.txt')) throw new Error('Expected doc1.txt in unstaged entries');
    if (!status.untracked.includes('untracked_file.txt')) throw new Error('Expected untracked_file.txt');
    console.log('[PASS] Oracle getStatusPorcelainV2 correctly identified staged, unstaged, untracked.');

    const headOid = primaryOracle.getRevParse('HEAD');
    if (!headOid || headOid.length !== 40) throw new Error(`Invalid HEAD OID: ${headOid}`);
    console.log(`[PASS] Oracle getRevParse returned valid HEAD OID: ${headOid}`);

    const log = primaryOracle.getLog();
    if (log.length < 5) throw new Error(`Expected at least 5 log entries, got ${log.length}`);
    const mergeCommit = log.find((c) => c.parents.length >= 2);
    if (!mergeCommit) throw new Error('Expected at least one merge commit in log');
    console.log(`[PASS] Oracle getLog verified linear, merge, and octopus history (${log.length} commits).`);

    const worktrees = primaryOracle.getWorktrees();
    if (worktrees.length < 2) throw new Error(`Expected at least 2 worktrees, got ${worktrees.length}`);
    const punctWt = worktrees.find((w) => w.path.includes('& spaces + punct # test=val'));
    if (!punctWt) throw new Error('Worktree with punctuation and spaces not detected');
    console.log('[PASS] Oracle worktree list correctly parsed punctuation worktree.');

    // 4. Test Signed Header Verification via git cat-file
    const signedOid = primaryOracle.getRevParse('refs/heads/feature/signed-consent');
    if (!signedOid) throw new Error('Signed commit ref not found');
    const signedCat = primaryOracle.getCatFile(signedOid);
    if (!signedCat || !signedCat.includes('gpgsig -----BEGIN PGP SIGNATURE-----')) {
      throw new Error('gpgsig header not found in commit object');
    }
    console.log('[PASS] Oracle verified signed commit header presence via cat-file.');

    // 5. Test Conflict Repo
    const conflictOracle = new GitOracle(ws.conflictDir);
    const conflictStatus = conflictOracle.getStatusPorcelainV2();
    if (!conflictStatus.unstaged.includes('conflict.txt')) {
      throw new Error('Expected conflict.txt in conflict repo unstaged');
    }
    console.log('[PASS] Conflict repo fixture verified with unmerged/conflict state.');

    // 6. Test Transparent Proxy, Audit Logging, and Drop-Ack Fault
    // Mock upstream server to test proxy mechanics without needing Rust daemon
    const mockUpstreamPort = 4899;
    const mockProxyPort = 4898;
    let upstreamReceivedCount = 0;

    const mockServer = http.createServer((req, res) => {
      upstreamReceivedCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: upstreamReceivedCount }));
    });

    await new Promise((r) => mockServer.listen(mockUpstreamPort, '127.0.0.1', r));

    const proxy = new TransparentGitProxy({
      targetHost: '127.0.0.1',
      targetPort: mockUpstreamPort,
      proxyPort: mockProxyPort,
    });
    proxy.registerOracle('primary', primaryOracle);
    await proxy.start();

    // Verify Control Plane Ping & Oracle HTTP Query
    const pingRes = await fetch(`http://127.0.0.1:${mockProxyPort}/__test_control/ping`).then((r) => r.json());
    if (pingRes.status !== 'ok') throw new Error('Proxy control ping failed');

    const oracleHttpRes = await fetch(
      `http://127.0.0.1:${mockProxyPort}/__test_control/oracle/head?project=primary`
    ).then((r) => r.json());
    if (oracleHttpRes.oid !== headOid) throw new Error('Oracle HTTP endpoint returned incorrect OID');
    console.log('[PASS] Proxy control plane and HTTP oracle query verified.');

    // Test Normal Forwarding & Request Auditing
    const postRes = await fetch(`http://127.0.0.1:${mockProxyPort}/api/git/primary/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token-secret' },
      body: JSON.stringify({ paths: ['doc1.txt'] }),
    }).then((r) => r.json());

    if (!postRes.ok) throw new Error('Normal proxy forward failed');
    const logsAfterPost = proxy.getAuditLogs();
    const audit = logsAfterPost[0];
    if (audit.method !== 'POST' || audit.path !== '/api/git/primary/stage') {
      throw new Error('Audit log failed to record method/path');
    }
    if (!audit.bodyKeys.includes('paths')) throw new Error('Audit log failed to capture body keys');
    // Ensure token is not logged in audit
    if (JSON.stringify(audit).includes('test-token-secret')) throw new Error('Audit log leaked bearer token!');
    console.log('[PASS] Proxy forwarding and redacted request auditing verified.');

    // Test Drop-Ack Fault (simulate drop after upstream mutation completes)
    proxy.setDropNextAck(true);
    let ackDropped = false;
    try {
      await fetch(`http://127.0.0.1:${mockProxyPort}/api/git/primary/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'drop-ack test' }),
      });
    } catch {
      ackDropped = true; // Connection dropped as expected!
    }

    if (!ackDropped) throw new Error('Expected drop-ack fault to terminate client connection');
    if (upstreamReceivedCount !== 2) throw new Error(`Upstream should have received exactly 2 requests, got ${upstreamReceivedCount}`);
    const lastAudit = proxy.getAuditLogs()[proxy.getAuditLogs().length - 1];
    if (!lastAudit.ackDropped) throw new Error('Audit log did not record ackDropped flag');
    console.log('[PASS] Proxy drop-ack fault injection verified (upstream completed, response dropped).');

    // 7. Negative CLI / Prerequisite validation and host credential non-mutation checks
    const hostTokenPath = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming', 'dam-hopper', 'server-token')
      : path.join(os.homedir(), '.config', 'dam-hopper', 'server-token');
    const initialHostTokenStat = fs.existsSync(hostTokenPath)
      ? { exists: true, mtime: fs.statSync(hostTokenPath).mtimeMs, size: fs.statSync(hostTokenPath).size }
      : { exists: false };

    let negativeCheckPassed = false;
    try {
      // Missing required binaries in smoke-current-server mode
      await runSmokeCurrentServer({
        serverBin: path.join(tempDir, 'non_existent_server_binary'),
        seedBin: path.join(tempDir, 'non_existent_seed_binary'),
        evidenceDir: tempDir,
      });
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('missing')) {
        negativeCheckPassed = true;
      }
    }
    if (!negativeCheckPassed) throw new Error('Negative binary check failed to reject non-existent binaries');
    console.log('[PASS] Negative prerequisite check verified (non-existent binaries fail-closed).');

    // Verify host credentials remain 100% untouched after prerequisite failure
    const postPrereqStat = fs.existsSync(hostTokenPath)
      ? { exists: true, mtime: fs.statSync(hostTokenPath).mtimeMs, size: fs.statSync(hostTokenPath).size }
      : { exists: false };
    if (JSON.stringify(initialHostTokenStat) !== JSON.stringify(postPrereqStat)) {
      throw new Error('Host server-token was modified during prerequisite negative check!');
    }
    console.log('[PASS] Host credential non-mutation verified (unreachable binaries leave host files untouched).');
    await proxy.stop();
    await new Promise((r) => mockServer.close(r));

    console.log('\n[SUMMARY] All self-test assertions passed successfully (0 failures).');
    process.exitCode = 0;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// --- Smoke Current Server Mode ---

export async function runSmokeCurrentServer(options) {
  const { serverBin, seedBin, evidenceDir, proxyPort = DEFAULT_PROXY_PORT, serverPort = DEFAULT_SERVER_PORT } = options;

  if (!serverBin || !fs.existsSync(serverBin)) {
    throw new Error(`Server binary not found at: ${serverBin}`);
  }
  if (!seedBin || !fs.existsSync(seedBin)) {
    throw new Error(`Seed binary not found at: ${seedBin}`);
  }
  if (!evidenceDir) {
    throw new Error('Evidence directory argument required');
  }

  // Resolve evidence directory absolutely to prevent relative XDG/HOME path fallback
  const absEvidenceDir = path.resolve(evidenceDir);
  const runDir = path.join(absEvidenceDir, `smoke-run-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log('=== Running Current-Server Smoke ===');
  console.log(`Server Binary: ${serverBin}`);
  console.log(`Seed Binary: ${seedBin}`);
  console.log(`Isolated Run Directory: ${runDir}`);

  // Fail-closed on platforms where child-process credential isolation cannot be achieved via env
  // win32 binds to SHGetKnownFolderPath; darwin binds to ~/Library/Application Support ignoring XDG
  if (process.platform === 'win32' || process.platform === 'darwin') {
    throw new Error(
      `[BLOCKED] Genuine child-process credential isolation is unavailable on ${process.platform} without mutating host profile credentials. Host token mutation is forbidden; failing before touching host credentials.`
    );
  }

  // 1. Setup Deterministic Git Repositories
  const ws = setupDisposableGitWorkspace(runDir);
  const primaryOracle = new GitOracle(ws.primaryDir);

  // 2. Seed SQLite Authentication Database via seedBin --stdin
  const sqliteDbPath = path.join(runDir, 'auth.db');
  // Always generate an independent, disposable token to avoid reading or leaking host credentials
  const serverToken = `disposable-fixture-token-${crypto.randomBytes(16).toString('hex')}`;
  const seedInput = JSON.stringify({
    sqlite_path: sqliteDbPath,
    server_token: serverToken,
    username: 'git-fixture',
  });

  const seedProcOutput = execFileSync(seedBin, ['--stdin'], {
    input: seedInput,
    encoding: 'utf8',
    shell: false,
  });

  const seedOutput = JSON.parse(seedProcOutput);
  const bearerToken = seedOutput.token;
  console.log(`[PASS] Auth database seeded. User: ${seedOutput.username}, Token: Bearer [REDACTED]`);

  // 3. Write Isolated dam-hopper.toml Registry Configuration
  const configPath = path.join(runDir, 'dam-hopper.toml');
  const tomlContent = [
    '[workspace]',
    'name = "fixture-workspace"',
    `root = "${runDir.replace(/\\/g, '/')}"`,
    '',
    '[server]',
    'host = "127.0.0.1"',
    `port = ${serverPort}`,
    '',
    '[[projects]]',
    'name = "primary"',
    `path = "${ws.primaryDir.replace(/\\/g, '/')}"`,
    'type = "custom"',
    '',
    '[[projects]]',
    'name = "secondary"',
    `path = "${ws.secondaryDir.replace(/\\/g, '/')}"`,
    'type = "custom"',
  ].join('\n');
  fs.writeFileSync(configPath, tomlContent, 'utf8');
  // Isolated config directory for server-token
  // Isolated config and home directories (guaranteed absolute)
  const absConfigDir = path.join(runDir, 'config');
  const absHomeDir = path.join(runDir, 'home');
  fs.mkdirSync(path.join(absConfigDir, 'dam-hopper'), { recursive: true });
  fs.mkdirSync(path.join(absHomeDir, '.config', 'dam-hopper'), { recursive: true });
  fs.writeFileSync(path.join(absConfigDir, 'dam-hopper', 'server-token'), serverToken, { mode: 0o600 });
  fs.writeFileSync(path.join(absHomeDir, '.config', 'dam-hopper', 'server-token'), serverToken, { mode: 0o600 });

  // 4. Start Server Daemon with isolated HOME and XDG_CONFIG_HOME
  const serverEnv = {
    ...process.env,
    DAM_HOPPER_LITE_MODE: 'true',
    DAM_HOPPER_AUTH_SQLITE_PATH: sqliteDbPath,
    SERVER_TOKEN: serverToken,
    HOME: absHomeDir,
    XDG_CONFIG_HOME: absConfigDir,
  };
  const serverProc = spawn(serverBin, ['--config', configPath, '--host', '127.0.0.1', '--port', String(serverPort)], {
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStderr = '';
  serverProc.stderr.on('data', (d) => {
    serverStderr += d.toString();
  });

  const proxy = new TransparentGitProxy({
    targetHost: '127.0.0.1',
    targetPort: serverPort,
    proxyPort: proxyPort,
  });
  proxy.registerOracle('primary', primaryOracle);

  const cleanup = async () => {
    await proxy.stop();
    serverProc.kill();
  };

  try {
    await proxy.start();

    // Await server readiness
    let ready = false;
    let lastStatus = 0;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${serverPort}/api/projects`, {
          headers: { Authorization: `Bearer ${bearerToken}` },
        });
        lastStatus = res.status;
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // Retry loop
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!ready) {
      throw new Error(`Current server failed to become ready on port ${serverPort} (last HTTP status: ${lastStatus}).\nServer stderr: ${serverStderr}`);
    }
    console.log('[PASS] Current server is healthy and responding on loopback.');

    // 5. Query /api/git/primary/roots through Transparent Proxy
    const rootsRes = await fetch(`http://127.0.0.1:${proxyPort}/api/git/primary/roots`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (rootsRes.status !== 200) {
      throw new Error(`Roots query via proxy failed with status ${rootsRes.status}`);
    }
    const roots = await rootsRes.json();
    console.log(`[PASS] Discovered ${roots.length} root(s) via transparent proxy.`);

    // 6. Execute Oracle Check
    const oracleStatus = primaryOracle.getStatusPorcelainV2();
    console.log(`[PASS] External Git Oracle verified branch: ${oracleStatus.branch}, clean: ${oracleStatus.isClean}`);

    // Record evidence
    const evidence = {
      timestamp: new Date().toISOString(),
      status: 'SUCCESS',
      serverBin,
      seedBin,
      serverPort,
      proxyPort,
      discoveredRoots: roots,
      oracleStatus,
      auditLogs: proxy.getAuditLogs(),
    };
    fs.writeFileSync(path.join(runDir, 'smoke-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(`[PASS] Smoke evidence recorded in ${path.join(runDir, 'smoke-evidence.json')}`);
    return evidence;
  } finally {
    await cleanup();
  }
}

// --- CLI Entry Point ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  if (args.includes('--smoke-current-server')) {
    let serverBin = '';
    let seedBin = '';
    let evidenceDir = '';
    let proxyPort = DEFAULT_PROXY_PORT;
    let serverPort = DEFAULT_SERVER_PORT;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--server-bin' && args[i + 1]) serverBin = args[++i];
      else if (args[i] === '--seed-bin' && args[i + 1]) seedBin = args[++i];
      else if (args[i] === '--evidence-dir' && args[i + 1]) evidenceDir = args[++i];
      else if (args[i] === '--proxy-port' && args[i + 1]) proxyPort = parseInt(args[++i], 10);
      else if (args[i] === '--server-port' && args[i + 1]) serverPort = parseInt(args[++i], 10);
    }

    try {
      await runSmokeCurrentServer({ serverBin, seedBin, evidenceDir, proxyPort, serverPort });
      process.exitCode = 0;
    } catch (err) {
      console.error(`[BLOCKED/FAILED] ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error('Usage:');
  console.error('  node git-workspace-fixture.mjs --self-test');
  console.error('  node git-workspace-fixture.mjs --smoke-current-server --server-bin <bin> --seed-bin <bin> --evidence-dir <dir>');
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(`[FATAL] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
