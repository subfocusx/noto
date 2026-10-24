# Noto

A personal Markdown notes application: a Go backend that serves a JSON API
over real `.md` files on disk, and a Preact PWA that edits, previews, searches
and syncs them.

Noto is designed for a single owner on a single machine (or behind a VPN).
It has **no user accounts and no login** — see
[Security model](#security-model-and-limitations) before exposing it to a
network.

---

## Table of contents

- [Features](#features)
- [Plugins](#plugins)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Storage layout](#storage-layout)
- [Database and migrations](#database-and-migrations)
- [Running the tests](#running-the-tests)
- [Production build](#production-build)
- [Windows deployment](#windows-deployment)
- [Installing the Android PWA](#installing-the-android-pwa)
- [HTTPS and reverse proxy](#https-and-reverse-proxy)
- [Backup and restore](#backup-and-restore)
- [Security model and limitations](#security-model-and-limitations)
- [Docker (optional)](#docker-optional)
- [API reference](#api-reference)
- [Known limitations and roadmap](#known-limitations-and-roadmap)
- [Repository layout](#repository-layout)

---

## Features

**Notes**

- Real Markdown files on disk — the filesystem is the source of truth, the
  database only mirrors metadata and the search index.
- Folder and file tree with create, rename, move, duplicate, delete and restore.
  A duplicate is created next to the original (`note copy.md`, `note copy 2.md`, …).
- Deletion is a move to a trash directory, so anything can be restored.
- Optimistic concurrency: every note carries a `revision`; a write with a
  stale revision is rejected with the current server copy instead of
  silently overwriting.
- Atomic saves — the content is written to a temporary file and renamed over
  the target.

**Editing**

- CodeMirror 6 editor with Markdown syntax support.
- Debounced autosave (800 ms) plus an explicit `Ctrl+S`, with a visible
  `idle` / `saving` / `saved` / `error` status indicator.
- Unsaved drafts are kept in IndexedDB and can be recovered after a network
  failure or a reload.
- Sanitised Markdown rendering (`marked` + DOMPurify) — raw HTML from notes is
  never injected into the page. The renderer stays in the repository as a
  library; the interface itself shows the editor only.

**Search**

- SQLite FTS5 full-text search over note names and bodies.
- Ranked hits with a snippet; falls back to a `LIKE` scan with a warning if
  FTS5 is unavailable.
- Manual reindex endpoint.

**Data**

- Import Markdown files or a whole zip archive, with `skip` / `rename` /
  `overwrite` conflict handling.
- Export a single note, a folder or the entire tree as a zip.
- Attachments (images, PDF, plain text) stored outside the notes directory
  with server-side content sniffing.
- Consistency check between the notes directory and the database
  (`noto reconcile`): it reports files that have no metadata row, metadata
  rows whose file is gone ("ghosts") and metadata that differs from the file
  system. By default it only reports; repairing the library requires the
  explicit `--apply` / `--drop-ghosts` flags.

**Encrypted storage**

- The storage of the notes can be encrypted in the browser: the master password
  is stretched with Argon2id, the data key is wrapped, and every object and
  every manifest is sealed with AES-256-GCM before the bytes reach the server.
  The server becomes a blind object store: it stores the bytes under an
  identifier and never sees a key — see
  [`docs/ENCRYPTION.md`](docs/ENCRYPTION.md).
- One path at a time: the store always talks to a `VaultService`, which is
  either an adapter over the API of the notes (plain mode) or an adapter over
  the sealed vault. In the sealed mode the server refuses the open endpoints
  with `409 vault_sealed`, so the server cannot write plaintext even by
  mistake.
- The key lives only in the memory of the tab, as a non-extractable
  `CryptoKey`. The storage locks itself on demand, after a period of
  inactivity or when the window loses the focus; the screen of the unlocking
  shows nothing but the name of the storage and the password field.
- A recovery key can be enabled: it wraps the same data key and is the only
  way back into the storage without the master password.
- An existing plain storage can be migrated: the notes are sealed and stored
  first, the copy is verified object by object, the server is switched only
  after the verification, and the plaintext is removed **only** after an
  explicit confirmation. The journal of the migration lives inside the sealed
  manifest, so an interrupted migration continues instead of starting over.
- Honest about the limits: the application cannot erase the copies that remain
  in the history of a cloud provider, in its snapshots or in its backups —
  they have to be cleaned in the settings of the provider. See
  [`docs/VAULT.md`](docs/VAULT.md).
- The plugin API 1.1.0 adds an optional `ctx.vault` state (`mode`,
  `encrypted`, `locked`, `formatVersion`). A plugin never sees the key
  material — the boundary is enforced by the import checker (rules R11 and
  R12), not by a promise — see
  [`docs/PLUGIN_SECURITY.md`](docs/PLUGIN_SECURITY.md).

**Application**

- Installable PWA (web manifest, service worker, offline app shell).
- **Storage of the notes (the "vault").** At the first start the application asks
  for the folder that holds the notes, like Obsidian does. The notes are plain
  Markdown files in that folder, the internal data of Noto lives in a hidden
  `.noto` subfolder next to them, and the folder can be changed at any time from
  the left column. See [`docs/VAULT.md`](docs/VAULT.md).
- One design system: semantic CSS tokens, a graphite dark theme ("Obsidian
  Slate": canvas `#09090b`, accent `#818cf8`) and a matching light theme, one
  icon set (Lucide), locally served Inter and JetBrains Mono, one spacing scale
  — see [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).
- The shell of the application is compact: there is no separate top bar. The
  brand and the path of the storage live in the header of the left column, the
  actions of the storage (the search, the stubs of the graph and the archive,
  the command palette, the plugins) live in the header of the EXPLORER section,
  and the state of the document (the status of the autosave, the path, the
  cursor, the counters) stays in the permanent status bar at the bottom, so a
  hidden column can always be brought back. Both columns are resized with the
  same control.
- A small dot in the header of the EXPLORER section shows the state of the
  connection with the backend (green — connected, amber — checking, red —
  unreachable, click to retry). A lost connection is a state, not an error, so
  it is not a banner.
- The tree shows the hierarchy explicitly (guide lines, a uniform step of the
  indent) and the number of the notes in every folder.
- Notes and folders can be dragged from one place of the tree to another. The
  rules live on the server: a folder cannot be dropped into itself or into one
  of its own subfolders.
- Long names in the tree are cut off with an ellipsis on one line; the full name
  is shown in a tooltip when the text is really clipped.
- The theme can follow the operating system (`System`) or be pinned to light or
  dark; the choice survives a reload.
- Responsive layout: a drawer sidebar below 820 px, a resizable sidebar above,
  no horizontal overflow from 360 px to 1920 px and 44 px touch targets on
  mobile.
- Single static Go binary in production — the frontend is embedded.
- Global command palette on **Ctrl+K** / **Ctrl+P** with eleven built-in
  commands (new note, new folder, daily note, search, rename note, delete
  note, toggle theme, open trash, settings, keyboard shortcuts, toggle
  sidebar) plus every command the plugins contribute.
- Daily note: one command creates or opens `YYYY-MM-DD.md` in the root of the
  library. The local date is used, and an existing file is never overwritten.
- Settings dialog: theme, the width of the columns, the font size
  and the wrapping of the editor, the order of the tree — every switch has a
  real effect and is remembered.
- Note tree with icons, a context menu (right click or the `…` button),
  renaming in place, a list of the recently opened notes and a configurable
  order (by name or by date of change).
- Breadcrumbs of the open note above the editor.

**Keyboard shortcuts**

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` / `Ctrl+P` | Open the command palette. |
| `Ctrl+Shift+F` | Open the note search (also reachable through the search button in the sidebar and through the "Search notes" command of the palette). |
| `Ctrl+S` | Save the open note explicitly (outside the editor). |
| `Ctrl+,` | Open the settings. |
| `Ctrl+/` | Show the list of the shortcuts. |
| `Ctrl+Alt+N` | Create a note. |
| `Ctrl+Alt+B` | Collapse or expand the sidebar. |
| `Ctrl+Alt+T` | Switch between the light and the dark theme. |

The full list lives in one place (`frontend/src/core/commands/shortcuts.ts`) and
is shown in the dialog of the shortcuts.

---

## Plugins

Noto has a plugin platform (phase 2). Plugins are **built-in code that is
compiled into the application** — there is no plugin installation from disk or
from the network, and there is no sandbox: a built-in plugin is trusted code
running in the context of the app.

Three plugins ship with the app:

| Plugin | What it does | Permissions it needs |
| --- | --- | --- |
| **Word Count** | Shows the word and character count of the open note in a panel. | `editor.read`, `ui.contribute` |
| **Insert Template** | Inserts a configurable Markdown template at the cursor position. | `editor.write`, `ui.contribute` |
| **Backlinks** | Lists the notes that link to the open note (`[[Wiki Link]]`) and the notes that only mention its name. | `editor.read`, `notes.read`, `tree.read`, `ui.contribute` |

The **Backlinks** plugin uses the public contract only (it imports nothing but
`plugins/contract.ts`). It shows the path of every matching note but cannot
open it: the contract has no "open this note" operation and it was not
extended.

A plugin can:

- read and write notes through `ctx.api` (`getNote`, `getTree`, `search`,
  `saveNote` with optimistic locking);
- read and edit the text of the open note through `ctx.editor`
  (`insert`, `insertAt`, `replaceSelection` — there is deliberately no
  `setText`, so the autosave keeps working);
- contribute UI: a panel, a sidebar entry, a context-menu entry, a toolbar
  button, a settings section and a command for the palette;
- subscribe to nine application events (`note.created`, `note.updated`,
  `note.deleted`, `note.renamed`, `note.moved`, `folder.created`,
  `folder.moved`, `editor.saved`, `workspace.opened`) — payloads never carry
  note content, only paths and metadata;
- keep its own settings, stored separately in the `noto-plugins` IndexedDB
  database under a per-plugin namespace;
- read the state of the storage through the optional `ctx.vault` (API 1.1.0):
  `mode`, `encrypted`, `locked`, `formatVersion`. It is a state, not an access:
  the key material is not in the API and cannot be imported by a plugin (rules
  R11 and R12 of the boundary checker).

**Managing plugins.** Open the app and press the **Plugins** button in the
sidebar. The dialog lists every built-in plugin with its state (`Active`,
`Disabled`, `Failed`, `Incompatible`), lets you enable or disable it, and
offers **Open settings** / **Reset settings** for plugins that declare a
settings schema. The enabled/disabled flags survive a reload.

**Permissions are enforced at runtime.** A manifest may request eight
permissions; the validator rejects unknown names and duplicates, and every
capability handed to a plugin checks the declared rights before the call — a
refusal raises a `PluginPermissionError` inside the plugin (e.g. `editor.write`
is needed to insert text, `ui.contribute` to add a panel or a command,
`settings.write` to store settings). The checks cover the data API, the editor,
the UI contributions and the settings; they do **not** cover network calls the
plugin makes itself (`fetch` is still available to it) and there is no sandbox,
because a built-in plugin is trusted code.

Documentation:

- [`docs/PLUGIN_API.md`](docs/PLUGIN_API.md) — the full contract reference;
- [`docs/PLUGIN_SECURITY.md`](docs/PLUGIN_SECURITY.md) — trust model, what the
  platform does and does not protect against;
- [`docs/PLUGIN_DEVELOPMENT.md`](docs/PLUGIN_DEVELOPMENT.md) — how to write,
  register, test and debug a plugin.

---

## Architecture

```
                    Browser / installed PWA
                              │
                              │  HTTP  (JSON, multipart, downloads)
                              ▼
        ┌──────────────────────────────────────────────┐
        │  backend/  (Go, module noto/backend)         │
        │                                              │
        │  cmd/noto        HTTP server, wiring, signals│
        │  cmd/backup      backup archive                │
        │  cmd/restore     restore from an archive       │
        │  noto restore    the same, as a subcommand     │
        │      │                                       │
        │      ├─ internal/api      HTTP routing, JSON │
        │      │      │             encoding, headers   │
        │      │      ▼                                 │
        │      ├─ internal/notes    domain logic:       │
        │      │                    tree, CRUD, search, │
        │      │                    import/export,      │
        │      │                    trash, attachments, │
        │      │                    reconciliation      │
        │      │      │  (depends only on the port)    │
        │      │      ▼                                 │
        │      ├─ internal/port    Store interface      │
        │      │      │                                 │
        │      │      ▼                                 │
        │      ├─ internal/sqlitestore                 │
        │      │      SQLite: notes metadata, FTS5      │
        │      │      index, attachments, trash         │
        │      │                                       │
        │      ├─ internal/backuppkg archive format:   │
        │      │      manifest, SHA-256 checksums       │
        │      ├─ internal/config   env -> Config      │
        │      ├─ internal/model    shared JSON types   │
        │      └─ internal/web      embedded frontend   │
        └──────────────────────────────────────────────┘
                    │                    │
                    ▼                    ▼
        notes/*.md on disk        noto.db (SQLite)
        attachments/              + -wal / -shm
        trash/

        ┌──────────────────────────────────────────────┐
        │  frontend/  (Preact + TypeScript + Vite)     │
        │                                              │
        │  src/api/client.ts   single request() helper │
        │  src/core/store/     state and actions       │
        │  src/core/commands/  built-in palette commands│
        │  src/components/     tree, editor, preview,  │
        │                      search, attachments,     │
        │                      command palette          │
        │  src/plugins/        plugin platform and the  │
        │                      three built-in plugins   │
        │  src/hooks/          autosave, drafts, theme  │
        │  CodeMirror 6        editor                   │
        │  marked + DOMPurify   sanitised preview       │
        │  idb                 offline drafts           │
        │  service worker      app shell; /api is      │
        │                      network-only             │
        └──────────────────────────────────────────────┘
```

**Backend layers.** `internal/api` handles HTTP only: routing, decoding JSON,
enforcing the body-size and origin/host rules and encoding the error
envelope. `internal/notes` holds the domain logic and knows nothing about
HTTP. It talks to storage through the `port.Store` interface in
`internal/port`, implemented by `internal/sqlitestore` on top of SQLite
(`modernc.org/sqlite`, pure Go). `internal/config` turns environment
variables into a `Config`, and `internal/model` holds the types that are
also the JSON contract.

**Frontend layers.** All HTTP traffic goes through `src/api/client.ts`,
which wraps a single `request()` helper that throws a typed error carrying
the server's stable `code` and `message`. Components never call `fetch`
directly.

**Data flow of a save.** The editor debounces for 800 ms, then `PUT
/api/notes` with the path, the new content and the revision the client last
saw. The server writes the file atomically, updates the metadata row and the
FTS index, and returns the new revision. If the revision is stale the server
answers `409 revision_conflict` and returns its own copy in `error.current`;
the client keeps the local draft and offers a merge or overwrite.

---

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Go | 1.23 or newer | The module declares `go 1.23`. |
| Node.js | 20 or newer | The frontend uses Vite 5 and Preact 10. |
| npm | 10 or newer | Ships with Node 20+. |
| Git | any | Optional. |
| Docker | any | Optional — see [Docker](#docker-optional). |

**In this repository the Go toolchain is vendored** at
`E:\Code\Software\noto\.tools\goroot\go\bin\go.exe` (Go 1.27.3). It is
equivalent to `go` on `PATH`. The helper scripts in `scripts/` find it
automatically; if you call Go directly, use:

```powershell
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go version
```

`.tools/` is excluded by `.gitignore`.

---

## Quick start

```powershell
# 1. Backend — creates the data directory and the database on first run.
cd E:\Code\Software\noto\backend
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" run ./cmd/noto

# 2. Frontend — in a second terminal.
cd E:\Code\Software\noto\frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

To run both at once, use the helper script from the repository root:

```powershell
cd E:\Code\Software\noto
.\scripts\dev.ps1
```

---

## Local development

### The recommended workflow

Run the Go API on `127.0.0.1:8080` and the Vite dev server on
`127.0.0.1:5173`. The dev server proxies `/api` to the backend, so the
browser talks to one origin and there is no CORS involvement at all.

The frontend calls the API with a **relative** base path — `API_BASE` in
`frontend/src/api/client.ts` is `'/api'` — so every request goes to the
origin the page was served from. With the Vite dev server that means the
dev server must proxy `/api` to the backend:

```ts
// frontend/vite.config.ts
export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
});
```

`frontend/vite.config.ts` is owned by the frontend component of this
repository. Read the file to confirm the proxy block is present before
relying on this workflow. If it is missing, either add it, or run the
backend with `NOTO_ALLOWED_ORIGINS=http://127.0.0.1:5173` and point the
frontend at `http://127.0.0.1:8080` explicitly instead.

### Backend only

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go run ./cmd/noto
```

The API is then on <http://127.0.0.1:8080/api>, for example
<http://127.0.0.1:8080/api/health>.

### Frontend only

```powershell
cd E:\Code\Software\noto\frontend
npm install     # once
npm run dev     # dev server on http://127.0.0.1:5173
```

Other frontend commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with hot module replacement. |
| `npm run build` | Type-checks with `tsc --noEmit`, then builds to `frontend/dist`. The `postbuild` step copies the result into `backend/internal/web/dist` so the Go binary can embed it. |
| `npm run preview` | Serves the production build locally. |
| `npm test` | Runs the Vitest suite once. |
| `npm run test:watch` | Runs Vitest in watch mode. |
| `npm run typecheck` | Type-checks the whole frontend with `tsc --noEmit`. |
| `npm run check:boundaries` | Checks the architectural import boundaries (rules R1–R12) of the frontend source tree. |
| `npm run measure` | Prints the bundle size report. |
| `npx vitest run src/core/crypto` | Runs only the tests of the crypto core (KDF, the key hierarchy, the container). |
| `npx vitest run src/core/vault` | Runs only the tests of the sealed vault (the manifest, the index, the conflicts, the service). |

### Helper scripts

All scripts live in `scripts/` and are PowerShell-first. They stop on the
first error (`$ErrorActionPreference = 'Stop'`) and check `$LASTEXITCODE`
after every native command.

| Script | What it does |
| --- | --- |
| `.\scripts\dev.ps1` | Runs the backend (`go run ./cmd/noto`) and the Vite dev server together. Options: `-BackendOnly`, `-FrontendOnly`, `-GoExe`, `-FrontendDir`. |
| `.\scripts\build.ps1` | Builds the frontend, copies `frontend/dist` into `backend/internal/web/dist`, then builds `backend/noto.exe`. |
| `.\scripts\test.ps1` | Runs `go vet ./...`, `go test ./... -race` and `npm test`. Options: `-BackendOnly`, `-FrontendOnly`. |
| `.\scripts\backup.ps1` | Runs the backup command from `backend/cmd/backup`. Extra flags can be forwarded with `-BackupArgs`. |
| `.\scripts\verify.ps1` | Runs every verification step and prints a PASS/FAIL summary. Options: `-Skip <steps>`, `-E2E`, `-Bench` (Go benchmarks of `internal/notes`), `-ReportPath <file.md>` (markdown report with the summary and the tool versions). |
| `.\scripts\measure-perf.ps1` | Measures the latency of the HTTP API on a generated notes tree (default 2000 notes) and prints median and p95 per operation. Options: `-Notes`, `-Iterations`, `-Port`, `-KeepData`. |

The npm scripts wrap the same tooling:

```powershell
cd E:\Code\Software\noto
npm run verify          # -> powershell -File scripts/verify.ps1
cd frontend
npm run verify          # typecheck + boundary check + unit tests + production build
```

### Loading an environment file

The server reads its configuration from the process environment; it does not
parse `.env` itself. To load the example file into the current PowerShell
session:

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
```

Start from [`.env.example`](.env.example); it lists every supported variable
with its default.

---

## Environment variables

Every variable is optional. The defaults below come from
`backend/internal/config/config.go`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOTO_ADDR` | `127.0.0.1:8080` | TCP address the HTTP server listens on. A non-loopback address (including a host-less `:8080`) requires `NOTO_ALLOW_PUBLIC=true`. |
| `NOTO_DATA_DIR` | `<user config dir>/noto` | Root of all persistent state. On Windows `%AppData%\noto`; on Linux `~/.config/noto`; on macOS `~/Library/Application Support/noto`. It only chooses the **default** location: the folder of the notes can still be changed at runtime. |
| `NOTO_NOTES_DIR` | `<NOTO_DATA_DIR>/notes` | Directory holding the Markdown files. |
| `NOTO_VAULT_FIXED` | *(empty)* | Fixes the storage of the notes: the folder cannot be changed at runtime and the application shows it as a normal state (not as an error). Any value except an empty string, `0` and `false` enables the fix. |
| `NOTO_ATTACHMENTS_DIR` | `<NOTO_DATA_DIR>/attachments` | Directory holding uploaded binaries. |
| `NOTO_TRASH_DIR` | `<NOTO_DATA_DIR>/trash` | Directory holding deleted-but-restorable entries. |
| `NOTO_DB_PATH` | `<NOTO_DATA_DIR>/noto.db` | SQLite database file. |
| `NOTO_STATIC_DIR` | *(empty)* | Serve the frontend from this directory instead of the assets embedded in the binary. |
| `NOTO_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list of extra origins allowed to call the API. Empty means no `Access-Control-Allow-Origin` header is sent at all. Not an authentication mechanism. |
| `NOTO_ALLOW_PUBLIC` | `false` | Allows binding a non-loopback address. The server refuses to start on a public address without it, because there is no authentication. |
| `NOTO_MAX_UPLOAD_MB` | `32` | Maximum size of a single upload body, in megabytes. |
| `NOTO_MAX_ARCHIVE_MB` | `256` | Maximum uncompressed size of an imported archive, in megabytes. |
| `NOTO_REQUEST_TIMEOUT_SEC` | `60` | Per-request timeout, in seconds. |
| `NOTO_SHUTDOWN_TIMEOUT_SEC` | `15` | Graceful shutdown timeout, in seconds. |
| `NOTO_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn` or `error`. |

Booleans accept the values `strconv.ParseBool` understands (`true`, `false`,
`1`, `0`, `t`, `f`, …). Integers fall back to the default when the value does
not parse.

---

## Storage layout

With the default configuration, on Windows:

```
%AppData%\noto\            <- NOTO_DATA_DIR
├── notes\                 <- NOTO_NOTES_DIR
│   ├── journal\
│   │   └── 2026\october.md
│   └── welcome.md
├── attachments\           <- NOTO_ATTACHMENTS_DIR
│   └── 3f9a….png
├── trash\                 <- NOTO_TRASH_DIR
│   └── 2026-01-02-101500\
│       └── old-note.md
├── noto.db                <- NOTO_DB_PATH
├── noto.db-wal
└── noto.db-shm
```

* `notes/` — the Markdown files. Paths in the API are slash-separated and
  relative to this directory (`journal/2026/october.md`).
* `attachments/` — uploaded binaries. The file name on disk is generated
  server side; the original name is stored in the database.
* `trash/` — deleted entries, moved here so they can be restored.
* `noto.db` — the SQLite database, with `-wal` and `-shm` sidecar files while
  the server is running (WAL mode).

All four directories are created automatically on startup.

---

## Database and migrations

The database is created and migrated automatically on the first start — there
is no separate migration command. `internal/sqlitestore` opens the file with
`journal_mode=WAL`, `foreign_keys=ON` and `busy_timeout=5000`, then applies
the schema.

Migrations are tracked with the SQLite `user_version` pragma (currently
version `1`). Every statement is idempotent (`CREATE TABLE IF NOT EXISTS`),
so the full set is applied on every open and a re-open is always safe. If the
database was written by a newer version, the server refuses to open it rather
than corrupting it.

The tables are `notes` (metadata), `notes_fts` and the FTS5 virtual table
`notes_fts_v` (search index), `attachments` (metadata) and `trash` (deleted
entries). See `docs/CONTRACT.md` section 2 for the exact schema.

If the SQLite build has no FTS5, the store logs a warning and falls back to
a bounded `LIKE` scan; the server does not crash.

---

## Running the tests

Backend:

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go vet ./...
& $go test ./... -race
```

Frontend:

```powershell
cd E:\Code\Software\noto\frontend
npm test
```

The crypto core and the sealed vault have their own suites; they can be run
alone while working on them:

```powershell
cd E:\Code\Software\noto\frontend
npx vitest run src/core/crypto
npx vitest run src/core/vault
```

The backend of the sealed storage (`internal/sealed`) is covered by the Go
suite:

```powershell
cd E:\Code\Software\noto\backend
& $go test ./internal/sealed/... -race
```

Both at once:

```powershell
cd E:\Code\Software\noto
.\scripts\test.ps1
```

Everything at once (backend build, vet, race tests, HTTP smoke suite,
architecture boundaries, type-check, unit tests, production build and the
bundle-size report):

```powershell
cd E:\Code\Software\noto
.\scripts\verify.ps1
```

`scripts/verify.ps1` runs every step and prints a PASS/FAIL summary at the
end instead of stopping at the first failure. Steps can be skipped with
`-Skip` (names: `build`, `vet`, `test`, `smoke`, `boundaries`, `typecheck`,
`unit`, `bundle`, `measure`, `bench`, `e2e`), and the end-to-end Playwright suite runs
only with `-E2E`:

```powershell
.\scripts\verify.ps1 -Skip e2e,smoke
```

The Go benchmarks of the notes package are added with `-Bench`, and the whole
run can be written as a markdown report (with the summary and the versions of
the tools) with `-ReportPath`:

```powershell
.\scripts\verify.ps1 -Bench -ReportPath .tools\verify-report.md
```

The measurements of the latency of the API are described in
[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

The architecture boundary check on its own (it is part of `verify.ps1` too):

```powershell
cd E:\Code\Software\noto\frontend
npm run check:boundaries
```

---

## Production build

Build the frontend first — the Go binary embeds the built assets from
`backend/internal/web/dist`.

```powershell
cd E:\Code\Software\noto\frontend
npm install
npm run build          # also copies frontend/dist -> backend/internal/web/dist
```

Then build the binary:

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go build -trimpath -o noto.exe ./cmd/noto
```

Or run the whole thing with `.\scripts\build.ps1` from the repository root,
which produces `backend\noto.exe`.

Run the binary:

```powershell
cd E:\Code\Software\noto\backend
.\noto.exe
```

The server serves the API and the SPA from the same origin on
<http://127.0.0.1:8080>. There is nothing else to install — the frontend is
inside the binary.

If you would rather serve the frontend from disk, set
`NOTO_STATIC_DIR` to the directory containing `index.html`.

---

## Windows deployment

1. Build the binary on the target machine (or copy `noto.exe` there):

   ```powershell
   cd E:\Code\Software\noto\backend
   $go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
   & $go build -trimpath -o noto.exe ./cmd/noto
   ```

2. Put `noto.exe` somewhere stable, for example `C:\noto\noto.exe`. It is a
   single self-contained binary; no Go runtime is needed on the target.

3. Create the data directory and set the environment:

   ```powershell
   New-Item -ItemType Directory -Force -Path C:\noto\data
   [Environment]::SetEnvironmentVariable('NOTO_DATA_DIR', 'C:\noto\data', 'Machine')
   [Environment]::SetEnvironmentVariable('NOTO_ADDR', '127.0.0.1:8080', 'Machine')
   ```

   Keep the default `NOTO_ADDR`. Only change it if a reverse proxy or a VPN
   terminates the connection, and set `NOTO_ALLOW_PUBLIC=true` in that case.

4. Run it as a scheduled task at start-up, or install it as a Windows
   service with `sc.exe create` / NSSM / WinSW:

   ```powershell
   sc.exe create Noto binPath= "C:\noto\noto.exe" start= auto
   sc.exe start Noto
   ```

5. Open <http://127.0.0.1:8080>. For access from other machines, put a
   reverse proxy with authentication in front of it — see
   [HTTPS and reverse proxy](#https-and-reverse-proxy).

To uninstall: stop and delete the service, then delete the data directory.

---

## Installing the Android PWA

1. Serve Noto over **HTTPS** (or open it on `localhost` on the same
   machine). Service workers and "Add to home screen" installs require a
   secure context; `http://127.0.0.1` counts as secure, a plain-HTTP LAN
   address does not. Use a reverse proxy with TLS, or a tunnel with HTTPS.
2. Open the site in **Chrome for Android**.
3. Tap the ⋮ menu → **Add to Home screen** (or **Install app**).
4. Confirm the name; Noto is added as a standalone app with its own icon and
   opens without browser chrome.
5. The service worker caches the app shell, so the UI opens offline. API calls
   are **network-only**: private responses are never cached, so an offline
   request fails with an explicit error instead of showing a stale note body;
   writes that fail offline keep their draft in IndexedDB and are retried when
   the connection returns.

On iOS the equivalent is Safari → Share → **Add to Home Screen**.

---

## HTTPS and reverse proxy

Noto does not terminate TLS itself and has no user accounts. Put an
authenticating reverse proxy in front of it for any deployment that is
reachable beyond the machine it runs on.

Caddy:

```caddyfile
notes.example.com {
    basicauth {
        you $2a$14$REPLACE_WITH_THE_HASH_FROM_CADDY_HASH_PASSWORD
    }
    reverse_proxy 127.0.0.1:8080
}
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    ssl_certificate     /etc/letsencrypt/live/notes.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

    auth_basic "Noto";
    auth_basic_user_file /etc/nginx/.htpasswd;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Set `NOTO_ALLOWED_ORIGINS` to the exact public origin (for example
`https://notes.example.com`) so that browser requests from your own page are
accepted, while requests carrying a foreign `Origin` are still rejected with
`403 forbidden`.

Full details, the threat model and a hardening checklist are in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Backup and restore

Everything that matters is in the data directory: the Markdown files, the
attachments, the trash and the SQLite database. Backing up that directory is
backing up Noto.

### Using the backup command

The repository ships a backup tool at `backend/cmd/backup` (see
`docs/CONTRACT.md` section 0). It packs the data directory — notes,
attachments, trash and the SQLite database — into a single archive.

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go run ./cmd/backup -h      # list the supported flags
& $go run ./cmd/backup          # create a backup
```

The tool prints the archive path it wrote. The archive is written to a
temporary file and renamed into place, so an interrupted backup never leaves a
broken archive under the final name. Its `manifest.json` is version 2 and
lists every file with its size and SHA-256 checksum.

Or via the helper script, which forwards any extra arguments verbatim:

```powershell
cd E:\Code\Software\noto
.\scripts\backup.ps1
.\scripts\backup.ps1 -BackupArgs @('-out', 'D:\backups\noto.zip')
```

### Manual backup (any platform)

Stop the server first so the SQLite WAL is checkpointed, then copy the whole
data directory:

```powershell
# Windows
Copy-Item -Recurse "$env:APPDATA\noto" "D:\backups\noto-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

```bash
# Linux / macOS
tar -czf "noto-$(date +%Y%m%d-%H%M%S).tar.gz" -C "${XDG_CONFIG_HOME:-$HOME/.config}/noto" .
```

Copy the archive off the machine. Test a restore occasionally.

### Restore

The restore logic lives in `backend/internal/restore` and is reached through two
entry points that share the same implementation: the `noto restore` subcommand
of the server binary (the usual way) and the standalone program
`backend/cmd/restore`, which is a thin wrapper around the same package.

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go run ./cmd/noto restore --help
```

The standalone program takes the same flags:

```powershell
& $go run ./cmd/restore -h
```

| Flag | Meaning |
| --- | --- |
| `-in <archive.zip>` | The backup archive to restore. Required. |
| `-data <dir>` | Override the data directory (default: the configured one). |
| `-dry-run` | Only report what would be restored; nothing is changed. |
| `-force` | Restore even when the target directory already contains data. |

What it does, in this order:

1. Opens the archive and verifies every file against the SHA-256 checksums of
   the manifest. A mismatch aborts the restore. Archives written before the
   checksums existed are still restored, with a warning that their integrity
   cannot be verified.
2. With `-dry-run` it prints the report and stops — nothing is written.
3. Refuses to continue when the target directory already contains data, unless
   `-force` is given.
4. Keeps the current database next to it as
   `noto.db.pre-restore-<timestamp>` and moves the current content
   directories aside with the same suffix.
5. Installs the restored database atomically (rename), removes the stale
   `noto.db-wal` and `noto.db-shm` side files and opens the database through
   the store, which applies the schema. If the restored database turns out to
   be unusable, the whole restore is rolled back.

Manual restore (without the tool):

1. Stop the server.
2. Move the current data directory aside — do not delete it yet.
3. Extract the backup over the data directory, so that `notes/`,
   `attachments/`, `trash/` and `noto.db` are back in place.
4. Start the server. The schema is migrated automatically on open.
5. If the index looks stale, call `POST /api/search/reindex`.
6. Only delete the old copy once you have confirmed the restore.

Restoring into an existing installation overwrites `noto.db`; the WAL and
shm sidecar files (`noto.db-wal`, `noto.db-shm`) belong to the old database
and should be removed before the restore.

### Checking the consistency of the library

`noto reconcile` compares the notes directory with the database and reports
the differences:

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go run ./cmd/noto reconcile                # report only, nothing is changed
& $go run ./cmd/noto reconcile --json         # the same report as JSON
& $go run ./cmd/noto reconcile --apply        # write the missing metadata rows
& $go run ./cmd/noto reconcile --drop-ghosts  # delete the metadata of missing files
```

Without an explicit flag the command only reports. The trash is not part of
the comparison, and junctions and symbolic links are skipped.

---

## Security model and limitations

Noto has **no user accounts**: no registration, no login, no password, no
session, no token, and no per-user data model. Every request that reaches the
server is treated as a fully privileged request from the owner.

**Anyone who can open a TCP connection to the server can read, write, delete
and export every note.** There is no way to give two people separate access
to one Noto instance.

What the server does do:

* Binds `127.0.0.1:8080` by default, and **refuses to start** on a
  non-loopback address unless `NOTO_ALLOW_PUBLIC=true` is set. An address
  without a host (`NOTO_ADDR=":8080"`) counts as non-loopback and is refused too.
* Sends no `Access-Control-Allow-Origin` header unless the origin is listed
  in `NOTO_ALLOWED_ORIGINS`. Same-origin requests (the `Origin` host:port equals
  the request `Host`) and requests without an `Origin` header are allowed;
  state-changing requests with a foreign `Origin` are rejected with
  `403 forbidden`.
* Requires the `Host` header to be `localhost`, `127.0.0.1`, `::1` or an
  explicitly allowed host.
* Sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` and a
  restrictive `Content-Security-Policy` on every response.
* Normalises and validates every path, and refuses to follow symlinks out of
  the notes root.
* Sniffs attachment content types from the bytes and stores a
  server-generated file name.
* Limits request bodies and archive sizes, and bounds requests with a
  timeout.
* Never returns stack traces or absolute server paths, and never logs note
  contents.

What it does **not** do:

* Authenticate anybody.
* Encrypt data at rest.
* Provide an audit trail.
* Serve HTTPS itself.
* Protect against a local user who can read the data directory, a malicious
  browser extension, or traffic interception on a non-HTTPS link.

**CORS is not authentication.** Allowing an origin in
`NOTO_ALLOWED_ORIGINS` only tells the browser whether to attach headers; any
other client can call the API directly.

Recommended hardening, in order of importance:

1. Keep the server on `127.0.0.1`.
2. Put an authenticating reverse proxy (or a VPN) in front of it.
3. Terminate TLS at the proxy.
4. Encrypt the disk holding the data directory.
5. Back up the data directory and keep an off-machine copy.

The full threat model and checklist are in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Docker (optional)

Docker is a convenience, not a requirement — the application is a single Go
binary and runs fine without Docker.

```powershell
cd E:\Code\Software\noto
docker compose up --build
```

This builds a three-stage image (Node build for the frontend, Go build for
the backend, Alpine runtime) and starts the server with a named volume for
the data directory. The port is published on `127.0.0.1:8080` only, so the
container is not reachable from the network.

```powershell
docker compose down          # stop
docker compose down -v       # stop and delete the data volume
```

Inside the container the server listens on `0.0.0.0:8080` with
`NOTO_ALLOW_PUBLIC=true` (the guard has to be disabled for the container to
be reachable at all) and `NOTO_DATA_DIR=/data`. The published port mapping
is what restricts access.

To build and run the image directly:

```powershell
docker build -t noto:latest .
docker run --rm -p 127.0.0.1:8080:8080 -v noto-data:/data noto:latest
```

---

## API reference

Base path `/api`. All requests and responses are JSON, except uploads
(`multipart/form-data`) and downloads (raw bytes). There is no
authentication — see [Security model](#security-model-and-limitations).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe: `{"status":"ok","version":"…","time":"…"}`. |
| `GET` | `/api/tree` | All notes and folders as flat `folders` / `files` arrays. Trashed entries excluded. |
| `POST` | `/api/folders` | Create a folder. Body `{"parentPath":"","name":"Journal"}`. |
| `POST` | `/api/files` | Create an empty `.md` file. Body `{"parentPath":"","name":"note.md"}`. |
| `GET` | `/api/notes?path=…` | Read a note: body, revision and timestamps. |
| `PUT` | `/api/notes` | Write a note. Body `{"path","content","revision"}`. `revision: 0` forces the write. |
| `POST` | `/api/notes/rename` | Rename a file or folder. Body `{"path","newName"}`. |
| `POST` | `/api/notes/move` | Move a file or folder. Body `{"path","newParentPath"}`. |
| `DELETE` | `/api/notes?path=…` | Move an entry to the trash. |
| `POST` | `/api/notes/restore` | Restore a trashed entry. Body `{"trashPath":"…"}`. |
| `GET` | `/api/trash` | List trashed entries. |
| `GET` | `/api/search?q=…&limit=50` | Full-text search over names and bodies. |
| `POST` | `/api/search/reindex` | Rebuild the search index from disk. |
| `POST` | `/api/import/files` | Import Markdown files (`multipart`). |
| `POST` | `/api/import/zip` | Import a zip archive (`multipart`). |
| `GET` | `/api/export/note?path=…` | Download one note as `text/markdown`. |
| `GET` | `/api/export/folder?path=…` | Download a folder as `application/zip`. |
| `GET` | `/api/export/all` | Download the whole tree as `application/zip`. |
| `POST` | `/api/attachments` | Upload a file (`multipart`). |
| `GET` | `/api/attachments` | List attachment metadata. |
| `GET` | `/api/attachments/{id}/raw` | Download the raw bytes. |
| `DELETE` | `/api/attachments/{id}` | Delete an attachment. |
| `POST` | `/api/maintenance/reconcile` | Compare the notes directory with the database. Only registered when the server runs with `NOTO_MAINTENANCE=1`; otherwise the route answers `404`. |
| `GET` | `/` and any non-`/api` route | The SPA `index.html` (SPA fallback). |

Errors use a single envelope:

```json
{ "error": { "code": "not_found", "message": "note not found" } }
```

Error codes: `bad_request`, `invalid_path`, `not_found`, `conflict`,
`revision_conflict`, `duplicate_name`, `invalid_name`, `payload_too_large`,
`unsupported_media_type`, `forbidden`, `internal`.

Full request and response examples are in [`docs/API.md`](docs/API.md).

---

## Known limitations and roadmap

**Limitations**

* No user accounts, no multi-user support, no authentication of any kind.
* No encryption at rest and no TLS termination in the server.
* No audit log and no note history — the trash keeps deleted files, but an
  edited note keeps only its current content.
* Full-text search falls back to a `LIKE` scan when the SQLite build lacks
  FTS5; the fallback is slower and less accurate.
* Attachments are not editable or re-orderable in the UI, and there is no
  image thumbnail generation.
* No server-side pagination — `/api/tree` and `/api/attachments` return
  everything.
* The UI is single-language (English) and has no tagging or filtering beyond
  folders and search.
* Offline support covers the app shell and the static assets only: every
  `/api/*` route is served `network-only`, so private responses never come
  from a cache. Writes made offline are queued as local drafts and are not
  synchronised automatically to the server.
* Plugins are built-in code that runs as trusted code inside the application —
  there is no sandbox and no plugin installation from disk or the network.
  Declared permissions are enforced for the data API, the editor, the UI
  contributions and the settings, but a plugin can still make network requests
  itself (see [`docs/PLUGIN_SECURITY.md`](docs/PLUGIN_SECURITY.md)).
* The **Backlinks** plugin can only list the matching notes; it cannot open
  them, because the plugin contract has no such operation.
* The name of a note is not length-limited and may contain control characters
  (except NUL) — the validation deliberately stays permissive so that existing
  files are never rejected.
* The search button in the sidebar still carries the old tooltip
  "Search (Ctrl+K)"; the shortcut itself is `Ctrl+Shift+F` (or `Ctrl+K` for
  the command palette, which also offers "Search notes").
* There is no mobile-native wrapper — Android support is via the installed
  PWA.

**Roadmap**

* Optional passphrase protection for the whole vault, unlocking the key in
  the browser.
* Note version history and a diff view.
* Tagging and a graph view. The backlinks plugin already lists the incoming
  links and the mentions of the open note, but it cannot open a note and
  there is no graph.
* Server-side pagination and lazy loading of the tree.
* Full-text search over attachments.
* Optional end-to-end encryption between the browser and the server.
* A native Android wrapper using the same API.

---

## Repository layout

```
noto/
├── backend/                  Go module noto/backend
│   ├── cmd/noto/             server entry point and the "reconcile" and "restore" subcommands
│   ├── cmd/backup/           backup tool
│   ├── cmd/restore/          thin wrapper around internal/restore (also `noto restore`)
│   └── internal/
│       ├── config/           environment -> Config
│       ├── model/            shared domain and JSON types
│       ├── port/             Store interface
│       ├── sqlitestore/      SQLite implementation
│       ├── backuppkg/        archive format: manifest, checksums, create and open
│       ├── restore/          restore logic: checksums, dry run, atomic DB replacement
│       ├── notes/            domain logic
│       ├── api/              HTTP layer
│       └── web/              embedded frontend assets
├── frontend/                 Preact + TypeScript + Vite PWA
│   ├── public/sw-policy.js   pure service worker policy (testable without a browser)
│   └── src/plugins/          plugin platform: contract, manifest, registry, host, loader, builtin plugins
│   └── src/core/commands/    built-in commands of the command palette
├── scripts/                  PowerShell helper scripts
├── docs/
│   ├── CONTRACT.md           authoritative internal contract
│   ├── API.md                REST API reference
│   ├── SECURITY.md           threat model and hardening checklist
│   ├── PERFORMANCE.md        measurements and the methodology
│   ├── ARCHITECTURE.md       structure of the application
│   ├── ENCRYPTION.md         the encrypted storage: the scheme and the guarantees
│   ├── VAULT.md              the storage of the notes: the modes and the migration
│   ├── UI_AUDIT.md           the audit of the interface
│   ├── DESIGN_SYSTEM.md      the visual rules of the application
│   ├── PLUGIN_API.md         plugin contract reference
│   ├── PLUGIN_SECURITY.md    plugin trust model and limitations
│   └── PLUGIN_DEVELOPMENT.md how to write, test and debug a plugin
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## License

Noto is a personal project. Use it as you like.
