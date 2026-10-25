# AGENTS.md — working agreement for Noto

This file is the contract between the people and the AI agents who change this
repository. It is short on purpose: it states the rules that are easy to break
and impossible to notice.

Read it before the first change. If a rule here conflicts with a habit, a
tutorial or an opinion — the rule wins.

The domain vocabulary lives in [`CONTEXT.md`](CONTEXT.md): use the terms of that
file in the code, in the commits and in the documentation.

---

## 1. The truth is in the source code

* **The code is the source of truth.** If a fact in a document contradicts the
  code, the code is right and the document is wrong.
* Fix the document **in the same change** that made the code diverge. A
  document that describes a system that does not exist is worse than no
  document: it is a trap for the next reader.
* The same rule applies in the other direction: if you change a document, the
  code must match it before the change is finished. A change that is only
  documented is not finished.
* Never describe a planned behaviour in the past tense, and never describe a
  planned behaviour as if it existed. The status of a feature is written in
  `IMPLEMENTATION_STATUS.md` and in the design cards in `docs/design/`.
* Do not weaken the security rules to make something work. If a rule blocks a
  feature, the feature changes — not the rule (see `docs/CONTRACT.md` §5).

---

## 2. Repository layout

| Directory | What is inside | May import |
|---|---|---|
| `backend/cmd/` | Entry points: `noto` (the server), `backup`, `restore`, `smoke`. Flags live here and nowhere else. | `backend/internal/**` |
| `backend/internal/api/` | HTTP only: routing, JSON decoding, middleware, the error envelope. Knows nothing about the domain. | `internal/notes`, `internal/model`, `internal/config`, `internal/port` (types only), `internal/sealed`, `internal/web` |
| `backend/internal/notes/` | The domain: tree, CRUD, trash, search, import/export, attachments, reconciliation, the hook extension point. Knows nothing about HTTP. | `internal/port`, `internal/model`, `internal/config` |
| `backend/internal/port/` | `port.Store` — the only interface to the storage. The frozen contract between the domain and the engine. | nothing inside `backend/` (leaf) |
| `backend/internal/sqlitestore/` | The SQLite implementation of `port.Store`: metadata, FTS5 index (+ `LIKE` fallback), attachments, trash, schema and migrations. | `internal/port`, `internal/model` |
| `backend/internal/model/` | The shared JSON types. A frozen contract: the shape of the API. | nothing inside `backend/` (leaf) |
| `backend/internal/config/` | Environment → `config.Config`. A frozen contract. | nothing inside `backend/` (leaf) |
| `backend/internal/backuppkg/` | The archive format: the manifest, the SHA-256 checksums, create/open. | `internal/config` |
| `backend/internal/restore/` | The restore logic: checksums, dry run, the atomic replacement of the database, the rollback. | `internal/backuppkg`, `internal/config` |
| `backend/internal/sealed/` | The blind object store of the sealed vault: bytes without a key. | `internal/port`, `internal/model` |
| `backend/internal/auth/` | The accounts, the passwords (Argon2id) and the sessions. It keeps its own SQLite file and knows nothing about the notes. | nothing inside `backend/` (leaf) |
| `backend/internal/audit/` | The journal of the actions of the users. It keeps its own SQLite file and never holds the content of a note. | nothing inside `backend/` (leaf) |
| `backend/internal/webhooks/` | The subscriptions, the outbox and the worker of the delivery. It keeps its own SQLite file. | nothing inside `backend/` (leaf) |
| `backend/internal/mcp/` | The MCP over HTTP: the envelope of JSON-RPC 2.0 and the tools of the notes. It talks to the domain through the interface it declares. | nothing inside `backend/` (leaf) |
| `backend/internal/vault/` | The location of the storage on the machine: the config file, the layout, the validation. | `internal/config` |
| `backend/internal/web/` | The serving of the SPA (the embedded `dist` or `NOTO_STATIC_DIR`). | nothing inside `backend/` (leaf) |
| `backend/internal/testutil/` | The in-memory store and the helpers of the tests. Never used by the production code. | `internal/port`, `internal/model`, `internal/notes`, `internal/config` |
| `frontend/src/core/` | The app-agnostic core: the store, the API facade, the events, the commands, the settings, the crypto core, the sealed vault, the query core, the queue of the offline writes (`core/sync/`), the registry of the storages (`core/storages/`). | `src/api`, `src/lib`, `src/core/**`, `src/i18n` — **never** `src/components/**` and **never** `src/plugins/**` |
| `frontend/src/i18n/` | The localisation: the catalogue of the strings, the language of the user and the hook of the interface. It is used by the core and by the components, and it never imports a component and never imports the plugin platform. | `src/core/settings/prefs` (the language is a preference) |
| `frontend/src/components/` | The interface: the shell, the tree, the editor, the panels, the dialogs. | `src/core`, `src/api`, `src/lib`, `src/ui`, and only `src/plugins/contract.ts` + `src/plugins/{host,registry}.ts` |
| `frontend/src/api/` | The single HTTP client (`client.ts`) and the typed modules over it. | `src/lib`, `src/core` (types only) — never `src/plugins/**` |
| `frontend/src/lib/` | Small, pure helpers: debounce, formatting, ordering, the lazy loaders. | `src/lib`, `src/i18n` (the strings of the interface) — never `src/plugins/**` |
| `frontend/src/plugins/` | The plugin platform: `contract.ts`, the manifest, the registry, the host, the loader, the sandbox and the built-in plugins. | `src/plugins/contract.ts` only from a built-in plugin; the platform itself may import `src/core` **type-only** |
| `frontend/src/ui/` | The shared presentational primitives (the tooltip and the like). | `src/lib`, `src/ui` |
| `frontend/src/styles/` | The CSS of the design system (the tokens, the layout, the components). | — (CSS only) |
| `frontend/src/__tests__/` | The unit tests of the frontend (Vitest). | everything under `src/` (only in tests) |
| `frontend/scripts/` | The tools: `check-boundaries.mjs`, `measure-bundle.mjs`, `copy-dist.mjs`, `gen-icons.mjs`. | — (Node scripts) |
| `e2e/` | The end-to-end suite (Playwright): the specs, the helpers, the global setup. | the built application over HTTP |
| `shared/` | The data shared by the two languages (today: the golden vectors of the query language and of the regular expressions). | — (JSON) |
| `docs/` | The documentation. `CONTRACT.md` is authoritative for the API, `ARCHITECTURE.md` for the structure. | — (Markdown) |
| `scripts/` | The PowerShell helpers: `dev`, `build`, `test`, `verify`, `backup`, `smoke`, `measure-perf`, `restore-smoke`. | — (PowerShell) |

---

## 3. The layering

### Frontend

```
components ──▶ core ──▶ api ──▶ lib
     │           │        │
     │           └── i18n ┘
     └── plugins (contract only)
```

* `frontend/src/core/**` must not import `frontend/src/components/**`, and must
  not import `frontend/src/plugins/**` at all.
* `frontend/src/i18n/**` is shared by the core and by the components: it holds
  the strings and nothing else, it never imports a component, and it never
  imports the plugin platform.
* `frontend/src/plugins/**` (a built-in plugin) imports **only**
  `frontend/src/plugins/contract.ts` and its own files. It never imports the
  core, the API client or another plugin.
* The rules are not a promise, they are a test:
  `frontend/scripts/check-boundaries.mjs` (`npm run check:boundaries` in
  `frontend/`). The rules R1–R12 are listed in `docs/PLUGIN_DEVELOPMENT.md`.
* A new rule means a new numbered rule in that script, a test that fails
  without it and a line in `docs/PLUGIN_DEVELOPMENT.md`.

### Backend

```
api ──▶ notes ──▶ port.Store ◀── sqlitestore
 │  ╲
 │   └──▶ auth · audit · webhooks · mcp   (their own SQLite files, leaves)
```

* `backend/internal/port/**` is the **only** way to the storage. The domain
  layer never imports the SQLite driver, so the engine stays replaceable and
  testable.
* `backend/internal/api/**` never touches the file system directly.
* `backend/internal/auth/**`, `backend/internal/audit/**` and
  `backend/internal/webhooks/**` keep their own SQLite files and import
  nothing inside `backend/`: they are leaves under the HTTP layer.
  `backend/internal/mcp/**` is a leaf too — it reaches the notes through the
  interface it declares, never through the database.
* `backend/internal/model/**` and `backend/internal/config/**` are frozen
  contracts: read them, import them, do not change them silently.

### The plugin API and the key material

* A plugin never sees the key material of the encrypted storage. The boundary
  is enforced by the checker (R11, R12), not by a promise.
* The extension point of the backend is `notes.Hook` (`noteapi.go`); the
  extension point of the frontend is the contract of the plugin.

---

## 4. Change routing

When you change something, update **all** the rows of the table below that
concern it, in the same change.

| Change | What to update | How to verify |
|---|---|---|
| A new endpoint (or a change of the shape of an answer) | `docs/CONTRACT.md`, `backend/internal/api/contract_test.go`, `docs/API.md` | `go test ./internal/api -run Contract`; `go run ./cmd/smoke` |
| A new field of the plugin contract | `frontend/src/plugins/contract.ts`, `PLUGIN_API_VERSION`, `docs/PLUGIN_API.md` | `npm run typecheck`, `npm run check:boundaries`, the tests of the plugin |
| A change of the schema of SQLite | `backend/internal/sqlitestore/store_schema.go`, `backend/internal/sqlitestore/schema_compat_test.go` | `go test ./internal/sqlitestore -run Schema`; the migration of `user_version` is idempotent |
| A new dependency (Go) | `backend/go.mod` (`go mod tidy`), the license list in `docs/THIRD_PARTY.md` | `go mod tidy && git diff --exit-code backend/go.mod` |
| A new dependency (npm) | `frontend/package.json`, the lock file, `docs/THIRD_PARTY.md` | `npm ci` in a clean tree |
| A change of the layout of the tree | `frontend/src/components/**`, `docs/DESIGN_SYSTEM.md` | the unit tests of the tree, `npm test` |
| A new rule of the boundaries | `frontend/scripts/check-boundaries.mjs`, `docs/PLUGIN_DEVELOPMENT.md` | `npm run check:boundaries` must fail without the new rule and pass with it |
| A new command of the CLI | `backend/cmd/<name>/main.go`, `docs/CONTRACT.md` §3.1 | `go run ./cmd/<name> -h` |
| A change of the format of the backup | `backend/internal/backuppkg/manifest.go`, `docs/CONTRACT.md`, `scripts/restore-smoke.ps1` | `scripts/restore-smoke.ps1` |
| A new string of the interface | `frontend/src/i18n/catalog/<area>.ts` (in **every** language of the file) | `npm test` (the test of the catalogue walks the sources) |
| A new document | the index of `README.md`, the link in the section "Documentation" | the links are checked by reading |
| Any change of the behaviour | the status of the phase in `IMPLEMENTATION_STATUS.md`, the live plan `PHASE8_PLAN.md` | the real output of the verification is quoted |

---

## 5. Rules of the code

* **No dump packages.** `util`, `common`, `helpers`, `misc`, `shared-utils` and
  similar names are forbidden: they collect what nobody knows where to put.
  A helper belongs to the module that uses it, or to `frontend/src/lib` when it
  is genuinely pure and small.
* **Names of the files say what is inside.**
  `*_service.go`, `*_handlers.go`, `*_store.go`, `*_client.go`,
  `*_contracts.go`, `*_test.go`. Never `*_helpers2.go`, `*_new.go`,
  `*_final.go`, `*_v2.go` — rename the file or the function instead.
* **The generated code is not edited by hand.** The generated artefacts
  (`frontend/public/icons/*.png` — `node scripts/gen-icons.mjs`,
  `backend/internal/web/dist` — `npm run build`) are regenerated by their
  script. A hand edit is lost at the next build.
* **No `eval`, no `new Function`, no dynamic import by path in the plugins.**
  A plugin is trusted code, but it still has to be statically analysable: the
  checker must be able to prove that a plugin imports nothing but the
  contract. `import()` is allowed only for the lazy chunks of the core
  (`marked`, `dompurify`, `idb`), never with a variable.
* **One file, one job.** A file above ~600 lines is a smell: split it along
  the seam that already exists in the package, not along an arbitrary line.
* **The errors are typed.** The backend carries the stable `code` of the
  error (`docs/CONTRACT.md` §5), the frontend throws a typed error with that
  code. No error message is parsed by a human string.
* **Tests are a part of the change.** A new behaviour comes with a test; a
  fixed defect comes with a test that failed before the fix.
* **The commits are small and honest.** One concern per commit, the message
  says what was broken and what is now true, and no commit contains a
  "temporary" hack that nobody removed.

---

## 6. The commands of the verification

Everything below is real: the scripts are in `scripts/`, the npm scripts are in
`frontend/package.json`.

### Everything at once

```powershell
cd E:\Code\Software\noto
.\scripts\verify.ps1                 # all the steps except the E2E
.\scripts\verify.ps1 -E2E            # with the end-to-end suite
.\scripts\verify.ps1 -Skip e2e,smoke
.\scripts\verify.ps1 -ReportPath .tools\verify-report.md
```

`scripts/verify.ps1` runs, in this order: `boundaries` (`node
frontend/scripts/check-boundaries.mjs`), `build` (`go build ./...`), `vet`
(`go vet ./...`), `test` (`go test ./... -race -count=1`, with
`CGO_ENABLED=1`), `smoke` (`go run ./cmd/smoke`), `typecheck` (`tsc --noEmit`),
`unit` (`npm test`), `bundle` (`npm run build`), `measure`
(`node scripts/measure-bundle.mjs`), and with `-Bench` the benchmarks
(`go test ./internal/notes -bench=. -benchmem -count=1`), and with `-E2E`
`npx playwright test`.

### The backend

```powershell
cd E:\Code\Software\noto\backend
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" build ./...
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" vet ./...
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" test ./... -count=1
$env:CGO_ENABLED = '1'
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" test ./... -race -count=1
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" run ./cmd/smoke
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" mod tidy
```

### The frontend

```powershell
cd E:\Code\Software\noto\frontend
npm ci
npm run typecheck        # tsc --noEmit
npm run check:boundaries # node scripts/check-boundaries.mjs
npm test                 # vitest run
npm run build            # tsc --noEmit && vite build
npm run measure          # the size of the bundle
npm run verify           # typecheck + boundaries + test + build
```

### The end-to-end suite and the backup

```powershell
cd E:\Code\Software\noto
npm ci
npx playwright test --reporter=list
.\scripts\backup.ps1
.\scripts\restore-smoke.ps1     # backup -> restore -> smoke, in a temporary directory
```

### The environment

* The Go toolchain of this machine is vendored at
  `.tools\goroot\go\bin\go.exe`; the scripts find it themselves.
* `go test -race` needs a C compiler (`CGO_ENABLED=1`).
* The browser of Playwright is the local Chromium of the cache
  (`channel: 'chromium'`); the CDN of Playwright is not reachable from this
  network, so `npx playwright install` is **not** a part of the workflow.

---

## 7. Before you finish

* [ ] The change is in the files you own; the foreign files are untouched.
* [ ] The documentation that describes the change is updated in the same
      change.
* [ ] `scripts/verify.ps1` is green (or the steps that fail are named, with
      the real output).
* [ ] `IMPLEMENTATION_STATUS.md` and the live plan of the phase tell the truth
      about what is done.
* [ ] No secret, no personal data and no file of the user's storage was added
      to the repository.

---

## 8. The licences of the third parties

The ideas that Noto borrowed and the dependencies that it uses are listed in
[`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md). When you add a dependency or
borrow an idea, add a row there in the same change.
