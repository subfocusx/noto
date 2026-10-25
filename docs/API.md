# Noto — REST API reference

Derived from `docs/CONTRACT.md` section 3, which is the authoritative source.
If this document and the contract ever disagree, the contract wins.

* Base path: `/api`
* Content type: `application/json; charset=utf-8` for JSON responses
* Authentication: **none**. Noto has no user accounts, no login and no
  session. Anyone who can reach the server has full access to the notes.
  See `docs/SECURITY.md`.
* All requests and responses are JSON, except uploads
  (`multipart/form-data`) and downloads (raw file bytes).

## Error envelope

Every non-2xx response uses the same shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "note not found"
  }
}
```

`code` is a stable machine-readable string; `message` is human readable.
On a `revision_conflict` the envelope additionally carries `current`, the
server side copy of the note:

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "note was modified by another client",
    "current": {
      "path": "journal/a.md",
      "content": "# Hello",
      "revision": 7,
      "updatedAt": "2026-01-02T10:00:00Z",
      "conflict": false
    }
  }
}
```

Stable error codes:

| Code | Typical meaning |
| --- | --- |
| `bad_request` | malformed JSON or missing field |
| `invalid_path` | path escapes the notes root, or a folder was moved into itself |
| `not_found` | no such note, folder or attachment |
| `conflict` | generic state conflict |
| `revision_conflict` | the client revision is stale; `current` holds the server copy |
| `duplicate_name` | a sibling with that name already exists |
| `invalid_name` | illegal characters or a reserved name |
| `payload_too_large` | body exceeds `NOTO_MAX_UPLOAD_MB` / `NOTO_MAX_ARCHIVE_MB` |
| `unsupported_media_type` | unsupported upload or archive content |
| `forbidden` | rejected by the origin/host checks (CSRF guard), or the role of the user is not enough (HTTP `403`) |
| `unauthenticated` | the credentials are missing, wrong or expired (HTTP `401`) |
| `vault_sealed` | the vault is sealed: the request needs the open pipeline of the notes, which the server does not use in this mode (HTTP `409`) |
| `internal` | unexpected server error; details are logged, never returned |

## Data types

```jsonc
// Node — one entry of the tree
{
  "id": "0f1c…",
  "name": "note.md",
  "path": "journal/note.md",   // slash separated, relative to the notes root
  "type": "file",              // "file" | "folder"
  "parentPath": "journal",
  "size": 42,
  "modTime": "2026-01-02T10:00:00Z",
  "revision": 3,
  "createdAt": "2026-01-01T09:00:00Z",
  "updatedAt": "2026-01-02T10:00:00Z"
}

// NoteContent — full body plus revision
{
  "path": "journal/note.md",
  "content": "# Hello\n",
  "revision": 3,
  "updatedAt": "2026-01-02T10:00:00Z",
  "conflict": false
}

// SearchHit
{
  "path": "journal/note.md",
  "name": "note.md",
  "kind": "name",       // "name" | "content"
  "snippet": "…"
}

// Attachment
{
  "id": "3f9a…",
  "name": "image.png",
  "mime": "image/png",
  "size": 12345,
  "notePath": "journal/note.md",  // optional
  "createdAt": "2026-01-02T10:00:00Z"
}

// ImportResult
{
  "imported": ["journal/a.md"],
  "skipped": [],
  "errors": []
}
```

## Health

### `GET /api/health`

Liveness probe.

```bash
curl http://127.0.0.1:8080/api/health
```

```json
{ "status": "ok", "version": "0.1.0", "time": "2026-01-02T10:00:00Z" }
```

## Tree

### `GET /api/tree`

Returns every note and folder as two flat arrays. The client builds the
hierarchy. Trashed entries are excluded. The answer also carries the counters
of the tree: the number of the notes and of the folders of the whole vault and
the number of the notes below every folder (counted recursively).

```json
{
  "folders": [ { "path": "journal", "name": "journal", "type": "folder", "parentPath": "", "id": "…", "size": 0, "modTime": "2026-01-02T10:00:00Z", "revision": 1, "createdAt": "2026-01-01T09:00:00Z", "updatedAt": "2026-01-02T10:00:00Z", "noteCount": 3, "folderCount": 1 } ],
  "files":   [ { "path": "journal/note.md", "name": "note.md", "type": "file", "parentPath": "journal", "id": "…", "size": 42, "modTime": "2026-01-02T10:00:00Z", "revision": 3, "createdAt": "2026-01-01T09:00:00Z", "updatedAt": "2026-01-02T10:00:00Z" } ],
  "noteTotal": 3,
  "folderTotal": 2
}
```

`noteCount` of a folder counts the notes of the folder and of its subfolders;
`folderCount` counts the direct subfolders. An empty folder reports `0`.

`noteTotal` and `folderTotal` are still returned, but the interface does not
show them any more: the counters of the section were removed in the redesign of
the phase 7, the counters of the folders stayed. The fields are kept so that an
older client keeps working against a newer server.

### `GET /api/tree/children?parent=<path>&cursor=<path>&limit=<n>`

One page of the children of a folder — the lazy loading of the tree.

| Parameter | Type | Notes |
| --- | --- | --- |
| `parent` | string | the folder; the empty path is the root of the notes |
| `cursor` | string | optional; the path of the last child of the previous page |
| `limit` | number | optional; 100 by default, must be a positive number |

```json
{ "items": [ { "path": "journal/note.md", "name": "note.md", "type": "file", "parentPath": "journal" } ], "nextCursor": "journal/note.md" }
```

`nextCursor` is empty when the page is the last one. The page of a folder that
does not exist is empty. A `limit` that is not a positive number is refused
with `400 bad_request`.

### `POST /api/folders`

Creates a folder.

```json
{ "parentPath": "", "name": "Journal" }
```

Response `200` with the created `Node`.

### `POST /api/files`

Creates an empty Markdown file. `name` must end with `.md`; the server
appends the extension when it is missing.

```json
{ "parentPath": "", "name": "note.md" }
```

Response `200` with the created `Node`.

## Notes

### `GET /api/notes?path=journal/a.md`

Returns the note body and revision.

```json
{
  "path": "journal/a.md",
  "content": "# Hello\n",
  "revision": 3,
  "updatedAt": "2026-01-02T10:00:00Z",
  "conflict": false
}
```

### `PUT /api/notes`

Writes the note body. The server writes to a temporary file in the same
directory and renames it over the target, then updates the database and the
search index.

```json
{ "path": "journal/a.md", "content": "# Hello\n", "revision": 3 }
```

Response `200`:

```json
{ "path": "journal/a.md", "revision": 4, "updatedAt": "2026-01-02T10:05:00Z" }
```

* If `revision` is non-zero and differs from the stored revision the write is
  rejected with `409 revision_conflict` and the envelope carries `current`.
* A `revision` of `0` means "force write" and is used by import.

### `POST /api/notes/rename`

```json
{ "path": "a.md", "newName": "b.md" }
```

Response `200` with the updated `Node`. Renaming a folder moves the whole
subtree. Duplicate sibling names fail with `duplicate_name`; illegal names
fail with `invalid_name`.

### `POST /api/notes/move`

```json
{ "path": "a.md", "newParentPath": "journal" }
```

Response `200` with the updated `Node`. Moving a folder into itself or into
one of its descendants fails with `invalid_path`.

### `POST /api/notes/duplicate`

```json
{ "path": "journal/a.md" }
```

Copies the note next to the original and answers `200` with the `Node` of the
copy. The name of the copy is derived from the name of the original: `a.md`
becomes `a copy.md`; when the name is taken, a number is added (`a copy 2.md`,
`a copy 3.md`, …). The content of the copy is identical, the original stays
untouched. A path that does not exist fails with `not_found`, a folder fails
with `invalid_path`.

### `DELETE /api/notes?path=journal/a.md`

Moves the entry (or a whole folder subtree) to the trash directory.

Response `200`:

```json
{ "ok": true }
```

### `POST /api/notes/restore`

Restores a trashed entry.

```json
{ "trashPath": "trash/xxx/a.md" }
```

Response `200` with the restored `Node`.

### `GET /api/trash`

```json
{ "entries": [ { "path": "trash/xxx/a.md", "name": "a.md", "type": "file", "id": "…", "size": 42, "parentPath": "trash/xxx", "modTime": "2026-01-02T10:00:00Z", "revision": 3, "createdAt": "2026-01-01T09:00:00Z", "updatedAt": "2026-01-02T10:00:00Z" } ] }
```

## Storage of the notes

### `GET /api/vault`

Returns the state of the storage of the notes.

```json
{ "configured": true, "path": "D:\\Notes", "notesDir": "D:\\Notes", "fixed": false, "mode": "open" }
```

`path` is empty when the default layout is used and the storage was not fixed
by the environment. `fixed` reports that the storage cannot be changed at
runtime (the variable `NOTO_VAULT_FIXED` is set). `mode` is the mode of the
storage: `open` — the notes are plain Markdown files, `sealed` — the client
encrypts everything and the server stores only ciphertext. See
[`docs/VAULT.md`](VAULT.md) for the whole model and
[`docs/ENCRYPTION.md`](ENCRYPTION.md) for the cryptography.

### `POST /api/vault`

```json
{ "path": "D:\\Notes" }
```

Chooses the folder with the notes: the path is validated, the configuration is
saved and the server switches to the new folder. Response `200`:

```json
{ "ok": true, "path": "D:\\Notes" }
```

Errors: `400 bad_request` (no path), `400 invalid_path` (the path is not
usable), `404 not_found` (there is no such directory), `500 internal` (the
storage could not be opened; the saved configuration is restored).

When the storage was fixed by the environment (`NOTO_VAULT_FIXED`), the request
is refused with `400 vault_fixed` and the message `the storage is fixed by the
environment`. The dedicated code lets the application tell "it is not allowed"
from "something went wrong": the client shows the fixed storage as a normal
state and never as an error banner.

The variables `NOTO_DATA_DIR` and `NOTO_NOTES_DIR` only choose the default
location of the data and of the notes; they do not fix the storage.

### `DELETE /api/vault`

Resets the configuration and returns the server to the default layout.
Response `200`:

```json
{ "ok": true }
```

### `GET /api/vault/browse?path=D:\\`

Lists the subdirectories of a folder, for the dialog of the choice of the
folder.

```json
{ "path": "D:\\", "parent": "", "dirs": [ { "name": "Notes", "path": "D:\\Notes" } ] }
```

Only the directories are returned, the hidden ones are not. An empty `path`
means the root of the volume. A path that does not exist fails with
`400 bad_request`.

## Sealed mode (encrypted storage)

In the sealed mode the client encrypts everything in the browser before the
bytes reach the server. The server becomes a blind object store: it keeps the
bytes under an identifier, it does not know the key and it does not parse the
container. The cryptography is described in
[`docs/ENCRYPTION.md`](ENCRYPTION.md); the model of the storage — in
[`docs/VAULT.md`](VAULT.md).

Two rules define the mode:

* **Only one path is used at a time.** In the open mode the application works
  through the ordinary endpoints of the notes (`/api/tree`, `/api/notes`, …);
  in the sealed mode it works only through the endpoints below. The two are
  never mixed.
* **The open endpoints are refused.** As soon as the vault is sealed, every
  endpoint of the open pipeline answers `409` with the code `vault_sealed` and
  the message `the vault is sealed: the notes are encrypted by the client and
  the server stores only ciphertext`. The server therefore never writes a
  plaintext file, not even by accident.

The endpoints below are registered in all modes, but they only carry data in
the sealed mode.

### `GET /api/vault/sealed/status`

The state of a sealed vault.

```json
{ "mode": "sealed", "format": 1, "objectCount": 42, "generations": [7, 6, 5] }
```

- `mode` — the mode of the storage (`sealed`);
- `format` — the version of the layout of the sealed vault (currently `1`);
- `objectCount` — the number of the stored objects;
- `generations` — the generations of the stored manifests, newest first.

When the vault is not sealed the endpoint answers `404 not_found` with the
message `the vault is not sealed`.

### `GET /api/vault/sealed/keystore`

The keystore of the client: the parameters of the KDF, the epochs with their
wrapped data keys and the optional block of the recovery key. The answer is
`200` with `Content-Type: application/json` and the keystore as it is stored.

The keystore holds **no key in the clear**: only the wrapped copies of the data
key. A missing keystore answers `404 not_found`.

### `PUT /api/vault/sealed/keystore`

Writes the keystore. The body is the keystore JSON, unchanged. Response `204`.

Limits: the body must not exceed 1 MiB, otherwise `413 payload_too_large`.

### `GET /api/vault/sealed/objects`

The identifiers of the stored objects.

```json
{ "ids": ["3f2c1ab7…", "9d41e0c5…"] }
```

An identifier is 32 lowercase hexadecimal characters (16 random bytes) and
never depends on the content.

### `GET /api/vault/sealed/objects/{id}`

The bytes of the object. Response `200` with
`Content-Type: application/octet-stream` and the raw ciphertext (the container
of the client, header included).

Errors: `400 bad_request` (the identifier must be 32 lowercase hexadecimal
characters), `404 not_found` (there is no such object).

### `PUT /api/vault/sealed/objects/{id}`

Writes the bytes of the object. The body is the raw ciphertext, unchanged.
Response `204`.

Errors: `400 bad_request` (the identifier must be 32 lowercase hexadecimal
characters), `413 payload_too_large` (the body is bigger than 64 MiB).

### `DELETE /api/vault/sealed/objects/{id}`

Removes the object. Response `204`.

### `GET /api/vault/sealed/manifests`

The generations of the stored manifests.

```json
{ "generations": [7, 6, 5] }
```

### `GET /api/vault/sealed/manifests/{gen}`

The bytes of the manifest of the generation. Response `200` with
`Content-Type: application/octet-stream`.

The manifest is sealed like everything else: it carries the tree, and the tree
is the only place where the names of the notes live.

Errors: `400 bad_request` (the generation must be a positive integer),
`404 not_found`.

### `PUT /api/vault/sealed/manifests/{gen}`

Writes the bytes of the manifest of the generation. The body is the raw
ciphertext. Response `204`.

The order of the write is the order of the client: first the objects, then the
manifest. A crash may leave an orphan object, but never a manifest that refers
to an object that does not exist.

### `DELETE /api/vault/sealed/manifests/{gen}`

Removes the manifest of the generation. Response `204`.

### `POST /api/vault/sealed/enable`

Switches the server into the sealed mode: the mode of the vault is written to
the configuration file of the store and the server starts to refuse the open
endpoints with `409 vault_sealed`. Response `204`.

The endpoint does **not** delete or move any plaintext file: the migration of
the plaintext is the business of the client, which removes it only after it has
verified its own copy.

### `POST /api/vault/sealed/purge-plaintext`

Removes the plaintext files of the vault. Response `200`:

```json
{ "deleted": 128, "bytes": 48312 }
```

The server deletes every regular file under the notes directory, except the
files of the internal directory of the vault (the sealed objects, the manifests
and the keystore live there), and removes the folders that became empty: a
folder name is a part of the metadata of the storage and must not stay in the
clear.

The call cannot be undone, so it happens only after the client verified its
copy and the user confirmed it. When the vault is not sealed the endpoint
answers `400 bad_request` with the message `the vault is not sealed: there is
nothing to purge`.

## Search

### `GET /api/search?q=term&limit=50`

```json
{
  "hits": [
    { "path": "journal/a.md", "name": "a.md", "kind": "content", "snippet": "…the matching term…" }
  ]
}
```

An empty `q` returns `{"hits":[]}` with status `200`.

### `POST /api/search/reindex`

Rebuilds the search index from the files on disk.

Response `200`:

```json
{ "indexed": 128 }
```

## Query (the query language)

The language itself is described in [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md).
The two endpoints below are the server side of the language: the encrypted
storage answers the same questions in the browser.

### `POST /api/query`

Body:

```json
{ "query": "tag == 'work' && folder != ''", "limit": 50 }
```

Response `200`:

```json
{
  "hits": [
    { "path": "journal/a.md", "name": "a.md", "kind": "query", "snippet": "" }
  ],
  "total": 12,
  "partial": false
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `hits` | `SearchHit[]` | the notes that match the query |
| `total` | number | the number of the matching notes, before the limit |
| `partial` | boolean | `true` when the derived properties of some notes could not be recalculated, so the answer may be incomplete |

An empty query answers `{"hits":[],"total":0,"partial":false}` with status
`200`. A broken query answers `400` with the envelope of the error and the
message of the parser (`unknown field: colour`, `unknown operator: ~`,
`expected a value`, …).

The operator `matches` (and the prefix form `match:`) looks for a regular
expression in the text of a note. A broken expression answers `400` with the
message `invalid regular expression: <reason>`. The backend compiles it with
RE2, the browser with the `RegExp` of JavaScript — the grammar, the fields
and the limits are in [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md) §3.

### `GET /api/tags`

Response `200`:

```json
{ "tags": [ { "tag": "work", "count": 12 }, { "tag": "home", "count": 3 } ] }
```

The tags are sorted by their count (the biggest first) and then by their name.

## Import and export

### `POST /api/import/files`

`multipart/form-data`:

| Field | Type | Notes |
| --- | --- | --- |
| `files` | file (repeatable) | one or more Markdown files |
| `targetPath` | string | optional destination folder |
| `conflict` | string | `skip` (default), `rename` or `overwrite` |

Response `200` with an `ImportResult`.

### `POST /api/import/zip`

`multipart/form-data`:

| Field | Type | Notes |
| --- | --- | --- |
| `file` | file | the zip archive |
| `targetPath` | string | destination folder |
| `conflict` | string | `skip` (default), `rename` or `overwrite` |

Response `200` with an `ImportResult`.

Archive entries with absolute paths, `..` segments or symlinks are rejected,
the total uncompressed size is capped by `NOTO_MAX_ARCHIVE_MB` and the number
of entries is capped.

### `GET /api/export/note?path=a.md`

Returns the note as a `text/markdown` attachment.

### `GET /api/export/folder?path=journal`

Returns the folder as a `application/zip` attachment.

### `GET /api/export/all`

Returns the whole notes tree as a `application/zip` attachment.

## Attachments

### `POST /api/attachments`

`multipart/form-data`:

| Field | Type | Notes |
| --- | --- | --- |
| `file` | file | the binary to store |
| `notePath` | string | optional note the attachment belongs to |

The content type is sniffed from the bytes with `http.DetectContentType`; only
`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`,
`application/pdf` and `text/plain` are accepted. The stored file name and the
stored mime type are generated server side — the client values are not
trusted. The size limit is `NOTO_MAX_UPLOAD_MB`.

Response `200` with the `Attachment`:

```json
{ "id": "3f9a…", "name": "image.png", "mime": "image/png", "size": 12345, "createdAt": "2026-01-02T10:00:00Z" }
```

### `GET /api/attachments`

```json
{ "attachments": [ { "id": "3f9a…", "name": "image.png", "mime": "image/png", "size": 12345, "createdAt": "2026-01-02T10:00:00Z" } ] }
```

### `GET /api/attachments/{id}/raw`

Returns the raw bytes with the stored mime type.

### `DELETE /api/attachments/{id}`

Response `200`:

```json
{ "ok": true }
```

### `POST /api/attachments/search`

The full-text search over the text inside the attachments (the text of a
`text/plain`, a `text/markdown`, a `.md` and a `.txt` file is indexed when the
file is uploaded).

Request:

```json
{ "query": "release notes", "limit": 50 }
```

Response `200`:

```json
{
  "hits": [
    { "noteId": "…", "notePath": "journal/a.md", "attachmentId": "3f9a…", "name": "notes.txt", "mime": "text/plain", "snippet": "…release notes…" }
  ]
}
```

An empty query is refused with `400 bad_request`.

### `GET /api/attachments/{id}/content`

The raw bytes with the real content type — the source of the preview of an
image.

### `POST /api/attachments/{id}/preview`

Response `200`:

```json
{ "mime": "image/png", "width": 1280, "height": 720, "url": "/api/attachments/3f9a…/content" }
```

The size of an image is read from the bytes; a file that is not an image gives
`0` and `0`.

## The versions of a note

### `GET /api/notes/versions?path=journal/a.md`

```json
{ "versions": [ { "path": "journal/a.md", "revision": 3, "title": "A", "content": "…", "createdAt": "2026-01-02T10:00:00Z" } ] }
```

### `GET /api/notes/versions/diff?path=journal/a.md&from=2&to=3`

```json
{ "path": "journal/a.md", "from": 2, "to": 3, "lines": [ { "kind": "context", "text": "…", "fromLine": 12, "toLine": 12 } ] }
```

The kinds are `context`, `added` and `removed`. The line numbers are 1-based;
`0` means that the line does not exist on that side.

### `POST /api/notes/versions/restore`

Request `{"path": "journal/a.md", "revision": 3}` → the note content. The
restore is a new write, so the revision grows. The restore is written into the
audit log.

## Authentication, accounts, audit, webhooks, MCP

These endpoints exist when the authentication is enabled
(`NOTO_AUTH_ENABLED=true`). Without it the local single-user mode keeps
working and every request is served as the local user `local` (role `admin`).

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /api/auth/login` | `{"name":"…","password":"…"}` | `{"token":"…","user":User,"expiresAt":"RFC3339"}` |
| `POST /api/auth/logout` | — | `{"ok":true}` |
| `GET /api/auth/me` | — | `{"user":User,"authenticated":bool}` |
| `GET /api/users` | — | `{"users":[User]}` (administrator) |
| `POST /api/users` | `{"name":"…","password":"…","role":"admin\|user"}` | `User` (administrator) |
| `DELETE /api/users/{id}` | — | `{"ok":true}` (administrator) |
| `POST /api/users/{id}/role` | `{"role":"admin\|user"}` | `User` (administrator) |
| `GET /api/audit?limit=100` | — | `{"entries":[Entry]}` (administrator) |
| `GET /api/webhooks` | — | `{"subscriptions":[Subscription]}` |
| `POST /api/webhooks` | `{"url":"https://…","events":["note.created"]}` | `Subscription` (with the secret) |
| `DELETE /api/webhooks/{id}` | — | `{"ok":true}` |
| `GET /api/webhooks/deliveries?limit=100` | — | `{"deliveries":[Delivery]}` |
| `POST /api/webhooks/deliveries/{id}/redeliver` | — | `{"ok":true}` |
| `POST /api/mcp` | a JSON-RPC 2.0 request | the raw JSON of the protocol |

`User` is `{"id","name","role","createdAt"}`. `Entry` is
`{"id","time","user","action","target","result"}` — never the content of a
note. `Subscription` is `{"id","owner","url","events","secret","createdAt"}`;
the secret is empty in every answer but the creation. `Delivery` is
`{"id","subscriptionId","event","payload","state","attempts","nextAttempt","lastError","createdAt"}`.

The credentials travel with the header `Authorization: Bearer <token>` or with
the cookie `noto_session`.

The MCP endpoint speaks JSON-RPC 2.0: the methods are `initialize`,
`tools/list` and `tools/call`, the tools are `notes.list`, `notes.read`,
`notes.create`, `notes.update`, `notes.delete` and `notes.search`.

## Maintenance

The maintenance endpoint is **not part of the normal route contract**. It is
registered only when the server was started with the environment variable
`NOTO_MAINTENANCE=1`; otherwise `POST /api/maintenance/reconcile` is not
registered at all and the request answers `404` with the usual error envelope
(`{"error":{"code":"not_found","message":"unknown endpoint"}}`).

### `POST /api/maintenance/reconcile`

Compares the notes directory with the metadata rows of the database.

The body is optional. Without a body the call only produces the report and
changes nothing.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `apply` | boolean | `false` | Create the metadata rows of the files that have no row. |
| `dropGhosts` | boolean | `false` | Delete the metadata rows whose file no longer exists. |

`dropGhosts` alone deletes the rows without a file; it is never done
implicitly.

```json
{ "apply": true, "dropGhosts": true }
```

Response `200`:

```json
{
  "missingInDB": [ "journal/day2.md" ],
  "missingOnDisk": [ "journal/gone.md" ],
  "metadataDrift": [ "journal/day1.md: updatedAt differs" ],
  "checked": 128,
  "restored": [ "journal/day2.md" ],
  "dropped": [ "journal/gone.md" ],
  "indexed": [ "journal/day2.md" ],
  "notes": []
}
```

* `missingInDB` — the files that exist on the disk but have no row in the
  `notes` table,
* `missingOnDisk` — the rows of the `notes` table whose file is gone (the
  "ghosts"),
* `metadataDrift` — the descriptions of the metadata that differs between the
  disk and the database,
* `checked` — the number of the compared entries of the notes directory,
* `restored`, `dropped`, `indexed` — what the run actually changed (they stay
  empty for a report without flags),
* `notes` — the human readable remarks of the run.

The trash is not part of the comparison, and junctions and symbolic links
inside the notes directory are skipped.

## Static frontend

* `GET /` and every unknown route that does not start with `/api` return the
  SPA `index.html` (SPA fallback).
* The frontend is served from the assets embedded in `internal/web` when
  `NOTO_STATIC_DIR` is unset. Set `NOTO_STATIC_DIR` to serve a directory on
  disk instead.

## Security behaviour of the API

These rules are implemented by the server (see `docs/CONTRACT.md` section 5
and `docs/SECURITY.md`):

* The server binds `127.0.0.1:8080` by default. A non-loopback bind address
  requires `NOTO_ALLOW_PUBLIC=true`, otherwise the server refuses to start.
* No `Access-Control-Allow-Origin` header is sent unless the request `Origin`
  is listed in `NOTO_ALLOWED_ORIGINS`.
* State-changing requests carrying a foreign `Origin` are rejected with
  `403 forbidden`.
* `Host` must be `localhost`, `127.0.0.1`, `::1` or an explicitly allowed
  host.
* Every response carries `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin` and a restrictive
  `Content-Security-Policy`.
* Request bodies are limited by `http.MaxBytesReader`.
* Errors never contain stack traces or absolute server paths, and note
  contents are never logged.
