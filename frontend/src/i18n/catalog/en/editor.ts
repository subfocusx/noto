// The strings of the editor of the notes (English).
//
// The file holds the en text of the area "editor". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const editor: Record<string, string> = {
  'filter.title': 'Filter',
  'filter.hint': 'Shows only the notes that match the condition.',
  'filter.tagsHint':
    'A tag is written in the text of a note as #word. Click a tag to filter by it.',
  'filter.savedHint': 'Save the current filter under a name to come back to it later.',
  'filter.inputLabel': 'Filter of the notes',
  'filter.oneNote': '1 note matches',
  'filter.manyNotes': '{count} notes match',
  'filter.clear': 'Clear the filter',
  'filter.partial': 'Some notes could not be checked: the answer may be incomplete.',
  'filter.tags': 'Tags',
  'filter.noTags': 'No tag yet.',
  'filter.tagTitle': 'Show the notes tagged {tag}',
  'filter.saved': 'Saved',
  'filter.deleteFilter': 'Delete the filter {name}',
  'filter.namePlaceholder': 'Name',
  'filter.nameLabel': 'Name of the filter',
  'filter.saveCurrent': 'Save the current filter',

  'editor.placeholder': 'Write something…',
  'editor.tagsLabel': 'Tags of the vault',
  'editor.recorder.start': 'Record audio',
  'editor.recorder.stop': 'Stop recording',
  'editor.recorder.level': 'Level of the microphone',
  'editor.recorder.permissionDenied':
    'The microphone permission was refused: the recording was not started.',
  'editor.recorder.cannotStart': 'The recording could not be started.',
  'editor.recorder.cannotSave': 'The recording could not be saved.',

  'editor.audio.label': 'Audio recording',
  'editor.audio.play': 'Play the recording',
  'editor.audio.pause': 'Pause the recording',
  'editor.toolbar.label': 'Formatting of the text',
  'editor.toolbar.heading1': 'Heading of the first level',
  'editor.toolbar.heading2': 'Heading of the second level',
  'editor.toolbar.heading3': 'Heading of the third level',
  'editor.toolbar.bold': 'Bold',
  'editor.toolbar.italic': 'Italic',
  'editor.toolbar.underline': 'Underline',
  'editor.toolbar.strikethrough': 'Strikethrough',
  'editor.toolbar.code': 'Code',
  'editor.toolbar.link': 'Link',
  'editor.toolbar.bulletList': 'Bullet list',
  'editor.toolbar.numberedList': 'Numbered list',
  'editor.toolbar.quote': 'Quote',
  'editor.toolbar.fontSmaller': 'Smaller font',
  'editor.toolbar.fontBigger': 'Bigger font',

  'preview.unavailable': 'Preview unavailable',
  'preview.present': 'Present',
  'preview.label': 'Presentation: {title}',
  'preview.progress': 'Progress of the presentation',

  'find.label': 'Search notes',
  'find.modules': 'Modules of the window',
  'find.searchTab': 'Search',
  'find.filtersTab': 'Filters',
  'find.searchModule': 'Search',
  'find.filtersModule': 'Filters',
  'find.placeholder': 'Search notes…',
  'find.queryLabel': 'Search query',
  'find.searching': 'Searching…',
  'find.noResults': 'No results',
  'find.hint': 'Type to search in the notes of the vault.',

  'markdown.footnoteBack': 'Back to the reference',
  'markdown.footnotes': 'Footnotes'
};
