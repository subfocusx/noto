// Static list of built-in plugins.
//
// Built-in plugins are compiled into the application: there is no dynamic
// `import()`, no `import.meta.glob`, no remote code loading and no `eval`.
// Plugin ids and display strings are never used as a module specifier.
//
// The list is filled in by the integration wave that adds the example
// plugins; until then it stays empty and the platform works unchanged.
import type { Plugin } from './contract';

/**
 * The built-in plugins known to this build.
 *
 * Each entry is a static object literal created by the integration layer.
 */
export const builtinPlugins: Plugin[] = [];
