#!/usr/bin/env node
/**
 * Local loopback fixture server for DamHopper Windows installer tests.
 * Serves synthetic GitHub Release metadata and release artifacts without external network access.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
let artifactsDir = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && i + 1 < args.length) {
    artifactsDir = resolve(args[i + 1]);
    i++;
  }
}

if (!artifactsDir || !existsSync(artifactsDir)) {
  console.error("Error: --dir <existing-directory> is required");
  process.exit(1);
}

function computeSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

const server = createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = parsedUrl.pathname;

  // Graceful shutdown
  if (pathname === "/shutdown") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("shutting down");
    server.close(() => {
      process.exit(0);
    });
    return;
  }

  // Artifact downloads
  if (pathname.startsWith("/artifacts/")) {
    const filename = basename(pathname.slice("/artifacts/".length));
    const filePath = resolve(artifactsDir, filename);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Artifact not found");
      return;
    }
    const stat = statSync(filePath);
    const content = readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stat.size,
    });
    res.end(content);
    return;
  }

  // Negative scenarios: /negative/:scenario/releases/...
  const negMatch = pathname.match(/^\/negative\/([^/]+)\/releases\/(.+)$/);
  if (negMatch) {
    const scenario = negMatch[1];
    const releaseSubpath = negMatch[2];
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    let tag = "v1.0.0";
    if (releaseSubpath.startsWith("tags/")) {
      tag = releaseSubpath.slice("tags/".length);
    }

    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    let targetArtifactName = zipName;
    let digestOverride = null;
    let sizeOverride = null;

    if (scenario === "bad-digest") {
      digestOverride = "0000000000000000000000000000000000000000000000000000000000000000";
    } else if (scenario === "bad-size") {
      sizeOverride = 99999999;
    } else if (scenario === "unsafe-traversal") {
      targetArtifactName = "unsafe-traversal.zip";
    } else if (scenario === "unsafe-directory") {
      targetArtifactName = "unsafe-directory.zip";
    } else if (scenario === "extra-member") {
      targetArtifactName = "extra-member.zip";
    } else if (scenario === "missing-member") {
      targetArtifactName = "missing-member.zip";
    }

    const targetFilePath = resolve(artifactsDir, targetArtifactName);
    const actualSize = existsSync(targetFilePath) ? statSync(targetFilePath).size : 1024;
    const actualDigest = existsSync(targetFilePath) ? computeSha256(targetFilePath) : "abcdef";

    const responsePayload = {
      tag_name: tag,
      assets: [
        {
          name: zipName,
          state: "uploaded",
          size: sizeOverride !== null ? sizeOverride : actualSize,
          digest: `sha256:${digestOverride !== null ? digestOverride : actualDigest}`,
          browser_download_url: `${baseUrl}/artifacts/${targetArtifactName}`,
        },
      ],
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responsePayload));
    return;
  }

  // Standard release metadata: /releases/latest or /releases/tags/:tag
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  if (pathname.endsWith("/releases/latest") || pathname.includes("/releases/latest")) {
    const tag = "v1.2.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const targetFilePath = resolve(artifactsDir, zipName);
    const size = existsSync(targetFilePath) ? statSync(targetFilePath).size : 1024;
    const digest = existsSync(targetFilePath) ? computeSha256(targetFilePath) : "abcdef";

    const payload = {
      tag_name: tag,
      assets: [
        {
          name: zipName,
          state: "uploaded",
          size,
          digest: `sha256:${digest}`,
          browser_download_url: `${baseUrl}/artifacts/${zipName}`,
        },
      ],
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  const tagMatch = pathname.match(/\/releases\/tags\/([^/]+)$/);
  if (tagMatch) {
    const tag = tagMatch[1];
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const targetFilePath = resolve(artifactsDir, zipName);
    const size = existsSync(targetFilePath) ? statSync(targetFilePath).size : 1024;
    const digest = existsSync(targetFilePath) ? computeSha256(targetFilePath) : "abcdef";

    const payload = {
      tag_name: tag,
      assets: [
        {
          name: zipName,
          state: "uploaded",
          size,
          digest: `sha256:${digest}`,
          browser_download_url: `${baseUrl}/artifacts/${zipName}`,
        },
      ],
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`SERVER_PORT=${port}`);
});
