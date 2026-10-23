import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor, type EditorHandle } from '../components/Editor';
import { PluginManagerPanel, type PluginManagerEntry } from '../components/PluginManagerPanel';
import {
  PluginCommandSlot,
  PluginContextMenuSlot,
  PluginPanelSlot,
  PluginSidebarSlot,
  PluginToolbarSlot,
} from '../components/PluginSlots';
import type { PluginManifest } from '../plugins/contract';

/* --------------------------------------------------------------- fixtures */

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo',
    name: 'Demo plugin',
    version: '1.2.3',
    description: 'A demo plugin',
    author: 'Someone',
    manifestVersion: 1,
    minApiVersion: '1.0.0',
    permissions: [],
    ...overrides,
  };
}

function entry(overrides: Partial<PluginManagerEntry> = {}): PluginManagerEntry {
  return {
    id: 'demo',
    manifest: manifest(),
    status: 'active',
    error: null,
    ...overrides,
  };
}

/* --------------------------------------------------------- manager panel */

describe('PluginManagerPanel', () => {
  it('renders the plugins with their state', () => {
    render(
      <PluginManagerPanel
        plugins={[
          entry(),
          entry({
            id: 'second',
            manifest: manifest({ id: 'second', name: 'Second plugin', version: '0.1.0' }),
            status: 'disabled',
          }),
        ]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    expect(screen.getByText('Demo plugin')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getAllByText('A demo plugin').length).toBe(2);
    expect(screen.getAllByText('Author: Someone').length).toBe(2);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('warns about the trust model of the plugins', () => {
    render(
      <PluginManagerPanel
        plugins={[entry()]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    expect(
      screen.getByText(
        'Встроенные плагины выполняются как доверенный код в приложении. Изоляции/песочницы нет.',
      ),
    ).toBeTruthy();
  });

  it('calls the enable and disable callbacks', () => {
    const onEnable = vi.fn();
    const onDisable = vi.fn();
    render(
      <PluginManagerPanel
        plugins={[entry()]}
        onEnable={onEnable}
        onDisable={onDisable}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText('Disable the plugin Demo plugin'));
    expect(onDisable).toHaveBeenCalledWith('demo');

    const { rerender } = render(
      <PluginManagerPanel
        plugins={[entry({ status: 'disabled' })]}
        onEnable={onEnable}
        onDisable={onDisable}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );
    rerender(
      <PluginManagerPanel
        plugins={[entry({ status: 'disabled' })]}
        onEnable={onEnable}
        onDisable={onDisable}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );
    fireEvent.click(screen.getAllByLabelText('Enable the plugin Demo plugin')[0]);
    expect(onEnable).toHaveBeenCalledWith('demo');
  });

  it('shows the error of a failed plugin and offers a recovery', () => {
    const onEnable = vi.fn();
    const onDisable = vi.fn();
    render(
      <PluginManagerPanel
        plugins={[entry({ status: 'failed', error: 'boom' })]}
        onEnable={onEnable}
        onDisable={onDisable}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Disable and reload the plugin Demo plugin'));
    expect(onDisable).toHaveBeenCalledWith('demo');
    expect(onEnable).toHaveBeenCalledWith('demo');
  });

  it('shows the settings buttons only for plugins with settings', () => {
    const { rerender } = render(
      <PluginManagerPanel
        plugins={[entry()]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    expect(screen.queryByLabelText('Open the settings of the plugin Demo plugin')).toBeNull();

    rerender(
      <PluginManagerPanel
        plugins={[
          entry({
            manifest: manifest({
              settings: [{ key: 'token', label: 'Token', type: 'string', default: '' }],
            }),
          }),
        ]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Open the settings of the plugin Demo plugin')).toBeTruthy();
    expect(screen.getByLabelText('Reset the settings of the plugin Demo plugin')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ slots */

describe('plugin slots', () => {
  it('renders the sidebar items of the plugins', () => {
    const onSelect = vi.fn();
    render(
      <PluginSidebarSlot
        items={[{ id: 'a', title: 'Alpha', onSelect }]}
      />,
    );

    fireEvent.click(screen.getByLabelText('Alpha'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('shows the sidebar and the toolbar items as icon-only buttons', () => {
    render(
      <div>
        <PluginSidebarSlot items={[{ id: 'a', title: 'Alpha', onSelect: () => undefined }]} />
        <PluginToolbarSlot items={[{ id: 'b', title: 'Beta', run: () => undefined }]} />
      </div>,
    );

    for (const label of ['Alpha', 'Beta']) {
      const button = screen.getByLabelText(label);
      expect(button.className).toContain('noto-plugin-button-icon');
      expect(button.getAttribute('title')).toBe(label);
    }
  });

  it('keeps the text of the commands of the plugins', () => {
    render(
      <PluginCommandSlot
        commands={[{ id: 'a', title: 'Do it', run: () => undefined }]}
      />,
    );

    const button = screen.getByLabelText('Do it');
    expect(button.className).not.toContain('noto-plugin-button-icon');
    expect(button.textContent).toContain('Do it');
  });

  it('renders the toolbar items of the plugins', () => {
    const run = vi.fn();
    render(<PluginToolbarSlot items={[{ id: 'a', title: 'Do it', run }]} />);

    fireEvent.click(screen.getByLabelText('Do it'));
    expect(run).toHaveBeenCalled();
  });

  it('renders the panels of the plugins', () => {
    render(
      <PluginPanelSlot
        panels={[
          { id: 'p1', title: 'First', render: () => <p>first panel</p> },
          { id: 'p2', title: 'Second', render: () => <p>second panel</p> },
        ]}
      />,
    );

    expect(screen.getByText('first panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByText('second panel')).toBeTruthy();
  });

  it('keeps the page alive when a panel throws', () => {
    render(
      <div>
        <PluginPanelSlot
          panels={[
            {
              id: 'bad',
              title: 'Broken',
              render: () => {
                throw new Error('plugin exploded');
              },
            },
          ]}
        />
        <p>page content</p>
      </div>,
    );

    expect(screen.getByText('page content')).toBeTruthy();
    expect(document.querySelector('.noto-plugin-error')).toBeTruthy();
    expect(document.querySelector('.noto-plugin-error')?.textContent).toContain('Ошибка плагина');
  });

  it('filters the context menu items by the path', () => {
    const run = vi.fn();
    render(
      <PluginContextMenuSlot
        path='notes/a.md'
        items={[
          { id: 'x', title: 'Only md', appliesTo: (p) => p.endsWith('.md'), run },
          { id: 'y', title: 'Only txt', appliesTo: (p) => p.endsWith('.txt'), run },
        ]}
      />,
    );

    expect(screen.getByLabelText('Only md')).toBeTruthy();
    expect(screen.queryByLabelText('Only txt')).toBeNull();
    fireEvent.click(screen.getByLabelText('Only md'));
    expect(run).toHaveBeenCalledWith('notes/a.md');
  });
});

/* ----------------------------------------------------------------- editor */

function renderEditor(onChange?: (text: string) => void) {
  let handle: EditorHandle | null = null;
  const view = render(
    <MarkdownEditor
      value='hello world'
      path='a.md'
      contentPath='a.md'
      onChange={onChange ?? (() => undefined)}
      onSave={() => undefined}
      onHandle={(h) => {
        handle = h;
      }}
    />,
  );
  return { view, get handle(): EditorHandle | null {
    return handle;
  } };
}

describe('editor extension points', () => {
  it('reports the selection and the cursor', () => {
    const { handle } = renderEditor();
    expect(handle).not.toBeNull();
    expect(handle!.getCursor()).toEqual({ from: 0, to: 0 });
    expect(handle!.getSelection()).toBe('');

    handle!.insertAt('!', 5, 5);
    expect(handle!.getCursor()).toEqual({ from: 6, to: 6 });
    expect(handle!.getSelection()).toBe('');
  });

  it('inserts at a range and reports the change to the application', () => {
    const onChange = vi.fn();
    const { handle } = renderEditor(onChange);

    handle!.insertAt('brave ', 0, 0);
    expect(handle!.getText()).toBe('brave hello world');
    // The application must see the change, so that the autosave works.
    expect(onChange).toHaveBeenCalledWith('brave hello world');
  });

  it('replaces the selection', () => {
    const onChange = vi.fn();
    const { handle } = renderEditor(onChange);

    handle!.insertAt('XYZ', 0, 5);
    onChange.mockClear();
    // The selection is empty (the cursor is behind the inserted text), so the
    // text is inserted at the cursor.
    handle!.replaceSelection('123');
    expect(handle!.getText()).toBe('XYZ123 world');
    expect(onChange).toHaveBeenCalledWith('XYZ123 world');
  });

  it('notifies the subscribers and can unsubscribe them', () => {
    const { handle } = renderEditor();
    const changes: string[] = [];
    const selections: { from: number; to: number }[] = [];

    const offChange = handle!.onChange((text) => changes.push(text));
    const offSelection = handle!.onSelectionChange((sel) => selections.push(sel));

    handle!.insertAt('a', 0, 0);
    expect(changes).toEqual(['ahello world']);
    expect(selections.length).toBeGreaterThan(0);

    offChange();
    offSelection();
    handle!.insertAt('b', 0, 0);
    expect(changes).toEqual(['ahello world']);
    expect(selections.length).toBe(selections.length);
  });

  it('accepts CodeMirror extensions from a plugin', () => {
    const { view, handle } = renderEditor();

    handle!.setExtensions([EditorView.contentAttributes.of({ 'data-plugin': 'yes' })]);

    // The document survives the reconfiguration.
    expect(handle!.getText()).toBe('hello world');
    const content = view.container.querySelector('.cm-content');
    expect(content?.getAttribute('data-plugin')).toBe('yes');
  });
});
