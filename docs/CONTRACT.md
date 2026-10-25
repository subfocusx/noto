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
│  ├─ cmd/restore/main.go        OWNER: agent-backend-api (thin wrapper around internal/restore)
│  ├─ internal/config/           OWNER: root (frozen)
│  ├─ internal/model/            OWNER: root (frozen)
│  ├─ internal/port/             OWNER: root (frozen)
│  ├─ internal/sqlitestore/      OWNER: agent-store
│  ├─ internal/backuppkg/        OWNER: agent-backend-api
│  ├─ internal/restore/          OWNER: agent-backend-api
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

### Phase 3 modules

Phase 3 added the following modules. They follow the layering of the sections
above: `api` → `notes` → `port.Store` ← `sqlitestore`, and the archive format
lives in its own package that knows nothing about the HTTP layer.

```
backend/internal/backuppkg/        archive format: manifest v2 with the SHA-256
                                   checksums of the files, create, open, verify
backend/internal/restore/         the restore logic: checksums, dry run, atomic
                                   replacement of the database, rollback
backend/cmd/restore/main.go        a thin wrapper around internal/restore: the
                                   same flags and the same behaviour
backend/internal/notes/reconcile.go  Reconcile / ReconcileWithOptions: the
                                   comparison of the notes directory and the
                                   metadata rows of the database
backend/internal/api/handlers_maintenance.go  the reconcile endpoint, registered
                                   only when NOTO_MAINTENANCE=1
frontend/src/core/commands/appCommands.ts  the built-in commands of the palette
frontend/src/components/CommandPalette.tsx  the global command palette
frontend/src/plugins/builtin/backlinks/     the third built-in plugin
frontend/public/sw-policy.js        the pure functions of the service worker
                                   policy (testable without a browser)
```

`port.Store` was **not** changed in phase 3: the N+1 of the tree was removed
with the existing `ListNotes`, not with a new method of the interface.

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
CREATE TABLE IF NOT EXISTS note_props (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  flags       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_note_props_tag ON note_props(tags);
CREATE TABLE IF NOT EXISTS note_versions (
  path       TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path, revision)
);
CREATE TABLE IF NOT EXISTS note_derived (
  path        TEXT PRIMARY KEY,
  derived     TEXT NOT NULL DEFAULT '{}',
  computed_at INTEGER NOT NULL DEFAULT 0,
  stale       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachment_text (
  id        TEXT PRIMARY KEY,
  note_path TEXT NOT NULL DEFAULT '',
  name      TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_attachment_text_note ON attachment_text(note_path);
```

The schema version is stored in `PRAGMA user_version`. It is `1` for the
vaults created before the query language, `2` since the migration of the
phase 8 (the table `note_props` and its index) and `3` since the migration of
2026-10-25: version `3` adds the table `note_versions` (the history of the
notes), the table `note_derived` (the cache of the derived properties with
the flag `stale`), the table `attachment_text` (the text of the attachments,
so that it is searchable) and the column `created_at` of the notes. The
migration is idempotent: opening a vault of version `1` twice leaves it at
version `3`, and the data of the version `1` is never touched. The data
migration fills the `created_at` of the old notes with their modification
time — an approximation, not a fact.

The table `note_props` holds the **derived** properties of the notes (the
title, the tags and the boolean flags). They are a cache of the text of the
note: the file on the disk stays the source of truth, and the rows are
rebuilt when the note is saved or when the index is rebuilt. A row whose
flags contain the bit `PropStale` marks a note whose properties could not be
recalculated; the answer of a query then carries `partial: true`.

The table `note_derived` is the second, newer cache of the same properties:
the blob `derived` holds the title, the tags and the bit mask of the flags,
and the column `stale` tells whether the note changed since the last
calculation. The rule of the cache is simple: a write **marks** the
properties as stale instead of recomputing them, and the recalculation is a
separate, explicit step. The table `note_versions` holds the history of the
notes: a version is immutable, it is written once and never modified. The
table `attachment_text` holds the text extracted from the attachments at the
upload, so that the content of an attachment is searchable.

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
`unsupported_media_type`, `forbidden`, `unauthenticated`, `internal`.

### Health
* `GET /api/health` → `200 {"status":"ok","version":"...","time":"RFC3339"}`

### Tree
* `GET /api/tree` → `200 {"folders":[Node],"files":[Node]}`
  Flat arrays; the client builds the hierarchy. Trashed entries are excluded.
* `GET /api/tree/children?parent=<path>&cursor=<path>&limit=<n>` →
  `200 {"items":[Node],"nextCursor":"<path>"}`
  One page of the children of a folder (the lazy loading of the tree). The
  cursor is the path of the last child of the previous page; the cursor of the
  answer is empty when the page is the last one. `limit` must be a positive
  number (100 by default); anything else → `400 bad_request`. The page of a
  folder that does not exist is empty.
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

### Query (the query language)
The query language is described in [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md).
The endpoints below are the server side of the language; in the encrypted
storage the same queries are answered by the browser.

* `POST /api/query` body `{"query":"tag == 'work'","limit":50}` →
  `200 {"hits":[SearchHit],"total":N,"partial":bool}`
  * `hits` are the notes that match the query; `total` is the number of the
    matching notes (before the limit); `partial` is `true` when the derived
    properties of some notes could not be recalculated, so the answer may be
    incomplete.
  * An empty query → `200 {"hits":[],"total":0,"partial":false}`.
  * A broken query → `400 bad_request` with the message of the parser
    (`unknown field: <name>`, `unknown operator: <name>`, `expected a value`…).
  * The limit is optional; the default is `50`.
* The operator `matches` (and the prefix form `match:`) looks for a regular
  expression in the text of a note. The expression is compiled when the query
  is parsed: a broken expression is `400 bad_request` with the message
  `invalid regular expression: <reason>`. The backend compiles it with RE2,
  the browser with the `RegExp` of JavaScript — see
  [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md) §3.
* `GET /api/tags` → `200 {"tags":[{"tag":"work","count":3}]}`
  The tags of the vault with the number of the notes that carry them, the
  biggest count first and then by name.

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
* `POST /api/attachments/search` body `{"query":string,"limit"?:int}`
  → `200 {"hits":[{"noteId":string,"notePath"?:string,"attachmentId":string,
  "name":string,"mime":string,"snippet":string}]}`
  — the full-text search over the text of the attachments (the text of a
  `text/plain`, a `text/markdown`, a `.md` and a `.txt` file is indexed at the
  upload). An empty query → `400 bad_request`.
* `GET /api/attachments/{id}/content` → the raw bytes with the real content type
* `POST /api/attachments/{id}/preview` → `200 {"mime":string,"width":int,"height":int,"url":string}`
  — the size of an image is read from the bytes; a file that is not an image
  gives `0` and `0`.

### The versions of a note
* `GET /api/notes/versions?path=<path>` → `200 {"versions":[{"path":string,
  "revision":int,"title":string,"content":string,"createdAt":RFC3339}]}`
* `GET /api/notes/versions/diff?path=<path>&from=<rev>&to=<rev>` →
  `200 {"path":string,"from":int,"to":int,"lines":[{"kind":"context|added|removed",
  "text":string,"fromLine":int,"toLine":int}]}` — the line numbers are 1-based,
  `0` means that the line does not exist on that side
* `POST /api/notes/versions/restore` body `{"path":string,"revision":int}`
  → `200 NoteContent` — the restore is a new write, so the revision grows

  An unknown path or an unknown revision → `404 not_found`; a missing `path`
  → `400 bad_request`. The restore is written into the audit log.

### The authentication (the accounts)
The authentication is disabled by default: the local mode keeps working exactly
as before, and every request is served as the local user `local` (role `admin`).
When `NOTO_AUTH_ENABLED` is `true`, the endpoints below are the entry points.

* `POST /api/auth/login` body `{"name":string,"password":string}`
  → `200 {"token":string,"user":User,"expiresAt":RFC3339}`
  — the session is also written in the cookie `noto_session` (`HttpOnly`,
  `SameSite=Lax`), so that the browser works without a token. A wrong name or
  password → `401 unauthenticated`.
* `POST /api/auth/logout` → `200 {"ok":true}` — the session is removed, the
  cookie is cleared.
* `GET /api/auth/me` → `200 {"user":User,"authenticated":bool}`

The credentials travel with the header `Authorization: Bearer <token>` or with
the cookie `noto_session`.

### The accounts (the administrator only)
* `GET /api/users` → `200 {"users":[User]}`
* `POST /api/users` body `{"name":string,"password":string,"role":"admin|user"}`
  → `200 User` (the role defaults to `user`)
* `DELETE /api/users/{id}` → `200 {"ok":true}` — the last administrator cannot
  be removed → `409 conflict`
* `POST /api/users/{id}/role` body `{"role":"admin|user"}` → `200 User` — the
  last administrator cannot be demoted → `409 conflict`

`User` is `{"id":string,"name":string,"role":"admin|user","createdAt":RFC3339}`.

### The audit log
* `GET /api/audit?limit=100&action=&user=` → `200 {"entries":[Entry]}` — only
  an administrator reads it; `limit` is 100 by default and 1000 at most.

`Entry` is `{"id":int,"time":RFC3339,"user":string,"action":string,"target":string,"result":"ok|error"}`.
The actions are `note.created`, `note.updated`, `note.renamed`, `note.moved`,
`note.deleted`, `note.restored`, `note.imported`, `file.created` and
`folder.created`. The log never holds the content of a note — only the
identifiers.

### The webhooks
* `GET /api/webhooks` → `200 {"subscriptions":[Subscription]}`
  (`?all=true` — the subscriptions of every user, for an administrator)
* `POST /api/webhooks` body `{"url":string,"events":[string]}` → `200 Subscription`
  — the answer carries the secret of the subscription: it is the only time the
  secret leaves the server. An empty list of events means every event.
* `DELETE /api/webhooks/{id}` → `200 {"ok":true}`
* `GET /api/webhooks/deliveries?limit=100` → `200 {"deliveries":[Delivery]}`
* `POST /api/webhooks/deliveries/{id}/redeliver` → `200 {"ok":true}`

`Subscription` is `{"id":string,"owner":string,"url":string,"events":[string],"secret":string,"createdAt":RFC3339}`.
`Delivery` is `{"id":int,"subscriptionId":string,"event":string,"payload":string,"state":"pending|delivered|failed","attempts":int,"nextAttempt":RFC3339,"lastError":string,"createdAt":RFC3339}`.

The guard against the server side request forgery: only `https` is accepted, and
a plain `http` only for a loopback address (`localhost`, `127.0.0.1`, `::1`).
Every other url → `400 bad_request`.

The delivery is a `POST` with the body of the event, the header
`X-Noto-Signature: sha256=<hexadecimal HMAC-SHA256 of the body with the secret
of the subscription>`, the header `X-Noto-Event` and the header
`X-Noto-Delivery`. A failed delivery is retried with a backoff (30 s, 60 s,
120 s…) and is marked as `failed` after five attempts.

### The MCP over HTTP
* `POST /api/mcp` — the body is a JSON-RPC 2.0 request or a batch of requests.
  The answer is the raw JSON of the protocol (the envelope of the REST API is
  not used).

The methods are `initialize`, `tools/list` and `tools/call`. The tools are
`notes.list`, `notes.read`, `notes.create`, `notes.update`, `notes.delete` and
`notes.search`. The errors of the protocol follow JSON-RPC 2.0: `-32700`
(parse), `-32600` (invalid request), `-32601` (unknown method), `-32602`
(invalid params and unknown tool), `-32603` (internal error).

### The TLS
The server serves HTTPS when `NOTO_TLS_CERT_FILE` and `NOTO_TLS_KEY_FILE` are
set. Nothing changes in the API: the routes, the envelopes and the codes are
the same over HTTPS.

### Maintenance
The maintenance endpoint is registered **only** when the server was started
with `NOTO_MAINTENANCE=1`. Without it the route does not exist and answers
`404 not_found` ("unknown endpoint").

* `POST /api/maintenance/reconcile` body optional
  `{"apply":bool,"dropGhosts":bool}` → `200 ReconcileReport`
  `{"missingInDB":[path],"missingOnDisk":[path],"metadataDrift":[string],
  "checked":N,"restored":[path],"dropped":[path],"indexed":[path],"notes":[string]}`

  Without a body (or with both flags false) the call only reports and changes
  nothing. `apply` creates the metadata rows of the files without a row,
  `dropGhosts` deletes the rows whose file is gone. The trash is not compared
  and junctions/symlinks inside the notes directory are skipped. The SQLite
  schema is not changed by a reconciliation.

### Static frontend
* `GET /` and all unknown non `/api` routes → the SPA index (with SPA fallback).
* The frontend is served from `internal/web` (embedded `dist/`) when
  `NOTO_STATIC_DIR` is unset. `internal/web` may contain a placeholder
  `index.html`; the frontend agent must additionally provide a build script
  that copies `frontend/dist` into `backend/internal/web/dist`.

## 3.1 Operational commands (CLI)

Both commands change the library, so both follow the same policy: **the
default is a report, a destructive action always needs an explicit flag.**

### `noto reconcile` (subcommand of `cmd/noto`)

Compares the notes directory with the metadata rows of the database.

| Flag | Meaning |
| --- | --- |
| `--apply` | create the metadata rows of the files that have no row |
| `--drop-ghosts` | delete the metadata rows whose file is gone |
| `--dry-run` | report the differences and change nothing, whatever the other flags say |
| `--json` | print the report as JSON |

Without a flag the command only prints the report. The trash is not compared,
and junctions/symlinks inside the notes directory are skipped. The schema of
the database is not changed.

### `noto restore` / `cmd/restore`

Restores a backup archive into a data directory. The restore logic lives in
`backend/internal/restore` (`restore.Run`, `restore.PrintReport`); both entry
points call the same `restore.Run`, so they behave identically:

* `noto restore -in <archive.zip> [-data <dir>] [-dry-run] [-force]` — the
  subcommand of the server binary, parsed in `backend/cmd/noto`;
* `go run ./cmd/restore -in <archive.zip> [-data <dir>] [-dry-run] [-force]` —
  the standalone program, a thin wrapper around the same package.

| Flag | Meaning |
| --- | --- |
| `-in <archive.zip>` | the archive to restore (required) |
| `-data <dir>` | override the data directory (default: the configured one) |
| `-dry-run` | only report what would be restored, change nothing |
| `-force` | restore even when the target directory already contains data |

Policy of the command:

1. the archive is opened and every file is verified against the SHA-256
   checksums of the manifest; a mismatch aborts the restore. An archive
   without a `files` list (manifest version 1) is restored with a warning,
   because its integrity cannot be verified;
2. with `-dry-run` nothing is written;
3. without `-force` the command refuses to write into a directory that already
   contains data;
4. the current database is kept as `noto.db.pre-restore-<timestamp>`, the
   current content directories are moved aside with the same suffix, and the
   restored database is installed with an atomic rename; the stale
   `noto.db-wal` and `noto.db-shm` are removed;
5. the restored database is opened through `sqlitestore.Open` (which applies
   the schema); if it is not usable, the whole restore is rolled back.

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
  `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`,
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
* Authentication: when `NOTO_AUTH_ENABLED` is `true`, every endpoint of the API
  except `GET /api/health` and `POST /api/auth/login` needs valid credentials
  (the header `Authorization: Bearer <token>` or the cookie `noto_session`).
  The endpoints of the accounts and the audit log need the role `admin`. The
  password of an account is stored with PBKDF2-HMAC-SHA256 (600 000 iterations)
  and a random salt; the encoded hash is self describing, so the parameters can
  be raised later.
* The secret of a webhook subscription is generated by the server and never
  returned in clear after the creation of the subscription. The urls of the
  subscriptions are guarded against the server side request forgery: only
  `https`, or a plain `http` for a loopback address.
* The audit log never holds the content of a note — only the identifiers.

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
