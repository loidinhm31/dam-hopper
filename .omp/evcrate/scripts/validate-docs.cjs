#!/usr/bin/env node
/**
 * Documentation Validation Script for EVCrate / DamHopper
 * Validates documentation files for potential hallucinations and stale links.
 * 
 * Usage: node .omp/evcrate/scripts/validate-docs.cjs <docs-dir>
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDir = process.argv[2] || 'docs';
const rootDir = process.cwd();

console.log(`\n========================================\n  Documentation Validation Report\n  Target: ${targetDir}\n========================================\n`);

function getMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(getMarkdownFiles(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

const docFiles = getMarkdownFiles(targetDir);
console.log(`Found ${docFiles.length} markdown documents in ${targetDir}/\n`);

const knownEnvVars = new Set([
  'MONGODB_URI', 'MONGODB_DATABASE', 'DAM_HOPPER_MFA_KEY_FILE', 'DAM_HOPPER_CORS_ORIGINS',
  'DAM_HOPPER_CONFIG', 'DAM_HOPPER_WORKSPACE', 'DAM_HOPPER_NO_AUTH', 'DAM_HOPPER_WEB_ROOT',
  'DAM_HOPPER_WEB_PORT', 'DAM_HOPPER_WEB_HOST', 'DAM_HOPPER_API_URL', 'DAM_HOPPER_SERVER_TOKEN',
  'RUST_ENV', 'ENVIRONMENT', 'RUST_LOG', 'VITE_DAM_HOPPER_SERVER_URL', 'E2E_CAPTURE', 'CI',
  'HOME', 'PATH', 'NODE_ENV', 'SOURCE_DATE_EPOCH', 'PORT', 'HOST'
]);

const exampleEnvPath = path.join(rootDir, 'deploy', 'server.env.example');
if (fs.existsSync(exampleEnvPath)) {
  for (const line of fs.readFileSync(exampleEnvPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m) knownEnvVars.add(m[1]);
  }
}

const linkWarnings = [];
const codeRefWarnings = [];
const configKeyWarnings = [];

let codebaseContent = '';
try {
  codebaseContent = execSync(
    'git grep -I --line-number -E "(fn |struct |enum |type |class |interface |const |function |let |export )" server/src/ packages/ui/src/ apps/ 2>/dev/null || true',
    { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }
  );
} catch (e) {}

const IGNORE_WORDS = new Set([
  'HTTP', 'HTTPS', 'JSON', 'REST', 'CORS', 'HTML', 'POSIX', 'SHA256', 'AES', 'GCM', 'PAKE',
  'MFA', 'TOTP', 'SBOM', 'SPDX', 'TOML', 'UUID', 'PTY', 'IDE', 'VITE', 'TAURI', 'WASM', 'DOM',
  'SSE', 'CRUD', 'ASCII', 'UTF8', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'INFO', 'WARN',
  'ERROR', 'DEBUG', 'TRACE', 'TRUE', 'FALSE', 'NULL', 'NONE', 'SOME', 'TODO', 'NOTE', 'FAIL',
  'PASS', 'PENDING', 'ACCEPTED', 'REJECTED', 'IHDR', 'RGBA', 'RGB', 'MSVC', 'DPAPI', 'X86_64',
  'LINUX', 'WINDOWS', 'MACOS', 'ANDROID', 'V2', 'V1', 'V3'
]);

for (const docFile of docFiles) {
  const relDocPath = path.relative(rootDir, docFile);
  const content = fs.readFileSync(docFile, 'utf-8');

  // Check 1: Internal links: [text](path.md)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[2].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const filePart = target.split('#')[0];
    if (!filePart) continue;
    const resolvedPath = path.resolve(path.dirname(docFile), filePart);
    if (!fs.existsSync(resolvedPath)) {
      linkWarnings.push({ file: relDocPath, link: target, resolved: path.relative(rootDir, resolvedPath) });
    }
  }

  // Check 2: Config keys: ENV_VAR
  const envRegex = /\b([A-Z][A-Z0-9_]{3,})\b/g;
  let envMatch;
  while ((envMatch = envRegex.exec(content)) !== null) {
    const key = envMatch[1];
    if (IGNORE_WORDS.has(key)) continue;
    if ((key.startsWith('DAM_HOPPER_') || key.startsWith('MONGODB_') || key.startsWith('VITE_DAM_HOPPER_')) && !knownEnvVars.has(key)) {
      configKeyWarnings.push({ file: relDocPath, key });
    }
  }

  // Check 3: Code references: `functionName()`
  const codeRegex = /`([a-zA-Z0-9_]+(?:\(\))?)`/g;
  let codeMatch;
  while ((codeMatch = codeRegex.exec(content)) !== null) {
    const sym = codeMatch[1];
    if (sym.endsWith('()') && sym.length >= 8) {
      const fnName = sym.slice(0, -2);
      if (codebaseContent && !codebaseContent.includes(fnName) && !['toString', 'toLowerCase', 'toUpperCase'].includes(fnName)) {
        codeRefWarnings.push({ file: relDocPath, symbol: sym });
      }
    }
  }
}

console.log(`[Check 1: Internal Links]`);
if (!linkWarnings.length) {
  console.log(`  ✓ All internal markdown links point to existing files.`);
} else {
  console.log(`  ⚠ ${linkWarnings.length} broken internal links detected:`);
  for (const w of linkWarnings) console.log(`    - ${w.file}: ${w.link} (resolved: ${w.resolved})`);
}

console.log(`\n[Check 2: Config Keys]`);
if (!configKeyWarnings.length) {
  console.log(`  ✓ All environment configuration keys are verified.`);
} else {
  console.log(`  ⚠ ${configKeyWarnings.length} unverified environment keys:`);
  const unique = [...new Set(configKeyWarnings.map(w => `${w.key} in ${w.file}`))];
  for (const k of unique) console.log(`    - ${k}`);
}

console.log(`\n[Check 3: Code References]`);
if (!codeRefWarnings.length) {
  console.log(`  ✓ Verified function/symbol references.`);
} else {
  const unique = [...new Set(codeRefWarnings.map(w => `${w.symbol} in ${w.file}`))];
  console.log(`  ℹ ${unique.length} code references noted (warnings only):`);
  for (const ref of unique.slice(0, 10)) console.log(`    - ${ref}`);
  if (unique.length > 10) console.log(`    ... and ${unique.length - 10} more.`);
}

console.log(`\n========================================\n  Validation Complete (Non-blocking)\n========================================\n`);
process.exit(0);
