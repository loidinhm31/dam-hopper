#!/usr/bin/env bash
# Smoke-test pinned bundled LSP processes without host PATH or global packages.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 PAYLOAD_DIR" >&2
  exit 2
fi

PAYLOAD_DIR="$1"
for required in rust-analyzer node/bin/node typescript-language-server/lib/cli.mjs typescript-language-server/node_modules/typescript/lib/tsserver.js; do
  test -f "$PAYLOAD_DIR/$required"
done

PYTHON3="$(command -v python3)"
PATH='' PAYLOAD_DIR="$PAYLOAD_DIR" "$PYTHON3" - <<'PY'
import json
import os
import pathlib
import select
import subprocess
import sys
import tempfile
import time

payload = pathlib.Path(os.environ["PAYLOAD_DIR"]).resolve()

def send_message(process, message):
    body = json.dumps(message, separators=(",", ":")).encode()
    frame = b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
    process.stdin.write(frame)
    process.stdin.flush()

def read_response(process, label, expected_id):
    stdout = process.stdout
    while True:
        headers = b""
        while b"\r\n\r\n" not in headers:
            if not select.select([stdout], [], [], 10)[0]:
                raise RuntimeError(f"{label} initialize timed out")
            headers += os.read(stdout.fileno(), 1)
        length = next(
            int(line.split(b":", 1)[1].strip())
            for line in headers.split(b"\r\n")
            if line.lower().startswith(b"content-length:")
        )
        body = b""
        while len(body) < length:
            if not select.select([stdout], [], [], 10)[0]:
                raise RuntimeError(f"{label} response body timed out")
            body += os.read(stdout.fileno(), length - len(body))
        response = json.loads(body)
        if response.get("id") == expected_id and "result" in response:
            return response["result"]
        if response.get("id") == expected_id and "error" in response:
            raise RuntimeError(f"{label} rejected initialize: {response}")

def check(label, command, filename, language_id, source_text, initialization_options=None, definition_position=None):
    with tempfile.TemporaryDirectory() as workspace_name:
        workspace = pathlib.Path(workspace_name)
        source = workspace / filename
        if definition_position is not None:
            source.write_text(source_text, encoding="utf-8")
            if language_id == "rust":
                (workspace / "rust-project.json").write_text(json.dumps({"crates": [{
                    "root_module": str(source), "edition": "2021", "deps": [], "cfg": [], "env": {}
                }]}), encoding="utf-8")
        process = subprocess.Popen(
            command,
            cwd=workspace,
            env={"PATH": "", "HOME": str(workspace)},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        try:
            send_message(process, {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "processId": None,
                    "rootUri": workspace.as_uri(),
                    "capabilities": {},
                    "workspaceFolders": [{"uri": workspace.as_uri(), "name": "fixture"}],
                    "initializationOptions": initialization_options or {},
                },
            })
            read_response(process, label, 1)
            if definition_position is not None:
                send_message(process, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
                send_message(process, {
                    "jsonrpc": "2.0",
                    "method": "textDocument/didOpen",
                    "params": {"textDocument": {
                        "uri": source.as_uri(), "languageId": language_id, "version": 1, "text": source_text
                    }},
                })
                time.sleep(2)
                send_message(process, {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "textDocument/definition",
                    "params": {"textDocument": {"uri": source.as_uri()}, "position": definition_position},
                })
                result = read_response(process, label, 2)
                if not isinstance(result, list) or not result:
                    raise RuntimeError(f"{label} definition returned no locations")
                send_message(process, {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "textDocument/references",
                    "params": {"textDocument": {"uri": source.as_uri()}, "position": definition_position, "context": {"includeDeclaration": True}},
                })
                references = read_response(process, label, 3)
                if not isinstance(references, list) or not references:
                    raise RuntimeError(f"{label} references returned no locations")
        finally:
            process.kill()
            process.wait(timeout=5)

check(
    "rust-analyzer",
    [str(payload / "rust-analyzer")],
    "main.rs",
    "rust",
    "fn target() {}\nfn caller() { target(); }\n",
    definition_position={"line": 1, "character": 16},
)
check(
    "typescript-language-server",
    [
        str(payload / "node/bin/node"),
        str(payload / "typescript-language-server/lib/cli.mjs"),
        "--stdio",
    ],
    "main.ts",
    "typescript",
    "const target = 1;\ntarget;\n",
    {
        "plugins": [],
        "disableAutomaticTypingAcquisition": True,
        "tsserver": {
            "path": str(payload / "typescript-language-server/node_modules/typescript/lib/tsserver.js")
        },
    },
    definition_position={"line": 1, "character": 1},
)
print("pinned semantic runtime initialization: PASS")
PY
