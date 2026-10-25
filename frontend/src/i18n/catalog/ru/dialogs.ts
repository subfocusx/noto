// The strings of the dialogs of the application (Russian).
//
// The file holds the ru text of the area "dialogs". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const dialogs: Record<string, string> = {
  'dialog.createFolder.title': 'Новая папка',
  'dialog.createFile.title': 'Новая заметка',
  'dialog.rename.title': 'Переименовать',
  'dialog.move.title': 'Переместить',
  'dialog.delete.title': 'Удалить',
  'dialog.placeholder.folder': 'Имя папки',
  'dialog.placeholder.file': 'Имя заметки',
  'dialog.placeholder.other': 'Имя',
  'dialog.targetFolder': 'Целевая папка',
  'dialog.root': '(корень)',
  'dialog.moveHint': 'Папка, в которую переносится заметка.',
  'dialog.deleteQuestion': 'Удалить «{name}»? Её можно вернуть из корзины.',
  'dialog.deleteHint': 'Заметка переносится в корзину, а не стирается навсегда.',
  'dialog.nameLabel': 'Имя',
  'dialog.emptyName': 'Имя не может быть пустым.',
  'dialog.draft.title': 'Восстановить локальный черновик?',
  'dialog.draft.discard': 'Отбросить',
  'dialog.draft.reset': 'Сбросить черновик',
  'dialog.draft.resetTitle': 'Выбросить локальные изменения и оставить версию сервера',
  'dialog.draft.restore': 'Восстановить',
  'dialog.draft.question': 'Есть более новая несохранённая локальная версия «{path}». Восстановить её?',
  'dialog.draft.hint': 'Отбрасывание черновика оставляет ту версию, что хранится на сервере.',
  'dialog.undo.deleted': 'Заметка «{name}» была удалена.',
  'dialog.undo.deletedBefore': 'Заметка',
  'dialog.undo.deletedAfter': 'была удалена.',
  'dialog.undo.undo': 'Отменить',

  'conflict.title': 'Заметку изменили в другом месте',
  'conflict.text':
    'Версия сервера сохранена {when} (ревизия {revision}), а в редакторе другая версия. Ничего не потеряно: выберите, что оставить.',
  'conflict.unknownMoment': 'в неизвестный момент',
  'conflict.takeServer': 'Взять версию сервера',
  'conflict.keepMine': 'Оставить мою версию',
  'conflict.copyMine': 'Скопировать мою версию',
  'conflict.later': 'Решить позже',
  'conflict.showServer': 'Показать версию сервера'
};
