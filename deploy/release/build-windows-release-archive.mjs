#!/usr/bin/env node
/**
 * Deterministic Windows x86_64 release archive packager for DamHopper.
 * Produces a byte-reproducible ZIP file containing:
 *   - dam-hopper-server.exe
 *   - dam-hopper.example.toml
 *   - LICENSE
 *   - README.md
 *
 * Uses Node.js standard libraries only (no external zip dependencies).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_SOURCE_DATE_EPOCH = 1700000000;

const WINDOWS_ZIP_REQUIRED_MEMBERS = Object.freeze([
  "dam-hopper-server.exe",
  "dam-hopper.example.toml",
  "LICENSE",
  "README.md",
]);

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function computeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function epochToDosDateTime(epochSec) {
  const d = new Date(epochSec * 1000);
  const year = Math.max(1980, Math.min(2099, d.getUTCFullYear()));
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();

  const dosTime = (hour << 11) | (minute << 5) | (second >> 1);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let tag = process.env.RELEASE_TAG || null;
  let binaryPath = null;
  let configExamplePath = null;
  let licensePath = null;
  let readmePath = null;
  let outputDir = null;
  let epoch = process.env.SOURCE_DATE_EPOCH
    ? parseInt(process.env.SOURCE_DATE_EPOCH, 10)
    : DEFAULT_SOURCE_DATE_EPOCH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--tag" || arg === "-t") && i + 1 < args.length) {
      tag = args[++i];
    } else if ((arg === "--binary" || arg === "-b") && i + 1 < args.length) {
      binaryPath = args[++i];
    } else if (arg === "--config-example" && i + 1 < args.length) {
      configExamplePath = args[++i];
    } else if (arg === "--license" && i + 1 < args.length) {
      licensePath = args[++i];
    } else if (arg === "--readme" && i + 1 < args.length) {
      readmePath = args[++i];
    } else if ((arg === "--output-dir" || arg === "-o") && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (arg === "--epoch" && i + 1 < args.length) {
      epoch = parseInt(args[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsageAndExit(1);
    }
  }

  if (!tag) {
    console.error("Error: --tag <vX.Y.Z> is required");
    printUsageAndExit(1);
  }
  if (!TAG_REGEX.test(tag)) {
    console.error(`Error: Invalid release tag '${tag}'. Must match vMAJOR.MINOR.PATCH`);
    process.exit(1);
  }
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    console.error(`Error: Invalid epoch '${epoch}'. Must be a non-negative integer`);
    process.exit(1);
  }

  const rootDir = process.cwd();

  // Resolve default input paths if not provided
  if (!binaryPath) {
    const candidate1 = resolve(rootDir, "server/target/x86_64-pc-windows-msvc/release/dam-hopper-server.exe");
    const candidate2 = resolve(rootDir, "server/target/release/dam-hopper-server.exe");
    if (existsSync(candidate1)) {
      binaryPath = candidate1;
    } else if (existsSync(candidate2)) {
      binaryPath = candidate2;
    } else {
      binaryPath = candidate1; // Will fail cleanly during input validation
    }
  } else {
    binaryPath = resolve(rootDir, binaryPath);
  }

  configExamplePath = configExamplePath
    ? resolve(rootDir, configExamplePath)
    : resolve(rootDir, "__fixtures__/workspace/dam-hopper.toml");

  licensePath = licensePath
    ? resolve(rootDir, licensePath)
    : resolve(rootDir, "LICENSE");

  readmePath = readmePath
    ? resolve(rootDir, readmePath)
    : resolve(rootDir, "README.md");

  outputDir = outputDir
    ? resolve(rootDir, outputDir)
    : resolve(rootDir, "artifacts/release");

  return {
    tag,
    binaryPath,
    configExamplePath,
    licensePath,
    readmePath,
    outputDir,
    epoch,
  };
}

function printUsageAndExit(code) {
  console.log(
    `Usage: node build-windows-release-archive.mjs --tag <vX.Y.Z> [options]

Options:
  --tag, -t <tag>            Release tag (vX.Y.Z, required)
  --binary, -b <path>        Path to dam-hopper-server.exe (default: server/target/.../dam-hopper-server.exe)
  --config-example <path>    Path to example TOML config (default: __fixtures__/workspace/dam-hopper.toml)
  --license <path>           Path to LICENSE file (default: LICENSE)
  --readme <path>            Path to README.md file (default: README.md)
  --output-dir, -o <dir>     Output directory for ZIP archive (default: artifacts/release)
  --epoch <seconds>          Unix timestamp for SOURCE_DATE_EPOCH (default: 1700000000)
  --help, -h                 Show this help message`,
  );
  process.exit(code);
}

function readInputFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Input ${label} does not exist: ${filePath}`);
  }
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Input ${label} must not be a symbolic link: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Input ${label} is not a regular file: ${filePath}`);
  }
  if (stats.size === 0) {
    throw new Error(`Input ${label} is empty: ${filePath}`);
  }
  if (stats.size > MAX_INPUT_BYTES) {
    throw new Error(`Input ${label} exceeds max size (${MAX_INPUT_BYTES} bytes): ${filePath}`);
  }
  return readFileSync(filePath);
}

export function buildDeterministicZipBuffer(entries, epochSec = DEFAULT_SOURCE_DATE_EPOCH) {
  const { dosTime, dosDate } = epochToDosDateTime(epochSec);

  // Deterministic lexicographical sorting by member name
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const uncompressedBytes = entry.data;
    const crc = computeCrc32(uncompressedBytes);
    const compressedBytes = deflateRawSync(uncompressedBytes, { level: 9 });
    const method = 8; // Deflate

    // Local file header (30 bytes + nameBuf.length)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // LFH signature
    lfh.writeUInt16LE(20, 4); // version needed to extract (2.0)
    lfh.writeUInt16LE(0x0800, 6); // general purpose flag (bit 11 = UTF-8)
    lfh.writeUInt16LE(method, 8); // compression method
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressedBytes.length, 18);
    lfh.writeUInt32LE(uncompressedBytes.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra field length

    const lfhOffset = offset;
    localChunks.push(lfh, nameBuf, compressedBytes);
    offset += lfh.length + nameBuf.length + compressedBytes.length;

    // Central directory header (46 bytes + nameBuf.length)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // CDFH signature
    cdh.writeUInt16LE(20, 4); // version made by (2.0)
    cdh.writeUInt16LE(20, 6); // version needed to extract (2.0)
    cdh.writeUInt16LE(0x0800, 8); // general purpose flag (bit 11 = UTF-8)
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compressedBytes.length, 20);
    cdh.writeUInt32LE(uncompressedBytes.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra field length
    cdh.writeUInt16LE(0, 32); // comment length
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal file attributes
    cdh.writeUInt32LE(0, 38); // external file attributes (regular file)
    cdh.writeUInt32LE(lfhOffset, 42); // relative offset of local header

    cdChunks.push(cdh, nameBuf);
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(cdChunks);
  const cdSize = cdBuf.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(sorted.length, 8); // disk entries
  eocd.writeUInt16LE(sorted.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

function verifyZipBuffer(zipBytes, expectedMemberNames) {
  if (zipBytes.length < 22) throw new Error("ZIP file too small for EOCD record");

  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBytes.length - 22 - 65535);
  for (let i = zipBytes.length - 22; i >= minOffset; i--) {
    if (zipBytes.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD signature not found");

  const diskNumber = zipBytes.readUInt16LE(eocdOffset + 4);
  const startDisk = zipBytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = zipBytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = zipBytes.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  const commentLength = zipBytes.readUInt16LE(eocdOffset + 20);

  if (diskNumber !== 0 || startDisk !== 0) throw new Error("Multi-disk ZIP disallowed");
  if (diskEntries !== totalEntries) throw new Error("Disk entries do not match total entries");
  if (totalEntries !== expectedMemberNames.length) {
    throw new Error(`Expected exactly ${expectedMemberNames.length} entries, got ${totalEntries}`);
  }
  if (eocdOffset + 22 + commentLength !== zipBytes.length) {
    throw new Error("Trailing bytes after EOCD");
  }
  if (commentLength !== 0) throw new Error("EOCD comment must be empty");
  if (cdOffset + cdSize !== eocdOffset) throw new Error("CD boundary does not match EOCD");

  let pos = cdOffset;
  const seenNames = new Set();
  const cdEntries = [];

  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > cdOffset + cdSize) throw new Error("Malformed CD header");
    if (zipBytes.readUInt32LE(pos) !== 0x02014b50) throw new Error("Invalid CDFH signature");

    const method = zipBytes.readUInt16LE(pos + 10);
    const crc = zipBytes.readUInt32LE(pos + 16);
    const compressedSize = zipBytes.readUInt32LE(pos + 20);
    const uncompressedSize = zipBytes.readUInt32LE(pos + 24);
    const nameLen = zipBytes.readUInt16LE(pos + 28);
    const extraLen = zipBytes.readUInt16LE(pos + 30);
    const commentLen = zipBytes.readUInt16LE(pos + 32);
    const lfhOffset = zipBytes.readUInt32LE(pos + 42);

    const name = zipBytes.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    if (!expectedMemberNames.includes(name)) throw new Error(`Unexpected ZIP member: ${name}`);
    if (seenNames.has(name)) throw new Error(`Duplicate ZIP member: ${name}`);
    seenNames.add(name);

    cdEntries.push({ name, method, crc, compressedSize, uncompressedSize, lfhOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  for (const required of expectedMemberNames) {
    if (!seenNames.has(required)) throw new Error(`Missing expected ZIP member: ${required}`);
  }

  for (const entry of cdEntries) {
    if (zipBytes.readUInt32LE(entry.lfhOffset) !== 0x04034b50) {
      throw new Error(`Invalid LFH signature for '${entry.name}'`);
    }
    const lfhNameLen = zipBytes.readUInt16LE(entry.lfhOffset + 26);
    const lfhExtraLen = zipBytes.readUInt16LE(entry.lfhOffset + 28);
    const dataOffset = entry.lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const rawData = zipBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const decompressed = inflateRawSync(rawData);
    if (decompressed.length !== entry.uncompressedSize) {
      throw new Error(`Decompressed size mismatch for '${entry.name}'`);
    }
    if (computeCrc32(decompressed) !== entry.crc) {
      throw new Error(`CRC-32 mismatch for '${entry.name}'`);
    }
  }
}

function main() {
  const {
    tag,
    binaryPath,
    configExamplePath,
    licensePath,
    readmePath,
    outputDir,
    epoch,
  } = parseArgs();

  const binaryBytes = readInputFile(binaryPath, "dam-hopper-server.exe binary");
  const configBytes = readInputFile(configExamplePath, "dam-hopper.example.toml config");
  const licenseBytes = readInputFile(licensePath, "LICENSE file");
  const readmeBytes = readInputFile(readmePath, "README.md file");

  const entries = [
    { name: "dam-hopper-server.exe", data: binaryBytes },
    { name: "dam-hopper.example.toml", data: configBytes },
    { name: "LICENSE", data: licenseBytes },
    { name: "README.md", data: readmeBytes },
  ];

  const zipBytes = buildDeterministicZipBuffer(entries, epoch);
  verifyZipBuffer(zipBytes, WINDOWS_ZIP_REQUIRED_MEMBERS);

  mkdirSync(outputDir, { recursive: true });
  const archiveName = `dam-hopper-${tag}-windows-x86_64.zip`;
  const finalPath = resolve(outputDir, archiveName);
  const tempPath = resolve(outputDir, `.tmp-${archiveName}-${Date.now()}`);

  try {
    writeFileSync(tempPath, zipBytes);
    renameSync(tempPath, finalPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {}
    throw err;
  }

  const archiveDigest = computeSha256(zipBytes);
  console.log(`✓ Built deterministic Windows release archive: ${archiveName}`);
  console.log(`  - Path: ${finalPath}`);
  console.log(`  - Size: ${zipBytes.length} bytes`);
  console.log(`  - SHA-256: ${archiveDigest}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || "")) {
  main();
}
