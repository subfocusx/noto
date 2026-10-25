// The state of the connection with the backend.
//
// A lost connection used to raise a red banner ("Noto is offline: the server
// could not be reached."). It is a state, not an error: the indicator shows
// it, and the banner stays for the real errors.
import { describe, expect, it, vi } from 'vitest';
import { HealthMonitor } from '../core/connection/healthMonitor';
import { connectionLabel } from '../core/connection/types';
import { setConnection } from '../core/store/actions';
import { getSnapshot, resetState } from '../core/store/state';
import { ApiError } from '../api/client';

describe('the health monitor', () => {
  it('reports a reachable backend as connected', async () => {
    const states: string[] = [];
    const monitor = new HealthMonitor({
      probe: async () => ({ status: 'ok' }),
      onChange: (state) => states.push(state),
    });

    const state = await monitor.check();

    expect(state).toBe('connected');
    expect(states).toEqual(['connected']);
  });

  it('reports a backend that does not answer as unreachable', async () => {
    const states: string[] = [];
    const monitor = new HealthMonitor({
      probe: async () => {
        throw new ApiError('network_error', 'the server could not be reached', 0);
      },
      onChange: (state) => states.push(state),
    });

    const state = await monitor.check();

    expect(state).toBe('unreachable');
    expect(states).toEqual(['unreachable']);
  });

  it('turns the state red as soon as a request fails', async () => {
    const states: string[] = [];
    const monitor = new HealthMonitor({
      probe: async () => ({ status: 'ok' }),
      onChange: (state) => states.push(state),
    });
    await monitor.check();
    expect(monitor.getState()).toBe('connected');

    monitor.reportFailure();

    expect(monitor.getState()).toBe('unreachable');
    expect(states).toEqual(['connected', 'unreachable']);
  });

  it('reuses a probe that is already running', async () => {
    const probe = vi.fn(async () => ({ status: 'ok' }));
    const monitor = new HealthMonitor({ probe });

    await Promise.all([monitor.check(), monitor.check()]);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('describes the state for the user', () => {
    expect(connectionLabel('connected')).toBe('Backend connected');
    expect(connectionLabel('connecting')).toContain('Checking');
    expect(connectionLabel('unreachable')).toContain('unreachable');
  });
});

describe('the state of the application', () => {
  it('keeps the connection apart from the connectivity of the browser', () => {
    resetState();
    expect(getSnapshot().env.online).toBe(true);
    expect(getSnapshot().env.connection).toBe('connecting');

    setConnection('unreachable');

    expect(getSnapshot().env.connection).toBe('unreachable');
    // The browser is still online: the backend is the one that is missing.
    expect(getSnapshot().env.online).toBe(true);
  });
});
