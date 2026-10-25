// Public facade of the Noto REST API client.
//
// The implementation is split into focused modules (`http`, `notes`, `tree`,
// `search`, `attachments`, `transfer`, `trash`, `health`); this file keeps the
// historic, flat import surface alive so that every existing
// `from './api/client'` import keeps working.
export { API_BASE, ApiError, isAbortError, request } from './http';
export { deleteNote, duplicateNote, getNote, moveNote, renameNote, saveNote } from './notes';
export { createFile, createFolder, getTree, getTreePage } from './tree';
export { reindex, search } from './search';
export { getTags, runQuery, type QueryResult } from './query';
export {
  attachmentContentUrl,
  attachmentRawUrl,
  deleteAttachment,
  getAttachmentContent,
  getAttachmentPreview,
  listAttachments,
  searchAttachments,
  uploadAttachment,
  type AttachmentPreview,
  type AttachmentSearchHit,
} from './attachments';
export { exportAllUrl, exportFolderUrl, exportNoteUrl, importFiles, importZip } from './transfer';
export { getTrash, restoreNote } from './trash';
export {
  getVersionDiff,
  listVersions,
  restoreVersion,
  type DiffLine,
  type NoteVersion,
  type VersionDiffResponse,
  type VersionsResponse,
} from './versions';
export { getHealth } from './health';
export { browseVault, getVault, setVault, type VaultBrowse, type VaultDir, type VaultInfo } from './vault';
