#!/usr/bin/env node
/**
 * Deterministic semantic fixture corpus generator for DamHopper Phase 09 qualification.
 *
 * Canonical seed and workloads from reports/phase-09-qualification-budget-v1.json:
 * - fixtureSeed: 24301
 * - small:    8 files *  4,096 UTF-8 bytes =    32,768 bytes (32 KiB)
 * - medium:  64 files * 16,384 UTF-8 bytes = 1,048,576 bytes (1 MiB)
 * - large:  256 files * 32,768 UTF-8 bytes = 8,388,608 bytes (8 MiB)
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_FILENAME = fileURLToPath(import.meta.url);
const MODULE_DIRNAME = dirname(MODULE_FILENAME);

export const CORPUS_SEED = 24301;
export const TIER_SPECS = Object.freeze({
  small: { fileCount: 8, bytesPerFile: 4096, totalBytes: 8 * 4096 },
  medium: { fileCount: 64, bytesPerFile: 16384, totalBytes: 64 * 16384 },
  large: { fileCount: 256, bytesPerFile: 32768, totalBytes: 256 * 32768 },
});

const EXTENSIONS = ["ts", "tsx", "js", "jsx"];

function nextPrng(state) {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0);
}

function buildExactByteSource({ tier, index, fileCount, targetBytes, seed = CORPUS_SEED }) {
  const ext = EXTENSIONS[index % EXTENSIONS.length];
  const isTs = ext === "ts" || ext === "tsx";
  const pkg = index < fileCount / 2 ? "core" : "app";
  const prevIdx = index === 0 ? 0 : index - 1;
  const prevPkg = prevIdx < fileCount / 2 ? "core" : "app";
  const prevExt = EXTENSIONS[prevIdx % EXTENSIONS.length];
  const relImport =
    index === 0
      ? null
      : pkg === prevPkg
        ? `./module_${String(prevIdx).padStart(3, "0")}.${prevExt}`
        : `../${prevPkg}/module_${String(prevIdx).padStart(3, "0")}.${prevExt}`;

  let prngState = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  prngState = nextPrng(prngState);
  const seedTag = prngState.toString(16).padStart(8, "0");

  const lines = [`// Seed: ${seed} (${seedTag}) | Tier: ${tier} | File: ${index}/${fileCount}`];
  lines.push(relImport ? `import { computeNode_${prevIdx} } from "${relImport}";` : `const computeNode_0_seed = ${seed};`);

  if (isTs) {
    lines.push(
      `export interface SemanticContract_${index} {`,
      `  executeNode(input: number): number;`,
      `}`,
      `export class PrimaryNode_${index} implements SemanticContract_${index} {`,
      `  executeNode(input: number): number {`,
      `    return input + ${index}${relImport ? ` + computeNode_${prevIdx}(1)` : " + computeNode_0_seed"};`,
      `  }`,
      `}`,
      `export class SecondaryNode_${index} implements SemanticContract_${index} {`,
      `  executeNode(input: number): number {`,
      `    return input * 2 + ${index};`,
      `  }`,
      `}`,
      `export function computeNode_${index}(val: number): number {`,
      `  const inst: SemanticContract_${index} = new PrimaryNode_${index}();`,
      `  return inst.executeNode(val);`,
      `}`,
    );
  } else {
    lines.push(
      `export class PrimaryNode_${index} {`,
      `  executeNode(input) {`,
      `    return input + ${index}${relImport ? ` + computeNode_${prevIdx}(1)` : " + computeNode_0_seed"};`,
      `  }`,
      `}`,
      `export function computeNode_${index}(val) {`,
      `  const inst = new PrimaryNode_${index}();`,
      `  return inst.executeNode(val);`,
      `}`,
    );
  }

  lines.push(`/* 🚀 Café Cafe\u0301 */ export const unicodeSymbol_${index} = ${index + 100}; export const unicodeRef_${index} = unicodeSymbol_${index};`);

  const header = lines.join("\n") + "\n";
  let currentBytes = Buffer.byteLength(header, "utf8");
  let padIdx = 0;
  const padLines = [];
  while (currentBytes + 80 < targetBytes) {
    prngState = nextPrng(prngState);
    const token = prngState.toString(16).padStart(8, "0");
    const line = `export const pad_${index}_${String(padIdx).padStart(4, "0")} = "${token}_deterministic_payload";\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (currentBytes + lineBytes + 16 > targetBytes) break;
    padLines.push(line);
    currentBytes += lineBytes;
    padIdx++;
  }

  let body = header + padLines.join("");
  const remaining = targetBytes - Buffer.byteLength(body, "utf8");
  if (remaining > 0) {
    body += remaining >= 4 ? `// ${"x".repeat(remaining - 4)}\n` : "\n".repeat(remaining);
  }
  const finalBuf = Buffer.from(body, "utf8");
  if (finalBuf.length !== targetBytes) {
    throw new Error(`Byte size mismatch: expected ${targetBytes}, got ${finalBuf.length}`);
  }
  return {
    relPath: `packages/${pkg}/module_${String(index).padStart(3, "0")}.${ext}`,
    content: body,
    sha256: createHash("sha256").update(finalBuf).digest("hex"),
    bytes: finalBuf.length,
  };
}

export function generateCorpusTier(tier, outputDir, seed = CORPUS_SEED) {
  const spec = TIER_SPECS[tier];
  if (!spec) throw new Error(`Unknown corpus tier: ${tier}`);
  mkdirSync(join(outputDir, "packages/core"), { recursive: true });
  mkdirSync(join(outputDir, "packages/app"), { recursive: true });

  const rootTsconfig = {
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      allowJs: true, checkJs: false, jsx: "preserve", strict: true, composite: true,
    },
    references: [{ path: "./packages/core" }, { path: "./packages/app" }],
  };
  writeFileSync(join(outputDir, "tsconfig.json"), JSON.stringify(rootTsconfig, null, 2) + "\n");
  writeFileSync(join(outputDir, "packages/core/tsconfig.json"), JSON.stringify({
    extends: "../../tsconfig.json", compilerOptions: { composite: true }, include: ["./**/*"],
  }, null, 2) + "\n");
  writeFileSync(join(outputDir, "packages/app/tsconfig.json"), JSON.stringify({
    extends: "../../tsconfig.json", compilerOptions: { composite: true }, references: [{ path: "../core" }], include: ["./**/*"],
  }, null, 2) + "\n");

  const files = [];
  const treeHasher = createHash("sha256");
  for (let i = 0; i < spec.fileCount; i++) {
    const file = buildExactByteSource({ tier, index: i, fileCount: spec.fileCount, targetBytes: spec.bytesPerFile, seed });
    writeFileSync(join(outputDir, file.relPath), file.content, "utf8");
    treeHasher.update(`${file.relPath}:${file.sha256}\n`);
    files.push({ path: file.relPath, bytes: file.bytes, sha256: file.sha256 });
  }
  return {
    seed, tier, fileCount: spec.fileCount,
    bytesPerFile: spec.bytesPerFile, totalBytes: spec.totalBytes,
    corpusDigest: treeHasher.digest("hex"), files,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_FILENAME) {
  const args = process.argv.slice(2);
  let tier = "large", outputDir = null, seed = CORPUS_SEED;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tier" && i + 1 < args.length) tier = args[++i];
    else if (args[i] === "--output-dir" && i + 1 < args.length) outputDir = resolve(args[++i]);
    else if (args[i] === "--seed" && i + 1 < args.length) seed = parseInt(args[++i], 10);
    else {
      console.error(`Unknown or incomplete argument: ${args[i]}`);
      process.exit(1);
    }
  }
  const summary = generateCorpusTier(tier, outputDir || join(MODULE_DIRNAME, `semantic-${tier}`), seed);
  console.log(JSON.stringify({
    seed: summary.seed, tier: summary.tier, fileCount: summary.fileCount,
    bytesPerFile: summary.bytesPerFile, totalBytes: summary.totalBytes,
    corpusDigest: summary.corpusDigest,
  }, null, 2));
}
