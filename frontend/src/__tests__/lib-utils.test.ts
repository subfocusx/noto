import { describe, expect, it } from 'vitest';
import { compareStrings, debounce, errorMessage, formatSize } from '../lib/utils';

describe('lib/utils compatibility facade', () => {
  it('re-exports the focused helper modules', () => {
    expect(typeof debounce).toBe('function');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(compareStrings('a', 'b')).toBe(-1);
    expect(compareStrings('b', 'a')).toBe(1);
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
  });
});
