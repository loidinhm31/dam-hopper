import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "../../..");
const extensionDirectory = resolve(
  repositoryDirectory,
  "apps/browser-extension/dist",
);
const archiveDirectory = resolve(
  repositoryDirectory,
  "apps/web/public/browser-debug-extension",
);
const archivePath = resolve(archiveDirectory, "dam-hopper-browser-debug.zip");
const extensionFiles = ["manifest.json", "content.js"];
const archiveRoot = "dam-hopper-browser-debug";

function buildExtension() {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(pnpm, ["--filter", "@dam-hopper/browser-extension", "build"], {
    cwd: repositoryDirectory,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

async function validateExtension() {
  const manifestPath = resolve(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.manifest_version !== 3 || !manifest.version)
    throw new Error(
      "Browser Debug extension manifest is not a valid MV3 manifest.",
    );

  for (const file of extensionFiles) {
    const fileInfo = await stat(resolve(extensionDirectory, file));
    if (!fileInfo.isFile() || fileInfo.size === 0)
      throw new Error(
        `Browser Debug extension file is missing or empty: ${file}`,
      );
  }
}

async function createArchive() {
  await rm(archivePath, { force: true });
  await mkdir(archiveDirectory, { recursive: true });

  await new Promise((resolveArchive, rejectArchive) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const reject = (error) => rejectArchive(error);

    output.on("close", resolveArchive);
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
    });
    archive.pipe(output);

    archive.directory(extensionDirectory, archiveRoot, {
      date: new Date(0),
    });
    void archive.finalize().catch(reject);
  });

  const archiveInfo = await stat(archivePath);
  if (archiveInfo.size === 0)
    throw new Error("Browser Debug extension archive is empty.");
}

buildExtension();
await validateExtension();
await createArchive();
console.log(`Staged Browser Debug extension: ${archivePath}`);
