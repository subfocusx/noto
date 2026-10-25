import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { AppFooter } from '../components/AppFooter';
import type { ConnectionState } from '../types';

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

/** The name of the dot for every state of the connection. */
const NAMES: Array<[ConnectionState, string]> = [
  ['connected', 'Backend connected'],
  ['connecting', 'Checking the backend'],
  ['unreachable', 'The backend is unreachable'],
];

describe('the state of the backend in the status bar', () => {
  it('shows the dot with the name of every state', () => {
    const { rerender } = render(footer({ connection: 'connected' }));

    for (const [connection, name] of NAMES) {
      rerender(footer({ connection }));
      const dot = screen.getByLabelText(name);
      expect(dot.tagName).toBe('BUTTON');
      expect(dot.getAttribute('title')).toBeTruthy();
      expect(dot.classList.contains('conn-dot')).toBe(true);
      expect(dot.classList.contains(connection)).toBe(true);
    }
  });

  it('stands next to the state of the save', () => {
    render(footer({ connection: 'connected' }));

    const status = screen.getByTestId('save-status');
    const dot = screen.getByLabelText('Backend connected');
    // The dot follows the chip of the save: the bar shows the state of the
    // document and the state of the backend side by side.
    expect(status.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the dot out of the group of the toggles', () => {
    const { container } = render(footer({ connection: 'connected' }));

    const dot = screen.getByLabelText('Backend connected');
    expect(container.querySelector('.app-footer .conn-dot')).toBe(dot);
    expect(container.querySelector('.app-footer-actions .conn-dot')).toBeNull();
  });

  it('asks the application to check the backend again', () => {
    const onRetryConnection = vi.fn();
    render(footer({ connection: 'unreachable', onRetryConnection }));

    fireEvent.click(screen.getByLabelText('The backend is unreachable'));
    expect(onRetryConnection).toHaveBeenCalled();
  });
});
