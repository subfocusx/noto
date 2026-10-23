// Scoped logger used by the plugin host.
//
// Boundary note: `core/**` must not import from `src/plugins/**`, so the
// logger shape is declared structurally here; it is compatible with the
// `PluginLogger` interface of the plugin contract.
//
// PRIVACY: plugins must never log note content. The logger only prefixes
// the scope so that log lines can be attributed to a plugin; it cannot and
// does not inspect the logged payload. Plugin authors are responsible for
// never passing document text to the logger.

/** Structural shape of a logger (compatible with `PluginLogger`). */
export interface LoggerLike {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Creates a logger that prefixes every message with `[noto:<scope>]`.
 *
 * @param scope usually the plugin id.
 */
export function createLogger(scope: string): LoggerLike {
  const prefix = `[noto:${scope}]`;
  return {
    debug(msg: string, ...args: unknown[]): void {
      console.debug(prefix, msg, ...args);
    },
    info(msg: string, ...args: unknown[]): void {
      console.info(prefix, msg, ...args);
    },
    warn(msg: string, ...args: unknown[]): void {
      console.warn(prefix, msg, ...args);
    },
    error(msg: string, ...args: unknown[]): void {
      console.error(prefix, msg, ...args);
    },
  };
}
