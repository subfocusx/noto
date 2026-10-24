// Architectural boundary checks for the frontend source tree.
// Usage: node scripts/check-boundaries.mjs [--root <dir>]
// Pure Node.js (no dependencies, no network). Exits 1 on any violation.
//
// `--root <dir>` points the checker at another tree (the tests use it with a
// fixture): the paths of the rules are relative to that root.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The root of the tree that is checked.
 *
 * By default it is the directory of the frontend (the parent of `scripts/`).
 * The tests pass another root with `--root`, so that the rules can be tried
 * on a fixture.
 */
function resolveRoot() {
  const index = process.argv.indexOf('--root');
  if (index >= 0 && process.argv[index + 1]) {
    return resolve(process.cwd(), process.argv[index + 1]);
  }
  return resolve(here, '..');
}

const FRONTEND_ROOT = resolveRoot();
const SRC_ROOT = resolve(FRONTEND_ROOT, 'src');

// ---------------------------------------------------------------------------
// Configuration
//
// All paths below are POSIX, relative to `frontend/`, and WITHOUT the
// `.ts`/`.tsx` extension, so that `import '../contract'` and
// `import './contract.ts'` are treated identically.
// ---------------------------------------------------------------------------

/** Layer prefixes used by the rules. */
const LAYERS = {
  core: 'src/core/',
  plugins: 'src/plugins/',
  builtin: 'src/plugins/builtin/',
  api: 'src/api/',
  lib: 'src/lib/',
  components: 'src/components/',
};

/** The public API client (direct access is restricted for builtin plugins). */
const API_CLIENT = 'src/api/client';

/** The plugin contract module (types only, the single builtin entry point). */
const PLUGIN_CONTRACT = 'src/plugins/contract';

/**
 * Files under `src/plugins/` that `src/components/**` is allowed to import.
 * Extend this list when a new public plugin entry point is introduced.
 */
const ALLOWED_COMPONENT_PLUGIN_IMPORTS = [
  PLUGIN_CONTRACT,
  'src/plugins/host',
  'src/plugins/registry',
];

/** The only modules `src/plugins/builtin/**` may import from `src/plugins/`. */
const ALLOWED_BUILTIN_PLUGIN_IMPORTS = [PLUGIN_CONTRACT];

/**
 * The modules that own the key material of the encrypted storage.
 *
 * The key hierarchy (the master password, the wrapping key and the data key)
 * lives in `src/core/crypto/**`. Only the core itself may use it: the user
 * interface must never handle a key, and a plugin must never be able to reach
 * one. This is the boundary that makes the "no key material for plugins"
 * promise enforceable instead of decorative.
 */
const KEY_MATERIAL_MODULES = ['src/core/crypto/keys', 'src/core/crypto/sealed'];

/** The layers that are allowed to use the key material. */
const KEY_MATERIAL_CONSUMERS = ['src/core/crypto/', 'src/core/vault/'];

/**
 * The modules of the platform of the plugins.
 *
 * They are the only modules of `src/plugins/**` that may use the core: the
 * host owns the registrations, the registry owns the states, the loader
 * knows the built-in plugins and the manifest validates them. Every other
 * module of `src/plugins/**` is a plugin and may not reach into the core
 * (rule R15).
 */
const PLATFORM_PLUGIN_MODULES = [
  PLUGIN_CONTRACT,
  'src/plugins/host',
  'src/plugins/registry',
  'src/plugins/loader',
  'src/plugins/manifest',
];

/**
 * The implementation of the query and of the metadata.
 *
 * The contract declares the SHAPE of the query capability, never its
 * implementation: a plugin must not be able to compile a query itself with
 * the internals of the application (rule R16).
 */
const CONTRACT_FORBIDDEN_MODULES = [
  'src/core/query/',
  'src/core/metadata/',
  'src/core/crypto/',
];

/** Source extensions scanned by the checker. */
const SCAN_EXTENSIONS = ['.ts', '.tsx'];

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(sep).join('/');
}

/** Strips a trailing `.ts`/`.tsx` extension from a path key. */
function stripExt(key) {
  for (const ext of SCAN_EXTENSIONS) {
    if (key.endsWith(ext)) return key.slice(0, -ext.length);
  }
  return key;
}

function listSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

const FROM_RE = /\b(import|export)\s+([^;()]*?)\s*from\s*(['"])([^'"]+)\3/g;
const BARE_IMPORT_RE = /\bimport\s*(['"])([^'"]+)\1/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

function isTypeOnlyClause(clause) {
  const trimmed = clause.trim();
  return /^type\s/.test(trimmed) || trimmed === 'type';
}

/**
 * Extracts every import-like reference from a source file.
 * @returns {{specifier: string, typeOnly: boolean, line: number}[]}
 */
function parseImports(source) {
  const found = [];
  const lineAt = (index) => source.slice(0, index).split('\n').length;

  for (const match of source.matchAll(FROM_RE)) {
    found.push({
      specifier: match[4],
      typeOnly: isTypeOnlyClause(match[2] ?? ''),
      line: lineAt(match.index),
    });
  }

  for (const match of source.matchAll(BARE_IMPORT_RE)) {
    found.push({ specifier: match[2], typeOnly: false, line: lineAt(match.index) });
  }

  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
    found.push({ specifier: match[2], typeOnly: false, line: lineAt(match.index) });
  }

  for (const match of source.matchAll(REQUIRE_RE)) {
    found.push({ specifier: match[2], typeOnly: false, line: lineAt(match.index) });
  }

  const seen = new Set();
  return found.filter((item) => {
    const key = `${item.line}:${item.specifier}:${item.typeOnly ? 't' : 'r'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolves a relative specifier to a POSIX path relative to `frontend/`.
 * Returns null for external packages and for paths outside `src/`.
 */
function resolveTarget(filePath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(dirname(filePath), specifier);
  const rel = toPosix(relative(FRONTEND_ROOT, absolute));
  if (!rel || rel.startsWith('..')) return null;
  if (!rel.startsWith('src/')) return null;
  return stripExt(rel);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const violations = [];

function report(rule, fileKey, line, message) {
  violations.push({ rule, fileKey, line, message });
}

function inLayer(key, prefix) {
  return key.startsWith(prefix);
}

/**
 * Returns the builtin package directory of a file key, e.g.
 * `src/plugins/builtin/word-count/index.ts` -> `src/plugins/builtin/word-count`.
 */
function builtinPackageOf(fileKey) {
  if (!inLayer(fileKey, LAYERS.builtin)) return null;
  const rest = fileKey.slice(LAYERS.builtin.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return LAYERS.builtin;
  return LAYERS.builtin + rest.slice(0, slash);
}

/**
 * True when `target` lives inside the same builtin plugin package as `fileKey`
 * (a plugin may import its own modules, but never another plugin's).
 */
function isSameBuiltinPackage(fileKey, target) {
  const pkg = builtinPackageOf(fileKey);
  if (!pkg) return false;
  return target === pkg || target.startsWith(`${pkg}/`);
}

/**
 * @param {string} fileKey POSIX path relative to `frontend/` (no extension)
 * @param {{specifier: string, typeOnly: boolean, line: number}} imp
 * @param {string} target POSIX path relative to `frontend/` (no extension)
 */
function checkImport(fileKey, imp, target) {
  const fromPlugins = inLayer(target, LAYERS.plugins);
  const fromBuiltin = inLayer(target, LAYERS.builtin);

  // R1: core must not depend on plugins at all.
  if (inLayer(fileKey, LAYERS.core) && fromPlugins) {
    report(
      'R1',
      fileKey,
      imp.line,
      `src/core/** must not import from src/plugins/** (imports "${target}")`,
    );
  }

  // R2: api/lib must not depend on plugins; components may only use the
  // explicitly allowed plugin modules (see R6 and the allow-list above).
  if (
    (inLayer(fileKey, LAYERS.api) ||
      inLayer(fileKey, LAYERS.lib) ||
      (inLayer(fileKey, LAYERS.components) &&
        !ALLOWED_COMPONENT_PLUGIN_IMPORTS.includes(target))) &&
    fromPlugins
  ) {
    const layer = fileKey.split('/')[1];
    report(
      'R2',
      fileKey,
      imp.line,
      `src/${layer}/** must not import from src/plugins/** (imports "${target}")`,
    );
  }

  // R4: plugin imports from core and builtin must be type-only.
  // Exception: a builtin plugin may import its own modules at runtime (they
  // are part of the same plugin package and are bundled together).
  const sameBuiltinPackage = isSameBuiltinPackage(fileKey, target);
  if (
    fromPlugins &&
    (inLayer(fileKey, LAYERS.core) ||
      (inLayer(fileKey, LAYERS.builtin) && !sameBuiltinPackage)) &&
    !imp.typeOnly
  ) {
    report(
      'R4',
      fileKey,
      imp.line,
      `runtime import of "${target}" is forbidden here; use "import type { ... }"`,
    );
  }

  // R3: builtin may only import src/plugins/contract.ts and its own files.
  if (inLayer(fileKey, LAYERS.builtin) && !sameBuiltinPackage) {
    if (!ALLOWED_BUILTIN_PLUGIN_IMPORTS.includes(target)) {
      report(
        'R3',
        fileKey,
        imp.line,
        `src/plugins/builtin/** may only import ${ALLOWED_BUILTIN_PLUGIN_IMPORTS.join(', ')} or its own package files (imports "${target}")`,
      );
    }
  }

  // R5: contract.ts is a types-only boundary module.
  if (fileKey === PLUGIN_CONTRACT) {
    if (inLayer(target, LAYERS.components)) {
      report(
        'R5',
        fileKey,
        imp.line,
        `src/plugins/contract.ts must not import from src/components/** (imports "${target}")`,
      );
    }
    if (fromPlugins && !imp.typeOnly) {
      report(
        'R5',
        fileKey,
        imp.line,
        `src/plugins/contract.ts must not contain runtime imports of plugins (imports "${target}")`,
      );
    }
  }

  // R6: components may only import the explicitly allowed plugin modules.
  if (inLayer(fileKey, LAYERS.components) && fromPlugins) {
    if (!ALLOWED_COMPONENT_PLUGIN_IMPORTS.includes(target)) {
      report(
        'R6',
        fileKey,
        imp.line,
        `src/components/** may only import from ${ALLOWED_COMPONENT_PLUGIN_IMPORTS.join(', ')} (imports "${target}")`,
      );
    }
  }

  // R7: builtin plugins are reachable only through src/plugins/**.
  // Exception: unit tests may import a builtin plugin to verify it.
  if (!inLayer(fileKey, LAYERS.plugins) && fromBuiltin && !inLayer(fileKey, 'src/__tests__/')) {
    report(
      'R7',
      fileKey,
      imp.line,
      `src/plugins/builtin/** must only be imported by src/plugins/** (imports "${target}")`,
    );
  }

  // R8: builtin plugins must use the public API facade, not the raw client.
  if (inLayer(fileKey, LAYERS.builtin) && target === API_CLIENT) {
    report(
      'R8',
      fileKey,
      imp.line,
      `src/plugins/builtin/** must not import src/api/client.ts directly; use the public facade`,
    );
  }

  // R9: the core must not depend on the user interface.
  if (inLayer(fileKey, LAYERS.core) && inLayer(target, LAYERS.components)) {
    report(
      'R9',
      fileKey,
      imp.line,
      `src/core/** must not import from src/components/** (imports "${target}")`,
    );
  }

  // R10: the crypto core does not know the vault; the dependency points the
  // other way only, so that the key material stays a leaf of the graph.
  if (inLayer(fileKey, 'src/core/crypto/') && inLayer(target, 'src/core/vault/')) {
    report(
      'R10',
      fileKey,
      imp.line,
      `src/core/crypto/** must not import from src/core/vault/** (imports "${target}")`,
    );
  }

  // R11: a plugin must never be able to reach the key material.
  if (inLayer(fileKey, LAYERS.plugins) && inLayer(target, 'src/core/crypto/')) {
    report(
      'R11',
      fileKey,
      imp.line,
      `src/plugins/** must not import the crypto core (imports "${target}"); plugins never see keys`,
    );
  }

  // R12: only the core may use the key material.
  if (
    KEY_MATERIAL_MODULES.includes(target) &&
    !KEY_MATERIAL_CONSUMERS.some((prefix) => inLayer(fileKey, prefix))
  ) {
    report(
      'R12',
      fileKey,
      imp.line,
      `"${target}" owns the key material and may only be imported by ${KEY_MATERIAL_CONSUMERS.join(' or ')} (imports "${target}")`,
    );
  }
}

// ---------------------------------------------------------------------------
// The rules of the file (R13–R16)
//
// These rules look at a FILE and not at a single import: they state a
// property of the module as a whole. Every violation is reported once per
// file, with the list of the offending imports.
// ---------------------------------------------------------------------------

/**
 * Checks the rules that concern a file as a whole.
 *
 * @param {string} fileKey POSIX path relative to the root (no extension)
 * @param {{specifier: string, typeOnly: boolean, line: number, target: string}[]} imports
 */
function checkFile(fileKey, imports) {
  if (imports.length === 0) return;

  // R13: a built-in plugin is self-contained. It may import the contract and
  // the files of its own package — nothing else. The shared layers of the
  // application (`src/core/**`, `src/api/**`, `src/lib/**`, `src/ui/**`,
  // `src/components/**`) are not reachable from a plugin: a plugin repeats
  // the small helpers it needs instead of borrowing them.
  if (inLayer(fileKey, LAYERS.builtin)) {
    const foreign = imports
      .filter((item) => !isSameBuiltinPackage(fileKey, item.target))
      .filter((item) => !ALLOWED_BUILTIN_PLUGIN_IMPORTS.includes(item.target));
    if (foreign.length > 0) {
      report(
        'R13',
        fileKey,
        foreign[0].line,
        `a built-in plugin is self-contained: it may import only ${ALLOWED_BUILTIN_PLUGIN_IMPORTS.join(', ')} and the files of its own package (imports ${foreign.map((item) => `"${item.target}"`).join(', ')})`,
      );
    }
  }

  // R14: the core depends on neither the plugin platform nor the interface.
  // The property is a property of the module, so it is reported once.
  if (inLayer(fileKey, LAYERS.core)) {
    const foreign = imports.filter(
      (item) => inLayer(item.target, LAYERS.plugins) || inLayer(item.target, LAYERS.components),
    );
    if (foreign.length > 0) {
      report(
        'R14',
        fileKey,
        foreign[0].line,
        `src/core/** must not import from src/plugins/** or src/components/** (imports ${foreign.map((item) => `"${item.target}"`).join(', ')})`,
      );
    }
  }

  // R15: a module of the platform of the plugins may not use the core. Only
  // the platform itself (the host, the registry, the loader, the manifest and
  // the contract) may: for everybody else the contract is the only gateway.
  if (inLayer(fileKey, LAYERS.plugins) && !PLATFORM_PLUGIN_MODULES.includes(fileKey)) {
    const foreign = imports.filter((item) => inLayer(item.target, LAYERS.core));
    if (foreign.length > 0) {
      report(
        'R15',
        fileKey,
        foreign[0].line,
        `a plugin may not import src/core/**; the only gateway of a plugin is src/plugins/contract.ts (imports ${foreign.map((item) => `"${item.target}"`).join(', ')})`,
      );
    }
  }

  // R16: the contract declares the shape of the capabilities, never their
  // implementation. It must not import the query core, the scanner of the
  // metadata or the crypto core.
  if (fileKey === PLUGIN_CONTRACT) {
    const foreign = imports.filter((item) =>
      CONTRACT_FORBIDDEN_MODULES.some((prefix) => inLayer(item.target, prefix)),
    );
    if (foreign.length > 0) {
      report(
        'R16',
        fileKey,
        foreign[0].line,
        `src/plugins/contract.ts must not import the implementation of the query, of the metadata or the crypto core (imports ${foreign.map((item) => `"${item.target}"`).join(', ')})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const files = listSourceFiles(SRC_ROOT);
  let checked = 0;

  for (const file of files) {
    const fileKey = stripExt(toPosix(relative(FRONTEND_ROOT, file)));
    const source = readFileSync(file, 'utf8');
    checked += 1;
    const imports = [];
    for (const imp of parseImports(source)) {
      const target = resolveTarget(file, imp.specifier);
      if (!target) continue;
      checkImport(fileKey, imp, target);
      imports.push({ ...imp, target });
    }
    checkFile(fileKey, imports);
  }

  violations.sort((a, b) =>
    a.fileKey === b.fileKey
      ? a.line - b.line || a.rule.localeCompare(b.rule)
      : a.fileKey.localeCompare(b.fileKey),
  );

  if (violations.length === 0) {
    console.log(`OK: ${checked} файлов проверено, нарушений нет`);
    process.exit(0);
  }

  for (const v of violations) {
    console.error(`${v.fileKey}:${v.line} [${v.rule}] ${v.message}`);
  }
  console.error(`FAIL: ${violations.length} нарушений в ${checked} файлах`);
  process.exit(1);
}

main();
