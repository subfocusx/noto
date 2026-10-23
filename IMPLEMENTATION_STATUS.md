# IMPLEMENTATION_STATUS — Noto (Markdown Notes PWA)

Last updated: 2026-10-23. Status legend: **done** (implemented and verified here) ·
**partial** (implemented, some part unverified) · **planned**.

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
│     ├─ api           HTTP handlers, router, security middleware
│     ├─ web           SPA / static serving (embedded dist or NOTO_STATIC_DIR)
│     └─ testutil      in-memory store + test helpers
├─ frontend/           Preact + TypeScript(strict) + Vite + CodeMirror 6
├─ e2e/                Playwright end-to-end suite
├─ docs/               CONTRACT.md (authoritative), API.md, SECURITY.md
└─ scripts/            dev / build / test / backup / smoke PowerShell helpers
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

* `go test -race` needs cgo. On this machine it runs with
  `CGO_ENABLED=1` and `C:\msys64\mingw64\bin` on `PATH`; without a C compiler
  the race detector cannot start.
* The application has no user accounts. It binds to `127.0.0.1` by default and
  refuses to start on a public address unless `NOTO_ALLOW_PUBLIC=true`.
  A public deployment must be protected by a VPN or an authenticating reverse proxy.
* Offline support is an app-shell + cached-read foundation with local draft
  recovery; there is no automatic background synchronisation of pending edits.
* The Windows toolchain used here lives in `.tools/goroot`; on a normal machine
  install Go 1.23+ from go.dev and use `go` directly.
* `npx playwright install chromium` is blocked by the Playwright CDN from this
  network; the E2E config falls back to the locally cached full Chromium build
  (`channel: 'chromium'`). On a normal machine install the browser normally.
* The export endpoints buffer the archive in memory; for very large libraries a
  temporary file would be preferable.
* The security audit used a proof-of-concept that created three throwaway files
  outside the repository (`C:\Windows\evil.md`, `C:\Windows\small.md`,
  `C:\Windows\pwned_dir`). The sandbox refuses to delete anything under
  `C:\Windows`; remove them manually with an elevated shell.
