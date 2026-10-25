// The drafts of an encrypted storage.
//
// The draft of a note is kept in the database of the browser so that nothing
// is lost when the backend does not answer. In an encrypted storage that
// draft must not be readable in the clear: the promise of the feature is that
// nothing of a note lies on the disk.
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { getSealedDraft, putSealedDraft, deleteSealedDraft } from '../core/vault/sealedDrafts';
import { getSealedDraft as getRawDraft } from '../lib/drafts';
import type { SealedVault } from '../core/vault/sealedVault';

const MARKER = 'NOTO-DRAFT-PLAINTEXT-MARKER-4711';

describe('the drafts of an encrypted storage', () => {
  it('does not write the text of the note in the clear', async () => {
    const vault = makeVault();
    await putSealedDraft(vault, {
      path: 'note.md',
      content: `# a note\n\n${MARKER}`,
      revision: 1,
      updatedAt: 1,
    });

    // The bytes that the database holds are the ciphertext of the draft.
    const raw = await getRawDraft('note.md');
    expect(raw).toBeDefined();
    expect(new TextDecoder().decode(raw!)).not.toContain(MARKER);
    expect(new TextDecoder().decode(raw!)).not.toContain('note.md');
  });

  it('reads the draft back', async () => {
    const vault = makeVault();
    const draft = {
      path: 'note.md',
      content: `# a note\n\n${MARKER}`,
      revision: 3,
      updatedAt: 42,
    };
    await putSealedDraft(vault, draft);

    await expect(getSealedDraft(vault, 'note.md')).resolves.toEqual(draft);
  });

  it('forgets a draft that was removed', async () => {
    const vault = makeVault();
    await putSealedDraft(vault, {
      path: 'note.md',
      content: MARKER,
      revision: 1,
      updatedAt: 1,
    });
    await deleteSealedDraft('note.md');

    await expect(getSealedDraft(vault, 'note.md')).resolves.toBeUndefined();
  });
});

/**
 * A vault that seals and opens with a real key.
 *
 * The test uses the crypto core itself, so the bytes that the database holds
 * are the real ciphertext of the real format.
 */
function makeVault(): SealedVault {
  let key: CryptoKey | null = null;
  const ensureKey = async (): Promise<CryptoKey> => {
    key ??= (await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )) as CryptoKey;
    return key;
  };
  return {
    sealPayload: async (payload: Uint8Array) => {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce },
          await ensureKey(),
          payload as unknown as BufferSource,
        ),
      );
      const cipher = new Uint8Array(nonce.length + sealed.length);
      cipher.set(nonce, 0);
      cipher.set(sealed, nonce.length);
      return cipher;
    },
    openPayload: async (container: Uint8Array) => {
      const nonce = container.slice(0, 12);
      const sealed = container.slice(12);
      const opened = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        await ensureKey(),
        sealed as unknown as BufferSource,
      );
      return new Uint8Array(opened);
    },
  } as unknown as SealedVault;
}
