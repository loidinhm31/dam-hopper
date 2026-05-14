# Phase 01: Shared File Decoration Registry

## Context links

- Parent plan: [plan.md](./plan.md)
- Analysis report: [reports/codebase-analysis.md](./reports/codebase-analysis.md)
- Existing MIME helper: `packages/web/src/lib/mime-to-language.ts`
- Existing local icon mapping: `packages/web/src/components/organisms/FileTree.tsx`

## Overview

- Date: 2026-05-15
- Priority: P2
- Implementation status: Completed
- Review status: Reviewed
- Description: Create the shared frontend registry and language helper API.

## Key Insights

- Current mapping is duplicated risk waiting to happen; the first target is a single source of truth.
- Filename-based detection must support exact names like `.env`, `.gitignore`, `Dockerfile`, and `Makefile`.
- MIME still matters because server read responses include MIME, but extension fallback improves language labels when MIME is generic or missing.

## Requirements

- Add a shared decoration module under `packages/web/src/lib`.
- Expose icon/color/display-language/Monaco-language metadata from one lookup.
- Keep the API simple enough for UI components to consume without reimplementing parsing.
- Include unit tests for extension, exact filename, MIME, and fallback behavior.

## Architecture

- Create `file-decoration.tsx` if JSX icon factories are included directly.
- Prefer pure helpers where possible:
  - `getFileDecoration(pathOrName: string, options?: { mime?: string })`
  - `getDisplayLanguage(pathOrName: string, mime?: string)`
  - `getMonacoLanguage(pathOrName: string, mime?: string)`
- Export a small `FileDecorationIcon` component if rendering icons directly in the lib keeps components cleaner.
- Keep `mime-to-language.ts` as a compatibility wrapper or update call sites in Phase 02, whichever is less disruptive.

## Related code files

- Modify: `packages/web/src/lib/mime-to-language.ts`
- Create: `packages/web/src/lib/file-decoration.tsx`
- Create: `packages/web/src/lib/file-decoration.test.tsx` or `.test.ts`

## Implementation Steps

1. Implement normalized filename parsing: basename, lowercase exact name, lowercase extension.
2. Add exact-name registry entries for `.env`, `.gitignore`, `Dockerfile`, `Makefile`, lockfiles, and common config files.
3. Add extension registry entries for TypeScript/JavaScript, Java, Rust, Python, Go, C/C++, web, data/config, docs, images, archives, fonts, and binaries.
4. Add MIME mapping fallback by reusing current logic from `mime-to-language.ts`.
5. Add compatibility exports so existing language consumers can migrate incrementally.
6. Add unit tests for `.java`, `.rs`, `.tsx`, `.jsx`, `.env`, `.gitignore`, `Dockerfile`, unknown files, and MIME-only fallback.

## Todo list

- [x] Create registry types and normalized lookup helpers.
- [x] Define default decoration entries.
- [x] Add display and Monaco language helpers.
- [x] Preserve MIME helper compatibility.
- [x] Add unit tests.

## Success Criteria

- File metadata lookup is centralized.
- Unknown files never throw and return neutral decoration plus plaintext language.
- Tests prove exact-name matching has priority over extension matching.

## Risk Assessment

- Risk: Monaco receives unsupported language IDs for uncommon languages.
- Mitigation: Use conservative Monaco IDs and fall back to `plaintext`.
- Risk: JSX in `lib` makes tests slightly more involved.
- Mitigation: Split pure metadata from icon rendering if test setup becomes noisy.

## Security Considerations

- No user-provided file content is parsed.
- File paths are treated as display strings only; no filesystem operations are introduced.

## Next steps

- Phase 02 consumes this registry across all visible file surfaces.
