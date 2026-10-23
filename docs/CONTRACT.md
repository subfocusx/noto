# Noto — Internal Contract (authoritative)

This file is the single source of truth shared by all implementation agents.
Anything not defined here is an implementation detail and may be changed freely.
**Do not edit files owned by another agent.**

## 0. Repository layout and file ownership

```
E:\Code\Software\noto
├─ backend/                      Go module: noto/backend
│  ├─ go.mod                     OWNER: root (do not edit go.mod except `go mod tidy`)
│  ├─ cmd/noto/main.go           OWNER: agent-backend-api
│  ├─ cmd/backup/main.go         OWNER: agent-backend-api
│  ├─ internal/config/           OWNER: root (frozen)
│  ├─ internal/model/            OWNER: root (frozen)
│  ├─ internal/port/             OWNER: root (frozen)
│  ├─ internal/sqlitestore/      OWNER: agent-store
│  ├─ internal/notes/            OWNER: agent-backend-api
│  ├─ internal/api/              OWNER: agent-backend-api
│  ├─ internal/web/              OWNER: agent-backend-api
│  └─ internal/testutil/         OWNER: agent-backend-api
├─ frontend/                     OWNER: agent-frontend
├─ scripts/, docs/, Dockerfile   OWNER: agent-docs
└─ IMPLEMENTATION_STATUS.md      OWNER: root
```

Root-owned packages are frozen: read them, import them, but do not modify them.

### Phase 2 ownership (plugin platform)

Phase 2 added a plugin platform. The following files belong to it and are
owned by the plugin-platform component; the integration layer (`App.tsx`) is
owned by root.

```
frontend/src/plugins/contract.ts          public plugin contract (types + PLUGIN_API_VERSION)
frontend/src/plugins/manifest.ts          manifest validation, version compatibility
frontend/src/plugins/registry.ts          registry of built-in plugins, lifecycle states
frontend/src/plugins/host.ts              activation, ownership of registrations
frontend/src/plugins/loader.ts            static list of the built-in plugins
frontend/src/plugins/builtin/<id>/        the built-in plugins themselves
frontend/src/core/events/eventBus.ts      typed event bus (plugin events)
frontend/src/core/commands/commandRegistry.ts  command registry (plugin commands)
frontend/src/core/settings/settingsStore.ts    plugin settings storage (IndexedDB `noto-plugins`)
frontend/src/core/diagnostics/logger.ts   scoped logger `[noto:<scope>]`
frontend/src/core/api/pluginApi.ts        the only HTTP facade for plugins
frontend/src/components/PluginSlots.tsx   contribution points (sidebar, panels, toolbar, context menu, commands)
frontend/src/components/PluginManagerPanel.tsx  plugin management screen
frontend/scripts/check-boundaries.mjs     architectural boundary rules R1-R8
backend/internal/notes/noteapi.go        backend extension point: NoteService, NoteEvent, Hook, AddHook
docs/PLUGIN_API.md, docs/PLUGIN_SECURITY.md, docs/PLUGIN_DEVELOPMENT.md   plugin documentation
```

Built-in plugins may import `frontend/src/plugins/contract.ts` and their own
files only; the rules are enforced by `npm run check:boundaries`
(`frontend/scripts/check-boundaries.mjs`).

Toolchain: Go is installed at `E:\Code\Software\noto\.tools\goroot\go\bin\go.exe`
(equivalent to `go` on PATH). Node 24 + npm 11 are on PATH.
Always run Go commands with `$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"; & $go ...`
from the `backend` directory, e.g.
`& $go build ./...`, `& $go test ./...`, `& $go vet ./...`.

## 1. Domain model

See `backend/internal/model/model.go` (frozen). Key facts:

* `model.Node` — a tree entry. `Path` is a slash separated path relative to the
  notes root, no leading slash, e.g. `journal/2026/october.md`.
* `model.Node.Type` is `model.NodeFile` or `model.NodeFolder`.
* `model.Node.Revision` — monotonically increasing integer of the note content.
* `model.NoteContent` — full body + revision. `Conflict` is set when a write
  was rejected because the client revision was stale.
* `model.SearchHit` — `Kind` is `"name"` or `"content"`.
* `model.Attachment` — binary metadata, `ID` is a random hex id.
* `model.APIError` / `model.ErrorBody` — error envelope, `Code` is a stable
  machine readable string, `Message` is human readable, `Current` carries the
  server side note on `revision_conflict`.

## 2. Storage interface

See `backend/internal/port/port.go` (frozen). `port.Store` is implemented by
`internal/sqlitestore` and consumed by `internal/notes`.

SQLite schema (owned by `internal/sqlitestore`, migrations applied on open):

```sql
CREATE TABLE IF NOT EXISTS notes (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,        -- file | folder
  parent_path TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  revision    INTEGER NOT NULL DEFAULT 1,
  mod_time    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes_fts (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_v USING fts5(path UNINDEXED, name, body);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, note_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trash (
  trash_path    TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  type          TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER NOT NULL DEFAULT 0
);
```

Notes:

* Use `modernc.org/sqlite` (pure Go, already pinned in `go.mod`). It supports
  FTS5. If FTS5 turns out to be unavailable at runtime, fall back to a `LIKE`
  based scan and log a warning — do not crash.
* Enable `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`.
* Use integer unix milliseconds for timestamps.
* All methods must use `context.Context` and must be safe for concurrent use.

## 3. REST API

Base path `/api`. All requests and responses are JSON except uploads
(`multipart/form-data`) and downloads (file bytes). The server adds
`Content-Type: application/json; charset=utf-8` to JSON responses.

Every non-2xx response uses the envelope:

```json
{ "error": { "code": "not_found", "message": "note not found" } }
```

Stable error codes: `bad_request`, `invalid_path`, `not_found`, `conflict`,
`revision_conflict`, `duplicate_name`, `invalid_name`, `payload_too_large`,
`unsupported_media_type`, `forbidden`, `internal`.

### Health
* `GET /api/health` → `200 {"status":"ok","version":"...","time":"RFC3339"}`

### Tree
* `GET /api/tree` → `200 {"folders":[Node],"files":[Node]}`
  Flat arrays; the client builds the hierarchy. Trashed entries are excluded.
* `POST /api/folders` body `{"parentPath":"","name":"Journal"}` → `200 Node`
* `POST /api/files` body `{"parentPath":"","name":"note.md"}` → `200 Node`
  `name` must end with `.md`; the server appends it when missing.

### Notes
* `GET /api/notes?path=journal/a.md` → `200 NoteContent`
* `PUT /api/notes` body `{"path":"journal/a.md","content":"...","revision":3}`
  → `200 {"path","revision","updatedAt"}`
  If `revision` is non-zero and differs from the stored revision → `409`
  with `{"error":{"code":"revision_conflict","message":"...","current":NoteContent}}`.
  A `revision` of `0` means "force write" (used by import).
* `POST /api/notes/rename` body `{"path":"a.md","newName":"b.md"}` → `200 Node`
* `POST /api/notes/move` body `{"path":"a.md","newParentPath":"journal"}` → `200 Node`
* `DELETE /api/notes?path=journal/a.md` → `200 {"ok":true}` (moves to trash)
* `POST /api/notes/restore` body `{"trashPath":"trash/xxx/a.md"}` → `200 Node`
* `GET /api/trash` → `200 {"entries":[Node]}`

### Search
* `GET /api/search?q=term&limit=50` → `200 {"hits":[SearchHit]}`
  Empty `q` → `200 {"hits":[]}`.
* `POST /api/search/reindex` → `200 {"indexed":N}`

### Import / export
* `POST /api/import/files` — `multipart/form-data` with
  `files` (multiple), `targetPath` (optional), `conflict` (`skip`|`rename`|`overwrite`, default `skip`)
  → `200 ImportResult`
* `POST /api/import/zip` — `multipart/form-data` with `file`, `targetPath`, `conflict`
  → `200 ImportResult`
* `GET /api/export/note?path=a.md` → `text/markdown` attachment
* `GET /api/export/folder?path=journal` → `application/zip` attachment
* `GET /api/export/all` → `application/zip` attachment

### Attachments
* `POST /api/attachments` — `multipart/form-data` with `file`, optional `notePath`
  → `200 model.Attachment`
* `GET /api/attachments` → `200 {"attachments":[Attachment]}`
* `GET /api/attachments/{id}/raw` → raw bytes with the stored mime type
* `DELETE /api/attachments/{id}` → `200 {"ok":true}`

### Static frontend
* `GET /` and all unknown non `/api` routes → the SPA index (with SPA fallback).
* The frontend is served from `internal/web` (embedded `dist/`) when
  `NOTO_STATIC_DIR` is unset. `internal/web` may contain a placeholder
  `index.html`; the frontend agent must additionally provide a build script
  that copies `frontend/dist` into `backend/internal/web/dist`.

## 4. Filesystem rules (backend)

* The notes root is `cfg.NotesDir`. All user supplied paths are relative to it
  and are normalised with `path.Clean` after rejecting: absolute paths, `..`
  segments, empty segments, drive letters, backslashes, NUL bytes, and any
  path that escapes the root after cleaning. Every resolved absolute path must
  still have the notes root as prefix (`filepath.Rel` must not start with `..`).
* Symbolic links inside the notes root must never be followed out of it: after
  resolving, verify the final path is still inside the root; refuse symlinked
  folders that point outside.
* Folders and files are created on disk; the filesystem is the source of truth
  for content, the database holds metadata and the search index.
* Saving a note writes to a temporary file in the same directory and renames
  it over the target (atomic replace), then updates the database and the index.
* Renaming/moving a folder moves the whole subtree on disk and updates every
  affected database row and index entry.
* Moving a folder into itself or into one of its descendants must fail with
  `invalid_path`.
* Duplicate sibling names must fail with `duplicate_name`.
* Invalid names (empty, containing `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`,
  leading/trailing spaces, `.`/`..`, Windows reserved names such as `CON`,
  `PRN`, `AUX`, `NUL`, `COM1`..`COM9`, `LPT1`..`LPT9`) must fail with
  `invalid_name`.
* Deletes move entries to `cfg.TrashDir` (recording the original path) so they
  can be restored. Deleting a folder moves the whole subtree.

## 5. Security rules (backend)

* Bind to `127.0.0.1:8080` by default. If the configured address is not
  loopback and `NOTO_ALLOW_PUBLIC` is not `true`, refuse to start and print a
  clear error explaining that the API has no authentication.
* CORS: no `Access-Control-Allow-Origin` header at all by default. Only the
  exact origins listed in `NOTO_ALLOWED_ORIGINS` are allowed, with
  `Access-Control-Allow-Credentials` never set for non-listed origins.
* Validate `Origin` and `Host`: requests with a foreign `Origin` on
  state-changing methods are rejected with `403 forbidden` (CSRF protection).
  `Host` must be `localhost`, `127.0.0.1`, `::1`, or an explicitly allowed host.
* Response headers on every response: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'`,
  `Cross-Origin-Opener-Policy: same-origin`.
* Body size limits: `http.MaxBytesReader` with `cfg.MaxUploadBytes` for
  uploads and a smaller limit for JSON bodies.
* Never return stack traces or absolute server paths. Log the details server side.
* Never log note contents.
* Archive import: reject entries with absolute paths, `..` segments, symlinks,
  and total uncompressed size above `cfg.MaxArchiveBytes`; also cap the
  number of entries (e.g. 10000).
* Attachment upload: sniff the content type from the bytes (http.DetectContentType),
  allow only `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`,
  `application/pdf`, `text/plain`; enforce the size limit; generate the stored
  name server side; never trust the client file name or mime type.

## 6. Logging

Use the standard library `log/slog` with a text handler. Never log note
contents. Log method, path (API path), status, duration.

## 7. Frontend rules

* Preact + TypeScript (strict) + Vite in `frontend/`.
* Packages: `preact`, `@preact/preset-vite`, `typescript`, `vite`, `vitest`,
 `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`,
 `@codemirror/language-data`, `@codemirror/commands`, `@codemirror/search`,
 `@codemirror/state`, `marked`, `dompurify`, `idb`, `@vite-pwa/plugin` or a
 hand written service worker.
* All HTTP access goes through `frontend/src/api/client.ts` with a single
  `request()` helper that throws a typed error carrying `code` and `message`.
* Plugin facade: plugins never call `fetch` and never import
  `frontend/src/api/client.ts` directly. The only HTTP path available to a
  plugin is `frontend/src/core/api/pluginApi.ts` (`createPluginApi()`), which
  delegates to `frontend/src/api/{notes,tree,search}.ts` and therefore to
  `frontend/src/api/client.ts`. A direct `fetch` from a plugin is forbidden by
  the boundary rules (R8) and is not part of the plugin contract.
* Plugins are built-in code only: there is no dynamic `import()`, no
  `import.meta.glob`, no remote code loading and no `eval` in
  `frontend/src/plugins/**`. The public plugin contract lives in
  `frontend/src/plugins/contract.ts`; see `docs/PLUGIN_API.md`.
* Editor: CodeMirror 6 with markdown language, one editor instance only,
  recreated or reconfigured when the note changes.
* Preview: `marked` + `dompurify` (sanitize the rendered HTML; never inject raw
  HTML from notes).
* Autosave: debounce 800 ms, explicit `Ctrl+S`, status indicator
  (`idle` / `saving` / `saved` / `error`), do not lose edits on network error —
  keep the draft in IndexedDB via `idb` and offer retry.
* Draft recovery: on load, if a local draft for the path exists and is newer
  than the server copy, offer to restore it.
* PWA: `manifest.webmanifest` with icons 192/512, `display: standalone`,
  theme and background colors, a service worker with an offline app shell and
  a network-first API strategy with a cache fallback for `GET` requests.
  Updated in phase 2: every `/api/*` route is served `network-only` — private
  API responses are never written to a cache and an offline request fails with
  an explicit `network_error` envelope instead of a stale body
  (`frontend/public/sw.js`); only static assets and the app shell are cached.
* Responsive: CSS with a mobile breakpoint at 820px; sidebar becomes a drawer;
  touch targets at least 44px.
* Dark and light themes via `prefers-color-scheme` and a manual toggle stored
  in `localStorage`.
* Tests with Vitest for: sanitization, autosave/dirty state, api client error
  handling, search results rendering, tree navigation.

## 8. Acceptance criteria (the Definition of Done)

1. `go build ./...` succeeds in `backend/`.
2. `go vet ./...` and `go test ./...` pass in `backend/`.
3. `npm run build` succeeds in `frontend/`, `npm test` passes.
4. The server starts with the documented command and serves the API and the UI.
5. Notes are real `.md` files on disk; SQLite initialises and holds metadata.
6. Create, edit, rename, move, delete and restore of files and folders work.
7. Autosave works and reports errors instead of losing changes.
8. Search returns accurate results after edits and file operations.
9. Preview is safe against `<script>` and event handler injection.
10. Import/export work and preserve the folder structure.
11. Manifest and service worker are present and valid.
12. The UI works at desktop and mobile viewport sizes.
13. Path traversal, invalid names, duplicate names and archive traversal are tested.
14. README documents setup, build, test, backup, security and limitations.

## 9. Rules for every agent

* Implement only the files you own. If you need a change in a frozen or foreign
  file, report it in your final message instead of editing it.
* Do not weaken the security rules in section 5 to make something work.
* Do not leave stub handlers, hardcoded demo data or `TODO` placeholders in
  code paths that the Definition of Done requires.
* Run the relevant build, vet and test commands yourself and report the real
  output.
* The module path is `noto/backend`; imports look like `noto/backend/internal/model`.
