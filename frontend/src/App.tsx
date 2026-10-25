import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { AppFooter } from './components/AppFooter';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { CommandPalette } from './components/CommandPalette';
import { ColumnResizer } from './components/ColumnResizer';
import { Dialog } from './components/Dialog';
import { EditorTabs } from './components/EditorTabs';
import { MarkdownEditor, type EditorHandle } from './components/Editor';
import { NoteBreadcrumbs } from './components/NoteBreadcrumbs';
import { NoteConflictDialog } from './components/NoteConflictDialog';
import { NoteTags } from './components/NoteTags';
import { OutlinePanel } from './components/OutlinePanel';
import { NoteDialogs } from './components/NoteDialogs';
import {
  PluginCommandSlot,
  PluginPanelSlot,
  PluginSidebarSlot,
  PluginToolbarSlot,
} from './components/PluginSlots';
import type { PluginManagerEntry, PluginManagerPanelProps, PluginManagerStatus } from './components/PluginManagerPanel';
import type { FindPanelProps } from './components/FindPanel';
import type { VaultPickerProps } from './components/VaultPicker';
import type { SettingsDialogProps } from './components/SettingsDialog';
import type { ShortcutHelpProps } from './components/ShortcutHelp';
import { Sidebar } from './components/Sidebar';
import { Rail } from './components/Rail';
import type { TrashPanelProps } from './components/TrashPanel';
import type { TransferPanelProps } from './components/TransferPanel';
import { TreeContextMenu } from './components/TreeContextMenu';
import { createPluginApi } from './core/api/pluginApi';
import { connectionMonitor } from './core/connection/monitor';
import {
  detectVaultMode,
  getVaultSessionState,
  lockVault,
  subscribeVaultSession,
} from './core/vault/session';
import { AutoLock } from './core/vault/autoLock';
import { syncVaultServiceWithSession } from './core/vault/vaultService';
import {
  registerAppCommands,
  railSectionOfShortcut,
  APP_COMMAND_PREFIX,
} from './core/commands/appCommands';
import { CommandRegistry } from './core/commands/commandRegistry';
import { matchesShortcut, SHORTCUTS } from './core/commands/shortcuts';
import { EventBus } from './core/events/eventBus';
import { SettingsStore } from './core/settings/settingsStore';
import { AUTO_LOCK_MINUTES_DEFAULT, loadPrefs } from './core/settings/prefs';
import { appStore } from './core/store/appStore';
import { useAppActions, useAppState } from './core/store/hooks';
import { localDateOf } from './core/store/actions';
import { countUnread } from './core/notifications/types';
import { extractHeadings } from './lib/outline';
import { buildTree } from './lib/tree';
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
  'app:toggle-theme': 'Ctrl+Alt+T',
  'app:section-explorer': 'Ctrl+Alt+E',
  'app:section-favorites': 'Ctrl+Alt+B',
  'app:section-calendar': 'Ctrl+Alt+C',
  'app:section-search': 'Ctrl+Alt+S',
  'app:section-filters': 'Ctrl+Alt+F',
  'app:section-history': 'Ctrl+Alt+H',
  'app:section-trash': 'Ctrl+Alt+D',
};

/** Maps the state of the registry onto the states of the manager panel. */
function toManagerStatus(state: PluginState): PluginManagerStatus {
  if (state === 'active' || state === 'loading' || state === 'enabled') return 'active';
  if (state === 'failed') return 'failed';
  if (state === 'incompatible') return 'incompatible';
  return 'disabled';
}

/** The props of the wizard of the encrypted storage. */
type VaultSetupDialogProps = {
  open: boolean;
  onClose(): void;
  onDone(): void;
  onMigrate?(): void;
};

/** The props of the wizard of the migration. */
type VaultMigrationDialogProps = {
  open: boolean;
  onClose(): void;
  onDone(): void;
};

/** The props of the screen of the unlocking. */
type VaultUnlockScreenProps = {
  onUnlocked(): void;
  storageName?: string;
};

export function App() {
  const state = useAppState();
  const actions = useAppActions();
  const editorRef = useRef<EditorHandle | null>(null);
  /** The unsubscribe function of the listener of the selection. */
  const cursorUnsubscribe = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cursorUnsubscribe.current?.();
      cursorUnsubscribe.current = null;
    },
    [],
  );

  const { tree, note, ui, env, dialog, draftOffer, banner } = state;

  // The state of the storage (open or sealed, locked or not) lives in the
  // session of the vault: the application re-renders when it changes.
  const [vaultSession, setVaultSession] = useState(getVaultSessionState());
  useEffect(() => subscribeVaultSession(setVaultSession), []);

  // The mode of the storage is owned by the server: the folder on the disk
  // says whether it is sealed.
  useEffect(() => {
    void detectVaultMode();
  }, []);

  // The automatic lock: the storage is locked after a while without
  // activity, so that a forgotten tab does not keep the key in the memory.
  useEffect(() => {
    if (vaultSession.mode !== 'sealed' || vaultSession.locked) return;
    const autoLock = new AutoLock({
      timeoutMs: (loadPrefs().autoLockMinutes ?? AUTO_LOCK_MINUTES_DEFAULT) * 60_000,
      onLock: () => {
        void lockVault();
      },
    });
    autoLock.start();
    const activity = (): void => {
      autoLock.touch();
    };
    window.addEventListener('keydown', activity);
    window.addEventListener('pointerdown', activity);
    return () => {
      autoLock.stop();
      window.removeEventListener('keydown', activity);
      window.removeEventListener('pointerdown', activity);
    };
  }, [vaultSession.mode, vaultSession.locked]);

  useEffect(() => {
    appStore.start();
    // The store reads and writes through the service of the current mode:
    // the open one, or the sealed one when the storage is encrypted.
    const stopSync = syncVaultServiceWithSession();
    return () => {
      stopSync();
      appStore.stop();
    };
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
      createNote: () => appStore.actions.openDialog({ kind: 'create-file', parentPath: '', value: '' }),
      createFolder: () =>
        appStore.actions.openDialog({ kind: 'create-folder', parentPath: '', value: '' }),
      dailyNote: () => appStore.actions.openOrCreateDailyNote(),
      openSearch: () => {
        appStore.actions.setFindMode('search');
        appStore.actions.setFindOpen(true);
      },
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
      openSection: (section) => {
        // The search and the filters are not sections of the column any more:
        // they live in one window over the application.
        if (section === 'search' || section === 'filters') {
          appStore.actions.setFindMode(section);
          appStore.actions.setFindOpen(true);
          return;
        }
        appStore.actions.setRailSection(section);
      },
      duplicateNote: () => {
        const { note } = appStore.getSnapshot();
        if (!note.path) {
          appStore.actions.showBanner('Open a note first — there is nothing to duplicate');
          return;
        }
        void appStore.actions.duplicateNote(note.path);
      },
      expandAllFolders: () => appStore.actions.expandAllFolders(),
      collapseAllFolders: () => appStore.actions.collapseAllFolders(),
      switchVault: () => {
        // The menu of the storage lives in the header of the explorer, so the
        // section is opened with it.
        appStore.actions.setRailSection('explorer');
        appStore.actions.setVaultMenuOpen(true);
      },
    });

    const host = new PluginHost({
      registry,
      bus,
      commands,
      settings,
      createApi: () => createPluginApi(),
      getEditor: () => pluginEditor(),
      // A plugin may ask whether the storage is encrypted and whether it is
      // locked. It never sees a key: the state is a frozen copy of four
      // fields, published by the application.
      getVaultState: () => {
        const session = getVaultSessionState();
        return {
          mode: session.mode,
          encrypted: session.mode === 'sealed',
          locked: session.locked,
          formatVersion: session.formatVersion,
        };
      },
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

  // The storage of the notes is asked for once, at the start: when the user
  // has not chosen a folder yet, the picker opens right away.
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  /** True when the wizard of the encrypted storage is shown. */
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  /** True when the wizard of the migration is shown. */
  const [vaultMigrationOpen, setVaultMigrationOpen] = useState(false);

  /**
   * True when the right column is opened as a drawer over the editor on a
   * narrow screen.
   */
  const [panelOverlayOpen, setPanelOverlayOpen] = useState(false);

  /**
   * True on a narrow screen, where the left and the right columns are
   * drawers over the editor instead of columns next to it.
   */
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /** The position of the cursor in the editor; it is shown in the status bar. */
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);

  /** The line of the cursor, counted from one. */
  const cursorLine = cursor?.line ?? null;

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
   * Adds a tag to the open note.
   *
   * The tag is written into the text at the position of the cursor: the text
   * is the only place where a tag lives, so the strip, the server and the
   * search index all see the same thing.
   */
  const addTag = (tag: string): void => {
    const handle = editorRef.current;
    if (!handle) return;
    handle.insert(`#${tag} `);
    handle.focus();
  };

  /**
   * Removes a tag from the open note.
   *
   * Every token `#tag` is cut out of the text, so the rest of the note stays
   * untouched. The tag is a derived property: it is gone from the text, so it
   * is gone from the strip and from the index of the server too.
   */
  const removeTag = (tag: string): void => {
    const handle = editorRef.current;
    if (!handle) return;
    const text = handle.getText();
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`#${escaped}(?![\\p{L}\\p{N}_\\-/])`, 'gu');
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) return;
    // The tokens are cut from the end, so the offsets of the earlier ones stay
    // valid.
    for (const match of matches.reverse()) {
      const from = match.index ?? 0;
      handle.insertAt('', from, from + match[0].length);
    }
    handle.focus();
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

  // The application tells the user what happened: a save that failed and a
  // version that conflicts with the one of the server are told once, when
  // they appear — not on every render.
  const notifiedStatus = useRef(note.status);
  const notifiedConflict = useRef(note.conflict);
  useEffect(() => {
    const previousStatus = notifiedStatus.current;
    const previousConflict = notifiedConflict.current;
    notifiedStatus.current = note.status;
    notifiedConflict.current = note.conflict;
    if (note.status === 'error' && previousStatus !== 'error') {
      actions.notify({
        kind: 'error',
        title: 'The note could not be saved',
        body: note.path ?? undefined,
        path: note.path ?? undefined,
      });
    }
    if (note.conflict && !previousConflict) {
      actions.notify({
        kind: 'warning',
        title: 'The note was changed somewhere else',
        body: 'Open the note to choose which version to keep.',
        path: note.path ?? undefined,
      });
    }
  }, [actions, note.status, note.conflict, note.path]);

  // The reminders of the user: when the moment comes, the application writes a
  // notification and shows a system notification of the browser, so the
  // message is seen even when the window is in the background.
  //
  // The watcher is a module of its own, and it is loaded on demand: the shell
  // of the application has no use for it before the first tick.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import('./core/reminders/watcher').then((module) => {
      if (cancelled) return;
      stop = module.startReminderWatcher();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

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
        if (snapshot.ui.findOpen) {
          event.preventDefault();
          actions.setFindOpen(false);
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
        if (shortcut.group === 'Editor') return;
        switch (shortcut.id) {
          case 'palette':
          case 'palette.secondary':
            event.preventDefault();
            actions.togglePalette();
            return;
          case 'search':
            event.preventDefault();
            actions.setFindMode('search');
            actions.setFindOpen(true);
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
            actions.openDialog({ kind: 'create-file', parentPath: '', value: '' });
            return;
          case 'save':
            if (!inEditor) {
              event.preventDefault();
              actions.explicitSave();
            }
            return;
          case 'duplicateNote': {
            event.preventDefault();
            const { note: openNoteState } = appStore.getSnapshot();
            if (!openNoteState.path) {
              actions.showBanner('Open a note first — there is nothing to duplicate');
              return;
            }
            void actions.duplicateNote(openNoteState.path);
            return;
          }
          case 'section.explorer':
          case 'section.search':
          case 'section.filters':
          case 'section.history':
          case 'section.trash': {
            event.preventDefault();
            const section = railSectionOfShortcut(shortcut.id);
            if (!section) return;
            actions.setRailSection(section);
            if (narrow) actions.setDrawerOpen(true);
            return;
          }
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
    FindPanel: ComponentType<FindPanelProps>;
    VaultPicker: ComponentType<VaultPickerProps>;
    VaultSetupDialog: ComponentType<VaultSetupDialogProps>;
    VaultMigrationDialog: ComponentType<VaultMigrationDialogProps>;
    VaultUnlockScreen: ComponentType<VaultUnlockScreenProps>;
  } | null>(null);

  useEffect(() => {
    // The screens of the encrypted storage are loaded together with the other
    // overlays: they drag the crypto core with them, and an open storage must
    // not pay for it.
    const needed =
      ui.findOpen ||
      vaultPickerOpen ||
      vaultSetupOpen ||
      vaultMigrationOpen ||
      vaultSession.mode === 'sealed';
    if (!needed || lazyOverlays) return;
    let cancelled = false;
    void import('./components/LazyOverlays').then((module) => {
      if (cancelled) return;
      setLazyOverlays({
        FindPanel: module.FindPanel,
        VaultPicker: module.VaultPicker,
        VaultSetupDialog: module.VaultSetupDialog,
        VaultMigrationDialog: module.VaultMigrationDialog,
        VaultUnlockScreen: module.VaultUnlockScreen,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    ui.findOpen,
    vaultPickerOpen,
    vaultSetupOpen,
    vaultMigrationOpen,
    vaultSession.mode,
    lazyOverlays,
  ]);

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

  /* --------------------------------------------------------------- vault */

  useEffect(() => {
    let cancelled = false;
    void actions.loadVault().then(() => {
      if (cancelled) return;
      const snapshot = appStore.getSnapshot();
      if (!snapshot.ui.vaultConfigured) setVaultPickerOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ----------------------------------------------------------- derived */

  const { roots, filesByParent } = useMemo(
    () => buildTree(tree.folders, tree.files, ui.treeSort),
    [tree.folders, tree.files, ui.treeSort],
  );

  /**
   * The paths of the notes that match the filter of the user.
   *
   * `null` means "no filter": the tree shows every note. As soon as the query
   * returns notes, the tree shows only them (and the folders that hold them),
   * so the filter is visible and not only counted.
   */
  const filterPaths = useMemo(() => {
    if (!ui.query.trim()) return null;
    return new Set(ui.queryHits.map((hit) => hit.path));
  }, [ui.query, ui.queryHits]);

  /** The headings of the open note: the outline of the right column. */
  const headings = useMemo(() => extractHeadings(note.content), [note.content]);

  /** The heading the cursor is in: the active entry of the outline. */
  const activeHeadingId = useMemo(() => {
    const line = cursorLine;
    if (!line) return null;
    let current: string | null = null;
    for (const heading of headings) {
      if ((heading.line ?? 0) <= line) current = heading.id;
      else break;
    }
    return current;
  }, [headings, cursorLine]);

  /** The open notes for the tab strip of the editor. */
  const tabItems = useMemo(
    () =>
      ui.openPaths.map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
      })),
    [ui.openPaths],
  );

  /** The number of the words of the open note. */
  const wordCount = useMemo(() => {
    const text = note.content.trim();
    if (!text) return 0;
    return text.split(/\s+/).length;
  }, [note.content]);

  /** The name of the storage of the notes. */
  const vaultName = useMemo(() => {
    const path = ui.vaultPath;
    if (!path) return 'Noto';
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? 'Noto';
  }, [ui.vaultPath]);

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

  /**
   * Moves a node that was dropped on another folder.
   *
   * The drop is refused when it makes no sense: a folder cannot be moved into
   * itself or into one of its own subfolders, and a node that already lies in
   * the target folder stays where it is.
   */
  const moveByDrop = async (node: Node, targetParentPath: string) => {
    const parent = node.parentPath ?? '';
    if (
      node.type === 'folder' &&
      (targetParentPath === node.path || targetParentPath.startsWith(`${node.path}/`))
    ) {
      actions.showBanner('A folder cannot be moved into itself');
      return;
    }
    if (parent === targetParentPath) {
      actions.showBanner('The note is already here');
      return;
    }
    try {
      await actions.moveNode(node, targetParentPath);
    } catch (err) {
      actions.showBanner(err instanceof Error ? err.message : 'Could not move the note');
    }
  };

  /** Renames a note directly in the tree. */
  const renameInline = async (node: Node, name: string) => {
    if (!name || name === node.name) return;
    try {
      await actions.renameNode(node, name);
    } catch (err) {
      actions.showBanner(err instanceof Error ? err.message : 'Could not rename the note');
    }
  };

  // An encrypted storage that is locked shows nothing but the screen of the
  // unlocking: the notes must not stay in the memory of a locked tab.
  if (vaultSession.mode === 'sealed' && vaultSession.locked) {
    return lazyOverlays ? (
      <lazyOverlays.VaultUnlockScreen
        storageName={vaultName}
        onUnlocked={() => {
          void actions.refreshTree();
        }}
      />
    ) : null;
  }

  return (
    <div
      class={`app${ui.drawerOpen ? ' drawer-open' : ''}${narrow ? '' : ui.rightPanelVisible ? '' : ' panel-hidden'}${narrow && panelOverlayOpen ? ' panel-open' : ''}`}
      data-vault-mode={vaultSession.mode}
      data-vault-locked={vaultSession.locked ? 'true' : 'false'}
    >
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
        ) : null}
        {narrow && panelOverlayOpen ? (
          <div
            class="panel-backdrop"
            onClick={() => setPanelOverlayOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <Rail
          section={ui.railSection}
          findMode={ui.findOpen ? ui.findMode : null}
          onSelect={(section) => {
            // The search and the filters are not sections of the column: they
            // live in one window over the application, and the sign that was
            // pressed says which module the window opens. The column of the
            // explorer keeps the tree.
            if (section === 'search' || section === 'filters') {
              actions.setFindMode(section);
              actions.setFindOpen(true);
              return;
            }
            actions.setRailSection(section);
            // On a narrow screen the column is a drawer over the editor: the
            // section that was chosen comes with it, otherwise the click on
            // the rail would change nothing that is seen.
            if (narrow) actions.setDrawerOpen(true);
          }}
          theme={env.effectiveTheme}
          onToggleTheme={actions.toggleTheme}
          onOpenSettings={() => actions.setSettingsOpen(true)}
          unreadCount={countUnread(ui.notifications)}
        />
        <div class="sidebar-wrap">
          <Sidebar
            section={ui.railSection}
            folders={roots}
            filesByParent={filesByParent}
            filterPaths={filterPaths}
            currentPath={note.path ?? ''}
            expanded={ui.expanded}
            onToggle={actions.toggleFolder}
            onExpandAll={actions.expandAllFolders}
            onCollapseAll={actions.collapseAllFolders}
            onSelect={(path) => void openNote(path)}
            onCreateFolder={(parentPath) =>
              actions.openDialog({ kind: 'create-folder', parentPath, value: '' })
            }
            onCreateFile={(parentPath) =>
              actions.openDialog({ kind: 'create-file', parentPath, value: '' })
            }
            onRename={(node) => actions.openDialog({ kind: 'rename', node, value: node.name })}
            onMove={(node) => actions.openDialog({ kind: 'move', node, value: node.parentPath })}
            onDelete={(node) => actions.openDialog({ kind: 'delete', node })}
            onOpenPalette={() => actions.setPaletteOpen(true)}
            onOpenPlugins={() => setPluginsOpen(true)}
            onOpenTransfer={() => actions.openDialog({ kind: 'transfer' })}
            onRefresh={() => void actions.refreshTree()}
            loading={tree.loading}
            recentPaths={ui.recentPaths}
            onOpenRecent={(path) => void openNote(path)}
            onRemoveRecent={actions.removeRecent}
            onContextMenu={openTreeContextMenu}
            onRenameInline={(node, name) => renameInline(node, name)}
            vaultName={vaultName}
            vaultPath={ui.vaultPath}
            vaultFixed={ui.vaultFixed}
            noteTotal={tree.noteTotal}
            folderTotal={tree.folderTotal}
            showCounts={ui.treeShowCounts}
            onMoveNode={moveByDrop}
            onChooseVault={() => setVaultPickerOpen(true)}
            vaultRecents={ui.vaultRecents}
            vaultMenuOpen={ui.vaultMenuOpen}
            onVaultMenuToggle={actions.setVaultMenuOpen}
            onSwitchVault={(path) => void actions.chooseVault(path)}
            vaultMode={vaultSession.mode}
            vaultLocked={vaultSession.locked}
            onVaultLock={() => {
              // An encrypted storage is locked; an open one has no key to
              // forget, so the same button opens the wizard of the encryption.
              if (vaultSession.mode === 'sealed') void lockVault();
              else setVaultSetupOpen(true);
            }}
            sidebarWidth={ui.sidebarWidth}
            onResizeWidth={actions.setSidebarWidth}
            recentCollapsed={ui.recentCollapsed}
            onToggleRecent={() => actions.setRecentCollapsed(!ui.recentCollapsed)}
            onRestored={() => void actions.refreshTree()}
            hasPluginItems={pluginSidebarItems.length > 0}
            files={tree.files}
            calendarMonth={ui.calendarMonth}
            calendarDay={ui.calendarDay}
            onCalendarMonthChange={actions.setCalendarMonth}
            onCalendarDayChange={actions.setCalendarDay}
            onCreateDailyNote={(day) => void actions.openOrCreateDailyNote(localDateOf(day))}
          >
            {pluginSidebarItems.length > 0 ? <PluginSidebarSlot items={pluginSidebarItems} /> : null}
          </Sidebar>
        </div>

        <main class="workspace">
          <EditorTabs
            tabs={tabItems}
            activePath={note.path}
            onSelect={(path) => void openNote(path)}
            onClose={(path) => {
              actions.closeTab(path);
              const rest = ui.openPaths.filter((item) => item !== path);
              if (path === note.path && rest.length > 0) void openNote(rest[rest.length - 1]!);
              // The last tab closes the note with it: a closed tab must not
              // leave the note (and its name) on the screen.
              if (path === note.path && rest.length === 0) void actions.closeNote();
            }}
          />

          <div class="breadcrumb-strip">
            <NoteBreadcrumbs path={note.path ?? ''} onOpenFolder={(path) => actions.expandFolder(path)} />
          </div>

          {note.path ? (
            <div class="note-tags-strip">
              <NoteTags
                content={note.content}
                onAddTag={addTag}
                onRemoveTag={removeTag}
              />
            </div>
          ) : null}

          <div class="workspace-panes">
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
                // The position of the cursor is shown in the status bar and
                // marks the active heading of the outline.
                const unsubscribe = handle.onSelectionChange((range) => {
                  const text = handle.getText();
                  const upTo = text.slice(0, range.from);
                  const line = upTo.split('\n').length;
                  const column = range.from - (upTo.lastIndexOf('\n') + 1) + 1;
                  setCursor({ line, column });
                });
                cursorUnsubscribe.current = unsubscribe;
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
          </div>
        </main>

        <aside
          class="panel-wrap"
          aria-label="Outline of the note"
          style={{ '--panel-width': `${ui.rightPanelWidth}px` }}
        >
          <OutlinePanel
            headings={headings}
            activeId={activeHeadingId}
            onSelect={(id) => {
              const heading = headings.find((item) => item.id === id);
              if (heading?.line) editorRef.current?.scrollToLine(heading.line);
            }}
          />
          <PluginPanelSlot panels={pluginPanels} />
          {narrow ? null : (
            <ColumnResizer
              side="right"
              label="Resize outline panel"
              min={200}
              max={480}
              onResize={actions.setRightPanelWidth}
            />
          )}
        </aside>
      </div>

      <AppFooter
        saveError={note.saveError}
        status={note.status}
        statusLabel={statusLabel}
        currentPath={note.path ?? ''}
        onRetrySave={actions.explicitSave}
        connection={env.connection}
        onRetryConnection={() => void connectionMonitor.check()}
        wordCount={wordCount}
        characterCount={note.content.length}
        cursor={cursor}
        encoding="UTF-8"
        writable
        vaultPath={ui.vaultPath}
        onTogglePanel={() => {
          // On a narrow screen the panel is a drawer over the editor, on a
          // wide one it is a column next to the editor.
          if (narrow) setPanelOverlayOpen((open) => !open);
          else actions.toggleRightPanel();
        }}
        panelVisible={narrow ? panelOverlayOpen : ui.rightPanelVisible}
        onToggleTheme={actions.toggleTheme}
        theme={env.effectiveTheme}
        onToggleDrawer={actions.toggleDrawer}
        drawerOpen={ui.drawerOpen}
        filterQuery={ui.query.trim() || null}
        filterTotal={ui.queryTotal}
        onClearFilter={actions.clearQuery}
      />

      {lazyOverlays && ui.findOpen ? (
        <lazyOverlays.FindPanel
          open={ui.findOpen}
          mode={ui.findMode}
          onModeChange={actions.setFindMode}
          onClose={() => actions.setFindOpen(false)}
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

      <NoteConflictDialog
        conflict={note.conflict}
        localContent={note.content}
        onReload={() => actions.takeServerVersion()}
        onKeepMine={() => void actions.keepLocalVersion()}
        onCopyMine={() => {
          void navigator.clipboard?.writeText(note.content).catch(() => undefined);
          actions.dismissConflict();
        }}
        onDismiss={() => actions.dismissConflict()}
      />

      {ui.contextMenu && contextNode ? (
        <TreeContextMenu
          path={ui.contextMenu.path}
          isFolder={ui.contextMenu.isFolder}
          x={ui.contextMenu.x}
          y={ui.contextMenu.y}
          pluginItems={pluginContextMenuItems}
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
          onDuplicate={() => {
            const node = contextNode;
            actions.closeContextMenu();
            if (node) void actions.duplicateNote(node.path);
          }}
          onCreateFile={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'create-file', parentPath: node.path, value: '' });
          }}
          onCreateFolder={() => {
            const node = contextNode;
            actions.closeContextMenu();
            actions.openDialog({ kind: 'create-folder', parentPath: node.path, value: '' });
          }}
        />
      ) : null}

      {ui.settingsOpen && SettingsDialogComponent ? (
        <SettingsDialogComponent
          open={ui.settingsOpen}
          onClose={() => actions.setSettingsOpen(false)}
          theme={env.theme}
          sidebarWidth={ui.sidebarWidth}
          treeSort={ui.treeSort}
          editorFontSize={ui.editorFontSize}
          editorWrap={ui.editorWrap}
          online={env.online}
          version="0.1.0"
          onTheme={(theme) => actions.setTheme(theme)}
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
        onSetUpEncrypted={() => {
          actions.setSettingsOpen(false);
          setVaultSetupOpen(true);
        }}
        />
      ) : null}

      {ui.shortcutHelpOpen && ShortcutHelpComponent ? (
        <ShortcutHelpComponent
          open={ui.shortcutHelpOpen}
          onClose={() => actions.setShortcutHelpOpen(false)}
        />
      ) : null}

      {lazyOverlays && vaultPickerOpen ? (
        <lazyOverlays.VaultPicker
          open={vaultPickerOpen}
          initialPath={ui.vaultPath}
          fixed={ui.vaultFixed}
          busy={ui.vaultBusy}
          onChoose={(path) => {
            void actions.chooseVault(path).then(() => setVaultPickerOpen(false));
          }}
          onClose={() => {
            // The picker may be skipped: the application then works with the
            // default storage, and the banner offers to choose a folder later.
            setVaultPickerOpen(false);
            if (!ui.vaultConfigured) {
              actions.showBanner('No storage folder chosen — the notes are kept in the default folder');
            }
          }}
          onCreateEncrypted={() => {
            setVaultPickerOpen(false);
            setVaultSetupOpen(true);
          }}
        />
      ) : null}

      {vaultSetupOpen && lazyOverlays ? (
        <lazyOverlays.VaultSetupDialog
          open={vaultSetupOpen}
          onClose={() => setVaultSetupOpen(false)}
          onDone={() => {
            setVaultSetupOpen(false);
            void actions.refreshTree();
          }}
          onMigrate={() => {
            setVaultSetupOpen(false);
            setVaultMigrationOpen(true);
          }}
        />
      ) : null}

      {vaultMigrationOpen && lazyOverlays ? (
        <lazyOverlays.VaultMigrationDialog
          open={vaultMigrationOpen}
          onClose={() => setVaultMigrationOpen(false)}
          onDone={() => {
            setVaultMigrationOpen(false);
            void actions.refreshTree();
          }}
        />
      ) : null}
    </div>
  );
}
