// The tests of the outline of the note.
//
// The outline is the skeleton of the open note: the headings, with their
// level, as a tree. The section the cursor is in is the active one.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { OutlinePanel } from '../components/OutlinePanel';
import {
  activeSectionPath,
  extractHeadings,
  outlineCount,
  outlineSections,
} from '../lib/outline';

describe('the sections of the outline', () => {
  it('puts a heading under the heading of the level above it', () => {
    const sections = outlineSections(extractHeadings('# One\n\n## Two\n\n### Three\n'));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading.text).toBe('One');
    expect(sections[0]?.children[0]?.heading.text).toBe('Two');
    expect(sections[0]?.children[0]?.children[0]?.heading.text).toBe('Three');
  });

  it('keeps the headings of the same level next to each other', () => {
    const sections = outlineSections(extractHeadings('# One\n\n# Two\n'));
    expect(sections.map((section) => section.heading.text)).toEqual(['One', 'Two']);
  });

  it('puts a heading that jumps a level under the last heading of a lower level', () => {
    const sections = outlineSections(extractHeadings('# One\n\n### Deep\n'));
    expect(sections[0]?.children[0]?.heading.text).toBe('Deep');
  });

  it('names the way to the active section', () => {
    const sections = outlineSections(extractHeadings('# One\n\n## Two\n\n### Three\n'));
    const path = activeSectionPath(sections, sections[0]?.children[0]?.children[0]?.heading.id);
    expect(path).toHaveLength(3);
    expect(path[path.length - 1]).toBe(sections[0]?.children[0]?.children[0]?.heading.id);
  });

  it('names no way when no section is active', () => {
    const sections = outlineSections(extractHeadings('# One\n'));
    expect(activeSectionPath(sections, null)).toEqual([]);
  });

  it('counts the headings of an outline', () => {
    expect(outlineCount(extractHeadings('# One\n\n## Two\n'))).toBe(2);
  });
});

describe('the panel of the outline', () => {
  const headings = extractHeadings('# One\n\n## Two\n');

  it('shows the headings of the note', () => {
    render(<OutlinePanel headings={headings} onSelect={() => undefined} />);
    expect(screen.getByText('One')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
  });

  it('marks the section the cursor is in', () => {
    render(<OutlinePanel headings={headings} activeId={headings[1]?.id} onSelect={() => undefined} />);
    expect(screen.getByText('Two').getAttribute('aria-current')).toBe('true');
  });

  it('jumps to the heading the user chooses', () => {
    const onSelect = vi.fn();
    render(<OutlinePanel headings={headings} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Two'));
    expect(onSelect).toHaveBeenCalledWith(headings[1]?.id);
  });

  it('says that the note has no heading', () => {
    render(<OutlinePanel headings={[]} onSelect={() => undefined} />);
    expect(screen.getByText('No headings in this note.')).toBeTruthy();
  });
});
