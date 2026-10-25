// The mime types of the attachments: the kind, the icon, the thumbnail.
import { describe, expect, it } from 'vitest';
import {
  MAX_THUMBNAIL_BYTES,
  attachmentKind,
  formatAttachmentDate,
  iconNameForMime,
  isImageMime,
  normalizeMime,
  shouldShowThumbnail,
} from '../lib/attachments';

describe('the mime types of the attachments', () => {
  it('drops the parameters and the case of a mime type', () => {
    expect(normalizeMime('Text/Plain; charset=utf-8')).toBe('text/plain');
    expect(normalizeMime(undefined)).toBe('');
  });

  it('tells the images from the other files', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('IMAGE/JPEG')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isImageMime('')).toBe(false);
  });

  it('refuses to render the SVG, which is a scriptable format', () => {
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(attachmentKind('image/svg+xml')).toBe('file');
  });

  it('names the kind of every family of files', () => {
    expect(attachmentKind('image/webp')).toBe('image');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('text/markdown')).toBe('text');
    expect(attachmentKind('text/plain')).toBe('text');
    expect(attachmentKind('application/json')).toBe('text');
    expect(attachmentKind('application/zip')).toBe('archive');
    expect(attachmentKind('audio/mpeg')).toBe('audio');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('application/octet-stream')).toBe('file');
  });

  it('gives every kind an icon of the registry', () => {
    expect(iconNameForMime('image/png')).toBe('image');
    expect(iconNameForMime('application/zip')).toBe('archive');
    expect(iconNameForMime('text/plain')).toBe('file-text');
    expect(iconNameForMime('application/octet-stream')).toBe('file-text');
  });

  it('shows a thumbnail for a small image only', () => {
    expect(shouldShowThumbnail('image/png', 1024)).toBe(true);
    expect(shouldShowThumbnail('image/png', MAX_THUMBNAIL_BYTES)).toBe(true);
    expect(shouldShowThumbnail('image/png', MAX_THUMBNAIL_BYTES + 1)).toBe(false);
    expect(shouldShowThumbnail('application/pdf', 1024)).toBe(false);
    expect(shouldShowThumbnail('image/png', 0)).toBe(false);
  });

  it('formats the date of a file and refuses a broken one', () => {
    expect(formatAttachmentDate('2026-10-25T12:00:00Z')).toBe('2026-10-25');
    expect(formatAttachmentDate('')).toBe('');
    expect(formatAttachmentDate('not a date')).toBe('');
    expect(formatAttachmentDate(undefined)).toBe('');
  });
});
