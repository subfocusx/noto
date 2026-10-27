// The tests of the place of the floating window of the search and of the
// filters.
//
// The window is not a modal window: it floats over the application and the
// tree behind it stays clickable.
//
// The window does not measure itself: its place is a rule of the stylesheet,
// so it is painted once, in one place. A window that measures itself is
// painted in the corner first and then jumps to the middle of the screen.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closesOnClickOutside, containsPoint } from '../core/find/panel';

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const FIND_CSS = resolve(cwd, 'src', 'styles', 'find.css');

const css = readFileSync(FIND_CSS, 'utf8');

/** The rules of the card of the window. */
const card = /\.find-window\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

describe('the place of the floating window', () => {
  it('is pinned by the stylesheet and not measured by the window', () => {
    // The window is fixed, its top edge is pinned and it is centred
    // horizontally: the content can grow downwards without moving it.
    expect(card).toMatch(/position:\s*fixed/);
    expect(card).toMatch(/top:\s*12vh/);
    expect(card).toMatch(/left:\s*50%/);
    expect(card).toMatch(/transform:\s*translateX\(-50%\)/);
  });

  it('never leaves the screen', () => {
    expect(card).toMatch(/width:\s*min\(620px, calc\(100vw/);
    expect(card).toMatch(/max-height:\s*min\(70dvh/);
  });
});

describe('the click outside of the window', () => {
  const rect = { x: 100, y: 100, width: 400, height: 300 };

  it('does not close the window for a click inside it', () => {
    expect(containsPoint(rect, { x: 200, y: 200 })).toBe(true);
    expect(closesOnClickOutside(rect, { x: 200, y: 200 })).toBe(false);
  });

  it('closes the window for a click on the tree behind it', () => {
    expect(closesOnClickOutside(rect, { x: 20, y: 400 })).toBe(true);
  });
});
