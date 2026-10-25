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

---

## (A) Not written at all

### The editor and the notes

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A1 | The history of the versions of a note and the diff | `IMPLEMENTATION_STATUS.md:378`, `README.md:1103` | not started | — |
| A2 | The highlighting of the matches in the editor | `IMPLEMENTATION_STATUS.md:279`, `PHASE8_PLAN.md:105` | not started | — |
| A3 | The autocompletion of the tags | `IMPLEMENTATION_STATUS.md:279`, `PHASE8_PLAN.md:105` | not started | — |
| A4 | The focus mode | `IMPLEMENTATION_STATUS.md:279`, `PHASE8_PLAN.md:106` | not started | — |
| A5 | The undo of a deletion (a toast of five seconds) | `IMPLEMENTATION_STATUS.md:280`, `docs/design/README.md:34` | draft | S |
| A6 | The card of a note | `IMPLEMENTATION_STATUS.md:280`, `PHASE8_PLAN.md:106` | not started | — |
| A7 | The synchronisation of the filter with the URL | `IMPLEMENTATION_STATUS.md:280`, `PHASE8_PLAN.md:107` | not started | — |
| A8 | The drop of a file into the editor and the reset of a draft | `PHASE8_PLAN.md:105` | not started | S |
| A9 | The formulas and the highlighting of the code in the Markdown | `PHASE14_PLAN.md:111` | not started | M |
| A10 | The footnotes and the presentations in a note | `PHASE14_PLAN.md:108` | not started | S / M / L |
| A11 | The recording of the sound | `PHASE14_PLAN.md:107` (`MediaRecorder` is nowhere in the repository) | not started | M |
| A12 | The preview of the attachments (images) | `frontend/src/components/AttachmentsPanel.tsx:64`, `README.md:1107` | not started | M |
| A13 | The full-text search over the attachments | `README.md:1142` | not started | — |
| A14 | The cache of the derived properties of a note with the flag `stale` | `docs/design/README.md:32` | draft | — |

### The tree and the interface

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A15 | The graph of the notes and the archive (the two buttons of the header are honest stubs) | `frontend/src/components/sections/ExplorerSection.tsx:380-396`, `IMPLEMENTATION_STATUS.md:168` | not started | L |
| A16 | The pinning of the notes at the top of the tree | `PHASE14_PLAN.md:112` | not started | M |
| A17 | The quick notes (a note without a name and without a folder) | `PHASE14_PLAN.md:109` | not started | S |
| A18 | The time of the creation, shown in the interface | `PHASE14_PLAN.md:117` | not started | S |
| A19 | The user-defined templates (only the built-in `insert-template` exists) | `PHASE14_PLAN.md:105` | not started | M |
| A20 | The redesign of the right panel (the outline) | `IMPLEMENTATION_STATUS.md:381`, `PHASE10_PLAN.md:145` | not started | — |
| A21 | The section `H` in its full form (the versions) | `PHASE10_PLAN.md:146` | not started | — |
| A22 | The several storages at the same time (as in SiYuan) | `docs/UI_AUDIT.md:288` | not started | — |
| A23 | The graph of the activity instead of the banner | `docs/UI_AUDIT.md:284` | not started | — |
| A24 | The server-side pagination and the lazy loading of the tree | `README.md:1109`, `README.md:1141` | not started | — |
| A25 | The translation of the interface into Russian | `IMPLEMENTATION_STATUS.md:322`, `PHASE9_PLAN.md:98` | not started | L |

### The server and the automation

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A26 | The webhooks (an outbox in SQLite, `notes.Hook`, the routes) | `PHASE14_PLAN.md:113`, `IMPLEMENTATION_STATUS.md:642` | not started | L |
| A27 | The MCP over HTTP (JSON-RPC 2.0) | `PHASE14_PLAN.md:114`, `IMPLEMENTATION_STATUS.md:642` | not started | M |
| A28 | gRPC | `PHASE14_PLAN.md:115` | deferred by decision | L |
| A29 | The authentication, the accounts, the multi-user | `README.md:1101` | not started | L |
| A30 | The audit log on the server | `README.md:1103`, `docs/PLUGIN_SECURITY.md:307` | not started | — |
| A31 | The end-to-end encryption between the browser and the server | `README.md:1143` | not started | L |
| A32 | The TLS termination in the server | `README.md:1102` | not started | — |
| A33 | The native Android wrapper | `README.md:1130`, `README.md:1144` | not started | — |

### The platform of the plugins

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A34 | The plugins from a disk, from the network or from a registry | `README.md:1117`, `docs/PLUGIN_SECURITY.md:284` | not started | L |
| A35 | The sandbox of the plugins (an iframe with a strict CSP) | `docs/PLUGIN_SECURITY.md:288` | not started | L |
| A36 | The audit log of the actions of the plugins | `docs/PLUGIN_SECURITY.md:307` | not started | — |
| A37 | The operation that opens a note (the plugin of the backlinks can only list them) | `README.md:1122` | not started | S |

### The offline mode

| # | What | Where it is declared | Status | Size |
|---|---|---|---|---|
| A38 | The real synchronisation of the offline writes | `IMPLEMENTATION_STATUS.md:918`, `docs/PLUGIN_SECURITY.md:305`, `docs/UI_AUDIT.md:285` | not started | L |

---

## (B) Written, with a limitation

| # | What | The limitation | Where it is declared |
|---|---|---|---|
| B1 | The regular expressions in the query language | Deliberately not supported: `matches` answers "unknown operator" | `IMPLEMENTATION_STATUS.md:281`, `PHASE8_PLAN.md:108` |
| B2 | The notifications (the phase 11) | They live in the memory of the session, not in `localStorage` | `IMPLEMENTATION_STATUS.md:435` |
| B3 | The reminders and the notifications (the phase 12) | Memory / `localStorage` of the browser, no delivery by the server | `IMPLEMENTATION_STATUS.md:512` |
| B4 | The calendar | It does not create the daily note by itself (only the command and the button do) | `IMPLEMENTATION_STATUS.md:439` |
| B5 | The window of the search and of the filters (the phase 13) | It is modal: the tree behind it is darkened and cannot be clicked | `IMPLEMENTATION_STATUS.md:550` |
| B6 | The panels of the plugins Activity, Link Cards and Graph | They have no styles of their own: the browser draws them | `IMPLEMENTATION_STATUS.md:645`, `PHASE14_PLAN.md:205` |
| B7 | The webhooks and the MCP | They inherit the absence of an authentication of the API | `IMPLEMENTATION_STATUS.md:648` |
| B8 | The mobile adaptation (B10) | Partially: media queries, the drawer under 820 px, the PWA | `PHASE14_PLAN.md:116` |
| B9 | The drafts (B6) | They exist (`lib/drafts.ts`, `core/vault/sealedDrafts.ts`); they still need a test | `PHASE14_PLAN.md:110` |
| B10 | The Markdown (B7) | `marked` and `dompurify` are there; the formulas and the highlighting of the code are not | `PHASE14_PLAN.md:111` |
| B11 | The pinning (B8) | There is only the "favourites" | `PHASE14_PLAN.md:112` |
| B12 | The plugins | Trusted code without a sandbox; the declared rights do not cover the network calls a plugin makes itself | `README.md:1117`, `docs/PLUGIN_SECURITY.md:288` |
| B13 | The search | The `LIKE` fallback when the SQLite build has no FTS5: slower and less exact | `README.md:1105` |
| B14 | The name of a note | Not limited in length, control characters are allowed (except NUL), on purpose | `README.md:1124`, `IMPLEMENTATION_STATUS.md:923` |
| B15 | The export | The archive is buffered in the memory | `IMPLEMENTATION_STATUS.md:921` |
| B16 | The tooltip of the search button | It still says "Search (Ctrl+K)", the shortcut is `Ctrl+Shift+F` | `README.md:1127`, `IMPLEMENTATION_STATUS.md:928` |
| B17 | The trash | The shortcut is `Ctrl+Alt+D`, not `Ctrl+Alt+T` (a deliberate deviation) | `IMPLEMENTATION_STATUS.md:382` |
| B18 | The storage fixed by the environment | The button stays, marked `aria-disabled`, and opens nothing | `PHASE14_PLAN.md:195` |
| B19 | The mobile shell | The PWA, not a native application | `README.md:1130` |
| B20 | The Docker image | It has never been built on this machine | `IMPLEMENTATION_STATUS.md:892` |

---

## The stale texts (they say more than the code does)

These lines of the documentation are **outdated**: the code does more than
the text says. They are listed here so that nobody takes them for a gap.

| Where | What it says | The truth |
|---|---|---|
| `README.md:1102` | "No encryption at rest" | The sealed storage of the phase 7 encrypts the files in the browser (`frontend/src/core/vault/sealedVault.ts`, `backend/internal/sealed/`) |
| `README.md:1135` | "Optional passphrase protection for the whole vault" | The same: the encrypted storage with its master password exists |
| `docs/design/README.md:32-36` | The cards D2–D6 are marked `Draft` | The code of D3 (the manifest of the backup v2), of D4 (the saved views) and of D6 (the plugin of the activity) exists; the status of the cards is old |

---

## The order of the work

The points are not of the same weight. The ones that the user asked for
most often are at the top.

1. **The eleven large features of the phase 14** (`PHASE14_PLAN.md` §7): the
   boundaries, the place of the work and the size are already written down.
2. **The block of the phases 8 and 9** (`PHASE8_PLAN.md:105-108`,
   `PHASE9_PLAN.md:98-101`): the highlighting, the focus mode, the undo of a
   deletion, the card of a note, the synchronisation with the URL.
3. **The automation of the server**: the webhooks and the MCP — with the
   authentication, which they need first.
4. **The honest stubs** of the interface: the graph and the archive.

The graph of the notes and the archive are the only two buttons of the
interface that do nothing at all; they are marked as such, and they are the
only ones that can be called a lie.
