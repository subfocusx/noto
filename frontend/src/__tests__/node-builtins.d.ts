/**
 * The minimal ambient declarations of the Node built-ins that the
 * conformance tests read the golden vectors with.
 *
 * The project does not depend on `@types/node`, and the tests are the only
 * place that touches the file system.
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
}

declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:child_process' {
  export function execFileSync(
    command: string,
    args: string[],
    options?: { encoding?: 'utf8' | 'buffer' },
  ): string;
}

/** The directory of the module (CommonJS). */
declare const __dirname: string;
