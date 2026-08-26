import type { Plugin } from "vite";

const REQUEST_MODE_SIGNATURE = "requestMode(";
const BROKEN_ENUM_INIT = /void 0\|\|\(([A-Za-z_$][\w$]*)=\{\}\)/;

export function repairBrokenXtermRequestMode(code: string): {
  code: string;
  patched: boolean;
} {
  if (
    !code.includes(REQUEST_MODE_SIGNATURE) ||
    !code.includes("void 0||(") ||
    !code.includes("NOT_RECOGNIZED")
  ) {
    return { code, patched: false };
  }

  let cursor = 0;
  let patched = false;
  let output = "";

  while (cursor < code.length) {
    const start = code.indexOf(REQUEST_MODE_SIGNATURE, cursor);
    if (start === -1) {
      output += code.slice(cursor);
      break;
    }

    const brace = code.indexOf("{", start);
    if (brace === -1) {
      output += code.slice(cursor);
      break;
    }

    const scanEnd = Math.min(code.length, brace + 800);
    const head = code.slice(brace + 1, scanEnd);
    const match = head.match(BROKEN_ENUM_INIT);

    if (!match) {
      output += code.slice(cursor, scanEnd);
      cursor = scanEnd;
      continue;
    }

    const tempName = match[1];
    if (head.includes(`let ${tempName};`)) {
      output += code.slice(cursor, scanEnd);
      cursor = scanEnd;
      continue;
    }

    const fixedHead = head.replace(match[0], `${tempName}||(${tempName}={})`);
    output += code.slice(cursor, brace + 1);
    output += `let ${tempName};${fixedHead}`;
    cursor = scanEnd;
    patched = true;
  }

  return { code: patched ? output : code, patched };
}

export function fixBrokenXtermRequestMode(): Plugin {
  return {
    name: "fix-broken-xterm-request-mode",
    apply: "build",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;

        const result = repairBrokenXtermRequestMode(chunk.code);
        if (!result.patched) continue;

        chunk.code = result.code;
        this.warn(
          `patched broken xterm requestMode minification in ${chunk.fileName}`,
        );
      }
    },
  };
}
