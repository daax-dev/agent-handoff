# Language Conventions

`[FILL IN]` marks a gap. Treat as "ask the operator," not a guess.

For each active language, this file records:
1. Pinned version and how it is pinned.
2. Formatter and config location.
3. Linter and config location.
4. Type checker and strictness level.
5. Test framework and coverage threshold.
6. Any style rules that override the formatter's defaults.

---

## Active Languages

### TypeScript (server, REST API, CLI)
- Runtime: Bun >= 1.0 (CI pins 1.1.38). Uses Bun-native APIs (`bun:sqlite`); does not run on plain Node.
- Version: TypeScript 5.9 (pinned `^5.9.3` in devDependencies). ESM only (`"type": "module"`, NodeNext resolution).
- Package manager: Bun (`bun install`). No npm/yarn/pnpm. NOTE: `bun.lock` is currently gitignored even though CI runs `--frozen-lockfile` (no lockfile is committed today) — a known repo-state inconsistency to reconcile separately, not designed behavior. Dependency changes are deliberate — call them out in the PR.
- Formatter: none configured. No Prettier/Biome in the repo. Match the surrounding file's style; do not add a formatter without operator approval.
- Linter: none configured. No ESLint/Biome in the repo.
- Type checker: `tsc` with `"strict": true` (tsconfig.json). Run `bun run typecheck` (`tsc --noEmit`). `any` requires a justifying comment.
- Tests: Vitest. Run `bun run test` (→ `vitest run`; root config `vitest.config.ts`, includes `tests/**/*.test.ts`). NOTE: `test:bun` is currently just an alias for `bun run test` (still Vitest), not the native runner. To use Bun's native runner directly, invoke `bun test <path>` (e.g. `bun test src/__tests__/api.test.ts`, which is what `test:api` does). Additional suites live under `src/__tests__/`.
- Coverage threshold: [FILL IN — none enforced today; no coverage tooling or threshold configured in CI]

### TypeScript / React (web UI — `ui/`)
- Version: TypeScript 5.7 (pinned `^5.7.2` in `ui/package.json`), React 18, Vite 6.
- Stack: Tailwind CSS 3, `@xyflow/react`, TanStack Query, React Router.
- Formatter: none configured (no Prettier/Biome in `ui/`).
- Linter: none configured (no ESLint in `ui/`).
- Type checker: `tsc` (run `bun --cwd ui run typecheck`). UI build is `tsc && vite build`.
- Tests: Bun's native runner (`bun:test`) + `@testing-library/react` + happy-dom (registered via `@happy-dom/global-registrator`). Setup is preloaded through `ui/bunfig.toml` → `ui/test-setup.ts`. There is no `test` script in `ui/package.json` and no Vitest; run UI tests with `bun --cwd ui test`. UI tests are not currently wired into CI.
- Coverage threshold: [FILL IN — none enforced today]

### Shell (bash)
- Scripts under `scripts/` (`dev-web.sh`, `verify.sh`) and CLI helpers.
- Version target: bash 5.x.
- Linter: shellcheck (not enforced in CI; run locally).
- Style: `set -euo pipefail` in every script. Quote all expansions. No `eval`.

---

## Cross-Cutting Rules
- No standalone formatter/linter is configured — do not introduce one without operator approval. Match existing file style.
- Generated/build output lives under `dist/` (gitignored) — never edit by hand.
- SQLite schema changes go in a new numbered `migrations/NNN_*.sql` file — never edit an already-applied migration.
- `bun.lock` is gitignored in this repo but consumed by CI (`bun install --frozen-lockfile`). Updating dependencies is a deliberate change — call it out in the PR.
- TypeScript is `strict`. Type errors (`bun run typecheck`) and test failures (`bun run test`) block "done".
