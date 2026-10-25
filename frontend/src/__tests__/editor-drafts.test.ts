import { describe, expect, it, vi } from 'vitest';
import {
  attachmentReference,
  insertAttachmentReference,
  resetDraft,
} from '../lib/drafts';

describe('the file that was dropped into the editor', () => {
  it('becomes a reference of an image', () => {
    expect(attachmentReference('photo.png', '/api/attachments/1/raw')).toBe(
      '![photo.png](/api/attachments/1/raw)',
    );
  });

  it('escapes the brackets of the name', () => {
    expect(attachmentReference('a(b).png', '/raw')).toBe('![a\\(b\\).png](/raw)');
  });

  it('is put at the caret of the editor', () => {
    const result = insertAttachmentReference('hello world', 6, '![p.png](/raw)');
    expect(result.text).toBe('hello ![p.png](/raw) world');
    expect(result.caret).toBe(21);
  });

  it('is put at the end of the text when the caret is behind it', () => {
    const result = insertAttachmentReference('text', 99, '![p.png](/raw)');
    expect(result.text).toBe('text![p.png](/raw) ');
  });
});

describe('the reset of a draft', () => {
  it('holds the content of the server again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(5000));
    const draft = { path: 'a.md', content: 'local text', revision: 2, updatedAt: 1000 };
    const reset = resetDraft(draft, 'server text');
    expect(reset.content).toBe('server text');
    expect(reset.path).toBe('a.md');
    expect(reset.revision).toBe(3);
    expect(reset.updatedAt).toBe(5000);
    vi.useRealTimers();
  });

  it('does not change the draft it is given', () => {
    const draft = { path: 'a.md', content: 'local text', revision: 2, updatedAt: 1000 };
    resetDraft(draft, 'server text');
    expect(draft.content).toBe('local text');
    expect(draft.revision).toBe(2);
  });
});
