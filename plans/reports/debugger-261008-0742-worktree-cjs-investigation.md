# Diagnostic Report: worktree.cjs & Distribution Mechanism Investigation

**Date**: 2026-10-08  
**Author**: Debugger Agent  
**Target Repository**: `/home/loidinh/WS/evcrate`  
**Primary Source File**: `.evcrate/source/.claude/scripts/worktree.cjs`  
**Report Artifact**: `plans/reports/debugger-261008-0742-worktree-cjs-investigation.md`

---

## 1. Executive Summary

- **Problem 1**: `worktree.cjs` lacks `--base <branch>` option. Argument parser ignores `--base`; `detectBaseBranch()` hardcodes sequential preference `['dev', 'develop', 'main', 'master']`. If `dev`/`develop` exists locally or remotely, it unconditionally defaults to `develop`, preventing users/agents from basing worktrees on `main`.
- **Problem 2**: `worktree.cjs` never fetches or compares `baseBranch` against `origin` prior to creating worktree. If local base branch is behind origin, `git worktree add -b <feature> <path> <baseBranch>` branches from stale local commit.
- **Problem 3 (Distribution)**: `.evcrate/source/.claude/` is single source of truth for all targets. Target projections (`.omp`, `.pi`, `.codex`, `.gemini`, `.copilot`, `.antigravity`) generated via `evcrate distribute build` (`npm run distribute:build`) executed by TypeScript compiler + projection adapters in `src/adapters/`.
- **OMP Script Gap**: `.omp/evcrate/scripts/worktree.cjs` currently byte-for-byte identical to Claude source (`md5: 32dc6140ccbf6fe3e658a36f25a12f56`). Unlike Codex/Gemini/Copilot adapters, OMP script transform in `src/adapters/omp/hooks.ts` rewrites harness directory paths but leaks `claude` CLI commands (`cd ... && claude`) and `AskUserQuestion` suggestions.

---

## 2. Technical Analysis

### 2.1 Analysis of `.claude/scripts/worktree.cjs`

#### Argument Parsing (lines 32–61)
- Currently parses: `--json`, `--prefix <type>`, `--env <files>`, `--dry-run`.
- Omits `--base <branch>` parsing:
  - Any user/agent supplying `--base main` leaves `--base` in `args` array.
  - In monorepo mode, `arg1` becomes `--base`, `arg2` becomes `main`, resulting in project search failure (`PROJECT_NOT_FOUND`).
  - In standalone mode, `arg1` becomes `--base`, creating branch named `feat/--base`.

#### Base Branch Detection: `detectBaseBranch(cwd)` (lines 166–176)
```javascript
function detectBaseBranch(cwd) {
  const branches = ['dev', 'develop', 'main', 'master'];
  for (const branch of branches) {
    const local = git(`show-ref --verify --quiet refs/heads/${branch}`, { silent: true, cwd });
    if (local.success) return branch;
    const remote = git(`show-ref --verify --quiet refs/remotes/origin/${branch}`, { silent: true, cwd });
    if (remote.success) return branch;
  }
  return 'main'; // fallback
}
```
Flaws:
1. Static array evaluation order forces `dev` or `develop` over `main` even when repo standard is `main`.
2. Ignores remote default pointer (`git symbolic-ref refs/remotes/origin/HEAD`).
3. No parameter accepts explicit user override.

#### Worktree Creation: `cmdCreate()` (lines 410–496)
```javascript
// Line 413:
const baseBranch = detectBaseBranch(workDir);
...
// Lines 473-481: Only fetches branchName if reconnecting to existing remote feature branch!
if (branchStatus === 'remote') {
  const fetchResult = git(`fetch origin ${branchName}`, { silent: true, cwd: workDir });
  ...
}

// Line 488:
createResult = git(`worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`, { cwd: workDir });
```
Flaws:
1. Never executes `git fetch origin ${baseBranch}` before creation.
2. If local `main` was checked out months ago and is behind `origin/main`, worktree starts at stale local commit.
3. If `baseBranch` exists only on remote and not locally, `git worktree add -b ... baseBranch` fails or creates unintended tracking state.
4. When branching from remote refs, lacks `--no-track` flag, coupling new feature branch to upstream trunk instead of feature remote.

#### Repo Information: `cmdInfo()` (lines 267–303)
- Evaluates `detectBaseBranch(gitRoot)` unconditionally.
- Does not accept `--base <branch>` to validate user-selected base.
- Does not expose available/detected base candidates or origin freshness.

---

### 2.2 Target Comparison Matrix

All instances of `worktree.cjs` in `/home/loidinh/WS/evcrate`:

| Path | MD5 Checksum | Status vs Claude Source |
|---|---|---|
| `.evcrate/source/.claude/scripts/worktree.cjs` | `32dc6140ccbf6fe3e658a36f25a12f56` | **Canonical Source of Truth** |
| `.evcrate/source/.omp/evcrate/scripts/worktree.cjs` | `32dc6140ccbf6fe3e658a36f25a12f56` | Identical (untransformed) |
| `.evcrate/source/.pi/agent/evcrate/scripts/worktree.cjs` | `32dc6140ccbf6fe3e658a36f25a12f56` | Identical (untransformed) |
| `.evcrate/source/.antigravity/scripts/worktree.cjs` | `32dc6140ccbf6fe3e658a36f25a12f56` | Identical (untransformed) |
| `.evcrate/source/.codex/scripts/worktree.cjs` | `15c41d20b0d8ca967392b6139bb2e3f7` | Transformed (`claude` -> `codex`, `AskUserQuestion` -> `request_user_input`) |
| `.evcrate/source/.copilot/evcrate/scripts/worktree.cjs` | `928aaa17638a9e76d45c1177ee2f536c` | Transformed (`claude` -> `copilot`, `AskUserQuestion` -> `user input`) |
| `.evcrate/source/.gemini/scripts/worktree.cjs` | `d7f9896c43d31b4a0db3f4f5ef0031f1` | Transformed (`claude` -> `gemini`, `AskUserQuestion` -> `ask_user`) |

**Observations**:
- Codex, Copilot, Gemini adapters apply AST/regex post-processors converting CLI commands and tool prompts.
- OMP adapter (`src/adapters/omp/hooks.ts`) runs `translateHarnessReferences(value)`, rewriting `.claude/` path strings but omitting CLI executable (`claude` -> `omp`) and prompt tool (`AskUserQuestion` -> `ask the user`) replacements in script bodies.

---

### 2.3 Distribution Pipeline Mechanics

1. **Architecture**:
   - Canonical root: `.evcrate/source/.claude/`
   - Build engine: `src/distribution/local-build.ts` + `local-build-staging.ts`
   - Targets registry: `.evcrate/targets/manifest.json`
   - Adapter implementations: `src/adapters/{antigravity,codex,copilot,gemini,omp,pi,vscode}/`
2. **Execution Flow**:
   - `prepareSharedBuildInputs()` snapshots `.evcrate/source/.claude`.
   - `buildAndStageTarget()` executes target adapter `build(context)`.
   - Files copied from stage into `.evcrate/source/<target>/` via `promoteTransaction()`.
   - Manifest digests generated in `.evcrate/build-manifest.json` and `.evcrate/targets/<target>/manifest.json`.
3. **CLI / NPM Commands**:
   - `npm run build`: Compiles TypeScript compiler/adapters (`src/` -> `dist/`).
   - `npm run distribute:build` (`node dist/cli/evcrate.js distribute build`): Builds all targets into `.evcrate/source/` and updates manifests.
   - `npm run distribute:check` (`node dist/cli/evcrate.js distribute check`): Validates tree hashes against build manifests.
   - `npm run distribute:omp`: Target-only build for OMP.
   - `npm run distribute:all`: Build + local publishing pipeline.

---

## 3. Root Causes & Exact Bugs

### Bug 1: Missing `--base <branch>` CLI Argument
- **File**: `.evcrate/source/.claude/scripts/worktree.cjs:32-55`
- **Root Cause**: Argument parsing extracts `--json`, `--prefix`, `--env`, `--dry-run`, but lacks extraction for `--base`.
- **Consequence**: Users cannot specify base branch; flag values bleed into positional arguments.

### Bug 2: Inflexible Detection Order in `detectBaseBranch()`
- **File**: `.evcrate/source/.claude/scripts/worktree.cjs:166-176`
- **Root Cause**: Fixed iteration through `['dev', 'develop', 'main', 'master']` without querying upstream default (`origin/HEAD`) or allowing caller overrides.
- **Consequence**: Worktrees forced onto `dev`/`develop` even when team standard is `main`.

### Bug 3: Stale Worktree Creation Due to Missing Origin Fetch
- **File**: `.evcrate/source/.claude/scripts/worktree.cjs:483-490`
- **Root Cause**: Only fetches `origin ${branchName}` if feature branch existed remotely. Does not fetch `origin ${baseBranch}`.
- **Consequence**: Local base branch remains at old revision; worktree created from stale commit, leading to immediate merge conflicts.

### Bug 4: OMP Adapter Text Transformation Defect
- **File**: `src/adapters/omp/hooks.ts:33-46`
- **Root Cause**: `scriptTransform()` only applies `translateHarnessReferences()` which matches `\.claude` directory paths; does not substitute `claude` command invocation or `AskUserQuestion`.
- **Consequence**: `.omp/evcrate/scripts/worktree.cjs` instructs users to run `claude` instead of `omp`.

### Bug 5: Omission in Documentation & Command Markdown
- **Files**:
  - `.evcrate/source/.claude/scripts/worktree.cjs:6-18` (header docstring)
  - `.evcrate/source/.claude/commands/worktree.md` (canonical command definition)
  - Projected command files (`.omp/evcrate/commands/cmd-worktree.md`, etc.)
- **Root Cause**: Help text and option tables do not document `--base`.

### Bug 6: Test Suite Bug in `worktree.test.cjs`
- **File**: `.evcrate/source/.claude/scripts/worktree.test.cjs:13`
- **Root Cause**: Undeclared global `USER` (`const MONOREPO_DIR = \`/home/${USER}/evcrate\``) throws `ReferenceError: USER is not defined` on Node 18+. Must use `process.env.USER`.

---

## 4. Actionable Recommendations & Implementation Plan

### 4.1 Update Canonical Script: `.evcrate/source/.claude/scripts/worktree.cjs`

#### 1. Header Comments & Argument Parsing
```javascript
// Add --base to header options docstring
 * Options:
 *   --base <branch>    Base branch to branch off from (e.g. main, develop)
 *   --prefix <type>    Branch prefix (feat|fix|refactor|docs|test|chore|perf)
...

// Add to argument parsing (around line 44):
const baseIndex = args.indexOf('--base');
let explicitBaseBranch = null;
if (baseIndex > -1) {
  explicitBaseBranch = args[baseIndex + 1] || null;
  args.splice(baseIndex, 2);
}
```

#### 2. Enhanced `detectBaseBranch(cwd)`
```javascript
function detectBaseBranch(cwd) {
  // 1. Check upstream origin/HEAD if configured
  const headRef = git('symbolic-ref refs/remotes/origin/HEAD', { silent: true, cwd });
  if (headRef.success) {
    const defaultBranch = headRef.output.replace(/^refs\/remotes\/origin\//, '').trim();
    if (defaultBranch) return defaultBranch;
  }
  // 2. Candidate scan
  const branches = ['dev', 'develop', 'main', 'master'];
  for (const branch of branches) {
    const local = git(`show-ref --verify --quiet refs/heads/${branch}`, { silent: true, cwd });
    if (local.success) return branch;
    const remote = git(`show-ref --verify --quiet refs/remotes/origin/${branch}`, { silent: true, cwd });
    if (remote.success) return branch;
  }
  return 'main';
}
```

#### 3. Update `cmdInfo()`
```javascript
function cmdInfo() {
  const gitRoot = checkGitRepo();
  checkGitVersion();

  const projects = parseGitModules(gitRoot);
  const isMonorepo = projects.length > 0;
  
  if (explicitBaseBranch) {
    const exists = branchExists(explicitBaseBranch, gitRoot);
    if (!exists) {
      outputError('BASE_BRANCH_NOT_FOUND', `Base branch "${explicitBaseBranch}" does not exist`, {
        suggestion: 'Verify branch exists locally or on remote origin'
      });
    }
  }
  const baseBranch = explicitBaseBranch || detectBaseBranch(gitRoot);
  ...
```

#### 4. Update `cmdCreate()` with Origin Fetch & Ancestor Selection
```javascript
  // Resolve base branch
  if (explicitBaseBranch) {
    const exists = branchExists(explicitBaseBranch, workDir);
    if (!exists) {
      outputError('BASE_BRANCH_NOT_FOUND', `Base branch "${explicitBaseBranch}" does not exist`, {
        suggestion: 'Verify branch exists locally or on remote origin'
      });
    }
  }
  const baseBranch = explicitBaseBranch || detectBaseBranch(workDir);

  // Check remote origin availability
  const hasOrigin = git('remote get-url origin', { silent: true, cwd: workDir }).success;
  let remoteBaseAvailable = false;

  if (hasOrigin) {
    // Fetch base branch from origin
    const fetchBase = git(`fetch origin ${baseBranch}`, { silent: true, cwd: workDir });
    if (fetchBase.success) {
      remoteBaseAvailable = true;
    } else if (!branchExists(baseBranch, workDir)) {
      outputError('FETCH_FAILED', `Failed to fetch base branch "${baseBranch}" from remote`, {
        suggestion: 'Check network connection or specify existing local branch with --base'
      });
    } else {
      warnings.push(`Could not fetch "${baseBranch}" from origin; creating worktree from local commits.`);
    }
  }

  // Determine starting revision
  let startPoint = baseBranch;
  const localRef = `refs/heads/${baseBranch}`;
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const hasLocal = git(`show-ref --verify --quiet ${localRef}`, { silent: true, cwd: workDir }).success;
  const hasRemote = remoteBaseAvailable && git(`show-ref --verify --quiet ${remoteRef}`, { silent: true, cwd: workDir }).success;

  if (hasRemote && !hasLocal) {
    startPoint = remoteRef;
  } else if (hasRemote && hasLocal) {
    const localHash = git(`rev-parse ${localRef}`, { silent: true, cwd: workDir }).output.trim();
    const remoteHash = git(`rev-parse ${remoteRef}`, { silent: true, cwd: workDir }).output.trim();
    if (localHash !== remoteHash) {
      const isAncestor = git(`merge-base --is-ancestor ${localRef} ${remoteRef}`, { silent: true, cwd: workDir }).success;
      if (isAncestor) {
        // Local is strictly behind origin; use remote HEAD
        startPoint = remoteRef;
      } else {
        // Local has unpushed commits or diverged; retain local commits
        startPoint = localRef;
      }
    }
  }

  // Creation command:
  if (branchStatus) {
    createResult = git(`worktree add "${worktreePath}" ${branchName}`, { cwd: workDir });
  } else {
    // Use --no-track when startPoint is remote ref to avoid tracking upstream trunk
    const trackFlag = startPoint.startsWith('refs/remotes/') ? '--no-track ' : '';
    createResult = git(`worktree add -b ${branchName} ${trackFlag}"${worktreePath}" ${startPoint}`, { cwd: workDir });
  }
```

---

### 4.2 Update Documentation in `.evcrate/source/.claude/commands/worktree.md`
- Add `--base <branch>` to `argument-hint` on frontmatter:
  ```markdown
  argument-hint: "[feature-description] OR [project] [feature] (monorepo) [--base <branch>]"
  ```
- Document `--base` under options table in `worktree.md`.

---

### 4.3 Update OMP Adapter: `src/adapters/omp/hooks.ts`
Enhance `scriptTransform()` in `src/adapters/omp/hooks.ts` to replace `claude` and `AskUserQuestion`:
```typescript
function scriptTransform(value: string, relative: string, map: CommandMap): string {
  let rendered = renderCommandReferences(translateHarnessReferences(value), map);
  if (relative === 'worktree.cjs') {
    rendered = rendered
      .replaceAll('claude', 'omp')
      .replaceAll('AskUserQuestion', 'ask the user');
  }
  ...
```

---

### 4.4 Fix Test Suite in `.evcrate/source/.claude/scripts/worktree.test.cjs`
- Replace line 13:
  ```javascript
  const user = process.env.USER || process.env.USERNAME || 'unknown';
  const MONOREPO_DIR = `/home/${user}/evcrate`;
  ```
- Add unit tests for `--base <branch>` handling and custom base selection.

---

### 4.5 Target Distribution Procedure
Once changes are made to canonical source and adapter:
```bash
# 1. Rebuild TypeScript compiler & adapters
npm --prefix /home/loidinh/WS/evcrate run build

# 2. Distribute to all target directories (.omp, .pi, .gemini, .codex, etc.)
npm --prefix /home/loidinh/WS/evcrate run distribute:build

# 3. Verify consistency against target manifests
npm --prefix /home/loidinh/WS/evcrate run distribute:check

# 4. Run test suite
node /home/loidinh/WS/evcrate/.evcrate/source/.claude/scripts/worktree.test.cjs
```

---

## 5. Supporting Evidence

1. **MD5 Checksum Verification**:
   ```
   32dc6140ccbf6fe3e658a36f25a12f56  .claude/scripts/worktree.cjs
   32dc6140ccbf6fe3e658a36f25a12f56  .omp/evcrate/scripts/worktree.cjs
   32dc6140ccbf6fe3e658a36f25a12f56  .pi/agent/evcrate/scripts/worktree.cjs
   32dc6140ccbf6fe3e658a36f25a12f56  .antigravity/scripts/worktree.cjs
   15c41d20b0d8ca967392b6139bb2e3f7  .codex/scripts/worktree.cjs
   928aaa17638a9e76d45c1177ee2f536c  .copilot/evcrate/scripts/worktree.cjs
   d7f9896c43d31b4a0db3f4f5ef0031f1  .gemini/scripts/worktree.cjs
   ```
2. **Git Behavior Proof**:
   - In bare clone tests with remote ahead of local, `git worktree add -b feat/test --no-track "<path>" origin/main` successfully creates worktree on latest upstream commit without polluting branch tracking.
3. **Distribution Clean State**:
   - `npm run distribute:check` returns status `ok`, verifying that the build pipeline is deterministic.

---

## 6. Unresolved Questions

1. Should `--base` support arbitrary commit SHAs and tags in addition to branch names? (Currently git worktree supports any commit-ish).
2. If local base branch and origin base branch have diverged (e.g. rebased upstream), should `cmdCreate` abort with an error or prompt the user for resolution?
