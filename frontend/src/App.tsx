import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { CommandPalette } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { MarkdownEditor, type EditorHandle } from './components/Editor';
import { NoteDialogs } from './components/NoteDialogs';
import {
  PluginCommandSlot,
  PluginContextMenuSlot,
  PluginPanelSlot,
  PluginSidebarSlot,
  PluginToolbarSlot,
} from './components/PluginSlots';
import {
  PluginManagerPanel,
  type PluginManagerEntry,
  type PluginManagerStatus,
} from './components/PluginManagerPanel';
import { Preview } from './components/Preview';
import { SearchPanel } from './components/SearchPanel';
import { Sidebar } from './components/Sidebar';
import { TrashPanel } from './components/TrashPanel';
import { TransferPanel } from './components/TransferPanel';
import { createPluginApi } from './core/api/pluginApi';
import { registerAppCommands, APP_COMMAND_PREFIX } from './core/commands/appCommands';
import { CommandRegistry } from './core/commands/commandRegistry';
import { EventBus } from './core/events/eventBus';
import { SettingsStore } from './core/settings/settingsStore';
import { appStore } from './core/store/appStore';
import { useAppActions, useAppState } from './core/store/hooks';
import { buildTree } from './lib/tree';
import { createWikiResolver } from './lib/wiki';
import type { PluginEditor, PluginEventMap, PluginState } from './plugins/contract';
import { PluginHost } from './plugins/host';
import { builtinPlugins } from './plugins/loader';
import { PluginRegistry } from './plugins/registry';

/**
 * The application shell.
 *
 * All state lives in the store (`./core/store/appStore.ts`); this component
 * only composes the UI and forwards user intents to the store actions.
 *
 * The plugin platform is connected here as well: the host is created once,
 * the built-in plugins are registered with it and the plugin contributions
 * are rendered through the slots of `./components/PluginSlots.tsx`.
 */

/** Maps the state of the registry onto the states of the manager panel. */
function toManagerStatus(state: PluginState): PluginManagerStatus {
  if (state === 'active' || state === 'loading' || state === 'enabled') return 'active';
  if (state === 'failed') return 'failed';
  if (state === 'incompatible') return 'incompatible';
  return 'disabled';
}

export function App() {
  const state = useAppState();
  const actions = useAppActions();
  const editorRef = useRef<EditorHandle | null>(null);

  const { tree, note, ui, env, dialog, draftOffer, banner } = state;

  useEffect(() => {
    appStore.start();
    return () => appStore.stop();
  }, []);

  /* ------------------------------------------------------------- plugins */

  const hostRef = useRef<PluginHost | null>(null);
  const registryRef = useRef<PluginRegistry | null>(null);
  const commandsRef = useRef<CommandRegistry | null>(null);
  const settingsRef = useRef<SettingsStore | null>(null);
  /** Subscribers that must be notified when the editor instance changes. */
  const editorSubscribersRef = useRef(new Set<(editor: PluginEditor | null) => void>());
  /** Fingerprint of the current editor, used to detect an actual change. */
  const editorKeyRef = useRef('');
  const [pluginVersion, setPluginVersion] = useState(0);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [commandRegistry, setCommandRegistry] = useState<CommandRegistry | null>(null);

  /** The path of the note that is open; the plugins read it through the editor. */
  const currentPathRef = useRef<string | null>(note.path);
  currentPathRef.current = note.path;

  /**
   * The editor as the plugins see it.
   *
   * The contract has no `setText()`: replacing the whole document behind the
   * editor's back would bypass the autosave.
   */
  const pluginEditor = (): PluginEditor | null => {
    const handle = editorRef.current;
    if (!handle) return null;
    return {
      getText: () => handle.getText(),
      getSelection: () => handle.getSelection(),
      getCursor: () => handle.getCursor(),
      insert: (text: string) => handle.insert(text),
      insertAt: (text: string, from: number, to: number) => handle.insertAt(text, from, to),
      replaceSelection: (text: string) => handle.replaceSelection(text),
      focus: () => handle.focus(),
      openSearch: () => handle.openSearch(),
      getPath: () => currentPathRef.current,
      onChange: (cb) => handle.onChange(cb),
      onSelectionChange: (cb) => handle.onSelectionChange(cb),
    };
  };

  /**
   * Notifies the plugin host when the editor instance changes.
   *
   * The effect runs after every render: the editor handle appears after the
   * note is in the store, so a store-only subscription would report "no
   * editor" exactly once and then never again.
   */
  useEffect(() => {
    const key = `${currentPathRef.current ?? ''}|${editorRef.current ? '1' : '0'}`;
    if (key === editorKeyRef.current) return;
    editorKeyRef.current = key;
    const editor = pluginEditor();
    for (const cb of editorSubscribersRef.current) {
      try {
        cb(editor);
      } catch {
        // A broken plugin subscriber must not break the application.
      }
    }
  });

  // The host is created once and disposed when the application goes away.
  useEffect(() => {
    const registry = new PluginRegistry();
    const bus = new EventBus<PluginEventMap>();
    const commands = new CommandRegistry();
    const settings = new SettingsStore();
    registryRef.current = registry;
    commandsRef.current = commands;
    settingsRef.current = settings;
    setCommandRegistry(commands);

    // The commands of the application live in the same registry as the
    // commands of the plugins: the palette shows both of them.
    const unregisterAppCommands = registerAppCommands(commands, {
      createNote: () => appStore.actions.openDialog({ kind: 'create-file', parentPath: '', value: 'note.md' }),
      createFolder: () =>
        appStore.actions.openDialog({ kind: 'create-folder', parentPath: '', value: 'New folder' }),
      dailyNote: () => appStore.actions.openOrCreateDailyNote(),
      openSearch: () => appStore.actions.setSearchOpen(true),
      toggleTheme: () => appStore.actions.toggleTheme(),
      openTrash: () => appStore.actions.openDialog({ kind: 'trash' }),
      renameNote: () => {
        // The commands of the application act on the note that is open.
        const { note, tree } = appStore.getSnapshot();
        const node = tree.files.find((file) => file.path === note.path);
        if (!node) {
          appStore.actions.showBanner('Open a note first — there is nothing to rename');
          return;
        }
        appStore.actions.openDialog({ kind: 'rename', node, value: node.name });
      },
      deleteNote: () => {
        const { note, tree } = appStore.getSnapshot();
        const node = tree.files.find((file) => file.path === note.path);
        if (!node) {
          appStore.actions.showBanner('Open a note first — there is nothing to delete');
          return;
        }
        appStore.actions.openDialog({ kind: 'delete', node });
      },
    });

    const host = new PluginHost({
      registry,
      bus,
      commands,
      settings,
      createApi: () => createPluginApi(),
      getEditor: () => pluginEditor(),
      subscribeEditor: (cb) => {
        editorSubscribersRef.current.add(cb);
        cb(pluginEditor());
        return () => {
          editorSubscribersRef.current.delete(cb);
        };
      },
    });
    hostRef.current = host;

    const offState = registry.onStateChange(() => setPluginVersion((v) => v + 1));

    void (async () => {
      // The enabled/disabled flags of the plugins survive a reload.
      let states: Record<string, boolean> = {};
      try {
        states = await settings.getEnabledStates();
      } catch {
        states = {};
      }
      for (const plugin of builtinPlugins) {
        const id = plugin.manifest.id;
        const result = registry.register(plugin);
        // A plugin with an invalid manifest or an incompatible one keeps its
        // error state; it is never activated.
        if (!result.ok) continue;
        if (states[id] === false) {
          registry.disable(id);
          continue;
        }
        registry.enable(id);
        await host.activate(id);
      }
      setPluginVersion((v) => v + 1);
    })();

    return () => {
      offState();
      unregisterAppCommands();
      void host.disposeAll();
      hostRef.current = null;
      registryRef.current = null;
      commandsRef.current = null;
      settingsRef.current = null;
      setCommandRegistry(null);
    };
    // The host lives as long as the application does.
  }, []);

  /** Stores the enabled/disabled flags of the plugins. */
  const persistEnabledStates = async (): Promise<void> => {
    const registry = registryRef.current;
    const settings = settingsRef.current;
    if (!registry || !settings) return;
    const states: Record<string, boolean> = {};
    for (const entry of registry.list()) states[entry.plugin.manifest.id] = entry.enabled;
    try {
      await settings.setEnabledStates(states);
    } catch {
      /* the storage is not available */
    }
  };

  const enablePlugin = async (id: string): Promise<void> => {
    const registry = registryRef.current;
    const host = hostRef.current;
    if (!registry || !host) return;
    registry.enable(id);
    await host.activate(id);
    // The contributions of the plugin changed: the slots must be redrawn.
    setPluginVersion((v) => v + 1);
    await persistEnabledStates();
  };

  const disablePlugin = async (id: string): Promise<void> => {
    const registry = registryRef.current;
    const host = hostRef.current;
    if (!registry || !host) return;
    registry.disable(id);
    await host.deactivate(id);
    // The contributions of the plugin are gone: the slots must be redrawn.
    setPluginVersion((v) => v + 1);
    await persistEnabledStates();
  };

  const resetPluginSettings = async (id: string): Promise<void> => {
    const settings = settingsRef.current;
    if (!settings) return;
    try {
      await settings.reset(id);
    } catch {
      /* the storage is not available */
    }
  };

  /* -------------------------------------------------------------- events */

  /** Opens a note and tells the plugins about it. */
  const openNote = async (path: string): Promise<void> => {
    await actions.openNote(path);
    const snapshot = appStore.getSnapshot();
    const host = hostRef.current;
    if (!host) return;
    if (snapshot.note.path !== path || snapshot.note.status === 'error') return;
    host.emit('note.updated', { path, revision: snapshot.note.revision });
    host.emit('workspace.opened', { path });
  };

  /**
   * Confirms the current dialog.
   *
   * The events are emitted only when the server confirmed the change: the
   * new state of the tree is the proof of it.
   */
  const confirmDialog = async (): Promise<void> => {
    const { kind, node, value, parentPath } = dialog;
    await actions.confirmDialog();
    const host = hostRef.current;
    if (!host) return;
    const snapshot = appStore.getSnapshot();
    const paths = new Set(snapshot.tree.files.map((file) => file.path));

    if (kind === 'create-file') {
      const path = snapshot.note.path;
      if (path && paths.has(path)) host.emit('note.created', { path });
    } else if (kind === 'create-folder') {
      const parent = parentPath ?? '';
      const path = parent ? `${parent}/${value ?? ''}` : (value ?? '');
      if (path) host.emit('folder.created', { path });
    } else if (kind === 'rename' && node) {
      const parent = node.parentPath ?? '';
      const path = parent ? `${parent}/${value ?? ''}` : (value ?? '');
      if (path && paths.has(path)) host.emit('note.renamed', { path, previousPath: node.path });
    } else if (kind === 'move' && node) {
      const parent = value ?? '';
      const path = parent ? `${parent}/${node.name}` : node.name;
      if (paths.has(path)) host.emit('note.moved', { path, previousPath: node.path });
    } else if (kind === 'delete' && node) {
      if (!paths.has(node.path)) host.emit('note.deleted', { path: node.path });
    }
  };

  // A finished save is reported to the plugins.
  const previousStatus = useRef(note.status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = note.status;
    const host = hostRef.current;
    if (!host) return;
    if (note.status === 'saved' && previous === 'saving' && note.path) {
      host.emit('editor.saved', { path: note.path, revision: note.revision });
    }
  }, [note.status, note.path, note.revision]);

  /* ----------------------------------------------------------- shortcuts */

  // Ctrl+K / Ctrl+P open the command palette; the search is one of its
  // commands and stays reachable through Ctrl+Shift+F.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const inEditor = Boolean((event.target as HTMLElement | null)?.closest?.('.cm-editor'));
      if (key === 'k' || key === 'p') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        actions.setSearchOpen(true);
        return;
      }
      if (key === 's' && !inEditor) {
        event.preventDefault();
        actions.explicitSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  /* ----------------------------------------------------------- derived */

  const { roots, filesByParent } = useMemo(
    () => buildTree(tree.folders, tree.files),
    [tree.folders, tree.files],
  );

  const wikiResolver = useMemo(() => createWikiResolver(tree.files), [tree.files]);

  const treeFolderPaths = useMemo(
    () => tree.folders.map((f) => f.path).sort((a, b) => a.localeCompare(b)),
    [tree.folders],
  );

  /* ---------------------------------------------- the plugin contributions */

  const pluginEntries = useMemo<PluginManagerEntry[]>(() => {
    const registry = registryRef.current;
    if (!registry) return [];
    return registry.list().map((entry) => ({
      id: entry.plugin.manifest.id,
      manifest: entry.plugin.manifest,
      status: toManagerStatus(entry.state),
      error: entry.error ?? null,
    }));
    // `pluginVersion` changes whenever the state of a plugin changes.
  }, [pluginVersion]);

  const pluginPanels = useMemo(
    () => hostRef.current?.panels() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );
  const pluginSidebarItems = useMemo(
    () => hostRef.current?.sidebarItems() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );
  const pluginToolbarItems = useMemo(
    () => hostRef.current?.toolbarItems() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );
  const pluginContextMenuItems = useMemo(
    () => hostRef.current?.contextMenuItems() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );
  const pluginCommands = useMemo(
    // The commands of the application are not plugin contributions: they are
    // only shown in the command palette.
    () => (commandsRef.current?.list() ?? []).filter((cmd) => !cmd.id.startsWith(APP_COMMAND_PREFIX)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );
  const pluginSettingsSections = useMemo(
    () => hostRef.current?.settingsSections() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginVersion],
  );

  const settingsPlugin = pluginEntries.find((entry) => entry.id === settingsPluginId) ?? null;

  const statusLabel =
    note.status === 'saving'
      ? 'Saving…'
      : note.status === 'saved'
        ? 'Saved'
        : note.status === 'error'
          ? 'Save failed'
          : note.dirty
            ? 'Unsaved changes'
            : note.path
              ? 'Saved'
              : 'Idle';

  const insertAtCursor = (markdown: string) => {
    editorRef.current?.insert(markdown);
  };

  return (
    <div class={`app mode-${ui.mode}${ui.drawerOpen ? ' drawer-open' : ''}`}>
      <AppHeader
        title={note.path ? note.path.split('/').pop()! : 'Noto'}
        status={note.status}
        statusLabel={statusLabel}
        mode={ui.mode}
        drawerOpen={ui.drawerOpen}
        theme={env.theme}
        onToggleDrawer={actions.toggleDrawer}
        onSetMode={actions.setMode}
        onToggleTheme={actions.toggleTheme}
        onOpenAttachments={() => actions.openDialog({ kind: 'attachments' })}
      />

      {!env.online ? (
        <div class="offline-banner" role="status" data-testid="offline-banner">
          Offline — changes are kept locally and will be retried.
        </div>
      ) : null}

      {banner ? (
        <div class="error-banner" role="alert">
          {banner}
          <button
            type="button"
            class="icon-button"
            aria-label="Dismiss"
            onClick={actions.dismissBanner}
          >
            ×
          </button>
        </div>
      ) : null}

      <div class="app-body">
        {ui.drawerOpen ? (
          <div class="drawer-backdrop" onClick={actions.closeDrawer} aria-hidden="true" />
        ) : null}        <div class="sidebar-wrap">
          <Sidebar
            folders={roots}
            filesByParent={filesByParent}
            currentPath={note.path ?? ''}
            expanded={ui.expanded}
            onToggle={actions.toggleFolder}
            onSelect={(path) => void openNote(path)}
            onCreateFolder={(parentPath) =>
              actions.openDialog({ kind: 'create-folder', parentPath, value: 'New folder' })
            }
            onCreateFile={(parentPath) =>
              actions.openDialog({ kind: 'create-file', parentPath, value: 'note.md' })
            }
            onRename={(node) => actions.openDialog({ kind: 'rename', node, value: node.name })}
            onMove={(node) => actions.openDialog({ kind: 'move', node, value: node.parentPath })}
            onDelete={(node) => actions.openDialog({ kind: 'delete', node })}
            onOpenTrash={() => actions.openDialog({ kind: 'trash' })}
            onOpenSearch={() => actions.setSearchOpen(true)}
            onOpenTransfer={() => actions.openDialog({ kind: 'transfer' })}
            onRefresh={() => void actions.refreshTree()}
            loading={tree.loading}
          />

          <div class="noto-plugin-sidebar-area">
            <PluginSidebarSlot items={pluginSidebarItems} />
            <PluginContextMenuSlot items={pluginContextMenuItems} path={note.path ?? ''} />
            <button
              type="button"
              class="text-button"
              aria-label="Plugins"
              onClick={() => setPluginsOpen(true)}
            >
              Plugins
            </button>
            <button
              type="button"
              class="text-button"
              aria-label="Open command palette"
              onClick={() => setPaletteOpen(true)}
            >
              Commands
            </button>
          </div>
        </div>

        <main class="workspace">
          <div class="pane pane-editor">
            <PluginToolbarSlot items={pluginToolbarItems} />
            <MarkdownEditor
              value={note.content}
              path={note.path ?? ''}
              contentPath={note.contentPath}
              onChange={actions.editContent}
              onSave={actions.explicitSave}
              onHandle={(handle) => {
                editorRef.current = handle;
              }}
            />
            {!note.path ? (
              <div class="empty-state" data-testid="empty-state">
                <h2>No note selected</h2>
                <p>Pick a note in the sidebar or create a new one.</p>
              </div>
            ) : null}
          </div>
          {ui.mode === 'split' || ui.mode === 'preview' ? (
            <div class={`pane pane-preview${ui.mode === 'preview' ? ' only-preview' : ''}`}>
              <Preview
                source={note.content}
                resolve={wikiResolver}
                onOpenNote={(path) => void openNote(path)}
              />
            </div>
          ) : null}
          <PluginPanelSlot panels={pluginPanels} />
        </main>
      </div>

      <AppFooter
        saveError={note.saveError}
        status={note.status}
        currentPath={note.path ?? ''}
        onRetrySave={actions.explicitSave}
      />

      <SearchPanel
        open={ui.searchOpen}
        onClose={() => actions.setSearchOpen(false)}
        onOpenNote={(path) => void openNote(path)}
      />

      <TrashPanel
        open={dialog.kind === 'trash'}
        onClose={actions.closeDialog}
        onRestored={() => void actions.refreshTree()}
      />

      <TransferPanel
        open={dialog.kind === 'transfer'}
        onClose={actions.closeDialog}
        currentPath={note.path}
        onImported={() => void actions.refreshTree()}
      />

      <Dialog title="Plugins" open={pluginsOpen} onClose={() => setPluginsOpen(false)}>
        <PluginManagerPanel
          plugins={pluginEntries}
          onEnable={(id) => void enablePlugin(id)}
          onDisable={(id) => void disablePlugin(id)}
          onOpenSettings={(id) => setSettingsPluginId(id)}
          onResetSettings={(id) => void resetPluginSettings(id)}
        />
        <PluginCommandSlot commands={pluginCommands} />
      </Dialog>

      <Dialog
        title={settingsPlugin ? `Settings: ${settingsPlugin.manifest.name}` : 'Settings'}
        open={settingsPlugin !== null}
        onClose={() => setSettingsPluginId(null)}
      >
        {settingsPlugin?.manifest.settings?.length ? (
          <ul class="noto-plugin-list" role="list" aria-label="Plugin settings">
            {settingsPlugin.manifest.settings.map((schema) => (
              <li key={schema.key} class="noto-plugin-list-item">
                <span class="noto-plugin-name">{schema.label}</span>
                <p class="noto-plugin-description">
                  {schema.key} ({schema.type}): {String(schema.default)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {pluginSettingsSections.map((section) => (
          <section key={section.id} class="noto-plugin-settings-section">
            <h3>{section.title}</h3>
            {section.render()}
          </section>
        ))}
      </Dialog>

      <Dialog title="Attachments" open={dialog.kind === 'attachments'} onClose={actions.closeDialog}>
        <AttachmentsPanel notePath={note.path} onInsert={insertAtCursor} />
      </Dialog>

      <CommandPalette
        open={paletteOpen}
        registry={commandRegistry}
        refreshKey={pluginVersion}
        onClose={() => setPaletteOpen(false)}
        onError={(message) => actions.showBanner(message)}
      />

      <NoteDialogs
        dialog={dialog}
        folderPaths={treeFolderPaths}
        draftOffer={draftOffer}
        onClose={actions.closeDialog}
        onConfirm={() => void confirmDialog()}
        onChangeValue={actions.setDialogValue}
        onRestoreDraft={actions.restoreDraft}
        onDiscardDraft={actions.discardDraft}
      />
    </div>
  );
}
