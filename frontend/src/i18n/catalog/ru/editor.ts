// The strings of the editor of the notes (Russian).
//
// The file holds the ru text of the area "editor". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const editor: Record<string, string> = {
  'filter.title': 'Фильтр',
  'filter.hint': 'Показывает только заметки, которые отвечают условию.',
  'filter.tagsHint':
    'Тег записывается в тексте заметки как #слово. Нажмите на тег, чтобы отфильтровать по нему.',
  'filter.savedHint': 'Сохраните текущий фильтр под именем, чтобы вернуться к нему позже.',
  'filter.inputLabel': 'Фильтр заметок',
  'filter.oneNote': 'Подходит 1 заметка',
  'filter.manyNotes': 'Подходит заметок: {count}',
  'filter.clear': 'Очистить фильтр',
  'filter.partial': 'Некоторые заметки не удалось проверить: ответ может быть неполным.',
  'filter.tags': 'Теги',
  'filter.noTags': 'Тегов пока нет.',
  'filter.tagTitle': 'Показать заметки с тегом {tag}',
  'filter.saved': 'Сохранённые',
  'filter.deleteFilter': 'Удалить фильтр «{name}»',
  'filter.namePlaceholder': 'Имя',
  'filter.nameLabel': 'Имя фильтра',
  'filter.saveCurrent': 'Сохранить текущий фильтр',

  'editor.placeholder': 'Напишите что-нибудь…',
  'editor.tagsLabel': 'Теги хранилища',
  'editor.recorder.start': 'Записать звук',
  'editor.recorder.stop': 'Остановить запись',
  'editor.recorder.level': 'Уровень микрофона',
  'editor.recorder.permissionDenied':
    'Доступ к микрофону запрещён: запись не началась.',
  'editor.recorder.cannotStart': 'Не удалось начать запись.',
  'editor.recorder.cannotSave': 'Не удалось сохранить запись.',

  'preview.unavailable': 'Предпросмотр недоступен',
  'preview.present': 'Показ',
  'preview.label': 'Презентация: {title}',
  'preview.progress': 'Ход презентации',

  'find.label': 'Поиск по заметкам',
  'find.modules': 'Разделы окна',
  'find.searchTab': 'Поиск',
  'find.filtersTab': 'Фильтры',
  'find.searchModule': 'Поиск',
  'find.filtersModule': 'Фильтры',
  'find.placeholder': 'Поиск по заметкам…',
  'find.queryLabel': 'Поисковый запрос',
  'find.searching': 'Поиск…',
  'find.noResults': 'Ничего не найдено',
  'find.hint': 'Начните вводить, чтобы искать по заметкам хранилища.',

  'markdown.footnoteBack': 'Вернуться к ссылке',
  'markdown.footnotes': 'Сноски'
};
