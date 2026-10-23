// Persistent storage for plugin settings.
//
// The store lives in its own IndexedDB database (`noto-plugins`), separate
// from the drafts database, so plugin data never mixes with user notes.
//
// Namespace isolation: every value is stored under the composite key
// `<pluginId>:<settingKey>`, and all public methods take the plugin id as
// an explicit argument. The host — and only the host — knows the id of the
// plugin a context belongs to, so a plugin cannot address another plugin's
// namespace.
//
// Migrations: a plugin may declare `settingsVersion` and `settingsMigrations`
// in its manifest. `settingsMigrations` maps a source version number (as a
// string, e.g. `"1"`) to a function that converts one stored value from
// version N to version N+1. `migrateSettings()` applies them in order.
import type { IDBPDatabase } from 'idb';

const DB_NAME = 'noto-plugins';
const DB_VERSION = 1;
const STORE = 'settings';
const META = 'meta';

const ENABLED_STATES_KEY = 'enabled-states';

interface SettingRecord {
  key: string;
  pluginId: string;
  name: string;
  value: unknown;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Opens the plugin settings database on first use.
 *
 * `idb` is imported dynamically so that the IndexedDB helper stays out of the
 * start-up bundle; it is only needed once plugin settings are read or written.
 */
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = import('idb')
      .then(({ openDB }) =>
        openDB(DB_NAME, DB_VERSION, {
          upgrade(database) {
            if (!database.objectStoreNames.contains(STORE)) {
              const store = database.createObjectStore(STORE, { keyPath: 'key' });
              store.createIndex('by-plugin', 'pluginId');
            }
            if (!database.objectStoreNames.contains(META)) {
              database.createObjectStore(META, { keyPath: 'key' });
            }
          },
        }),
      )
      .catch((error: unknown) => {
        // Allow a later call to retry opening the database.
        dbPromise = null;
        throw error;
      });
  }
  return dbPromise;
}

function compositeKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

/** True when the value can survive a JSON round trip. */
function isJsonCompatible(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value as number);
  if (type === 'undefined' || type === 'function' || type === 'symbol') return false;
  if (type === 'bigint') return false;
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (value instanceof Date) return true;
  if (type === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonCompatible);
  }
  return false;
}

export class SettingsStore {
  /** Reads a setting, falling back to `fallback` when it is missing or broken. */
  async get<T>(pluginId: string, key: string, fallback: T): Promise<T> {
    const database = await db();
    let record: SettingRecord | undefined;
    try {
      record = await database.get(STORE, compositeKey(pluginId, key));
    } catch {
      return fallback;
    }
    if (!record) return fallback;
    if (!isJsonCompatible(record.value)) {
      console.warn(`[noto:settings] corrupted value for ${pluginId}:${key}, using default`);
      return fallback;
    }
    return record.value as T;
  }

  /** Writes a setting. The value must be JSON compatible. */
  async set<T>(pluginId: string, key: string, value: T): Promise<void> {
    if (!isJsonCompatible(value)) {
      throw new TypeError(`settings value for ${pluginId}:${key} is not JSON compatible`);
    }
    const database = await db();
    const record: SettingRecord = {
      key: compositeKey(pluginId, key),
      pluginId,
      name: key,
      value,
    };
    await database.put(STORE, record);
  }

  /** All settings of one plugin, keyed by setting name. */
  async getAll(pluginId: string): Promise<Record<string, unknown>> {
    const database = await db();
    const index = database.transaction(STORE).store.index('by-plugin');
    const records = (await index.getAll(pluginId)) as SettingRecord[];
    const out: Record<string, unknown> = {};
    for (const record of records) out[record.name] = record.value;
    return out;
  }

  /** Removes one setting, or every setting of the plugin. */
  async reset(pluginId: string, key?: string): Promise<void> {
    const database = await db();
    if (key !== undefined) {
      await database.delete(STORE, compositeKey(pluginId, key));
      return;
    }
    const records = await this.getAll(pluginId);
    const tx = database.transaction(STORE, 'readwrite');
    for (const name of Object.keys(records)) {
      await tx.store.delete(compositeKey(pluginId, name));
    }
    await tx.done;
  }

  /** Persists which plugins are enabled. */
  async setEnabledStates(states: Record<string, boolean>): Promise<void> {
    const database = await db();
    const record: MetaRecord = { key: ENABLED_STATES_KEY, value: { ...states } };
    await database.put(META, record);
  }

  /** Reads the persisted enabled states. */
  async getEnabledStates(): Promise<Record<string, boolean>> {
    const database = await db();
    const record = (await database.get(META, ENABLED_STATES_KEY)) as MetaRecord | undefined;
    const value = record?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, boolean> = {};
    for (const [id, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (typeof enabled === 'boolean') out[id] = enabled;
    }
    return out;
  }

  /** Reads the stored settings schema version of a plugin (0 when unknown). */
  async getSettingsVersion(pluginId: string): Promise<number> {
    const database = await db();
    const record = (await database.get(META, `${pluginId}:settings-version`)) as MetaRecord | undefined;
    const value = record?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /** Stores the settings schema version of a plugin. */
  async setSettingsVersion(pluginId: string, version: number): Promise<void> {
    const database = await db();
    const record: MetaRecord = { key: `${pluginId}:settings-version`, value: version };
    await database.put(META, record);
  }

  /**
   * Applies the manifest migrations of a plugin to its stored values.
   *
   * @param pluginId owner of the values
   * @param targetVersion the version declared in the manifest
   * @param migrations map of source version (string) -> conversion function
   * @returns the number of migrated values
   */
  async migrateSettings(
    pluginId: string,
    targetVersion: number,
    migrations: Record<string, (value: unknown) => unknown>,
  ): Promise<number> {
    let version = await this.getSettingsVersion(pluginId);
    if (version >= targetVersion) return 0;

    let migrated = 0;
    while (version < targetVersion) {
      const migrate = migrations[String(version)];
      if (!migrate) {
        // No migration for this step: stop and keep the stored version.
        break;
      }
      const all = await this.getAll(pluginId);
      for (const [name, value] of Object.entries(all)) {
        let next: unknown;
        try {
          next = migrate(value);
        } catch (err) {
          console.warn(`[noto:settings] migration ${version} -> ${version + 1} failed`, err);
          continue;
        }
        if (!isJsonCompatible(next)) continue;
        await this.set(pluginId, name, next);
        migrated += 1;
      }
      version += 1;
    }
    await this.setSettingsVersion(pluginId, version);
    return migrated;
  }
}
