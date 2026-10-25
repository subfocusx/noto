// The tests of the panel of the import and of the export.
//
// The two file fields of the panel used to show the native caption of the
// browser, and the buttons of the application were pushed away. These tests
// guard the fix: every field has its own button, and the markup holds no
// native caption.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { TransferPanel } from '../components/TransferPanel';

/** Renders the panel of the import and of the export. */
function renderPanel(open = true) {
  return render(
    <TransferPanel
      open={open}
      onClose={() => undefined}
      currentPath="journal/note.md"
      onImported={() => undefined}
    />,
  );
}

describe('the panel of the import and of the export', () => {
  it('shows nothing when it is closed', () => {
    renderPanel(false);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('holds the two fields of the files', () => {
    renderPanel();

    expect(screen.getByRole('dialog', { name: 'Import & Export' })).toBeTruthy();

    const markdown = screen.getByLabelText('Markdown files');
    const archive = screen.getByLabelText('Zip archive');
    expect(markdown.getAttribute('type')).toBe('file');
    expect(archive.getAttribute('type')).toBe('file');
  });

  it('gives every field its own button', () => {
    const { container } = renderPanel();

    const buttons = container.querySelectorAll('.file-picker-button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe('Choose files');
    expect(buttons[1]?.textContent).toBe('Choose archive');

    // Every button belongs to the field next to it.
    const markdown = screen.getByLabelText('Markdown files');
    expect(markdown.closest('.file-picker')?.querySelector('.file-picker-button')?.textContent).toBe(
      'Choose files',
    );
    const archive = screen.getByLabelText('Zip archive');
    expect(archive.closest('.file-picker')?.querySelector('.file-picker-button')?.textContent).toBe(
      'Choose archive',
    );
  });

  it('shows no native caption of the browser', () => {
    const { container } = renderPanel();

    expect(container.textContent).not.toContain('No file chosen');
    expect(container.textContent).not.toContain('Choose Files');
  });

  it('filters the files of every field', () => {
    renderPanel();

    const markdown = screen.getByLabelText('Markdown files');
    expect(markdown.getAttribute('accept')).toBe('.md,.markdown,text/markdown');
    const archive = screen.getByLabelText('Zip archive');
    expect(archive.getAttribute('accept')).toBe('.zip,application/zip');
  });
});
