# The actions of the tree, the pencil of the note and the window of the tags

**Date:** 2026-10-27
**Phase:** 22

## Goal

Four changes of the shell of Noto, asked for by the owner with screenshots:

1. The window of the search and of the filters must not jump when it opens.
2. The actions «New folder», «Refresh the tree» and «Archive» must leave the
   menu «⋯» and live on the face of the column; the duplicate of the button of
   the command palette must go.
3. The pencil (the switch between the editing and the reading of the note)
   must move to the far corner of the row of the tags.
4. The tags: the «+» next to the label opens a small window with the tags of
   the vault and an input for a tag of one's own.

Accepted by the owner:

- the three actions go into the strip of the actions under the header of the
  column (the order: expand all, collapse all, new folder, refresh, archive,
  command palette); the menu keeps the graph and the plugins;
- the window of the tags lists the tags of the whole vault;
- the window of the tags is a modal window in the middle of the screen.

## Context

The places of the code:

- `frontend/src/components/FindPanel.tsx` — the floating window of the search
  and of the filters; `frontend/src/core/find/panel.ts` — the rules of its
  place; `frontend/src/styles/find.css` — its shape.
- `frontend/src/components/sections/ExplorerSection.tsx` — the header of the
  column, the strip of the actions of the tree (`.explorer-actions`) and the
  menu of the explorer; `frontend/src/components/sections/ExplorerMenu.tsx` —
  the items of the menu.
- `frontend/src/components/EditorTabs.tsx` — the strip of the open notes and
  the pencil at its right end; `frontend/src/components/NoteTags.tsx` — the
  row of the tags; `frontend/src/App.tsx` — the place of both.
- `frontend/src/core/store/types.ts` — `ui.tags: TagCount[]`, the tags of the
  vault with their counters; `frontend/src/core/store/actions.ts` —
  `loadTags()`, which reads them (`core/query/service.ts`, both modes of the
  storage).

### Why the window of the search jumps

The window is placed by the measurement of itself: the component keeps the
rectangle in the state and writes it into the inline styles of the window. On
the first paint the rectangle is still `null`, so the window is drawn in the
upper left corner of the screen, and only after the effect has measured it
does it move to the middle. The measurement is taken with the rectangle of the
previous paint, so the height of the window (and therefore its place) follows
the content: the window grows, the window moves.

Measured in the browser (1440×900, the dev server):

```
search  frames: 88  distinct: [[0,0,620,154],[410,373,620,154]]
filters frames: 91  distinct: [[0,0,620,234],[410,333,620,234]]
```

The window is painted at (0,0) and then jumps to the middle. The height of
the window never exceeds the height it had when it opened (154 px for the
search): the results are squeezed into a scroll of 154 px.

A second cause: the window is a part of the lazy chunk of the overlays, and
that chunk drags the crypto core of the sealed storage with it. The first
click of the search waits for it.

### Why the pencil is where it is

`EditorTabs` renders the button `tab-mode` at the right end of the strip of
the tabs. The row of the tags (`App.tsx`, `.note-tags-strip`) is a strip of
its own under the breadcrumbs, and it ends with the button that adds a tag.

## Approach

### 1. The window of the search does not jump

The place of the window stops being a measurement and becomes a rule of the
stylesheet: the window is fixed, its top edge is at 12 % of the height of the
screen and it is centred horizontally. The content can grow downwards without
moving the window, and nothing is painted twice.

- `frontend/src/styles/find.css`: `.find-window` gets `position: fixed`,
  `top: 12vh`, `left: 50%`, `transform: translateX(-50%)`,
  `width: min(620px, calc(100vw - 2 * var(--space-4)))`,
  `max-height: min(70dvh, calc(100dvh - 2 * var(--space-4)))`.
- `frontend/src/components/FindPanel.tsx`: the state `rect`, the effect that
  measured the window and the inline `left`/`top`/`maxHeight` go away. The
  click outside of the window reads the live rectangle of the DOM
  (`card.current?.getBoundingClientRect()`), so it is never stale.
- `frontend/src/core/find/panel.ts`: `findPanelRect`, `PANEL_WIDTH` and
  `PANEL_MAX_HEIGHT` go away (the geometry of the window lives in the
  stylesheet); `containsPoint` and `closesOnClickOutside` stay.
- `frontend/src/App.tsx`: the window of the search is loaded by its own
  dynamic import (`./components/FindPanel`), not by the chunk of the overlays
  (which drags the crypto core). The chunk is preloaded when the browser is
  idle, so the first click opens the window at once.

### 2. The actions of the tree on the face of the column

The strip of the actions (`.explorer-actions`) holds six buttons in this
order: expand all, collapse all, new folder, refresh the tree, archive,
command palette. The menu of the explorer keeps the graph and the plugins —
the actions that are not the actions of the tree.

- `frontend/src/components/sections/ExplorerSection.tsx`: the strip grows
  three buttons; the archive opens the panel of the archive (`panel ===
  'archive'`, as the menu did).
- `frontend/src/components/sections/ExplorerMenu.tsx`: the items «new folder»,
  «command palette», «archive» and «refresh the tree» go away.
- `frontend/src/styles/components.css`: the strip keeps its height; the gap
  between the buttons grows a little.

### 3. The pencil moves to the row of the tags

- `frontend/src/components/EditorTabs.tsx`: the prop `onToggleMode` and the
  button `tab-mode` go away.
- `frontend/src/App.tsx`: the button is rendered in `.note-tags-strip`, after
  `<NoteTags>`, and the strip is a flex row: the button is pushed to the
  right end (`margin-left: auto`). The name of the test becomes
  `mode-toggle`.
- `frontend/src/styles/*.css`: the strip of the tags becomes a row that
  carries the button at its right end.

### 4. The window of the tags

- New `frontend/src/components/TagPickerDialog.tsx`: a modal window (the
  `Dialog` of the application) with the title «Tags of the vault», the list
  of the tags of the vault (the name and the number of the notes that carry
  it) and, under the list, the input of a tag of one's own. Clicking a tag of
  the list adds it to the note and closes the window; the Enter key confirms
  the tag of the input.
- `frontend/src/components/NoteTags.tsx`: the «+» opens the window
  (`props.onOpenPicker()`) instead of turning into an input inside the row.
- `frontend/src/App.tsx`: the window is rendered next to the note; the list is
  read with `loadTags()` when it opens.
- The tags are written into the text of the note, as they always were.

## Tasks

1. `frontend/src/styles/find.css`, `frontend/src/components/FindPanel.tsx`,
   `frontend/src/core/find/panel.ts`, `frontend/src/__tests__/find-panel-position.test.ts`,
   `frontend/src/__tests__/find-panel-floating.test.tsx`, `frontend/src/__tests__/find-panel.test.tsx`:
   the window is placed by the stylesheet; the measurement goes away.
2. `frontend/src/App.tsx`: the own chunk of the search and the preload.
3. `frontend/src/components/sections/ExplorerSection.tsx`,
   `frontend/src/components/sections/ExplorerMenu.tsx`,
   `frontend/src/styles/components.css`: the six buttons of the strip; the
   menu keeps two items.
4. `frontend/src/components/EditorTabs.tsx`, `frontend/src/App.tsx`, the styles
   of the strip of the tags: the pencil moves.
5. `frontend/src/components/TagPickerDialog.tsx` (new),
   `frontend/src/components/NoteTags.tsx`, `frontend/src/App.tsx`, the
   catalogue of the strings (en, ru): the window of the tags.
6. The tests: `frontend/src/__tests__/note-tags.test.tsx` (the inline field
   becomes the window), `frontend/src/__tests__/tag-picker.test.tsx` (new),
   `frontend/src/__tests__/editorTabs.test.tsx`, `frontend/src/__tests__/app.test.tsx`,
   `frontend/src/__tests__/explorer-header.test.tsx`,
   `e2e/helpers/app.ts`, `e2e/specs/{shell,shell-actions,tree-bulk,editor,search}.spec.ts`.
7. The documentation: `docs/DESIGN_SYSTEM.md` (§3.1, §6.1, §6.10 and a new
   §6.12), `IMPLEMENTATION_STATUS.md` (the phase 22).

## Verification

- `npm run typecheck` (exit 0), `npx vitest run`, `npm run check:boundaries`,
  `npm run build`.
- `npx playwright test` — the whole suite.
- The proof of the first task: the frames of the window must show one place
  only (the probe of `.tools/`), and the window must grow downwards when the
  results arrive.
- A screenshot of the column with the six buttons and of the window of the
  tags.

## Decisions / Risks

- The place of the window of the search is now a rule of the stylesheet: the
  constants of the geometry live in `find.css` and not in the TypeScript. The
  test of the place of the window (`find-panel-position.test.ts`) is rewritten
  around the rules of the stylesheet.
- The pencil leaves the strip of the tabs: the strip of the tabs is the header
  of the column of the editor, and the row of the tags is the row of the
  properties of the note. The button keeps its meaning (one button, two
  modes).
- The window of the tags is a modal window: it covers the note. The owner
  asked for it; a popover under the button would be lighter.
- The list of the tags of the vault is read when the window opens: it is a
  cache of the text of the notes, and it is empty until something reads it.
