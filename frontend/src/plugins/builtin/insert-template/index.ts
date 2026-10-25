// The "Insert Template" built-in plugin.
//
// The plugin contributes a single command that inserts a user configurable
// Markdown template into the note that is currently open in the editor.
//
// Everything happens through the public contract only:
//   * `ctx.registerCommand` — contributes the command;
//   * `ctx.settings.get`    — reads the template from the plugin settings;
//   * `ctx.editor.insertAt` — writes the text (it reports the change to the
//     application, so the autosave works as usual);
//   * `ctx.logger`          — reports everything that cannot be done.
//
// The permissions of the manifest are enforced by the host, so the plugin
// declares exactly what it uses: `ui.contribute` for the command,
// `editor.read` for the cursor position and `editor.write` for the insertion.
//
// The editor is read through the live getter of the context inside the
// command, so the plugin also works when it was activated before the first
// note was opened.
//
// Boundary rule R3 allows a built-in plugin to use only
// `src/plugins/contract.ts`, so the whole plugin lives in this one file.
import type { Plugin, PluginContext, PluginEditor, PluginManifest } from '../../contract';

/** Id of the command contributed by the plugin. */
export const INSERT_TEMPLATE_COMMAND_ID = 'insert-template:insert';

/** Key of the user setting that holds the Markdown template. */
export const TEMPLATE_SETTING_KEY = 'template';

/**
 * Default template: a small Markdown skeleton of a note
 * (heading, task list and a notes section).
 */
export const DEFAULT_TEMPLATE = [
  '# New note',
  '',
  '## Tasks',
  '',
  '- [ ] ',
  '- [ ] ',
  '',
  '## Notes',
  '',
].join('\n');

/** Static description of the plugin. */
export const insertTemplateManifest: PluginManifest = {
  id: 'insert-template',
  name: 'Insert Template',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description:
    'Inserts a configurable Markdown template into the active note at the position of the cursor.',
  author: 'Noto',
  // The plugin contributes a command (`ui.contribute`), reads the cursor
  // position of the editor (`editor.read`) and writes the template into it
  // (`editor.write`).
  permissions: ['editor.read', 'editor.write', 'ui.contribute'],
  settings: [
    {
      key: TEMPLATE_SETTING_KEY,
      label: 'Template',
      type: 'string',
      default: DEFAULT_TEMPLATE,
      description: 'The Markdown text that is inserted into the note.',
    },
  ],
};

/**
 * Reads the template from the plugin settings.
 *
 * Falls back to the default template when nothing is stored or when the
 * stored value is not a usable string.
 */
async function resolveTemplate(ctx: PluginContext): Promise<string> {
  try {
    const stored = await ctx.settings.get<string>(TEMPLATE_SETTING_KEY);
    if (typeof stored === 'string' && stored.trim().length > 0) return stored;
  } catch (err) {
    ctx.logger.warn('cannot read the setting of the template, the default is used', err);
  }
  return DEFAULT_TEMPLATE;
}

/**
 * Inserts the template at the current cursor position.
 *
 * `insertAt(text, from, from)` inserts the text at the cursor without
 * touching the current selection: `from === to` means "insert, replace
 * nothing". `insert()` would replace the whole selection instead.
 */
function insertAtCursor(editor: PluginEditor, text: string): void {
  const cursor = editor.getCursor();
  const from = Math.max(0, cursor.from);
  editor.insertAt(text, from, from);
}

/**
 * True when the error is a permission error of the plugin platform.
 *
 * The class itself cannot be imported as a value (a built-in plugin may only
 * use the contract as a type-only module), so the error is recognized by its
 * name.
 */
function isPermissionError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PluginPermissionError';
}

/**
 * Runs the command.
 *
 * The editor is taken from the live getter of the context, so the command
 * also works when the plugin was activated before the first note was opened.
 *
 * Never throws: every failure is logged, the application is not disturbed.
 */
async function runInsertTemplate(ctx: PluginContext): Promise<void> {
  // The editor is live: it is the editor that is open NOW, not the one that
  // was open when the plugin was activated.
  const editor = ctx.editor;
  if (!editor) {
    // No note is open: there is nothing to insert into. The contract has no
    // dialogs, so the user only sees that nothing happened — the reason is
    // written to the log of the plugin.
    ctx.logger.info('the template is not inserted: no open note');
    return;
  }

  const template = await resolveTemplate(ctx);

  try {
    insertAtCursor(editor, template);
    ctx.logger.debug('the template is inserted into the note');
  } catch (err) {
    if (isPermissionError(err)) {
      ctx.logger.error('the template is not inserted: not enough rights', err);
      return;
    }
    ctx.logger.error('cannot insert the template into the note', err);
  }
}

/**
 * Creates a new instance of the plugin.
 *
 * Every instance owns its own registration, so an instance can be activated
 * and deactivated independently.
 */
export function createInsertTemplatePlugin(): Plugin {
  let unregisterCommand: (() => void) | null = null;

  return {
    manifest: insertTemplateManifest,

    activate(ctx: PluginContext): void {
      const unregister = ctx.registerCommand({
        id: INSERT_TEMPLATE_COMMAND_ID,
        title: 'Insert template',
        description: 'Inserts a Markdown template into the active note at the position of the cursor.',
        run: () => runInsertTemplate(ctx),
      });
      unregisterCommand = unregister;

      // The host removes every registration of the plugin on its own, but the
      // plugin also cleans up explicitly, so that a manual `deactivate()`
      // removes the command as well.
      ctx.onDeactivate(() => {
        unregister();
        unregisterCommand = null;
      });
    },

    deactivate(): void {
      unregisterCommand?.();
      unregisterCommand = null;
    },
  };
}

/** The built-in instance of the plugin. */
export const insertTemplatePlugin: Plugin = createInsertTemplatePlugin();
