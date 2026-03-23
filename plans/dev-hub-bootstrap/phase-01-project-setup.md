# Phase 01 — Project Setup

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Next phase**: [phase-02-core-config.md](./phase-02-core-config.md)
- **Blocks**: All subsequent phases depend on this monorepo scaffolding.

## Overview

- **Date**: 2026-03-21
- **Priority**: Critical
- **Status**: `done`

Set up the pnpm workspace monorepo with four packages, shared TypeScript config, build tooling, and linting. This phase produces a skeleton where each package compiles and can import from siblings.

## Key Insights

- ESM-only throughout (`"type": "module"`) avoids CJS/ESM interop headaches.
- tsup handles library bundling (core, cli, server) with zero config for simple cases.
- Vite handles the web package since it is a React SPA.
- Project references in `tsconfig.base.json` give IDE go-to-definition across packages without building first.
- pnpm `workspace:*` protocol ensures local packages resolve to siblings, not npm registry.

## Requirements

- Node.js >= 20, pnpm >= 9.1.0
- All packages compile with `pnpm build` from root
- `@dev-hub/cli` and `@dev-hub/server` can import from `@dev-hub/core`
- `@dev-hub/web` can import types from `@dev-hub/core` (for shared interfaces)
- ESLint + Prettier run from root with `pnpm lint` and `pnpm format`

## Architecture

```
dev-hub/
  package.json              # root — scripts: build, lint, format, dev
  pnpm-workspace.yaml       # packages: ["packages/*"]
  tsconfig.base.json        # shared compilerOptions + project references
  .eslintrc.cjs             # shared ESLint config
  .prettierrc               # Prettier config
  dev-hub.toml              # example workspace config
  packages/
    core/
      package.json          # @dev-hub/core
      tsconfig.json         # extends ../../tsconfig.base.json
      tsup.config.ts        # entry: src/index.ts, format: esm, dts: true
      src/
        index.ts            # re-exports all modules
    cli/
      package.json          # @dev-hub/cli, bin: dev-hub
      tsconfig.json
      tsup.config.ts        # entry: src/index.ts, format: esm, banner: #!/usr/bin/env node
      src/
        index.ts            # Commander.js entry point (stub)
    server/
      package.json          # @dev-hub/server
      tsconfig.json
      tsup.config.ts        # entry: src/index.ts, format: esm
      src/
        index.ts            # Hono app (stub)
    web/
      package.json          # @dev-hub/web
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.tsx            # React entry (stub)
        App.tsx             # Root component (stub)
```

## Related Code Files

All files are new. No existing code to modify.

## Implementation Steps

1. **Create root `package.json`**
   - `"name": "dev-hub"`, `"private": true`, `"type": "module"`
   - Scripts: `"build": "pnpm -r build"`, `"lint": "eslint packages/"`, `"format": "prettier --write ."`
   - DevDependencies: `typescript@^5.7`, `eslint@^9`, `prettier@^3`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`

2. **Create `pnpm-workspace.yaml`**

   ```yaml
   packages:
     - "packages/*"
   ```

3. **Create `tsconfig.base.json`**

   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "esModuleInterop": true,
       "strict": true,
       "skipLibCheck": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "outDir": "dist",
       "rootDir": "src",
       "resolveJsonModule": true,
       "isolatedModules": true,
       "verbatimModuleSyntax": true,
       "forceConsistentCasingInFileNames": true,
       "paths": {
         "@dev-hub/core": ["./packages/core/src"],
         "@dev-hub/cli": ["./packages/cli/src"],
         "@dev-hub/server": ["./packages/server/src"]
       }
     }
   }
   ```

4. **Create `packages/core/package.json`**
   - `"name": "@dev-hub/core"`, `"version": "0.1.0"`, `"type": "module"`
   - `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
   - `"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }`
   - `"scripts": { "build": "tsup", "dev": "tsup --watch" }`
   - Dependencies: `smol-toml`, `simple-git`, `execa`, `p-limit`, `eventemitter3`, `zod` (config validation)
   - DevDependencies: `tsup`, `typescript`

5. **Create `packages/core/tsup.config.ts`**

   ```ts
   import { defineConfig } from "tsup";
   export default defineConfig({
     entry: ["src/index.ts"],
     format: ["esm"],
     dts: true,
     clean: true,
     sourcemap: true,
   });
   ```

6. **Create `packages/core/tsconfig.json`**
   - Extends `../../tsconfig.base.json`, `include: ["src"]`

7. **Create `packages/core/src/index.ts`**
   - Placeholder: `export const VERSION = "0.1.0";`

8. **Create `packages/cli/package.json`**
   - `"name": "@dev-hub/cli"`, `"bin": { "dev-hub": "./dist/index.js" }`
   - Dependencies: `@dev-hub/core: "workspace:*"`, `commander`, `@clack/prompts`, `ink`, `ink-spinner`, `react`
   - DevDependencies: `tsup`, `typescript`, `@types/react`

9. **Create `packages/cli/tsup.config.ts`**
   - Same as core but with `banner: { js: "#!/usr/bin/env node" }`

10. **Create `packages/cli/src/index.ts`**
    - Stub: import Commander, create program with version, parse args.

11. **Create `packages/server/package.json`**
    - Dependencies: `@dev-hub/core: "workspace:*"`, `hono`, `@hono/node-server`
    - DevDependencies: `tsup`, `typescript`

12. **Create `packages/server/tsup.config.ts`** and **`src/index.ts`**
    - Stub Hono app listening on port 4800.

13. **Create `packages/web/package.json`**
    - Dependencies: `react@^19`, `react-dom@^19`, `@tanstack/react-query`, `tailwindcss@^4`
    - DevDependencies: `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `typescript`, `@types/react`, `@types/react-dom`

14. **Create `packages/web/vite.config.ts`**

    ```ts
    import { defineConfig } from "vite";
    import react from "@vitejs/plugin-react";
    import tailwindcss from "@tailwindcss/vite";
    export default defineConfig({
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": "/src" } },
    });
    ```

15. **Create web stubs**: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css` (with `@import "tailwindcss"`).

16. **Create `.eslintrc.cjs`**
    - Flat config with `@typescript-eslint` for `.ts` and `.tsx` files.
    - Rules: no-unused-vars (warn), no-explicit-any (warn).

17. **Create `.prettierrc`**
    - `{ "semi": true, "singleQuote": false, "tabWidth": 2, "trailingComma": "all" }`

18. **Create `dev-hub.toml` example config**

    ```toml
    [workspace]
    name = "my-workspace"

    [[projects]]
    name = "api-server"
    path = "./api-server"
    type = "maven"
    build_command = "mvn clean package -DskipTests"
    run_command = "java -jar target/app.jar"
    env_file = ".env"

    [[projects]]
    name = "web-app"
    path = "./web-app"
    type = "pnpm"
    ```

19. **Validate the setup**
    - Run `pnpm install` from root.
    - Run `pnpm build` — all four packages compile.
    - Run `pnpm lint` — no errors.
    - Verify `@dev-hub/cli` can import `VERSION` from `@dev-hub/core`.

## Todo List

- [ ] Create root package.json and pnpm-workspace.yaml
- [ ] Create tsconfig.base.json with project references
- [ ] Scaffold packages/core with tsup config and stub
- [ ] Scaffold packages/cli with tsup config, bin entry, and stub
- [ ] Scaffold packages/server with tsup config and stub
- [ ] Scaffold packages/web with Vite config and stubs
- [ ] Add ESLint + Prettier configs
- [ ] Create dev-hub.toml example
- [ ] Verify full build from root: `pnpm install && pnpm build`
- [ ] Verify cross-package imports work at runtime

## Success Criteria

1. `pnpm install` resolves all workspace dependencies without errors.
2. `pnpm build` compiles all four packages successfully.
3. `pnpm lint` and `pnpm format` run without configuration errors.
4. Running the CLI stub (`node packages/cli/dist/index.js --version`) prints `0.1.0`.
5. Running the server stub (`node packages/server/dist/index.js`) starts on port 4800.
6. Running `pnpm dev` in `packages/web` opens a React app on localhost.

## Risk Assessment

| Risk                                                  | Likelihood | Impact | Mitigation                                                          |
| ----------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------- |
| ESM/CJS interop issues with dependencies              | Medium     | Medium | Pin to ESM-compatible versions; use tsup to bundle problematic deps |
| Ink (React terminal) conflicts with web React version | Low        | Medium | Ink uses its own React renderer; keep separate in cli package       |
| pnpm workspace resolution issues                      | Low        | Low    | Use `workspace:*` protocol consistently                             |

## Next Steps

Once this phase is complete, proceed to [Phase 02 — Core Config](./phase-02-core-config.md) to implement the TOML config parser and workspace discovery in `@dev-hub/core`.

## Completed

2026-03-21 — All success criteria met. Build passes, CLI prints version, server starts on port 4800.
