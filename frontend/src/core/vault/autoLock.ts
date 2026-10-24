// The automatic lock of the encrypted storage.
//
// The vault must not stay open on a machine that nobody watches. The
// controller below locks the storage after a period of inactivity: the
// application reports every edit, click and keystroke with `touch()`, and the
// controller locks the storage when nothing happens for the whole timeout.
//
// The controller knows nothing about the keys: it only calls the callback it
// was given. The caller (the shell of the application) locks the vault through
// the session.

/** The options of the automatic lock. */
export interface AutoLockOptions {
  /** The number of milliseconds of inactivity after which the lock fires. */
  timeoutMs: number;
  /** Called once when the inactivity lasts longer than the timeout. */
  onLock(): void;
  /** The clock of the controller; `Date.now` by default. */
  now?(): number;
}

/**
 * Locks the encrypted storage after a period of inactivity.
 *
 * The controller is started once and stopped when the storage is locked by
 * hand. Every call of `touch()` postpones the lock.
 */
export class AutoLock {
  private readonly options: AutoLockOptions;

  /** The timer of the pending lock, `null` when the controller is stopped. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** The moment of the last reported activity. */
  private lastActivity = 0;

  constructor(options: AutoLockOptions) {
    this.options = options;
  }

  /** Starts the controller; the timeout begins now. */
  start(): void {
    this.stop();
    this.lastActivity = this.now();
    this.schedule();
  }

  /** Stops the controller; the storage is not locked any more. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Reports an activity of the user.
   *
   * The lock is postponed; calling it while the controller is stopped does
   * nothing.
   */
  touch(): void {
    this.lastActivity = this.now();
    if (this.timer !== null) this.schedule();
  }

  /** The number of milliseconds since the last reported activity. */
  getIdleMs(): number {
    return this.now() - this.lastActivity;
  }

  /** The current time, according to the clock of the options. */
  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** Arms the timer for the time that is left. */
  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const idle = this.now() - this.lastActivity;
    const remaining = Math.max(0, this.options.timeoutMs - idle);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.options.onLock();
    }, remaining);
  }
}
