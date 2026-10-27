// The badge of the writes that wait for the connection in the status bar.
//
// The counter lives in the store (`env.pendingSync`), and the bar reads it
// alone through `useAppSelector`: the test publishes the number through the
// action of the store, exactly as the queue of the offline writes does.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { AppFooter } from '../components/AppFooter';
import { appStore } from '../core/store/appStore';
import { loadCatalogue } from '../i18n';

/** The status bar, with the state of the backend that a test needs. */
function footer(props: Partial<ComponentProps<typeof AppFooter>> = {}) {
  return (
    <AppFooter
      saveError={null}
      status="saved"
      statusLabel="Saved"
      connection="connected"
      currentPath="notes/a.md"
      onRetrySave={() => undefined}
      {...props}
    />
  );
}

beforeEach(async () => {
  // The catalogue of the strings travels in its own chunk: the test waits for
  // it, so the badge draws a text and not the raw key.
  await loadCatalogue('en');
  appStore.reset();
  appStore.actions.setPendingSync(0);
});

describe('the badge of the writes that wait', () => {
  it('is absent when nothing waits', () => {
    const { container } = render(footer());

    expect(container.querySelector('.footer-pending')).toBeNull();
    expect(screen.queryByTestId('footer-pending')).toBeNull();
  });

  it('counts the writes that wait', () => {
    appStore.actions.setPendingSync(3);
    render(footer());

    const badge = screen.getByTestId('footer-pending');
    expect(badge.textContent).toContain('3');
    expect(badge.classList.contains('footer-pending')).toBe(true);
  });

  it('names the number in the label of the badge', () => {
    appStore.actions.setPendingSync(3);
    render(footer());

    const badge = screen.getByTestId('footer-pending');
    expect(badge.getAttribute('title')).toContain('3');
    expect(badge.getAttribute('aria-label')).toContain('3');
  });

  it('follows the counter of the store', () => {
    const { rerender } = render(footer());
    expect(screen.queryByTestId('footer-pending')).toBeNull();

    appStore.actions.setPendingSync(2);
    rerender(footer());
    expect(screen.getByTestId('footer-pending').textContent).toContain('2');

    appStore.actions.setPendingSync(0);
    rerender(footer());
    expect(screen.queryByTestId('footer-pending')).toBeNull();
  });
});
