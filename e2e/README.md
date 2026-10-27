# Noto — End-to-End Tests

Playwright end-to-end tests for the Noto Markdown notes PWA.

## What is covered

| Spec | Requirement |
| --- | --- |
| `e2e/specs/smoke.spec.ts` | The app loads, `GET /api/health` answers, the empty state is visible. |
| `e2e/specs/notes.spec.ts` | Create a folder, create a note inside it, the note shows up in the tree; rename the note and move it to another folder. |
| `e2e/specs/editor.spec.ts` | Type Markdown (including Cyrillic), wait for the autosave (`Saved`), reload and verify the content persisted. The preview never executes injected `<script>` / `onerror` payloads. |
| `e2e/specs/search.spec.ts` | `Ctrl+K` opens the search overlay, a hit shows up and clicking it opens the note. |
| `e2e/specs/import-export.spec.ts` | Import a ZIP archive through the UI, export a folder and verify the downloaded file is a valid ZIP containing `Imported/note.md`. |
| `e2e/specs/responsive.spec.ts` | Mobile: the sidebar is a drawer, opening it works, the editor uses the screen width; no horizontal overflow in any layout. |
| `e2e/specs/offline.spec.ts` | Offline: the app shell is served from the service worker cache, the offline indicator appears and disappears again. |
| `e2e/specs/origin.spec.ts` | Regression spec for the backend origin check (see “Known application bugs”). |

## Running

```powershell
cd E:\Code\Software\noto
npm install          # once
npx playwright test  # both projects (desktop + mobile)
```

Useful variations:

```powershell
npx playwright test --project=desktop
npx playwright test --project=mobile
npx playwright test e2e/specs/editor.spec.ts
npx playwright show-report e2e\playwright-report   # HTML report
```

## Server topology

`frontend/src/api/client.ts` uses a **relative** API base (`const API_BASE = '/api'`), so the
SPA and the API have to share an origin. `frontend/vite.config.ts` defines no `/api` dev
proxy (and this agent may not edit it), therefore the Vite dev/preview server cannot be
used for the API calls.

The Go backend already serves the built SPA (`backend/internal/web/dist`, filled by
`frontend/scripts/copy-dist.mjs`) with an SPA fallback, so **the whole application is
driven through one origin**: `http://127.0.0.1:8099`.

`playwright.config.ts` therefore starts a single `webServer`:

```
node ../e2e/scripts/build-frontend.mjs && "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" run ./cmd/noto
  cwd: backend
  NOTO_ADDR=127.0.0.1:8099
  NOTO_DATA_DIR=%TEMP%\noto-e2e\<run id>   (a fresh directory per run)
  NOTO_ALLOW_PUBLIC=false
```

The build of the bundle is part of the command of the server, and not a step of the
global setup: Playwright starts the servers **before** the global setup, and the Go
server embeds `backend/internal/web/dist` at compile time. A build that happens later
therefore leaves the running server with the *previous* bundle, and the suite reports
failures that have nothing to do with the change under test. `e2e/scripts/build-frontend.mjs`
guards the build with a lock in the temporary folder, because the two servers of the
configuration may start at the same time.

> Note: the Playwright version used here only honours the `command` property of
> `webServer` (it is executed through a shell), so the arguments are part of the command
> string — the separate `args` property is silently ignored.

Every run uses its own data directory under the OS temp folder, so repeated runs do not
collide with notes left over from a previous run.

## Browser installation

`npx playwright install chromium` **fails in this environment**:

```
Error: Download failed: server returned code 403 body
'<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code>
<Message>Access denied.</Message><Details>We're sorry, but this service is not
available in your location</Details></Error>'
URL: https://cdn.playwright.dev/builds/cft/156.0.8078.4/win64/chrome-headless-shell-win64.zip
```

The Playwright CDN is not reachable from this network. A matching **full** Chromium build
(`chromium-1248`) is already present in the local Playwright cache
(`%LOCALAPPDATA%\ms-playwright`), only the separate *headless shell* download fails.
`playwright.config.ts` therefore sets `channel: 'chromium'`, which selects the full
Chromium build (new headless mode) instead of the missing headless shell:

```powershell
npx playwright install chromium   # optional, only needed on a fresh machine
```

If the browser is missing entirely, install it with the command above; on a machine
without access to the Playwright CDN, point `channel` to a locally installed browser
(`channel: 'chrome'` or `channel: 'msedge'`).

## Generated files

* `e2e/fixtures/import.zip` — the ZIP import fixture, (re)created by `e2e/global-setup.ts`
  from `e2e/fixtures/make-fixture.ts` before every run.
* `e2e/.artifacts/` — Playwright `outputDir` (traces, screenshots of failed tests).
* `e2e/playwright-report/` — the HTML report.

These three are build artefacts; the repository `.gitignore` is owned by another agent and
does not cover them yet, so they may show up as untracked files.

## Known application bugs

The following failures are **application bugs**, not test problems. They are kept in the
suite on purpose so that they stay visible until they are fixed.

### 1. Opening a note triggers a spurious autosave

`frontend/src/components/Editor.tsx:112-118` — the update listener tries to ignore
programmatic document changes:

```ts
const external = update.transactions.some((tr) => tr.annotation(EXTERNAL));
if (external) return;
```

`EXTERNAL.of(null)` stores the value `null` and `Transaction.annotation(type)` returns
that value, so the truthiness check in `some()` never matches. The guard is therefore
inactive and every programmatic replacement of the document (opening or switching a
note) is reported to the application as a user edit.

*Consequences:* the status indicator shows "Unsaved changes" for a note that was not
edited, and the app issues a redundant `PUT /api/notes` (and an IndexedDB draft) for it.
`e2e/specs/editor.spec.ts` ("opening a note does not trigger a save request") fails until
the annotation is created with a truthy value (`EXTERNAL.of(true)`) or the check is
changed to `tr.annotation(EXTERNAL) !== undefined`.

### 2. The hamburger button is visible on desktop

`frontend/src/styles.css:108-110` defines `.menu-button { display: none; }`, but
`frontend/src/styles.css:155-167` defines `.icon-button { display: inline-flex; }`.
Both selectors have the same specificity and `.icon-button` comes later in the file, so
the later rule wins and the hamburger stays visible above the 820px breakpoint.
`e2e/specs/responsive.spec.ts` ("the hamburger button is hidden above the 820px
breakpoint") fails until the rule is made more specific (e.g. `.icon-button.menu-button`)
or moved after `.icon-button`.

## Test results

`npx playwright test` (both projects) on this machine:

```
14 passed
10 skipped   (the tree/editor/search/import-export specs are desktop only)
 2 failed    (exactly the two application bugs documented above)
```

The two failing tests are the ones that document the bugs; they are expected to fail
until the frontend is fixed.

## Bugs that were found by this suite and fixed in the meantime

* **Same origin writes were rejected (`403 forbidden`).**
  `backend/internal/api/middleware.go` — `originCheck` rejected every state changing
  request whose `Origin` header was not listed in `NOTO_ALLOWED_ORIGINS`. The server's
  *own* origin was not part of that list, so the SPA could not create folders or notes,
  could not autosave, rename, move, import or delete anything
  (`POST /api/folders -> 403 {"error":{"code":"forbidden","message":"the origin is not allowed"}}`).
  `CONTRACT.md` section 5 only requires *foreign* origins to be rejected.
  The backend now accepts same origin requests (`sameOrigin()` in `middleware.go`).
  `e2e/specs/origin.spec.ts` starts a **second** backend with the default configuration
  and asserts that a same origin write succeeds — it now passes and guards the fix.
