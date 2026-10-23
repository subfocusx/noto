import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { CommandPalette } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { MarkdownEditor, type EditorHandle } from './components/Editor';
import { NoteBreadcrumbs } from './components/NoteBreadcrumbs';
import { NoteDialogs } from './components/NoteDialogs';
import {
  PluginCommandSlot,
  PluginContextMenuSlot,
  PluginPanelSlot,
  PluginSidebarSlot,
  PluginToolbarSlot,
} from './components/PluginSlots';
import type { PluginManagerEntry, PluginManagerPanelProps, PluginManagerStatus } from './components/PluginManagerPanel';
import { Preview } from './components/Preview';
import type { SearchPanelProps } from './components/SearchPanel';
import type { SettingsDialogProps } from './components/SettingsDialog';
import type { ShortcutHelpProps } from './components/ShortcutHelp';
import { Sidebar } from './components/Sidebar';
import type { TrashPanelProps } from './components/TrashPanel';
import type { TransferPanelProps } from './components/TransferPanel';
import { TreeContextMenu } from './components/TreeContextMenu';
import { createPluginApi } from './core/api/pluginApi';
import { registerAppCommands, APP_COMMAND_PREFIX } from './core/commands/appCommands';
import { CommandRegistry } from './core/commands/commandRegistry';
import { matchesShortcut, SHORTCUTS } from './core/commands/shortcuts';
import { EventBus } from './core/events/eventBus';
import { SettingsStore } from './core/settings/settingsStore';
import { appStore } from './core/store/appStore';
import { useAppActions, useAppState } from './core/store/hooks';
import { buildTree } from './lib/tree';
import { createWikiResolver } from './lib/wiki';
import { Icon } from './ui/icons';
import type { Node } from './types';
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

/** The shortcuts of the commands of the application, shown in the palette. */
const PALETTE_SHORTCUTS: Record<string, string> = {
  'app:new-note': 'Ctrl+Alt+N',
  'app:search': 'Ctrl+Shift+F',
  'app:settings': 'Ctrl+,',
  'app:shortcuts': 'Ctrl+/',
  'app:toggle-sidebar': 'Ctrl+Alt+B',
  'app:toggle-theme': 'Ctrl+Alt+T',
};

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

  /* --------------------------------------------------------------- theme */

  // The chosen theme is written into the document; the `system` theme follows
  // the operating system, also when it changes while the application is open.
  useEffect(() => {
    actions.applyTheme(env.theme);
    if (env.theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => actions.setEffectiveTheme(query.matches ? 'light' : 'dark');
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [actions, env.theme]);

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
  // The state of the palette lives in the store, so the keyboard handler can
  // read it at any moment without a stale closure.
  const paletteOpen = ui.paletteOpen;
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
      openSettings: () => appStore.actions.setSettingsOpen(true),
      openShortcuts: () => appStore.actions.setShortcutHelpOpen(true),
      toggleSidebar: () => appStore.actions.toggleSidebar(),
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

  // The shortcuts come from one list (`./core/commands/shortcuts.ts`), so the
  // handler, the palette and the help dialog can never disagree.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inEditor = Boolean((event.target as HTMLElement | null)?.closest?.('.cm-editor'));

      // Escape closes the open overlay. The handler of the shell is used on
      // purpose: it is registered when the application starts, so Escape works
      // even in the moment when an overlay has just appeared and its own
      // listener is not mounted yet. The state is read from the store, so the
      // handler never works with an outdated value.
      const snapshot = appStore.getSnapshot();
      if (event.key === 'Escape') {
        if (snapshot.ui.paletteOpen) {
          event.preventDefault();
          actions.setPaletteOpen(false);
          return;
        }
        if (snapshot.ui.searchOpen) {
          event.preventDefault();
          actions.setSearchOpen(false);
          return;
        }
        if (snapshot.ui.settingsOpen) {
          event.preventDefault();
          actions.setSettingsOpen(false);
          return;
        }
        if (snapshot.ui.shortcutHelpOpen) {
          event.preventDefault();
          actions.setShortcutHelpOpen(false);
          return;
        }
      }

      for (const shortcut of SHORTCUTS) {
        if (!matchesShortcut(event, shortcut.keys)) continue;
        // The shortcuts of the editor belong to CodeMirror itself.
        if (shortcut.group === 'Редактор') return;
        switch (shortcut.id) {
          case 'palette':
          case 'palette.secondary':
            event.preventDefault();
            actions.togglePalette();
            return;
          case 'search':
            event.preventDefault();
            actions.setSearchOpen(true);
            return;
          case 'shortcutHelp':
            event.preventDefault();
            actions.setShortcutHelpOpen(true);
            return;
          case 'settings':
            event.preventDefault();
            actions.setSettingsOpen(true);
            return;
          case 'newNote':
            event.preventDefault();
            actions.openDialog({ kind: 'create-file', parentPath: '', value: 'note.md' });
            return;
          case 'save':
            if (!inEditor) {
              event.preventDefault();
              actions.explicitSave();
            }
            return;
          case 'toggleSidebar':
            event.preventDefault();
            actions.toggleSidebar();
            return;
          case 'toggleTheme':
            event.preventDefault();
            actions.toggleTheme();
            return;
          default:
            return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  /* ------------------------------------------- the rarely used dialogs */

  // The dialogs of the settings, of the shortcuts and the panels of the
  // trash, of the import/export and of the plugins are opened rarely, so they
  // are loaded on demand: they stay out of the entry chunk.
  const [lazyPanels, setLazyPanels] = useState<{
    TrashPanel: ComponentType<TrashPanelProps>;
    TransferPanel: ComponentType<TransferPanelProps>;
    PluginManagerPanel: ComponentType<PluginManagerPanelProps>;
  } | null>(null);

  const needLazyPanels =
    pluginsOpen || dialog.kind === 'trash' || dialog.kind === 'transfer';

  useEffect(() => {
    if (!needLazyPanels || lazyPanels) return;
    let cancelled = false;
    void import('./components/LazyPanels').then((module) => {
      if (cancelled) return;
      setLazyPanels({
        TrashPanel: module.TrashPanel,
        TransferPanel: module.TransferPanel,
        PluginManagerPanel: module.PluginManagerPanel,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [needLazyPanels, lazyPanels]);

  const [lazyOverlays, setLazyOverlays] = useState<{
    SearchPanel: ComponentType<SearchPanelProps>;
  } | null>(null);

  useEffect(() => {
    if (!ui.searchOpen || lazyOverlays) return;
    let cancelled = false;
    void import('./components/LazyOverlays').then((module) => {
      if (cancelled) return;
      setLazyOverlays({ SearchPanel: module.SearchPanel });
    });
    return () => {
      cancelled = true;
    };
  }, [ui.searchOpen, lazyOverlays]);

  const [SettingsDialogComponent, setSettingsDialogComponent] = useState<
    ComponentType<SettingsDialogProps> | null
  >(null);
  const [ShortcutHelpComponent, setShortcutHelpComponent] = useState<
    ComponentType<ShortcutHelpProps> | null
  >(null);

  useEffect(() => {
    if (!ui.settingsOpen || SettingsDialogComponent) return;
    let cancelled = false;
    void import('./components/SettingsDialog').then((module) => {
      if (!cancelled) setSettingsDialogComponent(() => module.SettingsDialog);
    });
    return () => {
      cancelled = true;
    };
  }, [ui.settingsOpen, SettingsDialogComponent]);

  useEffect(() => {
    if (!ui.shortcutHelpOpen || ShortcutHelpComponent) return;
    let cancelled = false;
    void import('./components/ShortcutHelp').then((module) => {
      if (!cancelled) setShortcutHelpComponent(() => module.ShortcutHelp);
    });
    return () => {
      cancelled = true;
    };
  }, [ui.shortcutHelpOpen, ShortcutHelpComponent]);

  /* ----------------------------------------------------------- derived */

  const { roots, filesByParent } = useMemo(
    () => buildTree(tree.folders, tree.files, ui.treeSort),
    [tree.folders, tree.files, ui.treeSort],
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

  /** Opens the context menu of the tree. */
  const openTreeContextMenu = (payload: {
    path: string;
    isFolder: boolean;
    x: number;
    y: number;
  }) => {
    actions.openContextMenu(payload);
  };

  /** The node of the tree that the context menu belongs to. */
  const contextNode = useMemo(() => {
    const menu = ui.contextMenu;
    if (!menu) return null;
    if (menu.isFolder) return tree.folders.find((folder) => folder.path === menu.path) ?? null;
    return tree.files.find((file) => file.path === menu.path) ?? null;
  }, [ui.contextMenu, tree.folders, tree.files]);

  /** Renames a note directly in the tree. */
  const renameInline = async (node: Node, name: string) => {
    if (!name || name === node.name) return;
    try {
      await actions.renameNode(node, name);
    } catch (err) {
      actions.showBanner(err instanceof Error ? err.message : 'Could not rename the note');
    }
  };

  return (
    <div class={`app mode-${ui.mode}${ui.drawerOpen ? ' drawer-open' : ''}${ui.sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <AppHeader
        title={note.path ? note.path.split('/').pop()! : 'Noto'}
        status={note.status}
        statusLabel={statusLabel}
        mode={ui.mode}
        drawerOpen={ui.drawerOpen}
        theme={env.theme}
        effectiveTheme={env.effectiveTheme}
        onToggleDrawer={actions.toggleDrawer}
        onSetMode={actions.setMode}
        onToggleTheme={actions.toggleTheme}
        onOpenAttachments={() => actions.openDialog({ kind: 'attachments' })}
      />

      <NoteBreadcrumbs path={note.path ?? ''} onOpenFolder={(path) => actions.expandFolder(path)} />

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
            recentPaths={ui.recentPaths}
            onOpenRecent={(path) => void openNote(path)}
            onRemoveRecent={actions.removeRecent}
            onContextMenu={openTreeContextMenu}
            onRenameInline={(node, name) => renameInline(node, name)}
            collapsed={ui.sidebarCollapsed}
            onToggleCollapse={actions.toggleSidebar}
            sidebarWidth={ui.sidebarWidth}
            onResizeWidth={actions.setSidebarWidth}
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
              onClick={() => actions.setPaletteOpen(true)}
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
              fontSize={ui.editorFontSize}
              wrap={ui.editorWrap}
              onChange={actions.editContent}
              onSave={actions.explicitSave}
              onHandle={(handle) => {
                editorRef.current = handle;
              }}
            />
            {!note.path ? (
              <div class="empty-state" data-testid="empty-state">
                <Icon name="file-text" size={32} class="empty-state-icon" />
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

      {lazyOverlays && ui.searchOpen ? (
        <lazyOverlays.SearchPanel
          open={ui.searchOpen}
          onClose={() => actions.setSearchOpen(false)}
          onOpenNote={(path) => void openNote(path)}
        />
      ) : null}

      {lazyPanels && dialog.kind === 'trash' ? (
        <lazyPanels.TrashPanel
          open={dialog.kind === 'trash'}
          onClose={actions.closeDialog}
          onRestored={() => void actions.refreshTree()}
        />
      ) : null}

      {lazyPanels && dialog.kind === 'transfer' ? (
        <lazyPanels.TransferPanel
          open={dialog.kind === 'transfer'}
          onClose={actions.closeDialog}
          currentPath={note.path}
          onImported={() => void actions.refreshTree()}
        />
      ) : null}

      <Dialog title="Plugins" open={pluginsOpen} onClose={() => setPluginsOpen(false)}>
        {lazyPanels ? (
          <lazyPanels.PluginManagerPanel
            plugins={pluginEntries}
            onEnable={(id) => void enablePlugin(id)}
            onDisable={(id) => void disablePlugin(id)}
            onOpenSettings={(id) => setSettingsPluginId(id)}
            onResetSettings={(id) => void resetPluginSettings(id)}
          />
        ) : null}
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
        shortcuts={PALETTE_SHORTCUTS}
        onClose={() => actions.setPaletteOpen(false)}
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

      {ui.contextMenu && contextNode ? (
        <TreeContextMenu
          path={ui.contextMenu.path}
          isFolder={ui.contextMenu.isFolder}
          x={ui.contextMenu.x}
          y={ui.contextMenu.y}
          onClose={actions.closeContextMenu}
          onRename={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'rename', node, value: node.name });
          }}
          onMove={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'move', node, value: node.parentPath });
          }}
          onDelete={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'delete', node });
          }}
          onCreateFile={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'create-file', parentPath: node.path, value: 'note.md' });
          }}
          onCreateFolder={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'create-folder', parentPath: node.path, value: 'New folder' });
          }}
        />
      ) : null}

      {ui.settingsOpen && SettingsDialogComponent ? (
        <SettingsDialogComponent
          open={ui.settingsOpen}
        onClose={() => actions.setSettingsOpen(false)}
        theme={env.theme}
        mode={ui.mode}
        sidebarCollapsed={ui.sidebarCollapsed}
        sidebarWidth={ui.sidebarWidth}
        treeSort={ui.treeSort}
        editorFontSize={ui.editorFontSize}
        editorWrap={ui.editorWrap}
        online={env.online}
        version="0.1.0"
        onTheme={(theme) => actions.setTheme(theme)}
        onMode={(mode) => actions.setMode(mode)}
        onSidebarCollapsed={(collapsed) => actions.setSidebarCollapsed(collapsed)}
        onSidebarWidth={(width) => actions.setSidebarWidth(width)}
        onTreeSort={(sort) => actions.setTreeSort(sort)}
        onEditorFontSize={(size) => actions.setEditorFontSize(size)}
        onEditorWrap={(wrap) => actions.setEditorWrap(wrap)}
        onOpenPlugins={() => {
          actions.setSettingsOpen(false);
          setPluginsOpen(true);
        }}
        onOpenShortcuts={() => {
          actions.setSettingsOpen(false);
          actions.setShortcutHelpOpen(true);
        }}
        onOpenTrash={() => {
          actions.setSettingsOpen(false);
          actions.openDialog({ kind: 'trash' });
        }}
        onOpenTransfer={() => {
          actions.setSettingsOpen(false);
          actions.openDialog({ kind: 'transfer' });
        }}
        />
      ) : null}

      {ui.shortcutHelpOpen && ShortcutHelpComponent ? (
        <ShortcutHelpComponent
          open={ui.shortcutHelpOpen}
          onClose={() => actions.setShortcutHelpOpen(false)}
        />
      ) : null}
    </div>
  );
}
