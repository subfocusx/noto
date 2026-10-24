import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { Sidebar } from '../components/Sidebar';
import { PluginSidebarSlot } from '../components/PluginSlots';

/** Renders the sidebar, with or without the contributions of the plugins. */
function renderSidebar(children?: ComponentChildren, hasPluginItems = false) {
  return render(
    <Sidebar
      folders={[]}
      filesByParent={new Map()}
      currentPath=""
      expanded={new Set<string>()}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onCreateFolder={() => undefined}
      onCreateFile={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onOpenTrash={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      hasPluginItems={hasPluginItems}
    >
      {children}
    </Sidebar>,
  );
}

describe('the area of the plugins of the sidebar', () => {
  it('is not rendered when no plugin contributes to it', () => {
    const view = renderSidebar(<PluginSidebarSlot items={[]} />);

    expect(view.container.querySelector('.noto-plugin-sidebar-area')).toBeNull();
  });

  it('is not rendered when the sidebar has no contribution at all', () => {
    const view = renderSidebar();

    expect(view.container.querySelector('.noto-plugin-sidebar-area')).toBeNull();
  });

  it('holds the entries of the plugins', () => {
    const view = renderSidebar(
      <PluginSidebarSlot items={[{ id: 'alpha', title: 'Alpha', onSelect: () => undefined }]} />,
      true,
    );

    const area = view.container.querySelector('.noto-plugin-sidebar-area');
    expect(area).not.toBeNull();
    expect(area?.querySelector('.noto-plugin-sidebar')).not.toBeNull();
    expect(area?.querySelector('button[aria-label="Alpha"]')).not.toBeNull();
  });
});
