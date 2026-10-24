// Static list of built-in plugins.
//
// Built-in plugins are compiled into the application: there is no dynamic
// `import()`, no `import.meta.glob`, no remote code loading and no `eval`.
// Plugin ids and display strings are never used as a module specifier.
//
// The list is static on purpose: it is the only way to ship plugins without
// introducing an arbitrary code execution path into the application.
import type { Plugin } from './contract';
import { insertTemplatePlugin } from './builtin/insert-template';
import { wordCountPlugin } from './builtin/word-count';
import { backlinksPlugin } from './builtin/backlinks';
import { graphPlugin } from './builtin/graph';
import { tagsPlugin } from './builtin/tags';
import { activityPlugin } from './builtin/activity';
import { linksPlugin } from './builtin/links';

/**
 * The built-in plugins known to this build.
 *
 * Each entry is a static object literal created by the integration layer.
 * The order defines the order in the plugin manager panel.
 */
export const builtinPlugins: Plugin[] = [
  wordCountPlugin,
  insertTemplatePlugin,
  backlinksPlugin,
  graphPlugin,
  tagsPlugin,
  activityPlugin,
  linksPlugin,
];
