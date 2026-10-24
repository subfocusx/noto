// Manifest validation for built-in plugins.
//
// Manifests are static objects shipped with the application, but they are
// still validated as if they came from an untrusted source: no `eval`, no
// `new Function`, no dynamic import, no remote code. Plugin ids and display
// strings are NEVER used as a path or a module specifier.
import { PLUGIN_API_VERSION, type PluginManifest, type PluginPermission } from './contract';

/** Result of a manifest validation. */
export interface ManifestValidation {
  ok: boolean;
  errors: string[];
}

/** Every permission a plugin may request. */
export const PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'notes.read',
  'notes.write',
  'tree.read',
  'search.read',
  'query.read',
  'editor.read',
  'editor.write',
  'ui.contribute',
  'settings.write',
];

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/**
 * Validates a manifest object.
 *
 * @returns `ok: true` with an empty error list, or `ok: false` with a
 * human readable list of problems.
 */
export function validateManifest(manifest: unknown): ManifestValidation {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return { ok: false, errors: ['manifest must be an object'] };
  }

  const { id, name, version, manifestVersion, minApiVersion, permissions } = manifest;

  if (typeof id !== 'string' || !ID_RE.test(id)) {
    errors.push('id must match /^[a-z0-9][a-z0-9._-]*$/');
  } else if (id.length < 2 || id.length > 64) {
    errors.push('id must be between 2 and 64 characters long');
  }

  if (!isNonEmptyString(name)) errors.push('name must be a non-empty string');
  if (!isSemver(version)) errors.push('version must be a semantic version (x.y.z)');
  if (manifestVersion !== 1) errors.push('manifestVersion must be 1');
  if (!isSemver(minApiVersion)) errors.push('minApiVersion must be a semantic version (x.y.z)');

  if (!Array.isArray(permissions)) {
    errors.push('permissions must be an array');
  } else {
    const seen = new Set<string>();
    for (const permission of permissions) {
      if (typeof permission !== 'string' || !PLUGIN_PERMISSIONS.includes(permission as PluginPermission)) {
        errors.push(`unknown permission: ${String(permission)}`);
        continue;
      }
      if (seen.has(permission)) errors.push(`duplicate permission: ${permission}`);
      seen.add(permission);
    }
  }

  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    errors.push('description must be a string');
  }
  if (manifest.author !== undefined && typeof manifest.author !== 'string') {
    errors.push('author must be a string');
  }
  if (manifest.settingsVersion !== undefined) {
    const version = manifest.settingsVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      errors.push('settingsVersion must be a non-negative integer');
    }
  }
  if (manifest.settingsMigrations !== undefined) {
    if (!isRecord(manifest.settingsMigrations)) {
      errors.push('settingsMigrations must be an object');
    } else {
      for (const [key, fn] of Object.entries(manifest.settingsMigrations)) {
        if (!/^\d+$/.test(key)) errors.push(`settingsMigrations key must be a version number: ${key}`);
        if (typeof fn !== 'function') errors.push(`settingsMigrations["${key}"] must be a function`);
      }
    }
  }

  if (manifest.settings !== undefined) {
    if (!Array.isArray(manifest.settings)) {
      errors.push('settings must be an array');
    } else {
      const keys = new Set<string>();
      manifest.settings.forEach((schema, index) => {
        const label = `settings[${index}]`;
        if (!isRecord(schema)) {
          errors.push(`${label} must be an object`);
          return;
        }
        if (!isNonEmptyString(schema.key)) errors.push(`${label}.key must be a non-empty string`);
        else if (keys.has(schema.key)) errors.push(`${label}.key is duplicated: ${schema.key}`);
        else keys.add(schema.key);

        if (!isNonEmptyString(schema.label)) errors.push(`${label}.label must be a non-empty string`);

        const type = schema.type;
        if (type !== 'string' && type !== 'number' && type !== 'boolean') {
          errors.push(`${label}.type must be one of string|number|boolean`);
        } else {
          const def = schema.default;
          if (type === 'string' && typeof def !== 'string') {
            errors.push(`${label}.default must be a string`);
          } else if (type === 'number' && (typeof def !== 'number' || Number.isNaN(def))) {
            errors.push(`${label}.default must be a number`);
          } else if (type === 'boolean' && typeof def !== 'boolean') {
            errors.push(`${label}.default must be a boolean`);
          }
        }
        if (schema.description !== undefined && typeof schema.description !== 'string') {
          errors.push(`${label}.description must be a string`);
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Parsed semantic version numbers. */
interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(value: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * True when a plugin requiring `minApiVersion` can run against `apiVersion`.
 *
 * The major versions must match; the plugin's minor version must not exceed
 * the API's minor version (a plugin may require an older minor release).
 */
export function isCompatible(minApiVersion: string, apiVersion: string): boolean {
  const plugin = parseSemver(minApiVersion);
  const api = parseSemver(apiVersion);
  if (!plugin || !api) return false;
  if (plugin.major !== api.major) return false;
  return plugin.minor <= api.minor;
}

/** True when the manifest can run against the current API version. */
export function isCompatibleWithCurrentApi(manifest: PluginManifest): boolean {
  return isCompatible(manifest.minApiVersion, PLUGIN_API_VERSION);
}
