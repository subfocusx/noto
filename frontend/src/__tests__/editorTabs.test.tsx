// The strip of the open notes.
//
// The strip is the header of the workspace: the tests check that it stays a
// tablist, that the notes are told apart (the active one is raised), that the
// shape of the tabs lives in the stylesheet and not in the markup.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import {
  EditorTabs,
  TAB_DIRTY_DOT,
  TAB_GAP,
  TAB_PADDING_X,
  type EditorTab,
} from '../components/EditorTabs';

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const TABS_CSS = resolve(cwd, 'src', 'styles', 'tabs.css');
const TOKENS_CSS = resolve(cwd, 'src', 'styles', 'tokens.css');

/** The notes that are open in the tests: the second one has unsaved changes. */
const TABS: EditorTab[] = [
  { path: 'notes/2026-10-02.md', name: '2026-10-02.md' },
  { path: 'notes/demo.md', name: 'demo.md', dirty: true },
];

/** The value of a token of the design system, in pixels. */
function token(name: string): number {
  const tokens = readFileSync(TOKENS_CSS, 'utf8');
  const found = tokens.match(new RegExp(`--${name}:\\s*(\\d+)px`));
  return found ? Number(found[1]) : Number.NaN;
}

describe('the strip of the open notes', () => {
  it('is a tablist named "Open notes" and holds one tab per open note', () => {
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={() => {}} onClose={() => {}} />,
    );

    expect(view.getByRole('tablist', { name: 'Open notes' })).toBeTruthy();
    expect(view.getAllByRole('tab')).toHaveLength(2);
    expect(view.getByText('2026-10-02.md')).toBeTruthy();
    expect(view.getByText('demo.md')).toBeTruthy();
  });

  it('raises the active tab and leaves the other ones alone', () => {
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={() => {}} onClose={() => {}} />,
    );

    const [first, second] = view.getAllByRole('tab');

    expect(first!.getAttribute('aria-selected')).toBe('false');
    expect(first!.classList.contains('active')).toBe(false);

    expect(second!.getAttribute('aria-selected')).toBe('true');
    expect(second!.classList.contains('active')).toBe(true);
  });

  it('opens the note of the tab that was clicked', () => {
    const onSelect = vi.fn();
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={onSelect} onClose={() => {}} />,
    );

    fireEvent.click(view.getAllByRole('tab')[0]!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('notes/2026-10-02.md');
  });

  it('closes the active note without opening it again', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={onSelect} onClose={onClose} />,
    );

    fireEvent.click(view.getByTestId('tab-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('notes/demo.md');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves to the neighbouring tab with the arrow keys', () => {
    const onSelect = vi.fn();
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/2026-10-02.md" onSelect={onSelect} onClose={() => {}} />,
    );

    const [first, second] = view.getAllByRole('tab');

    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('notes/demo.md');

    fireEvent.keyDown(second!, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('notes/2026-10-02.md');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('marks the note with unsaved changes with a dot', () => {
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={() => {}} onClose={() => {}} />,
    );

    const dots = view.getAllByTestId('tab-dirty');
    expect(dots).toHaveLength(1);
    expect(view.getByRole('img', { name: 'Unsaved changes in demo.md' })).toBeTruthy();

    // The dot belongs to the note with the changes, not to the other one.
    const [first, second] = view.getAllByRole('tab');
    expect(first!.querySelector('[data-testid="tab-dirty"]')).toBeNull();
    expect(second!.querySelector('[data-testid="tab-dirty"]')).toBeTruthy();
  });

  it('shows nothing when no note is open', () => {
    const view = render(
      <EditorTabs tabs={[]} activePath={null} onSelect={() => {}} onClose={() => {}} />,
    );

    expect(view.container.innerHTML).toBe('');
    expect(view.queryByRole('tablist')).toBeNull();
  });

  it('describes no style of its own: the shape lives in the stylesheet', () => {
    const view = render(
      <EditorTabs tabs={TABS} activePath="notes/demo.md" onSelect={() => {}} onClose={() => {}} />,
    );

    expect(view.getByTestId('tab-strip').getAttribute('style')).toBeNull();
    for (const tab of view.getAllByRole('tab')) {
      expect(tab.getAttribute('style')).toBeNull();
    }
    expect(view.getByTestId('tab-dirty').getAttribute('style')).toBeNull();
    expect(view.getByTestId('tab-close').getAttribute('style')).toBeNull();
  });

  it('keeps the constants of the component and the stylesheet in step', () => {
    const css = readFileSync(TABS_CSS, 'utf8');

    // The gap and the padding of the pills are the tokens of the design system.
    expect(token('space-1')).toBe(TAB_GAP);
    expect(token('space-3')).toBe(TAB_PADDING_X);
    expect(css).toContain('gap: var(--space-1);');
    expect(css).toContain('padding: 0 var(--space-3);');
    // The dot of the unsaved note is a circle of a known size.
    expect(css).toContain(`width: ${TAB_DIRTY_DOT}px;`);
  });
});
