# IMPLEMENTATION_STATUS — Noto (Markdown Notes PWA)

Last updated: 2026-10-23 (phase 3). Status legend: **done** (implemented and
verified here) · **partial** (implemented, some part unverified) · **planned**.

## Architecture

```
noto/
├─ backend/            Go 1.23+ module `noto/backend`
│  ├─ cmd/noto         HTTP server entry point + the "reconcile" and "restore" subcommands
│  ├─ cmd/backup       consistent backup (notes + attachments + SQLite)
│  ├─ cmd/restore      thin wrapper around internal/restore (also `noto restore`)
│  ├─ cmd/smoke        end-to-end API smoke test
│  └─ internal/
│     ├─ config        env configuration            (frozen contract)
│     ├─ model         shared domain types / DTOs   (frozen contract)
│     ├─ port          Store interface              (frozen contract)
│     ├─ sqlitestore   SQLite implementation of port.Store (FTS5 + fallback)
│     ├─ backuppkg     archive format: manifest v2, SHA-256 checksums, create/open
│     ├─ restore       restore logic: checksums, dry run, atomic DB replacement, rollback
│     ├─ notes         business logic: tree, CRUD, trash, search, import/export, attachments
│     │                + noteapi.go: NoteService, NoteEvent, Hook, AddHook (extension point)
│     │                + reconcile.go: Reconcile / ReconcileWithOptions (file system vs. database)
│     ├─ api           HTTP handlers, router, security middleware
│     │                + handlers_maintenance.go (only with NOTO_MAINTENANCE=1)
│     ├─ web           SPA / static serving (embedded dist or NOTO_STATIC_DIR)
│     └─ testutil      in-memory store + test helpers
├─ frontend/           Preact + TypeScript(strict) + Vite + CodeMirror 6
│  ├─ src/core/        app-agnostic modules: store, api facade, events, commands,
│  │                   settings store, diagnostics logger
│  ├─ src/plugins/     plugin platform: contract, manifest, registry, host, loader,
│  │                   builtin/word-count, builtin/insert-template, builtin/backlinks
│  ├─ src/components/  shell, editor, preview, plugin slots, plugin manager,
│  │                   command palette
│  └─ public/          sw.js (service worker) + sw-policy.js (pure policy functions)
├─ e2e/                Playwright end-to-end suite
├─ docs/               CONTRACT.md (authoritative), API.md, SECURITY.md, PERFORMANCE.md,
│                      ARCHITECTURE.md, PLUGIN_API.md, PLUGIN_SECURITY.md,
│                      PLUGIN_DEVELOPMENT.md
└─ scripts/            dev / build / test / verify / backup / smoke / measure-perf helpers
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
| 9 | Phase 3: performance, backups, reconciliation, command palette | done | see "Phase 3 status" below |
| 10 | Phase 4: premium UI redesign, design system, accessibility, UX | done | see "Phase 4 status" below |

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
| E2E scenario for the plugin lifecycle (enable → tab → disable → cleanup → reload) | **not verified here** | `e2e/specs/plugins.spec.ts` was added in parallel by another worker; it was not executed as part of this documentation update (it ran green in phase 3, see the verification log) |

## Phase 3 status (performance, backups, reconciliation, command palette)

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P3-1 | The N+1 of `notes.Service.Tree` is removed: the metadata is read with a single `store.ListNotes(ctx)` and distributed to the walked nodes by path. `port.Store` was **not** changed | done | `backend/internal/notes/service.go`, benchmarks `backend/internal/notes/service_bench_test.go` |
| P3-2 | Backups get a manifest of version 2 with a SHA-256 checksum per file, the archive is written to a temporary file and renamed into place, and the restore logic in the new `backend/internal/restore` restores an archive (checksum verification, `-dry-run`, keeping of `noto.db.pre-restore-<timestamp>`, atomic replacement of the database, rollback on an invalid schema). The entry point is available both as the subcommand `noto restore` and as the standalone program `cmd/restore` — a thin wrapper around the same package. Old archives without checksums are still restored, with a warning | done | `backend/internal/backuppkg/`, `backend/internal/restore/`, `backend/cmd/restore/main.go`, `backend/cmd/backup/main.go` |
| P3-3 | Reconciliation of the file system and the database: `notes.Reconcile` / `notes.ReconcileWithOptions{Apply, DropGhosts, DryRun}`, the CLI `noto reconcile` and the HTTP endpoint `POST /api/maintenance/reconcile` (registered only with `NOTO_MAINTENANCE=1`). Without an explicit flag nothing is changed. The SQLite schema was not changed | done | `backend/internal/notes/reconcile.go`, `backend/internal/api/handlers_maintenance.go`, `backend/cmd/noto/main.go` |
| P3-4 | Tests: fuzz targets `FuzzNormalizeRel` / `FuzzJoinRel` / `FuzzValidateName`, the tests of the LIKE fallback of the search, and the race tests of concurrent writes to the same path | done | `backend/internal/notes/paths_fuzz_test.go`, `backend/internal/sqlitestore/search_fallback_test.go`, `backend/internal/notes/concurrency_test.go` |
| P3-5 | The service worker policy was moved into pure functions in `frontend/public/sw-policy.js` (20 unit tests) and the offline E2E scenario was extended. A real defect was fixed: a fixed base origin sent the private `/api/*` requests into the cache-first branch | done | `frontend/public/sw-policy.js`, `frontend/src/__tests__/sw-policy.test.ts`, `e2e/specs/offline.spec.ts` |
| P3-6 | Global command palette on Ctrl+K / Ctrl+P. The search moved to **Ctrl+Shift+F** and stays reachable through the button in the sidebar and the "Search notes" command of the palette. Eight built-in commands (`app:new-note`, `app:new-folder`, `app:rename-note`, `app:delete-note`, `app:daily-note`, `app:search`, `app:toggle-theme`, `app:open-trash`); the daily note creates or opens `YYYY-MM-DD.md` in the root of the library and never overwrites an existing file | done | `frontend/src/components/CommandPalette.tsx`, `frontend/src/core/commands/appCommands.ts`, `frontend/src/App.tsx` |
| P3-7 | Third built-in plugin `backlinks`: incoming links (`[[Wiki Link]]`) and mentions. It is implemented through the public contract only (it imports nothing but `plugins/contract.ts`) and declares `editor.read`, `notes.read`, `tree.read`, `ui.contribute`. It cannot open a note — the contract was not extended | done | `frontend/src/plugins/builtin/backlinks/index.ts`, `frontend/src/plugins/loader.ts` |
| P3-8 | DX: `scripts/verify.ps1` got `-ReportPath` (a markdown report with the summary and the tool versions) and `-Bench`; the npm scripts `verify` in the frontend and in the root; the outdated comments about FTS5 were corrected (in `modernc.org/sqlite` FTS5 is enabled by default, the build tag `sqlite_fts5` is not needed) | done | `scripts/verify.ps1`, `scripts/measure-perf.ps1`, `frontend/package.json`, `package.json` |

### Measured effect of P3-1

2000 notes, the same machine, the numbers are detailed in `docs/PERFORMANCE.md`:

| Measurement | before | after |
| --- | --- | --- |
| `GET /api/tree`, median | 283 ms | 98 - 110 ms |
| `GET /api/tree`, p95 | 314 ms | 118 - 125 ms |
| `BenchmarkTree`, allocations per operation | ~98 930 | ~56 440 |
| `BenchmarkTree`, time per operation | ~170 ms | ~92 ms |

The tree endpoint is 2.3x - 2.9x faster; the number of allocations drops by
43 %. `Service.Reindex` still has the same N+1 pattern and was out of the
scope of the card (about 7.7 s for 2000 notes).

## Phase 4 status (premium UI redesign)

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P4-1 | Audit of the interface: 18 defects with their cause (not only the symptom), 5 points consciously postponed | done | `docs/UI_AUDIT.md` |
| P4-2 | Design system: the monolithic `styles.css` (19 KB) was split into six layers (`tokens`, `base`, `layout`, `components`, `markdown`, `plugin`); the theme is declared once (explicit light/dark + the system theme); 60+ semantic tokens; `prefers-reduced-motion`; one focus ring | done | `frontend/src/styles/`, `docs/DESIGN_SYSTEM.md` |
| P4-3 | One icon set: `lucide-preact` with a registry of 21 icons (`frontend/src/ui/icons.tsx`), the same stroke width and `currentColor`; every unicode glyph was replaced. An unknown icon name falls back to a neutral dot | done | `frontend/src/ui/icons.tsx`, `frontend/package.json` |
| P4-4 | The shell: CSS grid/flex layout, a resizable and collapsible sidebar, a drawer below 820 px, no horizontal overflow from 360 to 1920 px, no clipped controls | done | `frontend/src/styles/layout.css`, `e2e/specs/viewport.spec.ts` |
| P4-5 | The note tree: icons, a clickable folder, a limited indent, one row height, the states, a context menu (right click or the `…` button), renaming in place with validation, the list of the recent notes, the order by name or by date | done | `frontend/src/components/{Sidebar,TreeRow,TreeContextMenu,RecentNotesPanel}.tsx` |
| P4-6 | The secondary screens: the dialogs with a focus trap and Escape, the palette with groups and `kbd`, the search with its states, the settings dialog, the shortcut help | done | `frontend/src/components/{Dialog,NoteDialogs,CommandPalette,SearchPanel,SettingsDialog,ShortcutHelp}.tsx` |
| P4-7 | One source of truth for the keyboard shortcuts (`core/commands/shortcuts.ts`) and the preferences of the user (`core/settings/prefs.ts`, `localStorage` `noto-prefs-v1`, with the validation and the inheritance of the old key `noto-theme`) | done | `frontend/src/core/commands/shortcuts.ts`, `frontend/src/core/settings/prefs.ts` |
| P4-8 | The breadcrumbs of the open note, the shared empty state, the reworked save status | done | `frontend/src/components/{NoteBreadcrumbs,EmptyState,AppFooter}.tsx` |
| P4-9 | Tests: 4 unit files (preferences, shortcuts, the order of the tree, the icons) and 3 E2E files (the matrix of the viewports, the settings, the keyboard operation) | done | `frontend/src/__tests__/`, `e2e/specs/{viewport,settings,a11y}.spec.ts` |
| P4-10 | The public contract of the plugins was not broken; the `icon` of a contribution is now the name of an icon of the registry (an unknown name is still safe) | done | `docs/PLUGIN_API.md`, `docs/DESIGN_SYSTEM.md` |

### Measured effect of the redesign

| Measurement | before (phase 3) | after (phase 4) |
| --- | --- | --- |
| Entry chunk, raw | 81,45 kB | 107,48 kB |
| Entry chunk, gzip | 25,33 kB | 32,25 kB |
| JS chunks | 119 | 123 (4 lazy: the settings, the shortcuts, the rarely used panels, the search) |
| CSS, raw / gzip | 13,74 kB / 3,05 kB | 34,65 kB / 6,25 kB |
| Frontend unit tests | 293 | 322 (+29) |
| E2E | 24 passed / 18 skipped | 57 passed / 19 skipped |

The entry chunk grew by 6,9 kB gzip: the icon set, six new components (the tree
rows, the context menu, the recent notes, the breadcrumbs, the settings, the
shortcut help) and the state of the preferences. The budget of the plan was
32 kB gzip — the result is 0,25 kB above it; the four rarely used overlays were
moved into lazy chunks to stay near the budget.

## Phase 5 status (the redesign of the prototype, the vault, the drag and drop)

The interface was rewritten pixel by pixel after the prototype
(`stitch_noto_markdown_editor_redesign`, the "Obsidian Slate" screens), and the
functions that the prototype promised were implemented.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P5-1 | The palette, the typography and the sizes of the prototype were transferred exactly: canvas `#09090b`, panel `#121215`, surface `#18181b`, container `#1f1f22`, border `#27272a`, accent `#818cf8` (light `#6366f1`), the radii 2/4/8/12, the row of 32 px, the column of 240 px, the outline column of 280 px, the editor of 720 px, the header of 44 px and the status bar of 24 px. The fonts (Inter 400–600, JetBrains Mono 400–500) are served locally from `frontend/public/fonts` — the application never asks a CDN at runtime | done | `frontend/src/styles/{tokens,fonts}.css`, `frontend/public/fonts/` |
| P5-2 | The shell of the prototype: a permanent top bar (brand, search, navigation, the state of the vault, the toggles of both columns, the theme), the left column with the vault header, the navigation (All notes / Recent / Trash) and the tree, the middle with the tab strip, the breadcrumbs and the editor, the right column with the outline of the note, the status bar with the path, Ln/Col, the word count, the encoding and the state of the file | done | `frontend/src/App.tsx`, `frontend/src/components/{AppHeader,AppFooter,EditorTabs,OutlinePanel}.tsx`, `frontend/src/styles/layout.css` |
| P5-3 | The buttons of both columns live in the permanent top bar, so a hidden column can always be brought back. On a narrow screen the columns are drawers over the editor | done | `frontend/src/components/AppHeader.tsx`, `e2e/specs/shell.spec.ts` |
| P5-4 | The drag and drop of the notes and the folders in the tree (native HTML5, without a new dependency). The rules are on the server: a folder cannot be dropped into itself or into one of its own descendants, a note cannot be dropped into the folder it already lives in | done | `frontend/src/components/{TreeRow,Sidebar}.tsx`, `backend/internal/notes/notes_move.go`, `e2e/specs/tree-interaction.spec.ts` |
| P5-5 | The long names are cut off with an ellipsis on one line (no wrapping). The full name is shown in a tooltip only when the text is really clipped (the pattern of `useOverflowTitle` of Memos, MIT) | done | `frontend/src/lib/useOverflowTitle.ts`, `frontend/src/components/TreeRow.tsx` |
| P5-6 | The button of the trash in the footer of the left column is an icon only; the point "Trash" of the navigation keeps its text | done | `frontend/src/components/Sidebar.tsx`, `e2e/specs/shell.spec.ts` |
| P5-7 | The storage of the notes (the "vault"): the folder is asked at the first start, the notes are plain Markdown files in it, the internal data lives in the hidden `.noto` subfolder, the folder can be changed at any time, the server switches to it on the fly | done | `backend/internal/vault/`, `backend/internal/api/handlers_vault.go`, `frontend/src/components/VaultPicker.tsx`, `docs/VAULT.md` |
| P5-8 | The outline of the note on the right: the headings of the Markdown, the active heading follows the cursor, the click scrolls the editor to the heading | done | `frontend/src/lib/outline.ts`, `frontend/src/components/OutlinePanel.tsx` |
| P5-9 | The stubs of the prototype: "Graph" and "Archive" in the top bar are honest stubs (`aria-disabled`, the title "Not implemented yet", the click does nothing) | stub | `frontend/src/components/AppHeader.tsx`, `e2e/specs/shell.spec.ts` |
| P5-10 | The tests: 8 new unit files (the outline, the preferences, the shortcut keys, the tree order, the icons) and 3 new E2E files (the shell, the tree, the vault) | done | `frontend/src/__tests__/`, `e2e/specs/{shell,tree-interaction,vault}.spec.ts` |
| P5-11 | The documentation: `docs/VAULT.md` (the model of the storage), the API of the storage in `docs/API.md`, the new shell in `docs/DESIGN_SYSTEM.md`, the README | done | `docs/`, `README.md` |

### Measured effect of the redesign

| Measurement | after phase 4 | after phase 5 |
| --- | --- | --- |
| Entry chunk, raw | 108,20 kB | 119,50 kB |
| Entry chunk, gzip | 32,39 kB | 35,66 kB |
| Frontend unit tests | 322 | 330 (+8) |
| E2E | 57 passed / 19 skipped | see the verification log of phase 5 |

The entry chunk grew by 3,3 kB gzip: the tab strip, the outline, the picker of
the storage and the state of the columns. The picker of the storage is loaded
lazily, because it is needed once.

### What was borrowed from the reference projects

| Project | Licence | What was taken |
|---|---|---|
| `usememos/memos` | MIT | the idea of the tooltip only for the really clipped text (`useOverflowTitle`), the outline that is built from the Markdown |
| `Vinzent03/obsidian-git` | MIT | nothing beyond the idea of the folder picker with a validation on the server |
| `laurent22/joplin` | AGPL-3.0 | only the ideas were read: the native HTML5 drag and drop, the check of the descendants in the model. **No code was copied** |
| `siyuan-note/siyuan` | AGPL-3.0 | only the ideas were read: the flow of the choice of the storage (check on the server, then switch), the outline that follows the cursor. **No code was copied** |

The rules of the drag and drop live on the server, like in SiYuan and in Joplin:
the client is not trusted.

## Phase 6 status (the compact shell)

The interface was compacted on the advice of the user: the top bar was
dismantled, the actions were moved to the permanent status bar and to the
footer of the left column, and the defects the user saw in phase 5 (D30–D39)
were closed.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P6-1 | The top bar is gone as a separate strip: the brand and the name of the open note live in the header of the left column, the search, Graph, Archive, the theme and the toggles of both columns live in the permanent status bar. A hidden column can always be brought back | done | `frontend/src/App.tsx`, `frontend/src/components/{AppHeader,AppFooter,Sidebar}.tsx`, `frontend/src/styles/layout.css` |
| P6-2 | The icon instead of the text: the context menu of the tree, the footer of the column and the status bar. Every icon-only control has `aria-label` and `title`; the shared helper is `frontend/src/ui/tooltip.tsx` | done | `frontend/src/ui/tooltip.tsx`, `frontend/src/components/{TreeContextMenu,PluginSlots,AppFooter}.tsx` |
| P6-3 | The storage fixed by the environment is a normal state, not a banner: the flag `NOTO_VAULT_FIXED=1` (and only it) fixes the storage, `GET /api/vault` returns `fixed`, `POST`/`DELETE` answer with the dedicated code `vault_fixed` | done | `backend/cmd/noto/main.go`, `backend/internal/api/handlers_vault.go`, `docs/VAULT.md` |
| P6-4 | The tree shows the hierarchy explicitly: the step of the indent is 16 px, every level draws a guide line, the rail of the chevron and of the icon is aligned, the folders show the number of their notes (counted recursively on the server) and the section EXPLORER shows the totals | done | `frontend/src/components/{TreeRow,Sidebar}.tsx`, `backend/internal/api/handlers_notes.go` |
| P6-5 | The tabs are flat: 2 px underline of the accent, no rounded corners, 32 px of height, the close button only of the active tab, a dot for the unsaved changes | done | `frontend/src/components/EditorTabs.tsx`, `frontend/src/styles/layout.css` |
| P6-6 | Both columns are resized with the same control (`ColumnResizer`); the width of the right column is stored in the preferences (`rightPanelWidth`, 200–480 px) | done | `frontend/src/components/ColumnResizer.tsx`, `frontend/src/core/settings/prefs.ts` |
| P6-7 | The section Recent folds with an icon, the search became a button, Graph and Archive became honest stubs in the status bar | done | `frontend/src/components/{RecentNotesPanel,AppFooter}.tsx` |
| P6-8 | The modes split and preview are removed from the interface; the type `ViewMode` and the old value in the preferences stay, `Preview.tsx` stays in the repository with its tests of the sanitizing | done | `frontend/src/App.tsx`, `frontend/src/components/SettingsDialog.tsx`, `frontend/src/__tests__/preview-lazy.test.tsx` |
| P6-9 | The duplication of a note (new): `POST /api/notes/duplicate` copies the note next to the original (`note copy.md`, `note copy 2.md`, …), the command `app:duplicate-note` and the shortcut `Ctrl+D` | done | `backend/internal/notes/notes.go`, `frontend/src/api/notes.ts`, `frontend/src/core/commands/appCommands.ts` |
| P6-10 | The tests: the unit files of the tree, the menu, the recent notes, the tabs and the status bar; the E2E of the shell, the tree, the storage and the viewports | done | `frontend/src/__tests__/`, `e2e/specs/{shell,tree-interaction,vault,viewport}.spec.ts` |
| P6-11 | The documentation: the defects D30–D39 in `docs/UI_AUDIT.md`, the new shell in `docs/DESIGN_SYSTEM.md`, the storage in `docs/VAULT.md`, the API of the counters and of the duplication in `docs/API.md`, `.env.example` | done | `docs/`, `.env.example` |

### Measured effect of the phase 6

| Measurement | after phase 5 | after phase 6 |
| --- | --- | --- |
| Entry chunk, raw | 119,50 kB | 125,95 kB |
| Entry chunk, gzip | 35,66 kB | 37,19 kB |
| Frontend unit tests | 330 | 368 (+38) |
| E2E | 79 passed / 23 skipped | 89 passed / 27 skipped |
| `scripts/verify.ps1 -E2E -Bench` | 11/11 PASS | 11/11 PASS |

The entry chunk grew by 1,5 kB gzip: the helper of the icon-only buttons, the
shared resizer of the columns, the counters of the tree and the new icons. The
preview was removed from the interface, but its renderer stayed in a lazy chunk
and does not weigh on the entry.

### What was borrowed from the reference projects (phase 6)

| Project | Licence | What was taken |
|---|---|---|
| `usememos/memos` | MIT | the pattern of the icon-only controls with the accessible name, the counters of the tree with `tabular-nums`, the compact footer that shows only the non-zero counters |
| `Vinzent03/obsidian-git` | MIT | the rule of the icon instead of the duplicated text, the `aria-label` and the tooltip of every icon-only control |
| `laurent22/joplin` | AGPL-3.0 | only the ideas were read: the uniform step of the indent. **No code was copied** |
| `siyuan-note/siyuan` | AGPL-3.0 | only the ideas were read: the compact status bar. **No code was copied** |

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

### Phase 3 (2026-10-23)

Commands that were actually executed while the phase 3 documentation was
written, with their real output:

| Check | Command | Result |
|-------|---------|--------|
| Backend tests | `go test ./... -count=1` (`backend`) | all packages `ok` (9 packages with tests: `cmd/backup`, `cmd/noto`, `internal/api`, `internal/backuppkg`, `internal/notes`, `internal/port`, `internal/restore`, `internal/sqlitestore`, `internal/web`; the restore tests live in `internal/restore`, `cmd/restore` is a thin wrapper without tests of its own) |
| Frontend unit tests | `npm test` (`frontend`) | 20 test files, **293 tests passed**, 0 failed |
| Bundle size | `npm run measure` (`frontend`) | entry chunk 81,44 kB (gzip 25,33 kB) — the phase 2 value was 36,52 kB / 11,96 kB; the command palette and the backlinks plugin added weight |
| End-to-end | `npx playwright test` | **24 passed, 18 skipped, 0 failed** — on the locally cached Chromium build |

Results of the phase 3 waves that were reported but **not** re-run for this
documentation update:

| Check | Command | Result |
|-------|---------|--------|
| Backend build / vet | `go build ./...`, `go vet ./...` | exit 0 |
| Backend tests (race) | `CGO_ENABLED=1 go test ./... -race -count=1` | exit 0 (needs cgo) |
| API smoke suite | `go run ./cmd/smoke` | `PASS 43 / FAIL 0` |
| Frontend production build | `npm run build` | exit 0 |
| Go benchmarks | `go test ./internal/notes -bench=. -benchmem` | `BenchmarkTree` ~170 ms -> ~92 ms, allocations 98 930 -> 56 440 |
| HTTP measurement | `.\scripts\measure-perf.ps1 -Notes 2000 -Iterations 11` | `GET /api/tree` median 283 ms -> 98 - 110 ms, p95 314 ms -> 118 - 125 ms |
| Verification script | `.\scripts\verify.ps1 -Bench -ReportPath ...` | markdown report with the summary and the tool versions |

Not verified in phase 3: the Docker image build (Docker is not installed on
this machine), the download of a Chromium build for Playwright (the suite ran
on the locally cached build), the race detector without a C compiler, and the
`npx playwright install` path.

**Note on concurrent work.** While this documentation was being written, the
plugin core (`frontend/src/plugins/{contract,host}.ts`,
`frontend/src/core/api/pluginApi.ts`, `frontend/src/core/settings/settingsStore.ts`)
was being changed in parallel — that is where the runtime permission
enforcement, the live `ctx.editor`, `ctx.onEditor` and the event
`editor.available` came from. The documents describe the state of the working
tree at the time of writing; the numbers above are from a run against that
same state.

### Phase 6 (2026-10-23)

The compact shell and the defects D30–D39 (see `docs/UI_AUDIT.md`).

| Check | Command | Result |
|-------|---------|--------|
| Verification script | `.\scripts\verify.ps1 -E2E -Bench -ReportPath .tools\phase6-verify.md` | **11/11 PASS** (boundaries, build, vet, `go test -race`, HTTP smoke, `tsc`, Vitest, production build, bundle report, Go benchmarks, Playwright) |
| Backend tests | `go test ./... -count=1` (`backend`) | all packages `ok` (the new tests: the duplication of a note, the counters of the tree, the fixed storage) |
| Frontend unit tests | `npm test` (`frontend`) | 28 test files, **368 tests passed**, 0 failed |
| Bundle size | `npm run measure` (`frontend`) | entry chunk 125,95 kB (gzip 37,19 kB) |
| End-to-end | `npx playwright test` | **89 passed, 27 skipped, 0 failed** — two servers: the main one fixes the storage (`NOTO_VAULT_FIXED=1`), the second one allows the real change of the folder |

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
  so `docker compose up --build` and the image build are unverified. The same
  is true for phase 3 — the images were never built.
* Playwright could not download Chromium from the CDN (403); the E2E config
  falls back to the locally cached full Chromium build (`channel: 'chromium'`).
  `npx playwright install` is therefore not usable on this machine, and the
  suite of phase 3 (24 passed / 18 skipped) ran on the cached build.
* `go test -race` needs cgo. On this machine it runs with
  `CGO_ENABLED=1` and `C:\msys64\mingw64\bin` on `PATH`; without a C compiler
  (gcc) the race detector cannot start.
* The Windows toolchain used here lives in `.tools/goroot`; on a normal machine
  install Go 1.23+ from go.dev and use `go` directly.
* The security audit used a proof-of-concept that created three throwaway files
  outside the repository (`C:\Windows\evil.md`, `C:\Windows\small.md`,
  `C:\Windows\pwned_dir`). The sandbox refuses to delete anything under
  `C:\Windows`; remove them manually with an elevated shell. The three paths
  were still present when the phase 3 documentation was written.

### Application

* The application has no user accounts. It binds to `127.0.0.1` by default and
  refuses to start on a public address unless `NOTO_ALLOW_PUBLIC=true`.
  A public deployment must be protected by a VPN or an authenticating reverse proxy.
* Offline support is an app-shell foundation with local draft recovery: every
  `/api/*` route is `network-only`, so nothing private is served from a cache
  and an offline request answers `503` with the code `network_error`. There is
  **no** automatic background synchronisation of pending edits: a **full
  offline synchronisation is not implemented**, the drafts stay in the browser
  until the note is saved again.
* The export endpoints buffer the archive in memory; for very large libraries a
  temporary file would be preferable.
* `validateName` does not limit the length of a name and accepts the control
  characters below `0x20` (except NUL). This was found by the fuzz targets of
  card P3-4 and was deliberately **not** changed, so that existing files on
  disk are never rejected. A note name is therefore not guaranteed to be free
  of control characters.
* The search button in the sidebar still carries the tooltip
  "Search (Ctrl+K)"; the shortcut is `Ctrl+Shift+F` since the command palette
  took over `Ctrl+K` / `Ctrl+P`. The palette itself offers "Search notes", so
  the function is still reachable.
* The restore is available as the subcommand `noto restore`; the separate
  program `backend/cmd/restore` remains for the cases where a separate process
  is needed. Both call the same `restore.Run`. It refuses to write into a
  directory that already contains data unless `-force` is given.

### Plugins

* **Plugins are trusted code without a sandbox.** A built-in plugin runs in the
  application's context: no iframe isolation, no separate origin, no capability
  sandboxing. See `docs/PLUGIN_SECURITY.md`.
* **Runtime permission enforcement is implemented** (working tree, not yet
  committed): the data API, the editor, the UI contributions and the settings
  check the declared rights and throw `PluginPermissionError`. The checks do
  **not** cover network requests a plugin makes itself, and there is no
  sandbox.
* **The manifests of the built-in plugins declare `ui.contribute`.** The defect
  of phase 2 (the manifests of `word-count` and `insert-template` lacked the
  right while they register a panel or a command, which made seven tests fail)
  is fixed: `word-count` declares `editor.read` and `ui.contribute`,
  `insert-template` declares `editor.read`, `editor.write` and
  `ui.contribute`, and the third plugin `backlinks` declares `editor.read`,
  `notes.read`, `tree.read` and `ui.contribute`.
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
* **The E2E suite covers the plugin lifecycle** (`e2e/specs/plugins.spec.ts`,
  14 tests over the desktop and the mobile project). It was not executed
  during the phase 2 status update, but the whole suite ran green in phase 3
  (24 passed / 18 skipped).* **Plugin logging is not filtered.** The rule "a plugin must not log note
  content" is a convention, not a mechanism: the logger only adds a prefix.

