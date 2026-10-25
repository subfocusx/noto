import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { appStore } from '../core/store/appStore';
import { FindPanel } from '../components/FindPanel';

vi.mock('../api/client', () => ({
  search: vi.fn(async () => []),
}));

afterEach(() => {
  appStore.reset();
  window.history.replaceState(null, '', '/');
});

function renderWindow() {
  return render(
    <FindPanel
      open
      mode="filters"
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenNote={() => undefined}
    />,
  );
}

describe('the filter and the address bar', () => {
  it('writes the query of the filter into the address', async () => {
    appStore.actions.setQuery('tag == "work"');
    renderWindow();

    await vi.waitFor(() => {
      expect(window.location.search).toContain('q=');
    });
    expect(new URLSearchParams(window.location.search).get('q')).toBe('tag == "work"');
  });

  it('takes the query of the address into the filter', async () => {
    window.history.replaceState(null, '', '/?q=tag%20%3D%3D%20%22work%22');
    renderWindow();

    await vi.waitFor(() => {
      expect(appStore.getSnapshot().ui.query).toBe('tag == "work"');
    });
  });

  it('keeps the route of the application in the address', async () => {
    window.history.replaceState(null, '', '/#/note/a.md');
    appStore.actions.setQuery('work');
    renderWindow();

    await vi.waitFor(() => {
      expect(window.location.search).toContain('q=');
    });
    expect(window.location.hash).toBe('#/note/a.md');
  });
});
