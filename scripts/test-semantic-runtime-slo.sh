#!/usr/bin/env bash
# Measure warm TypeScript definition latency and initialization for Linux release gates.
# Enforces the Phase 0 memory and cancellation-forwarding budgets as well.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 PAYLOAD_DIR" >&2
  exit 2
fi

PAYLOAD_DIR="$1"
PYTHON3="$(command -v python3)"
PATH='' PAYLOAD_DIR="$PAYLOAD_DIR" "$PYTHON3" - <<'PY'
import json
import math
import os
import pathlib
import select
import subprocess
import tempfile
import time

payload = pathlib.Path(os.environ["PAYLOAD_DIR"]).resolve()
with tempfile.TemporaryDirectory() as workspace_name:
    workspace = pathlib.Path(workspace_name)
    source = workspace / "main.ts"
    source_text = "const target = 1;\ntarget;\n"
    source.write_text(source_text, encoding="utf-8")
    process = subprocess.Popen(
        [
            str(payload / "node/bin/node"),
            str(payload / "typescript-language-server/lib/cli.mjs"),
            "--stdio",
        ],
        cwd=workspace,
        env={"PATH": "", "HOME": str(workspace)},
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    def send(message):
        body = json.dumps(message, separators=(",", ":")).encode()
        process.stdin.write(b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        process.stdin.flush()

    def receive(expected_id, timeout=10):
        while True:
            headers = b""
            while b"\r\n\r\n" not in headers:
                if not select.select([process.stdout], [], [], timeout)[0]:
                    raise RuntimeError("semantic SLO response timed out")
                headers += os.read(process.stdout.fileno(), 1)
            length = int(next(line.split(b":", 1)[1] for line in headers.split(b"\r\n") if line.lower().startswith(b"content-length:")))
            body = b""
            while len(body) < length:
                body += os.read(process.stdout.fileno(), length - len(body))
            message = json.loads(body)
            if message.get("id") == expected_id:
                if "error" in message:
                    raise RuntimeError(f"semantic SLO request failed: {message['error']}")
                return message.get("result")

    try:
        uri = source.as_uri()
        start = time.perf_counter()
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "processId": None, "rootUri": workspace.as_uri(), "capabilities": {},
            "workspaceFolders": [{"uri": workspace.as_uri(), "name": "slo-fixture"}],
            "initializationOptions": {"plugins": [], "disableAutomaticTypingAcquisition": True,
                "tsserver": {"path": str(payload / "typescript-language-server/node_modules/typescript/lib/tsserver.js")}},
        }})
        receive(1)
        initialize_ms = (time.perf_counter() - start) * 1000
        send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        send({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {
            "uri": uri, "languageId": "typescript", "version": 1, "text": source_text}}})
        time.sleep(1)
        latencies = []
        cancellation_latencies = []
        for request_id in range(2, 22):
            start = time.perf_counter()
            send({"jsonrpc": "2.0", "id": request_id, "method": "textDocument/definition", "params": {
                "textDocument": {"uri": uri}, "position": {"line": 1, "character": 1}}})
            result = receive(request_id)
            if not result:
                raise RuntimeError("semantic SLO definition returned no targets")
            latencies.append((time.perf_counter() - start) * 1000)
            cancel_id = request_id + 100
            cancel_start = time.perf_counter()
            send({"jsonrpc": "2.0", "id": cancel_id, "method": "textDocument/definition", "params": {
                "textDocument": {"uri": uri}, "position": {"line": 1, "character": 1}}})
            send({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": cancel_id}})
            receive(cancel_id)
            cancellation_latencies.append((time.perf_counter() - cancel_start) * 1000)
        rss_kib = 0
        status = pathlib.Path(f"/proc/{process.pid}/status")
        if status.exists():
            for line in status.read_text().splitlines():
                if line.startswith("VmRSS:"):
                    rss_kib = int(line.split()[1])
        ordered = sorted(latencies)
        p95 = ordered[math.ceil(len(ordered) * 0.95) - 1]
        p99 = ordered[math.ceil(len(ordered) * 0.99) - 1]
        cancellation_p99 = sorted(cancellation_latencies)[math.ceil(len(cancellation_latencies) * 0.99) - 1]
        print(json.dumps({"initializeMs": round(initialize_ms, 2), "definitionP95Ms": round(p95, 2), "definitionP99Ms": round(p99, 2), "cancellationP99Ms": round(cancellation_p99, 2), "rssKiB": rss_kib, "samples": len(latencies)}, sort_keys=True))
        if initialize_ms > 2000 or p95 > 300 or p99 > 1000 or cancellation_p99 > 100 or rss_kib > 1024 * 1024:
            raise SystemExit("semantic runtime SLO exceeded")
    finally:
        process.kill()
        process.wait(timeout=5)
PY
