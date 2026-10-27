// The header of the storage: one line, the name of the storage and the
// actions of the column.
//
// The path of the storage is not a line of the header: it is a detail, and it
// lives in the tooltip of the name and in the menu of the storage. The name
// itself is the button of that menu, the way Obsidian and Notion do it.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Sidebar, type SidebarProps } from '../components/Sidebar';
import { buildTree } from '../lib/tree';
import type { Node } from '../types';

/** A folder of the vault. */
function folder(path: string, name: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Renders the sidebar of the explorer.
 *
 * The props of the explorer are the same in every test of the header: only
 * the storage changes from one test to the other.
 */
function renderExplorer(overrides: Partial<SidebarProps> = {}) {
  const { roots, filesByParent } = buildTree([folder('journal', 'journal')], []);
  return render(
    <Sidebar
      section="explorer"
      folders={roots}
      filesByParent={filesByParent}
      currentPath=""
      expanded={new Set<string>()}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onCreateFolder={() => undefined}
      onCreateFile={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      vaultName="notes"
      vaultPath={'C:\\notes'}
      onChooseVault={() => undefined}
      {...overrides}
    />,
  );
}

describe('the header of the storage', () => {
  it('is one line: the name of the storage and the actions', () => {
    const { container } = renderExplorer();

    const header = container.querySelector('.vault-header');
    expect(header).toBeTruthy();
    // The path of the storage is not a second line of the header.
    expect(header?.querySelector('.vault-header-sub')).toBeNull();
    expect(header?.querySelector('.vault-header-path')).toBeNull();
    expect(header?.textContent).not.toContain('C:\\notes');
  });

  it('opens the menu of the storage by its name', () => {
    const onVaultMenuToggle = vi.fn();
    renderExplorer({ vaultMenuOpen: false, onVaultMenuToggle });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    // The visible name of the storage is a part of the accessible name.
    expect(trigger.getAttribute('aria-label')).toContain('notes');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    fireEvent.click(trigger);
    expect(onVaultMenuToggle).toHaveBeenCalledWith(true);
  });

  it('keeps the path of the storage in the tooltip of the name', () => {
    renderExplorer();

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('title')).toBe('C:\\notes');
  });

  it('shows the name as a text when the storage cannot be changed', () => {
    renderExplorer({ onChooseVault: undefined });

    expect(screen.queryByRole('button', { name: /change the storage of the notes/i })).toBeNull();
    expect(screen.getByText('notes')).toBeTruthy();
  });

  it('says that the storage is fixed when the environment fixes it', () => {
    renderExplorer({ vaultFixed: true });

    const trigger = screen.getByRole('button', { name: /change the storage of the notes/i });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.getAttribute('title')).toContain('fixed by the environment');
  });
});
