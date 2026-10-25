// The strings of the dialogs of the application (English).
//
// The file holds the en text of the area "dialogs". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const dialogs: Record<string, string> = {
  'dialog.createFolder.title': 'New folder',
  'dialog.createFile.title': 'New note',
  'dialog.rename.title': 'Rename',
  'dialog.move.title': 'Move',
  'dialog.delete.title': 'Delete',
  'dialog.placeholder.folder': 'Folder name',
  'dialog.placeholder.file': 'Note name',
  'dialog.placeholder.other': 'Name',
  'dialog.targetFolder': 'Target folder',
  'dialog.root': '(root)',
  'dialog.moveHint': 'The folder the note is moved into.',
  'dialog.deleteQuestion': 'Delete {name}? It can be restored from the trash.',
  'dialog.deleteHint': 'The note is moved into the trash, not erased for good.',
  'dialog.nameLabel': 'Name',
  'dialog.emptyName': 'The name must not be empty.',
  'dialog.draft.title': 'Recover local draft?',
  'dialog.draft.discard': 'Discard',
  'dialog.draft.reset': 'Reset the draft',
  'dialog.draft.resetTitle': 'Throw the local changes away and keep the version of the server',
  'dialog.draft.restore': 'Restore',
  'dialog.draft.question': 'A newer unsaved local version of {path} exists. Restore it?',
  'dialog.draft.hint': 'Discarding the draft keeps the version that is stored on the server.',
  'dialog.undo.deleted': 'The note {name} was deleted.',
  'dialog.undo.deletedBefore': 'The note',
  'dialog.undo.deletedAfter': 'was deleted.',
  'dialog.undo.undo': 'Undo',

  'conflict.title': 'The note was changed elsewhere',
  'conflict.text':
    'The version of the server was saved on {when} (revision {revision}), while the editor holds another version. Nothing is lost yet: choose what to keep.',
  'conflict.unknownMoment': 'an unknown moment',
  'conflict.takeServer': 'Take the version of the server',
  'conflict.keepMine': 'Keep my version',
  'conflict.copyMine': 'Copy my version',
  'conflict.later': 'Decide later',
  'conflict.showServer': 'Show the version of the server'
};
