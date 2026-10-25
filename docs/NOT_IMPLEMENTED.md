# What is not implemented yet

The list of everything that the repository claims and does not deliver, over
all the phases. Every line points at the place that declares it, so the list
can be checked against the code instead of being trusted.

The rule of the repository: **the code is the truth**. A point that is
written here and is implemented in the code is a defect of this document;
a point that is not written here but is missing in the code is a defect of
the code.

Two groups:

* **(A) not written at all** — the function does not exist;
* **(B) written, with a limitation** — the function exists, but it does not
  do what the user expects.

Status: `not started` · `partial` · `deferred by decision` · `draft`.

The list was reconciled with the code on 2026-10-25, after the batch of the
features of that day (the versions of the notes, the regular expressions of
the query language, the authentication, the webhooks, the MCP, the
localisation, the offline queue and the rest). The points that were closed by
that batch left this list; the ones that are still here survived it.

---

## (A) Not written at all

### The server and the platform

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A1 | The end-to-end encryption between the browser and the server: the sealed storage encrypts the files in the browser, but the traffic between the browser and the server is only protected by the TLS of the server | `README.md` (§ Known limitations and roadmap), `docs/ENCRYPTION.md` | not started | L |
| A2 | The native Android wrapper: the mobile answer today is the installed PWA | `README.md` (§ Known limitations and roadmap) | not started | L |
| A3 | The purge of the drafts: a draft is deleted when the note is saved, but nothing removes the drafts of the notes that were deleted or that were never saved | `frontend/src/lib/drafts.ts`, `frontend/src/core/store/actions.ts` | not started | S |

---

## (B) Written, with a limitation

| # | What | The limitation | Where it is declared |
|---|---|---|---|
| B1 | The regular expressions in the query language | The operator `matches` and the prefix `match:` work in the backend (RE2) and in the browser (the `RegExp` of JavaScript), but **the two engines are not the same**: RE2 has no back reference and no look around, and JavaScript has. The golden vectors hold only the expressions that both engines understand | `docs/QUERY_LANGUAGE.md` §3, `backend/internal/query/regex.go`, `frontend/src/core/query/regex.ts`, `shared/vectors/regex.json` |
| B2 | The notifications | They live in the `localStorage` of the browser and survive a reload, but they belong to the browser of the user, not to the vault: the server knows nothing about them and delivers nothing | `frontend/src/core/notifications/persistence.ts` |
| B3 | The reminders | The same: the browser shows a reminder whose moment has passed when the tab is opened again, the server neither stores nor delivers them | `frontend/src/core/reminders/` |
| B4 | The several storages at the same time | The registry keeps the state of every storage in the memory of the browser, but the server still serves **one** storage at a time: the tree of a storage that was opened before is restored from the registry and not read again | `frontend/src/core/storages/`, `PHASE14_PLAN.md` §8 |
| B5 | The paged listing of the tree | The domain and the store answer one page of the children of a folder (`notes.Children`, `port.Store.ListChildrenPaged`), the server answers it too (`GET /api/tree/children`, with the cursor and the limit) and the client has `getTreePage`, but the **interface still asks for the whole tree**: the pages are never requested | `backend/internal/notes/paged.go`, `backend/internal/api/handlers_notes.go`, `frontend/src/api/tree.ts` |
| B6 | The plugins | The built-in plugins still run as trusted code in the context of the application; the sandbox (an iframe with a strict CSP) belongs to the plugins that are installed from a disk or from a network, and the declared rights of a plugin do not cover the network calls it makes itself | `frontend/src/plugins/sandbox.ts`, `docs/PLUGIN_SECURITY.md` |
| B7 | The mobile adaptation | Partially: the drawer answers to the touch, the panels and the editor fit a narrow screen; the shell is still the shell of the desktop | `PHASE14_PLAN.md` §8 |
| B8 | The search | The `LIKE` fallback when the SQLite build has no FTS5: slower and less exact | `README.md` (§ Known limitations and roadmap), `backend/internal/sqlitestore/search.go` |
| B9 | The name of a note | Not limited in length, control characters are allowed (except NUL), on purpose: an existing file on the disk is never rejected | `README.md` (§ Known limitations and roadmap), `IMPLEMENTATION_STATUS.md` (§ Known limitations) |
| B10 | The trash | The shortcut is `Ctrl+Alt+D`, not `Ctrl+Alt+T` (a deliberate deviation) | `IMPLEMENTATION_STATUS.md` (§ Known limitations) |
| B11 | The storage fixed by the environment | The button stays, marked `aria-disabled`, and it explains itself: the column and the menu say why, and the banner repeats the reason. The storage itself cannot be changed while the server runs | `PHASE14_PLAN.md` §8, `frontend/src/core/storages/fixedStorage.ts` |
| B12 | The mobile shell | The PWA, not a native application | `README.md` (§ Known limitations and roadmap) |
| B13 | The Docker image | Docker is not installed on this machine: the image has never been built here; the Dockerfile and the build context were checked by hand | `IMPLEMENTATION_STATUS.md` (§ Known limitations) |
| B14 | The creation time of the notes that were written before the column existed | The migration of the schema (version 3) fills `created_at` with the modification time of the note: for those notes the moment of the creation is an approximation, not a fact | `backend/internal/sqlitestore/store_schema.go` |

---

## The stale texts (they say more than the code does)

These lines of the documentation are **outdated**: the code does more than the
text says. They are listed here so that nobody takes them for a gap.

The list was reconciled with the code on 2026-10-25 and no stale line is known
at that moment: the texts that said «the regular expressions are not
supported», «there is no history of the versions», «there are no user
accounts», «the plugins have no sandbox» and «the export is buffered in the
memory» were corrected in the same change. A text that says more than the
code must be listed here in the same change that makes it stale.

---

## The order of the work

The points are not of the same weight. The ones that the user asked for
most often are at the top.

1. **A1** — the end-to-end encryption between the browser and the server: it
   changes the protocol of the API and the model of the storage.
2. **A2** — the native Android wrapper: it needs its own build of the PWA and
   a place in the store of the applications.
3. **A3** — the purge of the drafts: it is small, but it touches the storage of
   the browser and the moments of the saving.
4. **B4** and **B5** — the storages at the same time and the paged tree: both
   need the server to serve more than one storage and one page at a time.

The other points are deliberate: they are written down so that nobody expects
more than the repository delivers.
