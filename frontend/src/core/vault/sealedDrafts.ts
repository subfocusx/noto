// The local drafts of an encrypted storage.
//
// An unsaved note is kept locally so that nothing is lost when the backend
// does not answer. In an encrypted storage that draft must not be readable in
// the clear: it is sealed with the same key that seals the notes, and it is
// removed when the storage is locked (the key is gone then).
import {
  deleteSealedDraft as deleteRawDraft,
  getSealedDraft as getRawDraft,
  putSealedDraft as putRawDraft,
} from '../../lib/drafts';
import type { Draft } from '../../lib/drafts';
import type { SealedVault } from './sealedVault';

/** The text of a draft, as it is written into the database. */
function encode(draft: Draft): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(draft));
}

/** The draft that was written into the database. */
function decode(bytes: Uint8Array): Draft {
  return JSON.parse(new TextDecoder().decode(bytes)) as Draft;
}

/**
 * Writes a draft of an encrypted storage.
 *
 * The draft is sealed before it reaches the database: the bytes that the
 * database holds do not contain the text of the note.
 */
export async function putSealedDraft(vault: SealedVault, draft: Draft): Promise<void> {
  await putRawDraft(draft.path, await vault.sealPayload(encode(draft)));
}

/** Reads a draft of an encrypted storage. */
export async function getSealedDraft(vault: SealedVault, path: string): Promise<Draft | undefined> {
  const raw = await getRawDraft(path);
  if (!raw) return undefined;
  try {
    return decode(await vault.openPayload(raw));
  } catch {
    // A draft that cannot be opened belongs to another key: it is useless.
    return undefined;
  }
}

/** Removes a draft of an encrypted storage. */
export async function deleteSealedDraft(path: string): Promise<void> {
  await deleteRawDraft(path);
}
