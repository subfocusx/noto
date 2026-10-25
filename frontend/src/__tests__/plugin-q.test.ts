// Tests of the query capability of the plugin platform (API 1.2.0).
//
// The capability is new in API 1.2.0: `ctx.api.query()` and `ctx.api.tags()`,
// behind the permission `query.read`. The tests below check three things:
//
//   * the capability answers in both storage modes (the server in the open
//     mode, the local evaluation in the sealed mode);
//   * the permission is really enforced — a plugin without `query.read` gets
//     a `PluginPermissionError`, never a silent no-op;
//   * the new boundary rules R13–R16 are enforced by the checker.
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PLUGIN_API_VERSION,
  PluginPermissionError,
  type PluginApi,
} from '../plugins/contract';
import { restrictPluginApi } from '../core/api/pluginApi';
import {
  countTags,
  createPluginQueryApi,
  evaluateQuery,
  toQueryNote,
} from '../core/api/pluginQuery';

const FRONTEND_ROOT = resolve(__dirname, '..', '..');
const CHECKER = join(FRONTEND_ROOT, 'scripts', 'check-boundaries.mjs');

/** A note of the fake vault. */
const NOTES = [
  {
    path: 'notes/alpha.md',
    name: 'alpha.md',
    content: '# Alpha\n\n#work #urgent\n\n- [ ] a task that is not done\n',
    createdAt: 1000,
    updatedAt: 2000,
  },
  {
    path: 'notes/beta.md',
    name: 'beta.md',
    content: '# Beta\n\n#work\n\n```go\nfmt.Println("x")\n```\n',
    createdAt: 1500,
    updatedAt: 2500,
  },
  {
    path: 'gamma.md',
    name: 'gamma.md',
    content: '# Gamma\n\nno tags here\n',
    createdAt: 1200,
    updatedAt: 1200,
  },
];

/** A data API that never touches the network. */
function mockApi(overrides: Partial<PluginApi> = {}): PluginApi {
  return {
    getNote: async (path) => ({
      path,
      content: 'the content of the note',
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      conflict: false,
    }),
    getTree: async () => ({ folders: [], files: [] }),
    search: async () => [],
    saveNote: async (path) => ({ path, revision: 1, updatedAt: '2026-01-01T00:00:00Z' }),
    ...overrides,
  };
}

describe('the query capability of the plugin platform', () => {
  it('publishes the API version 1.3.0', () => {
    expect(PLUGIN_API_VERSION).toBe('1.3.0');
  });

  it('answers a query locally in the sealed mode', async () => {
    const api = createPluginQueryApi({
      mode: () => 'sealed',
      notes: async () => NOTES,
      now: () => 3000,
    });
    const answer = await api.query("tag == 'work'");
    expect(answer.total).toBe(2);
    expect(answer.hits.map((hit) => hit.path).sort()).toEqual(['notes/alpha.md', 'notes/beta.md']);
    expect(answer.partial).toBe(false);
  });

  it('asks the server in the open mode', async () => {
    const runQuery = vi.fn(async () => ({
      hits: [{ path: 'a.md', name: 'a.md', kind: 'query', snippet: '' }],
      total: 1,
      partial: false,
    }));
    const api = createPluginQueryApi({ mode: () => 'open', runQuery });
    const answer = await api.query("tag == 'work'");
    expect(runQuery).toHaveBeenCalledWith("tag == 'work'", 50);
    expect(answer.total).toBe(1);
  });

  it('never asks the server for an empty query', async () => {
    const runQuery = vi.fn(async () => ({ hits: [], total: 0, partial: false }));
    const api = createPluginQueryApi({ mode: () => 'open', runQuery });
    const answer = await api.query('   ');
    expect(runQuery).not.toHaveBeenCalled();
    expect(answer.total).toBe(0);
  });

  it('counts the tags of the notes in the sealed mode', async () => {
    const api = createPluginQueryApi({ mode: () => 'sealed', notes: async () => NOTES });
    const tags = await api.tags();
    expect(tags).toEqual([
      { tag: 'work', count: 2 },
      { tag: 'urgent', count: 1 },
    ]);
  });

  it('derives the properties of a note the way the server does', () => {
    const note = toQueryNote(NOTES[0]);
    expect(note.title).toBe('Alpha');
    expect(note.tags).toEqual(['work', 'urgent']);
    expect(note.hasTaskList).toBe(true);
    expect(note.hasIncompleteTasks).toBe(true);
    expect(note.folder).toBe('notes');
    expect(note.ext).toBe('md');
  });

  it('evaluates the same answers as the server for the known queries', () => {
    const answer = evaluateQuery(NOTES, "tag == 'urgent'", 50, 3000);
    expect(answer.total).toBe(1);
    expect(answer.hits[0].path).toBe('notes/alpha.md');
  });

  it('counts the tags of the notes', () => {
    expect(countTags(NOTES)).toEqual([
      { tag: 'work', count: 2 },
      { tag: 'urgent', count: 1 },
    ]);
  });
});

describe('the permission of the query capability', () => {
  it('refuses a query of a plugin without the permission query.read', async () => {
    const api = mockApi({
      query: async () => ({ hits: [], total: 0, partial: false }),
      tags: async () => [],
    });
    const restricted = restrictPluginApi(api, 'perm.demo', ['notes.read']);
    await expect(restricted.query?.("tag == 'work'")).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(restricted.tags?.()).rejects.toBeInstanceOf(PluginPermissionError);
  });

  it('allows a query of a plugin with the permission query.read', async () => {
    const api = mockApi({
      query: async () => ({
        hits: [{ path: 'a.md', name: 'a.md', kind: 'query', snippet: '' }],
        total: 1,
        partial: false,
      }),
      tags: async () => [{ tag: 'work', count: 1 }],
    });
    const restricted = restrictPluginApi(api, 'perm.demo', ['query.read']);
    const answer = await restricted.query?.("tag == 'work'");
    expect(answer?.total).toBe(1);
    expect(await restricted.tags?.()).toEqual([{ tag: 'work', count: 1 }]);
  });
});

describe('the new boundary rules', () => {
  /**
   * Runs the checker on a fixture tree.
   *
   * The fixture is written into a temporary directory with the same shape as
   * the frontend, so the rules see the same paths as in the real tree.
   */
  function runChecker(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'noto-boundaries-'));
    mkdirSync(join(root, 'src', 'plugins', 'builtin', 'demo'), { recursive: true });
    mkdirSync(join(root, 'src', 'core'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, name);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    try {
      return execFileSync('node', [CHECKER, '--root', root], { encoding: 'utf8' });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
  }

  it('refuses a built-in plugin that imports the core (R13)', () => {
    const output = runChecker({
      'src/plugins/builtin/demo/index.ts': "import { x } from '../../../core/foo';\nexport const x2 = x;\n",
      'src/core/foo.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R13');
  });

  it('refuses a module of the core that imports the platform of the plugins (R14)', () => {
    const output = runChecker({
      'src/core/foo.ts': "import { x } from '../plugins/contract';\nexport const y = x;\n",
      'src/plugins/contract.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R14');
  });

  it('refuses a plugin that imports the core (R15)', () => {
    const output = runChecker({
      'src/plugins/demo.ts': "import { x } from '../core/foo';\nexport const y = x;\n",
      'src/core/foo.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R15');
  });

  it('refuses a contract that imports the implementation of the query (R16)', () => {
    const output = runChecker({
      'src/plugins/contract.ts': "import { x } from '../core/query/grammar';\nexport const y = x;\n",
      'src/core/query/grammar.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R16');
  });

  it('accepts a built-in plugin that imports only the contract', () => {
    const output = runChecker({
      'src/plugins/builtin/demo/index.ts': "import { x } from '../../contract';\nexport const y = x;\n",
      'src/plugins/contract.ts': 'export const x = 1;\n',
    });
    expect(output).not.toContain('R13');
    expect(output).not.toContain('R15');
  });
});
