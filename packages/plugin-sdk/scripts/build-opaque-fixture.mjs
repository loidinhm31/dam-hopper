#!/usr/bin/env node

import { build } from 'vite';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT_DIR, 'fixtures', 'opaque-ui');
const DIST_DIR = join(FIXTURE_DIR, 'dist');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

const CSS_CONTENT = `body {
  margin: 0;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #1a1a1a;
  color: #e0e0e0;
}
.plugin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #333;
  padding-bottom: 12px;
}
.plugin-nav button {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 12px;
  margin-right: 8px;
  border-radius: 4px;
  cursor: pointer;
}
.plugin-nav button.active {
  background: #0066cc;
  color: #fff;
}
.view-panel {
  padding: 16px 0;
}
.handshake-badge {
  font-size: 12px;
  padding: 4px 8px;
  background: #333;
  border-radius: 4px;
}`;

export async function buildOpaqueFixture() {
  const result = await build({
    configFile: false,
    root: FIXTURE_DIR,
    logLevel: 'error',
    build: {
      write: false,
      minify: 'esbuild',
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          format: 'iife',
          name: 'OpaquePluginApp',
          inlineDynamicImports: true,
        },
      },
    },
  });

  const output = Array.isArray(result) ? result[0].output : result.output;
  let jsCode = '';
  for (const item of output) {
    if (item.type === 'chunk' && item.code) {
      jsCode = item.code;
      break;
    }
  }

  if (!jsCode) {
    throw new Error('Failed to extract bundled JS chunk from Vite build output');
  }

  const scriptHash = 'sha256-' + createHash('sha256').update(jsCode).digest('base64');
  const styleHash = 'sha256-' + createHash('sha256').update(CSS_CONTENT).digest('base64');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Opaque Plugin Frame</title>
  <style>${CSS_CONTENT}</style>
</head>
<body>
  <div id="root"></div>
  <script>${jsCode}</script>
</body>
</html>`;

  const sha256 = createHash('sha256').update(html).digest('hex');
  const size = Buffer.byteLength(html, 'utf-8');

  if (size > MAX_SIZE_BYTES) {
    throw new Error(`Self-contained HTML size ${size} exceeds limit of ${MAX_SIZE_BYTES} bytes`);
  }

  return {
    html,
    sha256,
    size,
    scriptHash,
    styleHash,
  };
}

async function main() {
  const verify = process.argv.includes('--verify');

  const run1 = await buildOpaqueFixture();

  if (verify) {
    const run2 = await buildOpaqueFixture();
    if (run1.html !== run2.html) {
      console.error('VERIFICATION FAILED: Two successive builds produced non-identical outputs!');
      process.exit(1);
    }
    console.log('✓ Verification passed: successive builds are byte-identical.');
  }

  mkdirSync(DIST_DIR, { recursive: true });
  writeFileSync(join(DIST_DIR, 'index.html'), run1.html, 'utf-8');
  writeFileSync(
    join(DIST_DIR, 'metadata.json'),
    JSON.stringify(
      {
        sha256: run1.sha256,
        size: run1.size,
        scriptHash: run1.scriptHash,
        styleHash: run1.styleHash,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`Successfully built opaque UI fixture:`);
  console.log(`  File: dist/index.html (${run1.size} bytes)`);
  console.log(`  Document SHA-256: ${run1.sha256}`);
  console.log(`  CSP script-src: '${run1.scriptHash}'`);
  console.log(`  CSP style-src:  '${run1.styleHash}'`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
