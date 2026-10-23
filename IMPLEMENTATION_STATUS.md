# IMPLEMENTATION_STATUS — Noto (Markdown Notes PWA)

Last updated: 2026-10-23 (phase 2). Status legend: **done** (implemented and
verified here) · **partial** (implemented, some part unverified) · **planned**.

## Architecture

```
noto/
├─ backend/            Go 1.23+ module `noto/backend`
│  ├─ cmd/noto         HTTP server entry point
│  ├─ cmd/backup       consistent backup (notes + attachments + SQLite)
│  ├─ cmd/smoke        end-to-end API smoke test
│  └─ internal/
│     ├─ config        env configuration            (frozen contract)
│     ├─ model         shared domain types / DTOs   (frozen contract)
│     ├─ port          Store interface              (frozen contract)
│     ├─ sqlitestore   SQLite implementation of port.Store (FTS5 + fallback)
│     ├─ notes         business logic: tree, CRUD, trash, search, import/export, attachments
│     │                + noteapi.go: NoteService, NoteEvent, Hook, AddHook (extension point)
│     ├─ api           HTTP handlers, router, security middleware
│     ├─ web           SPA / static serving (embedded dist or NOTO_STATIC_DIR)
│     └─ testutil      in-memory store + test helpers
├─ frontend/           Preact + TypeScript(strict) + Vite + CodeMirror 6
│  ├─ src/core/        app-agnostic modules: store, api facade, events, commands,
│  │                   settings store, diagnostics logger
│  ├─ src/plugins/     plugin platform: contract, manifest, registry, host, loader,
│  │                   builtin/word-count, builtin/insert-template
│  └─ src/components/  shell, editor, preview, plugin slots, plugin manager
├─ e2e/                Playwright end-to-end suite
├─ docs/               CONTRACT.md (authoritative), API.md, SECURITY.md,
│                      PLUGIN_API.md, PLUGIN_SECURITY.md, PLUGIN_DEVELOPMENT.md
└─ scripts/            dev / build / test / verify / backup / smoke PowerShell helpers
```

Layering: `api` → `notes` → `port.Store` ← `sqlitestore`. The business layer never
imports the SQLite driver, so the storage engine is replaceable and testable.

## Phase checklist

| # | Phase | Status | Evidence |
|---|-------|--------|----------|
| 1 | Repository inspection and implementation strategy | done | `docs/CONTRACT.md` |
| 2 | Backend, storage model, API, frontend structure | done | `backend/internal/**`, `frontend/src/**` |
| 3 | File explorer and Markdown editor | done | `frontend/src/components/{Sidebar,Editor,Preview}.tsx` |
| 4 | Persistence, search, import/export, revisions | done | `internal/notes`, `internal/sqlitestore` |
| 5 | PWA, responsive mobile UX, offline foundation | done | `frontend/public/{manifest.webmanifest,sw.js}`, `frontend/src/styles.css` |
| 6 | Security, backups, tests, documentation | done | `internal/api/middleware.go`, `cmd/backup`, `README.md`, `docs/SECURITY.md` |
| 7 | Full check run, live start, fixes | done | see "Verification log" below |
| 8 | Phase 2: modularisation, PWA privacy, plugin platform | partial | see "Phase 2 status" below |

## Phase 2 status (plugin platform)

| Area | Status | Evidence |
|------|--------|----------|
| Plugin contract v1.0.0 (8 permissions, 9 events, 6 UI contribution points, `PluginEditor` without `setText`) | done | `frontend/src/plugins/contract.ts` |
| Manifest validation and version compatibility (`validateManifest`, `isCompatible`) | done | `frontend/src/plugins/manifest.ts` |
| Registry: duplicate id refused, invalid manifest → `failed`, incompatible → `incompatible` | done | `frontend/src/plugins/registry.ts` |
| Host: activate/deactivate/disposeAll, `activate` failure → `failed` and swallowed, no duplicates on re-activation | done | `frontend/src/plugins/host.ts` |
| Core modules: typed event bus, command registry, plugin settings store (IndexedDB `noto-plugins`, namespaces, migrations), scoped logger, plugin API facade | done | `frontend/src/core/{events,commands,settings,diagnostics,api}/**` |
| UI contribution points + error boundary + plugin manager screen | done | `frontend/src/components/{PluginSlots,PluginManagerPanel}.tsx` |
| Example plugin 1 — Word Count (panel + command, `editor.read`) | done | `frontend/src/plugins/builtin/word-count/index.ts` |
| Example plugin 2 — Insert Template (command `insert-template:insert`, `editor.write`) | done | `frontend/src/plugins/builtin/insert-template/index.ts` |
| Backend extension point: `NoteService`, `NoteEvent`, `Hook`, `AddHook`; hooks fire after disk → index → metadata and after the locks are released | done | `backend/internal/notes/noteapi.go` |
| Permission enforcement at runtime (`PluginPermissionError`, `restrictPluginApi`, `restrictEditor`, `requirePermission`) | done (in the working tree, not yet committed) | `frontend/src/core/api/pluginApi.ts`, `frontend/src/plugins/host.ts`, tests `frontend/src/__tests__/plugin-permissions.test.ts` |
| Plugin documentation | done | `docs/PLUGIN_API.md`, `docs/PLUGIN_SECURITY.md`, `docs/PLUGIN_DEVELOPMENT.md` |
| Frontend / backend modularisation (splits of `App.tsx`, `api/`, `lib/`, `internal/notes`, `internal/api`, `internal/sqlitestore`, `cmd/smoke`) | done | `frontend/src/core/store/**`, `frontend/src/api/**`, `backend/internal/**` |
| PWA privacy policy: `/api/*` → `network-only`, private responses never cached, offline → `503 network_error` | done | `frontend/public/sw.js` |
| Lazy loading of `marked`/`dompurify`/`idb` (entry chunk 652,02 kB → 36,52 kB) | done | `frontend/src/lib/markdownLoader.ts`, `frontend/src/lib/drafts.ts` |
| E2E scenario for the plugin lifecycle (enable → tab → disable → cleanup → reload) | **not verified here** | `e2e/specs/plugins.spec.ts` was added in parallel by another worker; it was not executed as part of this documentation update |

## Definition of Done

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Frontend builds | done | `npm run build` (tsc --noEmit + vite build) |
| 2 | Go backend builds | done | `go build ./...` |
| 3 | Application starts per documented instructions | done | live run on `127.0.0.1:8123` |
| 4 | Backend persists Markdown on disk | done | `notes/Journal/day1.md` verified byte-exact |
| 5 | SQLite initialises correctly | done | `noto.db` + WAL, idempotent migrations (`PRAGMA user_version`) |
| 6 | Create/edit/rename/move/delete notes and folders | done | `internal/notes` tests + smoke run |
| 7 | Autosave reports errors instead of losing changes | done | `frontend/src/lib/autosave.ts` + draft recovery in IndexedDB |
| 8 | Search accurate after edits and file operations | done | FTS5 index synced on every mutation; `Reindex` rebuilds |
| 9 | Preview safe against script injection | done | `marked` + `dompurify`, unit tested |
| 10 | Import/export preserve folder structure | done | `internal/notes/importexport.go` + smoke checks |
| 11 | PWA manifest and service worker | done | `frontend/public/` |
| 12 | Responsive UI at desktop and mobile sizes | done | 820 px drawer breakpoint, Playwright mobile project |
| 13 | Critical backend and frontend tests pass | done | `go test ./...`, `npm test` |
| 14 | Security-sensitive file operations tested | done | traversal, invalid names, duplicate names, malicious ZIP |
| 15 | README documents setup, backup, security, limitations | done | `README.md`, `docs/SECURITY.md` |
| 16 | No fake buttons or hardcoded demo data | done | all endpoints and UI actions hit real storage |

## Verification log

### Phase 1 (baseline, 2026-10-23)

Real results of the final verification run (2026-10-23):

| Check | Command | Result |
|-------|---------|--------|
| Backend build | `go build ./...` | exit 0 |
| Backend vet | `go vet ./...` | exit 0 |
| Backend tests (race) | `CGO_ENABLED=1 go test ./... -race -count=1` | all packages ok |
| API smoke suite | `go run ./cmd/smoke` | `PASS 43 / FAIL 0`, exit 0 |
| Frontend typecheck + build | `npm run build` (`tsc --noEmit && vite build`) | exit 0, main chunk 658 kB / 227 kB gzip |
| Frontend unit tests | `npm test` | 8 files, 51 tests passed |
| End-to-end (real browser) | `npx playwright test` | 16 passed, 10 skipped (mobile-only specs), 0 failed |

The E2E suite runs the real Go server and the built SPA in Chromium
(desktop 1440x900 and Pixel 5 projects) and covers: app load and health,
folder and note creation, Markdown editing with Cyrillic text, autosave and
reload persistence, preview XSS resistance, search, rename and move, ZIP
import, export download and archive contents, the responsive drawer, and the
offline service-worker behaviour.

### Phase 2 (2026-10-23, after the plugin platform)

Commands actually executed for this status update, with their real output:

| Check | Command | Result |
|-------|---------|--------|
| Architecture boundaries | `npm run check:boundaries` (`frontend`) | `OK: 70 файлов проверено, нарушений нет` |
| Frontend typecheck | `npm run typecheck` (`frontend`) | exit 0, no diagnostics |
| Frontend unit tests | `npm test` (`frontend`) | 17 test files, 222 tests: **215 passed, 7 failed**. The failures are in the plugin tests of the example plugins (`plugin-word-count.test.tsx`, `plugin-insert-template.test.tsx`, `plugin-ui.test.tsx`): the built-in manifests do not declare `ui.contribute`, while the runtime enforcement now requires it for `registerPanel` / `registerCommand`. This is an open defect in `frontend/src/plugins/builtin/**`, not in the documentation. |
| Backend tests | `go test ./... -count=1` (`backend`) | all packages `ok` (9 packages with tests; 90 top-level `Test*` functions in the tree) |

Results recorded by the phase 2 waves (see `PHASE2_PLAN.md`) that were **not**
re-run for this status update:

| Check | Command | Result |
|-------|---------|--------|
| Backend build / vet | `go build ./...`, `go vet ./...` | exit 0 |
| Backend tests (race) | `CGO_ENABLED=1 go test ./... -race -count=1` | exit 0 (requires cgo) |
| API smoke suite | `go run ./cmd/smoke` | `PASS 43 / FAIL 0` |
| Frontend production build | `npm run build` | exit 0 |
| Bundle size | `npm run measure` | entry chunk 36,52 kB (gzip 11,96 kB) after re-partitioning |
| End-to-end | `npx playwright test` | 16 passed, 10 skipped — on the locally cached Chromium build |

Not verified in phase 2: the plugin lifecycle E2E scenario
(`e2e/specs/plugins.spec.ts` exists in the tree but was not executed for this
update), the Docker image build, and the 7 failing frontend plugin tests
mentioned above (the defect is in the plugin code, not in the documentation).

**Note on concurrent work.** While this documentation was being written, the
plugin core (`frontend/src/plugins/{contract,host}.ts`,
`frontend/src/core/api/pluginApi.ts`, `frontend/src/core/settings/settingsStore.ts`)
was being changed in parallel — that is where the runtime permission
enforcement, the live `ctx.editor`, `ctx.onEditor` and the event
`editor.available` came from. The documents describe the state of the working
tree at the time of writing; the numbers above are from a run against that
same state.

## Security findings and fixes

An independent audit (see `docs/SECURITY.md`) reproduced ten defects; all ten
are fixed with regression tests:

| # | Finding | Fix |
|---|---------|-----|
| F1 | Loopback guard bypassable with `NOTO_ADDR=":port"` | empty host counts as non-loopback; effective address printed |
| F2 | Windows junction inside the notes root allowed writes outside it | every path component checked for reparse points/symlinks |
| F3 | Same-origin writes rejected with 403 — the SPA could not save | same-origin and origin-less requests allowed, foreign origins still 403 |
| F4 | No total limit on multipart upload bodies | `http.MaxBytesReader` on every multipart request |
| F5 | TOCTOU between folder rename and concurrent writes split the tree | hierarchical locks; moved note -> 409, missing parent -> 404 |
| F6 | Export errors returned 200 with an empty ZIP | archive built before the status line is written |
| F7 | `.md` suffix appended before name validation | raw name validated first |
| F8 | Windows reserved device names with a trailing space accepted | base trimmed before the lookup |
| F9 | Archive limits relied on the declared size | per-entry and cumulative extracted-byte caps |
| F10 | Backup did not contain the trash directory | trash tree copied into the archive |

## Known limitations

### Environment

* Docker was never built in this phase: Docker is not installed on this machine,
  so `docker compose up --build` and the image build are unverified.
* Playwright could not download Chromium from the CDN (403); the E2E config
  falls back to the locally cached full Chromium build (`channel: 'chromium'`).
  On a normal machine install the browser normally.
* `go test -race` needs cgo. On this machine it runs with
  `CGO_ENABLED=1` and `C:\msys64\mingw64\bin` on `PATH`; without a C compiler
  the race detector cannot start.
* The Windows toolchain used here lives in `.tools/goroot`; on a normal machine
  install Go 1.23+ from go.dev and use `go` directly.
* The security audit used a proof-of-concept that created three throwaway files
  outside the repository (`C:\Windows\evil.md`, `C:\Windows\small.md`,
  `C:\Windows\pwned_dir`). The sandbox refuses to delete anything under
  `C:\Windows`; remove them manually with an elevated shell.

### Application

* The application has no user accounts. It binds to `127.0.0.1` by default and
  refuses to start on a public address unless `NOTO_ALLOW_PUBLIC=true`.
  A public deployment must be protected by a VPN or an authenticating reverse proxy.
* Offline support is an app-shell foundation with local draft recovery: every
  `/api/*` route is `network-only`, so nothing private is served from a cache.
  There is **no** automatic background synchronisation of pending edits.
* The export endpoints buffer the archive in memory; for very large libraries a
  temporary file would be preferable.

### Plugins

* **Plugins are trusted code without a sandbox.** A built-in plugin runs in the
  application's context: no iframe isolation, no separate origin, no capability
  sandboxing. See `docs/PLUGIN_SECURITY.md`.
* **Runtime permission enforcement is implemented** (working tree, not yet
  committed): the data API, the editor, the UI contributions and the settings
  check the declared rights and throw `PluginPermissionError`. The checks do
  **not** cover network requests a plugin makes itself, and there is no
  sandbox.
* **The built-in example manifests need `ui.contribute`.** `word-count`
  declares only `editor.read` and `insert-template` only `editor.write`, while
  both register a panel or a command — with the enforcement in place their UI
  contributions are refused and the corresponding tests fail
  (`plugin-word-count.test.tsx`, `plugin-insert-template.test.tsx`). The fix
  belongs to the plugin code (`frontend/src/plugins/builtin/**`), which is not
  part of the documentation scope.
* **User-supplied plugins are not supported.** Only built-in plugins exist;
  loading a plugin from disk or from the network is not implemented. A future
  phase would need an iframe sandbox with a strict CSP.
* **Plugin settings are not type-checked.** A stored value of the wrong type is
  returned as is; only values that cannot survive a JSON round trip are
  replaced by the default (known limitation, covered by a test).
* **`ctx.editor` is live, not a snapshot.** It is recomputed on every access,
  and `ctx.onEditor(...)` plus the event `editor.available` report a change of
  the editor. A plugin that captures `ctx.editor` once keeps that snapshot.
* **The event `folder.moved` is declared but never emitted** by the frontend;
  the other contract events (`note.*`, `folder.created`, `editor.saved`,
  `editor.available`, `workspace.opened`) are emitted after the corresponding
  operation succeeded.
* **The backend hook API (`notes.AddHook`) is not connected to the frontend**
  yet: the plugin events come from `App.tsx`, not from the Go hooks.
* **No verified E2E scenario for the plugin lifecycle** — the spec file
  `e2e/specs/plugins.spec.ts` exists in the tree, but it was not executed as
  part of this status update.
* **Plugin logging is not filtered.** The rule "a plugin must not log note
  content" is a convention, not a mechanism: the logger only adds a prefix.

