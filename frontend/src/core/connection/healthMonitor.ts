// The monitor of the connection with the Noto backend.
//
// The application used to show "Noto is offline: the server could not be
// reached." as a red banner, even when the browser was online and the server
// was simply slow to answer. The banner is the wrong tool for that: a lost
// connection is a state, not an error. The state belongs to a small indicator
// that the user can read at a glance and that can be retried with a click.
//
// The monitor polls the public health endpoint. It never touches the notes:
// the probe carries no payload and no private data.
import { getHealth } from '../../api/health';
import type { ConnectionState } from './types';

/** The interval between two probes when the backend answered. */
const HEALTHY_INTERVAL_MS = 15_000;

/** The first delay between two probes when the backend did not answer. */
const FAILURE_INTERVAL_MS = 5_000;

/** The longest delay between two probes when the backend did not answer. */
const MAX_FAILURE_INTERVAL_MS = 60_000;

export interface HealthMonitorOptions {
  /** The probe: resolves when the backend answers, rejects otherwise. */
  probe?: () => Promise<unknown>;
  /** The interval between two probes when the backend answered. */
  intervalMs?: number;
  /** The first delay between two probes after a failure. */
  failureIntervalMs?: number;
  /** The longest delay between two probes after a failure. */
  maxFailureIntervalMs?: number;
  /** Called with the new state whenever it changes. */
  onChange?: (state: ConnectionState) => void;
  /** The window the monitor listens to; `null` disables the listeners. */
  target?: Window | null;
}

/**
 * Polls the backend and reports whether it answers.
 *
 * The monitor is deliberately boring: one probe at a time, a growing delay
 * after a failure, and an immediate probe when the tab becomes visible again
 * or when the browser reports that the network came back.
 */
export class HealthMonitor {
  private readonly probe: () => Promise<unknown>;
  private readonly intervalMs: number;
  private readonly failureIntervalMs: number;
  private readonly maxFailureIntervalMs: number;
  private onChange: ((state: ConnectionState) => void) | undefined;  private readonly target: Window | null;

  private state: ConnectionState = 'connecting';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight: Promise<ConnectionState> | null = null;
  private failures = 0;

  constructor(options: HealthMonitorOptions = {}) {
    this.probe = options.probe ?? (() => getHealth());
    this.intervalMs = options.intervalMs ?? HEALTHY_INTERVAL_MS;
    this.failureIntervalMs = options.failureIntervalMs ?? FAILURE_INTERVAL_MS;
    this.maxFailureIntervalMs = options.maxFailureIntervalMs ?? MAX_FAILURE_INTERVAL_MS;
    this.onChange = options.onChange;
    this.target =
      options.target === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.target;
  }

  /** The state of the connection as it is known now. */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Replaces the listener of the state.
   *
   * The listener is set after the construction so that the monitor does not
   * have to know the store: the store knows the monitor.
   */
  setOnChange(listener: ((state: ConnectionState) => void) | undefined): void {
    this.onChange = listener;
  }

  /** Starts the polling and the listeners of the browser. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.target?.addEventListener('online', this.handleOnline);
    this.target?.addEventListener('focus', this.handleFocus);
    void this.check();
  }

  /** Stops the polling and removes the listeners. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.target?.removeEventListener('online', this.handleOnline);
    this.target?.removeEventListener('focus', this.handleFocus);
  }

  /**
   * Runs a probe now and returns the new state.
   *
   * The call is safe to make from anywhere: a probe that is already running
   * is reused instead of starting a second one.
   */
  check(): Promise<ConnectionState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runProbe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Reports that an API call failed because the server did not answer.
   *
   * The state of the monitor follows the failure immediately, without waiting
   * for the next scheduled probe: the user must not keep a green light while
   * the backend is down.
   */
  reportFailure(): void {
    this.failures += 1;
    this.apply('unreachable');
    this.schedule();
  }

  private readonly handleOnline = (): void => {
    void this.check();
  };

  private readonly handleFocus = (): void => {
    // A tab that was in the background may have missed a change of the state
    // of the server; the answer is cheap and the user wants the truth.
    if (this.state !== 'connected') void this.check();
  };

  private async runProbe(): Promise<ConnectionState> {
    try {
      await this.probe();
      this.failures = 0;
      this.apply('connected');
    } catch {
      this.failures += 1;
      this.apply('unreachable');
    }
    this.schedule();
    return this.state;
  }

  /** Plans the next probe. */
  private schedule(): void {
    if (!this.running) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delay =
      this.state === 'connected'
        ? this.intervalMs
        : Math.min(
            this.failureIntervalMs * 2 ** Math.max(0, this.failures - 1),
            this.maxFailureIntervalMs,
          );
    this.timer = setTimeout(() => {
      void this.check();
    }, delay);
  }

  /** Publishes a new state when it differs from the current one. */
  private apply(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.onChange?.(state);
  }
}
