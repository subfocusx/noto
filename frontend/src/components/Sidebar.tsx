// The column of the sections of the application.
//
// The column stands next to the rail and shows the section that is open there.
// The rail is an accordion: the column shows one section at a time, and the
// column itself never disappears.
//
// The explorer is the section that is loaded with the application: it holds the
// tree of the notes. The other sections are loaded when they are opened for the
// first time, so they stay out of the entry chunk.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, ComponentType } from 'preact';
import type { Node } from '../types';
import type { TreeFolder } from '../lib/tree';
import type { RailSection } from '../core/store/types';
import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';
import { ColumnResizer } from './ColumnResizer';
import type { TreeContextMenuPayload } from './TreeContextMenu';
import { ExplorerSection } from './sections/ExplorerSection';
import { ActivityPanel } from './sections/ActivityPanel';
import type { CalendarSectionProps } from './sections/CalendarSection';
import type { FavoritesSectionProps } from './sections/FavoritesSection';
import type { HistorySectionProps } from './sections/HistorySection';
import type { TrashSectionProps } from './sections/TrashSection';

/** The sections that are loaded on demand. */
interface LazySections {
  CalendarSection: ComponentType<CalendarSectionProps>;
  FavoritesSection: ComponentType<FavoritesSectionProps>;
  HistorySection: ComponentType<HistorySectionProps>;
  NotificationsSection: ComponentType;
  TrashSection: ComponentType<TrashSectionProps>;
}

export interface SidebarProps {
  /** The section of the rail that is open. */
  section: RailSection;
  folders: TreeFolder[];
  filesByParent: Map<string, Node[]>;
  currentPath: string;
  expanded: Set<string>;
  onToggle(path: string): void;
  /** Called when every folder of the storage must be opened at once. */
  onExpandAll?(): void;
  /** Called when every folder of the storage must be closed at once. */
  onCollapseAll?(): void;
  onSelect(path: string): void;
  onCreateFolder(parentPath: string): void;
  onCreateFile(parentPath: string): void;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  /**
   * Opens the graph of the vault.
   *
   * When the shell does not answer, the explorer opens the graph by itself.
   */
  onOpenGraph?(): void;
  /**
   * Opens the archive of the vault.
   *
   * When the shell does not answer, the explorer opens the archive by itself.
   */
  onOpenArchive?(): void;
  /** Opens the command palette of the application. */
  onOpenPalette?(): void;
  /** Opens the manager of the plugins. */
  onOpenPlugins?(): void;
  onOpenTransfer(): void;
  onRefresh(): void;
  loading: boolean;
  /** The name of the vault. */
  vaultName?: string;
  /** The path of the vault on the disk. */
  vaultPath?: string;
  /** The paths of the recently opened notes. */
  recentPaths?: string[];
  /** Called when a recent note is opened. */
  onOpenRecent?: (path: string) => void;
  /** Called when a recent note is removed from the list. */
  onRemoveRecent?: (path: string) => void;
  /**
   * Restores a version of the note that is open.
   *
   * The section restores the version by itself when the shell does not answer.
   */
  onRestoreVersion?: (path: string, revision: number) => void | Promise<void>;
  /**
   * The paths that currently exist in the tree.
   *
   * When it is missing, the column computes it from the tree it shows.
   */
  knownPaths?: string[];
  /** Called when the user asks for the menu of a row. */
  onContextMenu?: (payload: TreeContextMenuPayload) => void;
  /** Called when a row is renamed in place. */
  onRenameInline?: (node: Node, name: string) => void | Promise<void>;
  /** Called when a node is dropped on another folder. */
  onMoveNode?: (node: Node, targetParentPath: string) => void | Promise<void>;
  /** The width of the sidebar, in pixels. */
  sidebarWidth?: number;
  /** Called when the user resizes the sidebar. */
  onResizeWidth?: (width: number) => void;
  /** Called when the user asks for the dialog of the choice of the storage. */
  onChooseVault?: () => void;
  /** The storages that were opened before, the newest first. */
  vaultRecents?: string[];
  /** True when the quick menu of the storage is open. */
  vaultMenuOpen?: boolean;
  /** The mode of the storage of the notes. */
  vaultMode?: 'open' | 'sealed';
  /** True when the storage is encrypted and locked. */
  vaultLocked?: boolean;
  /** Called when the user presses the lock of the storage. */
  onVaultLock?(): void;
  /** Called when the user opens or closes the quick menu of the storage. */
  onVaultMenuToggle?(open: boolean): void;
  /** Called when the user chooses a storage from the menu. */
  onSwitchVault?(path: string): void;
  /** True when the storage is fixed by the environment and cannot be changed. */
  vaultFixed?: boolean;
  /** The total number of the folders of the vault. */
  folderTotal?: number;
  /** False when the counters of the tree are hidden. */
  showCounts?: boolean;
  /** The total number of the notes of the vault. */
  noteTotal?: number;
  /** True when the list of the recent notes is collapsed. */
  recentCollapsed?: boolean;
  /** Called when the user folds or unfolds the list of the recent notes. */
  onToggleRecent?: () => void;
  /** The contributions of the plugins, shown above the footer. */
  children?: ComponentChildren;
  /**
   * True when at least one plugin contributes to the footer of the column.
   *
   * The area of the plugins is only rendered when it holds something: an
   * empty strip would look like a broken border under the tree.
   */
  hasPluginItems?: boolean;
  /**
   * The paths of the notes that match the filter of the user.
   *
   * `null` means "no filter": the tree shows every note. A set of paths
   * filters the tree: only the matching notes and the folders that hold them
   * stay visible.
   */
  filterPaths?: Set<string> | null;
  /** Called after a note was restored from the trash. */
  onRestored?: () => void;
  /**
   * The notes of the vault.
   *
   * The calendar groups them by the day they were written on, so it needs the
   * whole tree and not only the visible part of it.
   */
  files?: Node[];
  /**
   * The month the calendar shows, as `YYYY-MM`.
   *
   * The empty string means "the month of today": the calendar shows it until
   * the user walks to another month.
   */
  calendarMonth?: string;
  /** The selected day of the calendar, as `YYYY-MM-DD`. */
  calendarDay?: string | null;
  /** Called when the user walks to another month. */
  onCalendarMonthChange?: (month: string) => void;
  /** Called when the user selects a day of the calendar. */
  onCalendarDayChange?: (day: string | null) => void;
  /** Called when the user asks for the note of a day. */
  onCreateDailyNote?: (day: string) => void;
}

/** The smallest width of the sidebar, in pixels. */
const MIN_WIDTH = 200;

/** The biggest width of the sidebar, in pixels. */
const MAX_WIDTH = 480;

export function Sidebar(props: SidebarProps) {
  const t = useT();
  const navRef = useRef<HTMLElement | null>(null);
  const [sections, setSections] = useState<LazySections | null>(null);

  /**
   * The sections that are not the explorer are loaded on demand.
   *
   * The explorer is the section that is open when the application starts, so
   * it is always there. The other three are fetched the first time the user
   * opens them.
   */
  useEffect(() => {
    if (props.section === 'explorer' || sections) return;
    let cancelled = false;
    void import('./LazySections').then((module) => {
      if (cancelled) return;
      setSections({
        CalendarSection: module.CalendarSection,
        FavoritesSection: module.FavoritesSection,
        HistorySection: module.HistorySection,
        NotificationsSection: module.NotificationsSection,
        TrashSection: module.TrashSection,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [props.section, sections]);

  /**
   * The paths of the notes that exist in the vault.
   *
   * The list of the recent notes marks the notes that were deleted in the
   * meantime: it needs to know which paths are still alive.
   */
  const knownPaths = useMemo(() => {
    if (props.knownPaths) return props.knownPaths;
    const paths: string[] = [];
    const walk = (folders: TreeFolder[]): void => {
      for (const folder of folders) {
        paths.push(folder.node.path);
        walk(folder.children);
      }
    };
    walk(props.folders);
    for (const files of props.filesByParent.values()) {
      for (const file of files) paths.push(file.path);
    }
    return paths;
  }, [props.knownPaths, props.folders, props.filesByParent]);

  // The width of the sidebar is a property of the wrapper: the sidebar only
  // tells it which width it wants.
  useEffect(() => {
    const wrap = navRef.current?.parentElement;
    if (!wrap) return;
    if (props.sidebarWidth === undefined) {
      wrap.style.removeProperty('--sidebar-width');
      return;
    }
    wrap.style.setProperty('--sidebar-width', `${props.sidebarWidth}px`);
  }, [props.sidebarWidth]);

  const openRecent = (path: string): void => {
    (props.onOpenRecent ?? props.onSelect)(path);
  };

  const renderSection = (): ComponentChildren => {
    if (props.section === 'explorer') {
      return (
        <ExplorerSection
          folders={props.folders}
          filesByParent={props.filesByParent}
          currentPath={props.currentPath}
          expanded={props.expanded}
          loading={props.loading}
          onToggle={props.onToggle}
          onExpandAll={props.onExpandAll}
          onCollapseAll={props.onCollapseAll}
          onSelect={props.onSelect}
          onCreateFolder={props.onCreateFolder}
          onCreateFile={props.onCreateFile}
          onRename={props.onRename}
          onMove={props.onMove}
          onDelete={props.onDelete}
          onContextMenu={props.onContextMenu}
          onRenameInline={props.onRenameInline}
          onMoveNode={props.onMoveNode}
          onRefresh={props.onRefresh}
          vaultName={props.vaultName}
          vaultPath={props.vaultPath}
          vaultFixed={props.vaultFixed}
          onChooseVault={props.onChooseVault}
          vaultRecents={props.vaultRecents}
          vaultMenuOpen={props.vaultMenuOpen}
          vaultMode={props.vaultMode}
          vaultLocked={props.vaultLocked}
          onVaultLock={props.onVaultLock}
          onVaultMenuToggle={props.onVaultMenuToggle}
          onSwitchVault={props.onSwitchVault}
          showCounts={props.showCounts}
          filterPaths={props.filterPaths}
          onOpenGraph={props.onOpenGraph}
          onOpenArchive={props.onOpenArchive}
          onOpenPalette={props.onOpenPalette}
          onOpenPlugins={props.onOpenPlugins}
        />
      );
    }

    if (!sections) {
      return <p class="section-hint">{t('common.loading')}</p>;
    }

    if (props.section === 'calendar') {
      return (
        <sections.CalendarSection
          files={props.files ?? []}
          month={props.calendarMonth ?? ''}
          selectedDay={props.calendarDay ?? null}
          onMonthChange={(month) => props.onCalendarMonthChange?.(month)}
          onDayChange={(day) => props.onCalendarDayChange?.(day)}
          onOpenNote={(path) => props.onSelect(path)}
          onCreateDailyNote={(day) => props.onCreateDailyNote?.(day)}
        />
      );
    }
    if (props.section === 'favorites') {
      return (
        <sections.FavoritesSection
          files={props.files ?? []}
          onOpenNote={(path) => props.onSelect(path)}
        />
      );
    }
    if (props.section === 'notifications') {
      return <sections.NotificationsSection />;
    }
    if (props.section === 'history') {
      return (
        <sections.HistorySection
          recentPaths={props.recentPaths ?? []}
          knownPaths={knownPaths}
          onOpen={openRecent}
          onRemove={(path) => props.onRemoveRecent?.(path)}
          recentCollapsed={props.recentCollapsed}
          onToggleRecent={props.onToggleRecent}
          openPath={props.currentPath || undefined}
          onRestore={props.onRestoreVersion}
        />
      );
    }
    return <sections.TrashSection onRestored={props.onRestored} />;
  };

  return (
    <nav ref={navRef} class="sidebar" aria-label={t('sidebar.notes')}>
      {/*
        The storage of the notes can be fixed by the environment. The button of
        the storage stays where it is, but it cannot open anything: the column
        of the explorer says why instead of pretending that the storage can be
        changed.
      */}
      <div class="sidebar-scroll">{renderSection()}</div>

      {props.hasPluginItems && props.children ? (
        <div class="noto-plugin-sidebar-area">{props.children}</div>
      ) : null}

      <div class="sidebar-footer">
        {/*
          The graph of the activity stands where the banner of the recent
          activity used to stand: the rhythm of the vault is told by a picture,
          not by a line of text.
        */}
        {props.files && props.files.length > 0 ? <ActivityPanel files={props.files} /> : null}
        {props.noteTotal !== undefined || props.folderTotal !== undefined ? (
          <span class="sidebar-footer-counts">
            {props.noteTotal === 1
              ? t('sidebar.oneNote', { count: props.noteTotal ?? 0 })
              : t('sidebar.manyNotes', { count: props.noteTotal ?? 0 })}{' '}
            ·{' '}
            {props.folderTotal === 1
              ? t('sidebar.oneFolder', { count: props.folderTotal ?? 0 })
              : t('sidebar.manyFolders', { count: props.folderTotal ?? 0 })}
          </span>
        ) : null}
        <button
          type="button"
          class="icon-button"
          title={t('sidebar.transfer')}
          aria-label={t('sidebar.transfer')}
          onClick={props.onOpenTransfer}
        >
          <Icon name="upload" size={15} />
        </button>
      </div>

      {props.onResizeWidth ? (
        <ColumnResizer
          side="left"
          label={t('sidebar.resize')}
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          onResize={props.onResizeWidth}
        />
      ) : null}
    </nav>
  );
}
