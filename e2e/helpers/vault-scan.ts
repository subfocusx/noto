/**
 * The scanner of the files of a vault on the disk.
 *
 * The promise of the encrypted storage is that the files of the vault (and
 * therefore the files that a cloud provider receives) hold nothing but
 * ciphertext. The only honest way to prove it is to look at the real bytes of
 * the real files of a real vault, so this helper reads every file as bytes and
 * looks for the markers of the plaintext.
 *
 * The files of a vault are binary (the database of the notes is a SQLite file),
 * so the search is done on the bytes and never on a decoded text.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The result of the scan of a directory. */
export interface VaultScanResult {
  /** The number of the files that were found in the directory. */
  files: number;
  /** The matches: the file and the marker that were found in it. */
  matches: { file: string; marker: string }[];
}

/**
 * Lists the files of a directory, recursively.
 *
 * The paths are relative to the directory that was scanned, so that the
 * assertion of the test does not depend on the temporary directory of the
 * system. The files that cannot be read are listed as well: a file that cannot
 * be opened is a risk, not a detail.
 */
export function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(full, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      found.push(relative);
    }
  };
  walk(dir, '');
  return found.sort();
}

/**
 * Scans a directory (recursively) for the given markers.
 *
 * Every file is read as bytes and every marker is looked for as a byte
 * sequence. A file that cannot be read (a locked file, a file that was removed
 * while the scan was running) is reported on the console and never breaks the
 * scan: a broken scan would hide the very leak the test looks for.
 */
export function scanDirectoryForMarkers(dir: string, markers: string[]): VaultScanResult {
  const result: VaultScanResult = { files: 0, matches: [] };
  const needles = markers
    .filter((marker) => marker.length > 0)
    .map((marker) => ({ marker, bytes: Buffer.from(marker, 'utf8') }));

  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      console.warn(`vault-scan: cannot read the directory ${current}: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      result.files += 1;
      let data: Buffer;
      try {
        data = fs.readFileSync(full);
      } catch (err) {
        console.warn(`vault-scan: cannot read the file ${full}: ${String(err)}`);
        continue;
      }
      for (const needle of needles) {
        if (data.includes(needle.bytes)) {
          result.matches.push({ file: full, marker: needle.marker });
        }
      }
    }
  };

  walk(dir);
  return result;
}

/**
 * The description of the matches of a scan, for the message of a failure.
 *
 * The message names the file and the marker, so that the leak can be found
 * without running the test again.
 */
export function describeMatches(matches: { file: string; marker: string }[]): string {
  return matches
    .map((match) => `the file "${match.file}" holds the plaintext marker "${match.marker}"`)
    .join('\n');
}
