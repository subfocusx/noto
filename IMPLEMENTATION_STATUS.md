# IMPLEMENTATION_STATUS — Noto (Markdown Notes PWA)

Last updated: 2026-10-24 (phase 10). Status legend: **done** (implemented and
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
│     │                + handlers_sealed.go, handlers_sealed_purge.go (the sealed mode)
│     ├─ sealed        the blind object store of the sealed vault (bytes, no key)
│     ├─ web           SPA / static serving (embedded dist or NOTO_STATIC_DIR)
│     └─ testutil      in-memory store + test helpers
├─ frontend/           Preact + TypeScript(strict) + Vite + CodeMirror 6
│  ├─ src/core/        app-agnostic modules: store, api facade, events, commands,
│  │                   settings store, diagnostics logger
│  │  ├─ crypto/      the crypto core: KDF, the hierarchy of the keys, the container
│  │  ├─ vault/       the sealed vault: manifest, objects, index, session,
│  │  │               migration, the single entry point VaultService
│  │  └─ connection/  the monitor of the backend (connected/connecting/unreachable)
│  ├─ src/plugins/     plugin platform: contract, manifest, registry, host, loader,
│  │                   builtin/word-count, builtin/insert-template, builtin/backlinks
│  ├─ src/components/  shell, editor, preview, plugin slots, plugin manager,
│  │                   command palette, the screens of the encrypted storage
│  └─ public/          sw.js (service worker) + sw-policy.js (pure policy functions)
├─ e2e/                Playwright end-to-end suite
├─ docs/               CONTRACT.md (authoritative), API.md, SECURITY.md, PERFORMANCE.md,
│                      ARCHITECTURE.md, ENCRYPTION.md, VAULT.md, UI_AUDIT.md,
│                      DESIGN_SYSTEM.md, PLUGIN_API.md, PLUGIN_SECURITY.md,
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
| 11 | Phase 7: the redesign of the shell and the encrypted storage | done | see "Closed phases" below — commit `60d7ba8` |
| 12 | Phase 8: the query language, the derived properties, the plugin API 1.2.0 | done | see "Phase 8 status" below |
| 13 | Phase 9: the interface without documentation (the filter that works, the tags of the note, the conflict of the saving) | done | see "Phase 9 status" below |

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

## Phase 8 status (the query language, the derived properties, the plugins)

One idea: give the vault a **language of selection**. The notes carry derived
properties (the title, the tags, the flags), the language selects the notes by
them, and the interface offers the selection as a query, as saved views and as
a tree of tags. The language is small and written by us (the ideas come from
`usememos/memos`, MIT; `cel-go` is not used), and it has **two**
implementations: SQL for the open storage and a predicate over the tree for
the encrypted storage. The two are bound by one file of golden vectors, so
they cannot drift apart.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P8-1 | The specification of the language and the golden vectors that bind the two implementations: 45 vectors of queries and 23 vectors of properties, the canonical JSON AST of every query | done | `docs/QUERY_LANGUAGE.md`, `shared/query-vectors.json` |
| P8-2 | The core of the language on TypeScript and on Go: the parser, the IR, the compiler to SQL and the compiler to a predicate, the extraction of the properties | done | `frontend/src/core/query/{grammar,ir,schema,predicate,highlight}.ts`, `frontend/src/core/metadata/extract.ts`, `backend/internal/query/{grammar,ir,schema,render,predicate}.go`, `backend/internal/metadata/extract.go` |
| P8-3 | The parity of the two implementations: the same questions on the same vault give the same answers. **The test found a real defect** — the moments of time are stored in milliseconds, and the compiler compared them in seconds | done | `backend/internal/query/parity_test.go` (28 questions), the fix in `backend/internal/query/render.go` |
| P8-4 | The storage of the properties: the schema of SQLite is at version 2 (the table `note_props` and its index), the migration is idempotent, the properties are a cache of the text of the note and a failure marks the answer as `partial` | done | `backend/internal/sqlitastore/{store_schema.go,store_props.go}`, `schema_compat_test.go`, `backend/internal/notes/query.go` |
| P8-5 | The HTTP API of the selection: `POST /api/query` and `GET /api/tags`, the golden contract and the tests of the endpoints | done | `backend/internal/api/handlers_query.go`, `backend/internal/api/contract_test.go`, `backend/internal/api/handlers_query_test.go`, `docs/CONTRACT.md`, `docs/API.md` |
| P8-6 | The interface of the selection: the query bar with the counter of the matches, the saved views and the tree of tags, the actions of the store, the service that answers in both modes of the storage | done | `frontend/src/core/query/service.ts`, `frontend/src/core/store/actions.ts`, `frontend/src/components/{QueryBar,SavedViews,TagTree}.tsx`, `frontend/src/components/Sidebar.tsx` |
| P8-7 | The plugin API 1.2.0: the capability `ctx.api.query()` and `ctx.api.tags()` behind the new right `query.read`, the four built-in plugins (the graph of the links, the tree of the tags, the calendar of the activity, the cards of the links) and the rules R13–R16 of the boundary checker. The change is additive — the plugins with `minApiVersion: "1.0.0"` keep working | done | `frontend/src/plugins/contract.ts`, `frontend/src/core/api/pluginQuery.ts`, `frontend/src/plugins/builtin/{graph,tags,activity,links}/index.ts`, `frontend/scripts/check-boundaries.mjs`, `docs/PLUGIN_API.md`, `docs/PLUGIN_DEVELOPMENT.md`, `docs/PLUGIN_SECURITY.md` |
| P8-8 | The documentation and the continuous integration: the agreements of the repository, the vocabulary, the cards of the design, the journal of the API, the licences of the third parties, the workflows of the backend, the frontend, the end-to-end suite and the smoke test of the restore | done | `AGENTS.md`, `CONTEXT.md`, `docs/design/`, `docs/API-CHANGELOG.md`, `docs/THIRD_PARTY.md`, `.github/workflows/*.yml`, `scripts/restore-smoke.ps1` |

### The measured effect of the phase 8

| What | Phase 7 | Phase 8 |
|---|---|---|
| Entry chunk of the bundle | 41,88 kB gzip | 43,41 kB gzip (the panels of the plugins moved to their own chunk) |
| Frontend unit tests | 473 passed (43 files) | **589 passed (48 files)** |
| Backend tests | 1 suite of the port | **+ the parity of the two implementations, 8 tests of the endpoints, 2 cases of the port** |
| End-to-end tests | 106 passed, 32 skipped | **106 passed, 32 skipped, 0 failed** |
| Schema of SQLite | `user_version = 1` | `user_version = 2` (the migration is idempotent) |
| Files of the frontend | 144 | 166 (the boundaries hold: R1–R16) |

### What was left out of the phase 8

The following ideas of the reference project were **not** taken in this phase
and are written down as the next tasks in `PHASE8_PLAN.md`: the highlighting
of the matches in the editor, the completion of the tags, the focus mode, the
undo of a deletion, the card of the note and the synchronisation of the filter
with the URL. The regular expressions are deliberately not supported: the
operator `matches` answers «unknown operator».

## Phase 9 status (the interface without documentation)

The complaint of the user was precise: *the interface has to be understandable
without the documentation*. Three defects were behind it, and all three were
real, not cosmetic:

1. the panels of the query language (the query, the saved views, the tags)
   **computed the hits and showed nothing** — the block did not filter the
   tree, so the user saw a query that did nothing;
2. the icons of the sidebar were duplicated (the trash was in the list and in
   the footer, the recent notes were a text row), and the manager of the
   plugins was in Russian while the shell was in English;
3. the tags of a note had no visible owner: they were a derived property of
   the text, and the text was the only place where they could be seen.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P9-1 | The plugins of the query language failed to load: the right `query.read` was used by the built-in plugins but was missing in the list of the rights, so the host refused every one of them with «unknown permission». The contract did not change (it stays 1.2.0) — the list of the rights was wrong | done | `frontend/src/plugins/manifest.ts` |
| P9-2 | The block of the selection is one block now (**Filter**): the field of the condition, the number of the hits, the chips of the tags and the saved filters as chips. The block says in plain words what it does («Shows only the notes that match the condition.») and the tags are flat chips with a counter instead of a tree nobody understood | done | `frontend/src/components/FilterPanel.tsx` (replaces `QueryBar.tsx`, `SavedViews.tsx`, `TagTree.tsx`) |
| P9-3 | The filter **really filters the tree**: the hits of the query become the paths of the visible notes (`filterTree` in `frontend/src/lib/tree.ts`), the tree carries the badge «filtered» and the button of the reset brings the whole tree back. The notes stay in the storage and remain reachable through the tabs | done | `frontend/src/components/Sidebar.tsx`, `frontend/src/App.tsx` |
| P9-4 | The duplicates of the icons are gone: the trash stays in the list of the notes (it was there twice), the footer of the sidebar holds only the import and the export, the recent notes became the icon of the clock in the actions of the explorer, and the manager of the plugins and the built-in plugins were translated into English | done | `frontend/src/components/Sidebar.tsx`, `frontend/src/components/PluginManagerPanel.tsx`, `frontend/src/plugins/builtin/**`, `frontend/src/ui/icons.tsx` (the new icons `link`, `tags`, `clock`, `hash`) |
| P9-5 | The tags of the open note have a visible owner: the strip of the tags sits above the editor and is always there (it carries the button that adds the first tag). The tag is written into the text and cut out of the text — one source of truth, so it also works in the encrypted storage, where there is nowhere else to keep it | done | `frontend/src/components/NoteTags.tsx`, `frontend/src/App.tsx` |
| P9-6 | The conflict of the saving is a dialog with three ways out (take the version of the server, keep mine, copy mine) instead of a line of error that says the saving is impossible. The race of two simultaneous savings of the same note is closed: the saves are serialized per note | done | `frontend/src/components/NoteConflictDialog.tsx`, `frontend/src/core/store/{types,state,actions}.ts`, `frontend/src/lib/autosave.ts` |
| P9-7 | The buttons are tested by their **effect**, not by their presence: the new E2E file walks the buttons of the header, the panels of the actions, the clock, the trash, the footer, the toggles of the status bar, the filter of the tree, the chips of the tags and the tags of the note | done | `e2e/specs/shell-actions.spec.ts` (10 checks) |
| P9-8 | The documentation of the change: the language in the interface (§9 of `docs/QUERY_LANGUAGE.md`), the block of the selection (§6.3 of `docs/DESIGN_SYSTEM.md`) and the plan of the phase | done | `docs/QUERY_LANGUAGE.md`, `docs/DESIGN_SYSTEM.md`, `PHASE9_PLAN.md` |

### The measured effect of the phase 9

| What | Phase 8 | Phase 9 |
|---|---|---|
| Entry chunk of the bundle | 43,41 kB gzip | **45,39 kB gzip** (the budget is 46 kB) |
| Frontend unit tests | 589 passed (48 files) | **604 passed (50 files)** |
| End-to-end tests | 106 passed, 32 skipped | **116 passed, 32 skipped, 0 failed** (the 10 new checks of the buttons) |
| Files of the frontend | 166 | 169 (the boundaries hold: R1–R16) |
| The query language | the panels showed nothing | the filter narrows the tree |

### What was left out of the phase 9

The translation of the whole interface into Russian (F9.1) is **not** done: the
shell of the application stays in English, so the manager of the plugins and the
built-in plugins were translated into English as well. The items of the phase 8
that were not taken (the highlighting of the matches in the editor, the
completion of the tags, the focus mode, the undo of a deletion, the card of the
note, the synchronisation of the filter with the URL) are still open in
`PHASE8_PLAN.md`.

## Phase 10 status (the shell of the application)

The complaint of the user was about the shell itself: *the sidebars and the lines
do not meet, everything overlaps*, and the panes of the application were asked to
move to a narrow rail on the left. Behind the complaint were three real defects
and four bugs that the screenshots showed:

1. the columns did not start at the same height (the header of the vault was
   40 px, the strip of the tabs 32 px, the header of the outline 36 px) and the
   headers had three different backgrounds, so the vertical borders began and
   ended at different heights;
2. the left column could be collapsed, which left the application without a
   navigation when it was hidden;
3. the row of the tree carried five buttons **and** a menu with the same five
   actions, and the menu covered the buttons;
4. the dialog of the creation was prefilled with a real name (`New folder`,
   `note.md`), so a folder that nobody renamed was called «New folder» forever;
5. the native widget of the file input did not fit the field of the dialog of
   the import;
6. the strip of the tags of the note had no background and no border, so it
   floated over the editor.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P10-1 | **The rail of the sections.** A narrow strip (44 px) on the left holds the icons of the sections `E` explorer, `S` search, `F` filters, `H` history, `T` trash, and the theme with the settings at the bottom. The rail is an accordion: the pressed icon decides what the column next to it shows, and exactly one section is open at a time. The list of the sections lives in the core (`RAIL_SECTIONS`), so the rail, the palette and the keyboard never disagree | done | `frontend/src/components/Rail.tsx`, `frontend/src/core/commands/appCommands.ts` |
| P10-2 | **The column of the sections.** The left column is the container of the sections: the explorer (the vault and the tree), the search (the field, the results and the saved filters), the filters (the whole constructor), the history (the recent notes) and the trash. The four sections that are not the explorer are loaded on demand, so they stay out of the entry chunk. The choice of the section is remembered | done | `frontend/src/components/Sidebar.tsx`, `frontend/src/components/sections/**`, `frontend/src/components/LazySections.tsx`, `frontend/src/core/store/{types,state,actions}.ts`, `frontend/src/core/settings/prefs.ts` |
| P10-3 | **The left column stays where it is.** There is no collapse any more: the button «Toggle notes panel», the switch «Collapse the sidebar», the command `toggleSidebar` (`Ctrl+Alt+B`) and the field `sidebarCollapsed` are gone. The column is resized by the pointer (200…480 px). The right column keeps its toggle | done | `frontend/src/components/AppFooter.tsx`, `frontend/src/components/SettingsDialog.tsx`, `frontend/src/core/commands/{appCommands,shortcuts}.ts`, `frontend/src/core/settings/prefs.ts` |
| P10-4 | **One line of the frame.** Every header is `--header-height` (40 px), has the background `--bg-sidebar` and one bottom border; the vertical borders of the rail, of the column, of the workspace and of the outline are continuous, and the bottom line of the application is one line. Measured: the four headers stand at `y=0` with a height of 40 px | done | `frontend/src/styles/{tokens,layout,rail}.css`, `frontend/src/styles/components.css` |
| P10-5 | **The name of a new object is written by the user.** The dialog of the creation opens with an empty field and a placeholder («Folder name», «Note name»); an empty name keeps the dialog open and says why. The renaming still shows the real name | done | `frontend/src/components/NoteDialogs.tsx`, `frontend/src/core/store/actions.ts`, `frontend/src/App.tsx` |
| P10-6 | **The choice of a file looks like the rest of the interface.** The native input is hidden behind the elements of the application («Choose files», «Choose archive») and shows the names of the chosen files; the general rule of the fields no longer applies to `input[type='file']` | done | `frontend/src/components/TransferPanel.tsx`, `frontend/src/styles/components.css` |
| P10-7 | **The strip of the tags is a row of its own.** It keeps its place under the crumbs, has a background, a border and a height, and does not float over the editor | done | `frontend/src/styles/components.css` |
| P10-8 | **One button in a row of the tree.** The five inline buttons are gone; the row carries only the menu («three dots»), and the menu holds Rename, Move, New note, New folder, Duplicate and Delete | done | `frontend/src/components/TreeRow.tsx`, `frontend/src/components/TreeContextMenu.tsx` |
| P10-9 | **The tests of the new shell.** The unit tests of the rail, of the dialog of the creation and of the window of the import; the E2E of the rail (five checks) and the rewritten specs that no longer collapse the column | done | `frontend/src/__tests__/{rail,createDialog,transferPanel}.test.tsx`, `e2e/specs/rail.spec.ts`, `e2e/specs/{a11y,shell,shell-actions,responsive}.spec.ts` |

### The measured effect of the phase 10

| What | Phase 9 | Phase 10 |
|---|---|---|
| Entry chunk of the bundle | 45,39 kB gzip | **43,68 kB gzip** (the budget is 46 kB; the sections left the entry chunk) |
| Frontend unit tests | 604 passed (50 files) | **626 passed (53 files)** |
| End-to-end tests | 116 passed, 42 skipped | **128 passed, 42 skipped, 0 failed** |
| The height of the headers | 40 / 32 / 36 px | **40 px у всех** |
| The background of the headers | три тона | **один тон** (`--bg-sidebar`) |
| The left column | сворачивалась | **всегда видна**, 200…480 px |
| The buttons of a row of the tree | 6 | **1** (меню) |

### What was left out of the phase 10

The history of the versions of the notes is **not** done: the API has no endpoint
for it (`docs/CONTRACT.md` knows only the `revision` of `PUT /api/notes`), so the
section `H` shows the recent notes and says plainly that there is no version yet.
The right column (the outline) was not redesigned. The keyboard shortcut of the
trash is `Ctrl+Alt+D` and not `Ctrl+Alt+T`: the theme has held `Ctrl+Alt+T` since
the first release and the contract of the shortcuts is not broken for the sake of
a letter.

## Phase 11 status (the seven points of the user)

The complaint of the user came with seven points and two screenshots of other
applications (Obsidian and Mem). Every point was checked against the code
before anything was changed, and the check changed the plan twice:

1. the «каракули» were **not** a defect of the editor: the cropped screenshot is
   40×266 px, and enlarged eight times without smoothing it shows the rail with
   the letters `E`, `S`, `F`, `H`, `T` under the icons. The point 1 of the
   complaint and the point 3 are the same defect;
2. the folders inside the folders already worked on the server
   (`POST /api/folders` with `parentPath` creates `journal/sub`, checked with a
   real request), and the menu of a row already had the entry «New folder» — but
   the native right click of a row was not intercepted, so the menu of the
   browser appeared and the way in was invisible;
3. the command palette had **no CSS rules at all**: they were in the stylesheet
   of the phase 4 and were lost when the stylesheets were reorganised. Without
   them the palette was a flat list over the whole page, with the title and the
   description of a command glued into one line;
4. the counter «1 note matches» was rendered in the section `Search`, where no
   filter lives, and the button «×» cut the text of the chip;
5. the order and the icons of the sections were taken from nowhere: the letters
   stood for the shortcuts and the icons of the old sections.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P11-1 | **The rail has no letters.** The letters under the icons are gone: the name of a section lives in the accessible name of its button and in its tooltip, as in the ribbon of Obsidian. The item is a compact square of 28×28 px with an icon of 17 px | done | `frontend/src/components/Rail.tsx`, `frontend/src/styles/rail.css` |
| P11-2 | **The sections are grouped and their icons are semantic.** The order is the order of the work: the notes (`Explorer` → `Calendar` → `Search` → `Filters`), then the life of the storage (`History` → `Notifications` → `Trash`); a thin line separates the groups. The icons are `folder`, `calendar`, `search`, `filter`, `clock`, `bell`, `trash`. The list of the sections is still the single source of the order, the palette and the keyboard | done | `frontend/src/core/commands/appCommands.ts`, `frontend/src/core/store/types.ts`, `frontend/src/ui/icons.tsx` |
| P11-3 | **The command palette is a modal window.** The rules of the palette, lost in the reorganisation of the stylesheets, are back in `frontend/src/styles/palette.css`: a dimmed screen, a card of `min(620px, 100%)` in the upper third, a list that scrolls inside the card. The title and the description of a command stand on two lines, the shortcut on the right | done | `frontend/src/styles/palette.css`, `frontend/src/components/CommandPalette.tsx` |
| P11-4 | **The counter of the filter lives where the filter lives.** The section `Search` shows the search and points at the section `Filters` («Open the filters»); the number of the matching notes and the button that clears the filter are in `Filters`, in one row that cannot cut the text | done | `frontend/src/components/sections/SearchSection.tsx`, `frontend/src/components/FilterPanel.tsx` |
| P11-5 | **A folder inside a folder is one right click away.** The native right click of a row of the tree opens the menu of that row (the menu of the browser never appears), and the menu names the node it acts on. The entry «New folder» of a folder creates the folder inside it | done | `frontend/src/components/TreeRow.tsx`, `frontend/src/components/TreeContextMenu.tsx` |
| P11-6 | **The calendar of the vault.** A new section of the rail: a month of six rows of seven days, starting on Monday, the days of the neighbouring months dimmed, the days that carry notes marked with a dot; the notes of the picked day are listed under the grid, and the button «Open the note of the day» creates `YYYY-MM-DD.md`. The data comes from the tree (`createdAt` and `updatedAt`), so the API, the contract and the schema of SQLite do not change | done | `frontend/src/core/calendar/**`, `frontend/src/components/sections/CalendarSection.tsx`, `frontend/src/styles/calendar.css` |
| P11-7 | **The model of the notifications.** A typed record (kind, title, body, time, read, path) in the store, a section of the rail that shows the list, and a badge on the icon of the rail with the number of the entries that were not read. The sources are real: a save that failed and a version that conflicts with the one of the server. The list is capped at 50 entries | done | `frontend/src/core/notifications/**`, `frontend/src/components/sections/NotificationsSection.tsx`, `frontend/src/styles/notifications.css` |
| P11-8 | **The tests of the phase.** The unit tests of the rail (the letters are gone, the separator, the badge), of the palette, of the counter of the filter, of the right click of the tree, of the core of the calendar and of the model of the notifications; the E2E of the rail (seven sections), of the palette as a modal window, of the calendar, of the notifications and of the folder inside the folder | done | `frontend/src/__tests__/**`, `e2e/specs/{rail,shell-actions,tree-interaction,calendar,notifications}.spec.ts` |
| P11-9 | **The documentation.** The design system knows the new layers of the styles, the new icons, the rules of the rail without letters and the rules of the palette, the calendar and the notifications | done | `docs/DESIGN_SYSTEM.md`, `PHASE11_PLAN.md` |

### The measured effect of the phase 11

| What | Phase 10 | Phase 11 |
|---|---|---|
| Entry chunk of the bundle | 43,68 kB gzip | **45,04 kB gzip** (the budget is 46 kB; the calendar and the notifications are loaded on demand) |
| Frontend unit tests | 626 passed (53 files) | **688 passed (57 files)** |
| End-to-end tests | 128 passed, 42 skipped | **140 passed, 44 skipped, 0 failed** |
| The letters under the icons | 5 | **0** |
| The sections of the rail | 5 | **7** (the calendar and the notifications) |
| The rules of the palette | 0 | **12** (the palette was a flat list) |

### What was left out of the phase 11

The notifications live in the memory of the session: a reload empties the list.
The saving of the list in `localStorage` is not done, because the list describes
what happened during the session and the stale entries would only confuse. The
history of the versions of the notes is still not done (the API has no endpoint
for it). The calendar shows the days of the notes of the tree; it does not write
a daily note by itself — the button «Open the note of the day» opens the note of
the picked day, as the command «Daily note» does for today.

---

## Phase 12 status (the comfort of the interface)

The user came back with eight points and four screenshots. Four of them are about
the comfort of the interface, three are about functions that were promised or
never existed, and one is about an icon that says the wrong thing.

Two of the points were not what they looked like at first:

1. the drag & drop **was** implemented (the tree rows are `draggable`, a folder
   accepts a drop, the refusal of a folder that would land in itself is a
   banner, and an end-to-end test moves a note from one folder to another) —
   what was missing was that **the user could not see it**: there was no hint
   and the answer of the target was too quiet;
2. the window of the menu of a row became too wide in the phase 11: the header
   with the name of the node (up to 180 px) stretched a panel that holds a
   column of 30 px icons. The name of the node was useful for the screen
   reader, but it must not be painted on the panel.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P12-1 | **The calendar reads itself.** The selected day is a heading on its own line, the button that opens the note of the day is a line under it and never breaks; the buttons of the month got a frame and a state of their own | done | `frontend/src/components/sections/CalendarSection.tsx`, `frontend/src/styles/calendar.css` |
| P12-2 | **Two signs in the calendar.** The dot under the number is *today*; a day that carries records gets a tinted background and its number in the accent colour | done | `frontend/src/components/sections/CalendarSection.tsx`, `frontend/src/styles/calendar.css` |
| P12-3 | **The strip of the tags is a designed group.** It names itself, the tags are pills, the button that adds a tag is a pill, and the field is a field (18 ch, a placeholder, the accent ring of the focus). The height of the row never changes | done | `frontend/src/components/NoteTags.tsx`, `frontend/src/styles/tags.css` |
| P12-4 | **The open notes are pills.** A gap of 4 px, rounded corners, the active tab raised, the name cut with an ellipsis. The component has no inline style any more | done | `frontend/src/components/EditorTabs.tsx`, `frontend/src/styles/tabs.css` |
| P12-5 | **The menu of a row is narrow again.** The name of the node is gone from the panel; the accessible name "Actions of &lt;name&gt;" stays (it is invisible) | done | `frontend/src/components/TreeContextMenu.tsx`, `frontend/src/styles/components.css` |
| P12-6 | **The drag & drop is visible.** A hint in the explorer, a strong answer of the target folder, the cursor that tells the truth, and the end-to-end check of a folder that lands in another folder | done | `frontend/src/components/TreeRow.tsx`, `frontend/src/components/sections/ExplorerSection.tsx`, `e2e/specs/tree-interaction.spec.ts` |
| P12-7 | **The favorites.** A section of the rail with the icon `star`, the entry "Add to favorites" in the menu of a row, a star in the tree, and a list that survives a reload. The button of the plugins took the icon `puzzle`: the bookmark icon now means the bookmark | done | `frontend/src/core/favorites/types.ts`, `frontend/src/components/sections/FavoritesSection.tsx`, `frontend/src/core/store/*` |
| P12-8 | **The reminders of the calendar.** A model of a moment (day, time, text), a form in the panel of the selected day, and a timer that writes a notification and shows a system notification of the browser when the moment comes. The permission of the browser is asked only by a gesture of the user | done | `frontend/src/core/reminders/**`, `frontend/src/components/sections/CalendarSection.tsx`, `frontend/src/App.tsx` |

### The measured effect of the phase 12

| What | Phase 11 | Phase 12 |
|---|---|---|
| Entry chunk of the bundle | 45,04 kB gzip | **43,51 kB gzip** (the budget is 46 kB) |
| Frontend unit tests | 688 passed (57 files) | **752 passed (60 files)** |
| End-to-end tests | 140 passed, 44 skipped | **146 passed, 46 skipped, 0 failed** |
| The sections of the rail | 7 | **8** (the favorites) |
| The panel of the menu of a row | ~180 px, with the name of the node | **36 px**, one column of icons |
| The marks of a day of the calendar | one (a dot) | **two** (the dot of today, the tint of a day with records) |

### The budget of the entry chunk (wave 5 of the phase 12)

The first build of the phase grew the entry chunk to **47,35 kB gzip** — 1,35 kB
over the budget of 46 kB. The size was measured per module (the sourcemap of
the build attributes every byte of the chunk to its source), and the growth was
in the new modules of the core and in the eagerly loaded components.

The fix was not to cut the features, but to take out of the entry the code that
is not needed at the start:

* **The engine of the query language left the entry chunk.** The store loads
  `core/query/service` on demand (inside the actions that were asynchronous
  anyway), and the API of the plugins loads `core/api/pluginQuery` at the first
  question of a plugin. The parser of the query language, the predicates and
  the scanner of the derived properties (~11,5 kB raw) are now in a chunk that
  is fetched only when somebody asks a question.
* **The watcher of the reminders became a module of its own**
  (`core/reminders/watcher.ts`), which the shell loads on demand: the shell has
  no use for it before the first tick.

The result is **43,51 kB gzip** — under the budget, and under the size of the
phase 11. The rows of the tree also stopped listening to the whole state of the
store: a row listens to its own star (`useAppSelector`), so the tree is not
redrawn on every keystroke of the editor.

### What was left out of the phase 12

The notifications of the phase 11 and the reminders of the phase 12 live in the
memory and in `localStorage` of the browser: they are the data of the user, not
a part of the vault on the disk. A reminder that comes while the tab is closed
is shown when the tab is opened again (the moment has passed, the reminder is
due) — the application does not send anything to the server, because the server
knows nothing about the reminders of the user.

---

## Phase 13 status (the calendar, the tabs, the window)

The user came back with four points and two screenshots. Two of them were about
a function that looked broken but was not: the calendar marked the days of the
*life* of a note and not the days of its *name*, and the closing of the last tab
left the note on the screen (only its name was gone, and it looked like a tab
that stayed). The third point was about a colour that was not in the right
place, and the fourth one asked for one window instead of two sections.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P13-1 | **A daily note belongs to its day.** A note whose name reads as a day (`2026-10-29.md`) belongs to that day and to that day only; the days of its creation and of its change do not add it to the calendar. Every other note keeps the old rule | done | `frontend/src/core/calendar/notes.ts`, `frontend/src/__tests__/calendar-notes.test.ts` |
| P13-2 | **The two signs of the calendar differ.** The dot of today is painted in the colour of the text (white in the dark theme), the tint of a day with records stays violet | done | `frontend/src/styles/calendar.css` |
| P13-3 | **The last tab closes the note.** Closing the last tab empties the editor and clears the breadcrumbs: the name of the note does not hang in the strip any more | done | `frontend/src/core/store/actions.ts` (`closeNote`), `frontend/src/App.tsx` |
| P13-4 | **The dot of the connection moved down.** It stands in the status bar, next to the state of the save, and it is still a button: a click checks the backend again | done | `frontend/src/components/AppFooter.tsx`, `frontend/src/components/ConnectionIndicator.tsx` |
| P13-5 | **One window for the search and the filters.** The magnifier and the funnel open the same window in their own module; the column of the explorer keeps the tree. The two sections of the column are gone | done | `frontend/src/components/FindPanel.tsx`, `frontend/src/styles/find.css` |

### The measured effect of the phase 13

| What | Phase 12 | Phase 13 |
|---|---|---|
| Entry chunk of the bundle | 43,51 kB gzip | **43,58 kB gzip** (the budget is 46 kB) |
| Frontend unit tests | 752 passed (60 files) | **773 passed (63 files)** |
| End-to-end tests | 146 passed, 46 skipped | **152 passed, 46 skipped, 0 failed** |
| The sections of the column | 8 (the explorer, the favorites, the calendar, the search, the filters, the history, the notifications, the trash) | **6** (the search and the filters moved into the window) |
| The signs of a day of the calendar | two, but both violet | **two, and they differ in colour** |

### What was left out of the phase 13

The window of the search and the filters is a modal window: the tree behind it
is dimmed and cannot be clicked while it is open. The filter still filters the
tree — the list of the matching notes inside the window shows what matched, and
the tree is whole again when the window is closed.

---

## Phase 14 status (the icons, the signs and the switch)

The user came back with six points, two screenshots and a list of eleven large
features. The six points are done and are described here; the list of the
features is scoped in `PHASE14_PLAN.md` §7 and is **not** implemented yet.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P14-1 | **The restore of the trash is an icon.** The button of a row shows the glyph `rotate-ccw` and names the note it restores (`Restore <имя файла>`), so the rows do not sound alike | done | `frontend/src/components/TrashList.tsx`, `frontend/src/ui/icons.tsx`, `frontend/src/__tests__/trash-list.test.tsx` |
| P14-2 | **The active filter shows itself.** The permanent status bar carries a neutral chip "Filter: <query>" with the number of the matches and a cross that drops the filter and brings the whole tree back. The cross is named "Clear the active filter", so it never collides with the button of the same purpose inside the window of the filters | done | `frontend/src/components/AppFooter.tsx`, `frontend/src/styles/layout.css`, `frontend/src/__tests__/footer.test.tsx` |
| P14-3 | **Every folder can be opened and closed at once.** The store knows both actions, the group of the explorer offers two buttons, the palette knows two commands. The list of the open folders survives a reload and is limited to 5000 entries | done | `frontend/src/core/store/actions.ts`, `frontend/src/components/sections/ExplorerSection.tsx`, `frontend/src/core/commands/appCommands.ts`, `frontend/src/__tests__/tree-expand-all.test.tsx` |
| P14-4 | **A quick menu switches the storage.** The path of the storage in the header (and the palette command `app:switch-vault`) opens a menu with the storage that is open, the recent storages and the picker of the folders. The list of the recent storages lives with the preferences of the user | done | `frontend/src/components/VaultSwitchMenu.tsx`, `frontend/src/core/settings/prefs.ts`, `frontend/src/__tests__/vault-switch.test.tsx` |
| P14-5 | **The lock lives in the header, and the settings follow the mode.** The header of the storage carries a padlock: an encrypted storage is locked, an open one is offered the wizard of the encryption. The settings of an open storage show no action of a key at all, and the open storage does not even ask the backend about the format | done | `frontend/src/components/sections/ExplorerSection.tsx`, `frontend/src/components/VaultSecuritySection.tsx`, `frontend/src/__tests__/vault-ux.test.tsx` |
| P14-6 | **The tags of the panel are chips.** The panel had no styles at all, so the browser drew the tags as grey blocks. They are chips in a row now: a thin border instead of a fill, radius 4 px, semantic tokens only | done | `frontend/src/styles/plugin.css`, `frontend/src/__tests__/plugin-tags.test.tsx` |

Two defects of the session of the vault were fixed on the way: locking an open
storage no longer turns it into an encrypted one, and switching the storage
drops the key material of the previous one and reads the mode of the new one,
so an encrypted storage shows the screen of the password instead of the notes
of the storage that was open before
(`frontend/src/core/vault/session.ts`, `frontend/src/core/store/actions.ts`).

Two more defects were found by the visual check of the header: the menu of the
quick switch was wider than the column of the explorer, so its left part was cut
off, and a refused switch of the storage left an unhandled rejection behind
(the reason is in a banner, and the dialog of the picker stays open)
(`frontend/src/styles/components.css`, `frontend/src/App.tsx`,
`frontend/src/__tests__/app.test.tsx`).

A third defect was found by the end-to-end suite of a narrow screen: the status
bar is 24 px high, but it holds buttons of 28 px, and its labels break into two
lines when the screen is narrow. The bar overflowed the window by five or six
pixels, the browser scrolled the shell (an `overflow: hidden` container) to reveal
the focused element, and the headers of the columns moved apart — the test of the
rail failed at random. The bar now grows to fit its content, its labels never
break, and a narrow screen gives up the format of the file and the position of the
cursor
(`frontend/src/styles/layout.css`, `frontend/src/components/AppFooter.tsx`,
`frontend/src/__tests__/footer.test.tsx`).

A fourth defect was a regression of the phase itself: the rule `position:
relative` of the header of the explorer (added for the menu of the storage) overrode
the sticky header of the column, so the header scrolled away with the tree and
left its line on a narrow screen. A sticky element is a positioned one, so the
menu keeps its place without the rule, and the header sticks again
(`frontend/src/styles/components.css`).

### The measured effect of the phase 14

| What | Phase 13 | Phase 14 |
|---|---|---|
| Entry chunk of the bundle | 43,58 kB gzip | **44,98 kB gzip** (the budget is 46 kB) |
| Frontend unit tests | 773 passed (63 files) | **804 passed (67 files)** |
| End-to-end tests | 152 passed, 46 skipped | **152 passed, 46 skipped, 0 failed** |
| Icons of the registry | 41 | **45** (`rotate-ccw`, `chevrons-down-up`, `chevrons-up-down`, `lock`, `lock-open`) |
| The sections of the column | 6 | **6** (unchanged) |

### What was left out of the phase 14

* **The eleven large features are not implemented.** Their boundaries, the place
  of the work (a plugin, the core of the frontend or the backend) and the size
  are in `PHASE14_PLAN.md` §7. The server side of the automation (the webhooks
  with an outbox and the MCP over HTTP) is not started; gRPC is deferred by the
  decision of the user.
* **The panels of the plugins have no styles of their own** except the ones of
  the word count, the backlinks and now the tags. The panels of Activity, Link
  Cards and Graph are still drawn by the browser.
* **The webhooks and the MCP inherit the absence of an authentication of the
  API.** The server listens on the loopback by default and refuses to start on
  another address without `NOTO_ALLOW_PUBLIC=true`; the documentation of the
  contract has to say that before the surface grows.

---

## Closed phases

The closed phases are kept here as an archive: the cards of the phase are the
evidence of what was done, and the plan of the phase that follows lives in its
own file (`PHASE8_PLAN.md` for the phase 8).

### Phase 7 (the redesign of the shell and the encrypted storage) — closed, commit `60d7ba8`

Two changes: the interface was rebuilt around the rule *the action lives with
the object it acts on, the state lives where the state belongs*, and the
storage of the notes was encrypted in the browser. The state of every card was
read from the code, not from the plan.

| Card | What was done | Status | Evidence |
|------|---------------|--------|----------|
| P7-1 | The redesign of the shell: the header of the column is gone (the brand moved to the header of the storage, the name of the open note to the tabs of the editor), the global actions moved to the header of the EXPLORER section (the search, Graph, Archive, the command palette, the plugins), the counters of the section are gone while the counters of the folders stay, the block of the plugins at the bottom of the column is rendered only when it holds something, the panels of the plugins moved to the right column, the entries of the context menu of the plugins returned to the menu of the tree, and the red banner "Noto is offline" was replaced by the indicator of the connection (green / amber / red) | done | `frontend/src/components/{Sidebar,AppFooter,ConnectionIndicator,TreeContextMenu}.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/{layout,components,plugin,vault}.css`, `docs/UI_AUDIT.md` |
| P7-2 | The crypto core: Argon2id as the KDF, AES-256-GCM as the cipher, the hierarchy of the keys (KEK → DEK), the epochs and the key wrapping, the recovery key, the container `NOTOSEAL` with the header as the AAD | done | `frontend/src/core/crypto/{kdf,keys,sealed,format,errors}.ts`, unit tests in `frontend/src/core/crypto/__tests__/` (4 files) |
| P7-3 | The sealed vault on the client (the manifest and its generations, the objects, the in-memory index, the conflicts) and the blind object store of the server with its endpoints; the server refuses the open endpoints with `409 vault_sealed` | done | `frontend/src/core/vault/{sealedVault,sealedIndex,conflicts,sealedClient}.ts`, `backend/internal/sealed/`, `backend/internal/api/{api.go,handlers_sealed.go,handlers_sealed_purge.go}`, unit tests in `frontend/src/core/vault/__tests__/` (4 files) and `backend/internal/sealed/` (2 files) |
| P7-4 | The screens of the encrypted storage: the wizard, the unlocking, the lock, the settings of the security; the unlocking screen shows nothing but the name of the storage and the password field | done | `frontend/src/components/{VaultSetupDialog,VaultUnlockScreen,VaultSecuritySection}.tsx`, `frontend/src/core/vault/{session,autoLock}.ts`, `frontend/src/styles/vault.css` |
| P7-5 | The migration with its journal and the verification: the notes are sealed first, the copy is verified object by object, the server is switched only after the verification, and the plaintext is removed only after an explicit confirmation. The journal lives inside the sealed manifest, so an interrupted migration continues instead of starting over | done | `frontend/src/core/vault/migration.ts`, `frontend/src/components/VaultMigrationDialog.tsx` |
| P7-6 | The single path of the store: the store always talks to a `VaultService` — the adapter over the API of the notes in the open mode, the adapter over the sealed vault in the sealed mode. The two are never used at the same time | done | `frontend/src/core/vault/vaultService.ts`, `frontend/src/core/store/**` |
| P7-7 | The plugin API 1.1.0 with the optional capability `ctx.vault` (`mode`, `encrypted`, `locked`, `formatVersion`); the change is additive, the plugins with `minApiVersion: "1.0.0"` keep working, and a plugin never sees the key material | done | `frontend/src/plugins/contract.ts`, `frontend/src/core/api/pluginApi.ts`, `docs/PLUGIN_API.md` |
| P7-8 | The rules R9–R12 of the boundary checker: the core does not import the interface, the crypto core does not import the vault, a plugin never imports the crypto core, and only the core uses the key material | done | `frontend/scripts/check-boundaries.mjs`, `npm run check:boundaries` |
| P7-9 | The end-to-end test that scans the real files of the disk for the plaintext: a real vault in a temporary directory, two notes with unique markers, the migration through the user interface, and then a byte-by-byte scan of every file of the vault. The scenario passes: the vault holds nothing but ciphertext, the plaintext notes and the database of the open pipeline are gone, the storage is locked after a reload, and the right password opens the notes again | done | `e2e/specs/encryption.spec.ts`, `e2e/helpers/vault-scan.ts` |
| P7-10 | The documentation: the modules and the rules in `docs/ARCHITECTURE.md`, the storage in `docs/VAULT.md`, the API 1.1.0 in `docs/PLUGIN_API.md` and `docs/PLUGIN_DEVELOPMENT.md`, the boundary of the key material in `docs/PLUGIN_SECURITY.md`, the defects of the redesign in `docs/UI_AUDIT.md`, the placement rules in `docs/DESIGN_SYSTEM.md`, `README.md` | done | `docs/`, `README.md` |

### The measured effect of the phase 7

| What | Phase 6 | Phase 7 |
|---|---|---|
| Entry chunk of the bundle | 37,19 kB gzip | 41,88 kB gzip (the crypto core is a lazy chunk of 4,57 kB gzip) |
| Frontend unit tests | 463 passed (41 files) | **473 passed (43 files)** |
| End-to-end tests | 101 passed, 32 skipped | **106 passed, 32 skipped, 0 failed** |
| Files of the frontend | 144 | 144 (the boundaries hold: R1–R12) |
| Plaintext of the notes on the disk | every note in the clear | only ciphertext (the scenario of P7-9 scans the real files of a real vault) |

The number of the unit tests of the frontend grew by the tests of the crypto
core, of the sealed vault, of the migration, of the connection and of the
dialogs of the encrypted storage. The end-to-end suite grew by the scenario of
the encrypted storage (5 checks) and by the three checks of the connection.

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

### Phase 8 (2026-10-24, the query language)

Commands that were actually executed for this status update, with their real
output:

| Check | Command | Result |
|-------|---------|--------|
| Backend build / vet | `go build ./...`, `go vet ./...` (`backend`) | exit 0 |
| Backend tests | `go test ./... -count=1` (`backend`) | all packages `ok` (the new packages: `internal/query`, `internal/metadata`; the new tests: the parity of the two implementations, 8 tests of the endpoints, 2 cases of the port) |
| Backend tests (race) | `CGO_ENABLED=1 go test ./... -race -count=1` (`backend`) | exit 0, all packages `ok` |
| HTTP smoke suite | `go run ./cmd/smoke` (`backend`) | `PASS 43 / FAIL 0` |
| Frontend type check | `npx tsc --noEmit` (`frontend`) | exit 0 |
| Frontend unit tests | `npm test` (`frontend`) | 48 test files, **589 tests passed**, 0 failed |
| Boundaries | `node scripts/check-boundaries.mjs` (`frontend`) | OK: 166 files, no violations (R1–R16) |
| Frontend production build | `npm run build` (`frontend`) | exit 0 |
| Bundle size | `npm run measure` (`frontend`) | entry chunk 143,19 kB (**gzip 43,41 kB**); the panels of the plugins moved into their own chunk |
| End-to-end | `npx playwright test` | **106 passed, 32 skipped, 0 failed** — on the locally cached Chromium build |
| The round trip of the backup | `.\scripts\restore-smoke.ps1` | `restore-smoke: OK (backup -> restore -> smoke, all green)` |

The parity test of the phase 8 found a real defect: the moments of time are
stored in the database in milliseconds, and the SQL compiler of the query
language compared them in seconds. The two implementations of the language
now answer the same questions the same way.

### Phase 9 (2026-10-24, the interface without documentation)

Commands that were actually executed for this status update, with their real
output:

| Check | Command | Result |
|-------|---------|--------|
| Backend build / vet | `go build ./...`, `go vet ./...` (`backend`) | exit 0 |
| Backend tests | `go test ./... -count=1` (`backend`) | all packages `ok` |
| Backend tests (race) | `CGO_ENABLED=1 go test ./... -race -count=1` (`backend`) | exit 0, all packages `ok` |
| HTTP smoke suite | `go run ./cmd/smoke` (`backend`) | `PASS 43 / FAIL 0` |
| Frontend type check | `npx tsc --noEmit` (`frontend`) | exit 0 |
| Frontend unit tests | `npm test` (`frontend`) | 50 test files, **604 tests passed**, 0 failed |
| Boundaries | `node scripts/check-boundaries.mjs` (`frontend`) | OK: 169 files, no violations (R1–R16) |
| Frontend production build | `npm run build` (`frontend`) | exit 0 |
| Bundle size | `npm run measure` (`frontend`) | entry chunk 149,69 kB (**gzip 45,42 kB**; the budget is 46 kB) |
| The whole verification | `.\scripts\verify.ps1 -Skip e2e` | every step PASS (boundaries, build, vet, test, smoke, typecheck, unit, bundle, measure) |
| End-to-end | `npx playwright test` | **116 passed, 32 skipped, 0 failed** (the 10 new checks of the buttons) |
| The round trip of the backup | `.\scripts\restore-smoke.ps1` | `restore-smoke: OK (backup -> restore -> smoke, all green)` |

The end-to-end suite found two real defects of this phase and not one false
alarm: the strip of the tags was submitting the tag **twice** (the Enter key
and the loss of the focus of the field), so the tag landed in the text twice
and the cross of the chip removed only one of them; and the spec of the
plugins still expected the Russian strings of the panels (`Слов: 2`,
`Вставить шаблон`), which the plugins do not speak any more.

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

