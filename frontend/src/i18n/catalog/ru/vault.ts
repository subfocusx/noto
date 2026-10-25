// The strings of the storage of the notes (Russian).
//
// The file holds the ru text of the area "vault". Every key of the
// area exists in every language: the test of the catalogue proves it.
export const vault: Record<string, string> = {
  'vault.fixed.message':
    'Хранилище задано окружением (NOTO_VAULT_FIXED).',
  'vault.fixed.title': 'Хранилище задано окружением',
  'vault.fixed.reason':
    'Сервер был запущен с фиксированной папкой заметок, поэтому во время работы приложения хранилище сменить нельзя.',

  'vault.picker.title': 'Выберите хранилище заметок',
  'vault.picker.hint':
    'Заметки хранятся как файлы Markdown в выбранной папке. Внутренние данные Noto лежат в скрытой подпапке .noto рядом с ними.',
  'vault.picker.folder': 'Папка',
  'vault.picker.pathLabel': 'Путь к папке',
  'vault.picker.parent': 'Родительский каталог',
  'vault.picker.noDirs': 'Подпапок нет',
  'vault.picker.use': 'Использовать эту папку',
  'vault.picker.working': 'Работа…',
  'vault.picker.encrypt': 'Настроить зашифрованное хранилище',
  'vault.picker.readFailed': 'Не удалось прочитать каталог',

  'vault.switch.label': 'Сменить хранилище заметок',
  'vault.switch.title': 'Хранилище заметок',
  'vault.switch.open': 'Открытые',
  'vault.switch.recent': 'Недавние',
  'vault.switch.close': 'Закрыть хранилище «{name}»',
  'vault.switch.choose': 'Выбрать другую папку…',

  'vault.setup.title': 'Зашифрованное хранилище',
  'vault.setup.steps': 'Шаги мастера',
  'vault.setup.step.storage': 'Хранилище',
  'vault.setup.step.password': 'Пароль',
  'vault.setup.step.warning': 'Предупреждение',
  'vault.setup.step.recovery': 'Восстановление',
  'vault.setup.step.ready': 'Готово',
  'vault.setup.hint':
    'Заметки Noto можно зашифровать в браузере до отправки на сервер. Тогда сервер хранит только шифротекст и никогда не узнаёт заголовок, текст или путь.',
  'vault.setup.createNew': 'Создать новое зашифрованное хранилище',
  'vault.setup.createNewHint':
    'Текущая папка станет зашифрованным хранилищем. В ней пока не должно быть заметок.',
  'vault.setup.migrate': 'Перенести существующее хранилище',
  'vault.setup.migrateHint':
    'Заметки папки шифруются один раз, и хранилище становится закрытым.',
  'vault.setup.masterPassword': 'Мастер-пароль',
  'vault.setup.formLabel': 'Мастер-пароль',
  'vault.setup.repeatPassword': 'Повторите мастер-пароль',
  'vault.setup.show': 'Показать',
  'vault.setup.hide': 'Скрыть',
  'vault.setup.showLabel': 'Показать мастер-пароль',
  'vault.setup.hideLabel': 'Скрыть мастер-пароль',
  'vault.setup.strength': 'Надёжность',
  'vault.setup.strength.weak': 'Слабый',
  'vault.setup.strength.fair': 'Средний',
  'vault.setup.strength.good': 'Хороший',
  'vault.setup.strength.strong': 'Надёжный',
  'vault.setup.lightPreset': 'Использовать облегчённый пресет вывода ключа',
  'vault.setup.estimate': 'Вывод ключа занимает около {ms} мс на этом устройстве.',
  'vault.setup.lightWarning':
    'Облегчённый пресет ослабляет вывод ключа: перебор паролей хранилища идёт намного быстрее. Используйте его только на медленном устройстве.',
  'vault.setup.warningText':
    'Без мастер-пароля и без ключа восстановления эти заметки не откроет никто: ни автор программы, ни сервер, ни кто-либо ещё. Потерянный пароль означает потерянные заметки.',
  'vault.setup.understand': 'Я понимаю, что пароль восстановить нельзя.',
  'vault.setup.recoveryHint':
    'Ключ восстановления открывает это хранилище, если мастер-пароль потерян. Он показывается один раз и больше не показывается: скопируйте его сейчас.',
  'vault.setup.copy': 'Копировать',
  'vault.setup.copied': 'Скопировано',
  'vault.setup.copyLabel': 'Скопировать ключ восстановления',
  'vault.setup.clipboardHint':
    'Если буфер обмена недоступен, выделите текст выше и скопируйте его вручную.',
  'vault.setup.saved': 'Я сохранил ключ восстановления в надёжном месте.',
  'vault.setup.doneTitle': 'Зашифрованное хранилище готово.',
  'vault.setup.doneHint':
    'Теперь заметки шифруются в этом браузере. Храните мастер-пароль и ключ восстановления в надёжном месте.',
  'vault.setup.creating': 'Создание…',
  'vault.setup.create': 'Создать зашифрованное хранилище',
  'vault.setup.openNotes': 'Открыть заметки',
  'vault.setup.continue': 'Продолжить',
  'vault.setup.createFailed': 'Не удалось создать зашифрованное хранилище. Попробуйте ещё раз.',
  'vault.setup.recoveryFailed': 'Не удалось включить ключ восстановления. Попробуйте ещё раз.',
  'vault.setup.recoveryCreateFailed':
    'Не удалось создать ключ восстановления. Попробуйте ещё раз.',
  'vault.setup.migrationMissing': 'Перенос хранилища здесь недоступен.',
  'vault.setup.clipboardUnavailable':
    'Буфер обмена недоступен. Выделите ключ и скопируйте его вручную.',

  'vault.password.tooShort': 'Мастер-пароль должен содержать не менее {min} символов.',
  'vault.password.mismatch': 'Пароли не совпадают.',

  'vault.unlock.label': 'Разблокировать зашифрованное хранилище',
  'vault.unlock.title': 'Хранилище заблокировано',
  'vault.unlock.hint':
    'Введите мастер-пароль этого хранилища. Заметки расшифровываются в этом браузере и остаются здесь.',
  'vault.unlock.password': 'Мастер-пароль',
  'vault.unlock.unlocking': 'Разблокировка…',
  'vault.unlock.unlock': 'Разблокировать',
  'vault.unlock.error': 'Неверный пароль или повреждённое хранилище.',
  'vault.unlock.empty': 'Введите мастер-пароль.',

  'vault.security.title': 'Безопасность',
  'vault.security.encryption': 'Шифрование',
  'vault.security.encryptionHint': 'Состояние хранилища заметок',
  'vault.security.mode.plain': 'Открытое (без шифрования)',
  'vault.security.mode.sealed': 'Зашифрованное',
  'vault.security.format': 'Версия формата',
  'vault.security.formatHint': 'Версия формата зашифрованного хранилища',
  'vault.security.lockNow': 'Заблокировать сейчас',
  'vault.security.lockNowHint': 'Забывает ключ хранилища в этой вкладке',
  'vault.security.changePassword': 'Сменить пароль',
  'vault.security.changePasswordHint': 'Заметки остаются зашифрованными тем же ключом',
  'vault.security.currentPassword': 'Текущий пароль',
  'vault.security.masterPassword': 'Мастер-пароль',
  'vault.security.changePasswordForm': 'Смена мастер-пароля',
  'vault.security.newPassword': 'Новый пароль',
  'vault.security.repeatNewPassword': 'Повторите новый пароль',
  'vault.security.passwordChanged': 'Мастер-пароль изменён.',
  'vault.security.passwordMismatch': 'Новые пароли не совпадают.',
  'vault.security.autoLock': 'Автоблокировка',
  'vault.security.autoLockHint':
    'Блокирует хранилище после стольких минут без активности',
  'vault.security.autoLockLabel': 'Автоблокировка через N минут',
  'vault.security.minute': '{count} минута',
  'vault.security.minutes': '{count} минут',
  'vault.security.check': 'Проверить целостность',
  'vault.security.checkHint':
    'Открывает каждый закрытый объект и сообщает о повреждённых',
  'vault.security.checking': 'Проверка…',
  'vault.security.checkResult': 'Проверено объектов: {checked}, повреждено: {broken}.',
  'vault.security.brokenList': 'Повреждённые объекты',
  'vault.security.recovery': 'Ключ восстановления',
  'vault.security.recoveryHint':
    'Ключ, который открывает хранилище, если пароль потерян',
  'vault.security.recoveryEnabled': 'включён',
  'vault.security.recoveryDisabled': 'не включён',
  'vault.security.newRecovery': 'Новый ключ восстановления',
  'vault.security.newRecoveryHint': 'Старый ключ перестаёт работать сразу',
  'vault.security.generateRecovery': 'Создать новый ключ восстановления',
  'vault.security.copyNow': 'Скопируйте этот ключ сейчас: он показывается один раз.',
  'vault.security.enableRecovery': 'Включить ключ восстановления',
  'vault.security.encryptedStorage': 'Зашифрованное хранилище',
  'vault.security.encryptedStorageHint':
    'Заметки хранятся открытыми файлами, и пароль пока ничего не значит',
  'vault.security.setup': 'Настроить зашифрованное хранилище',
  'vault.security.note':
    'Пароль никогда не записывается на диск и не покидает этот браузер.',
  'vault.security.changeFailed':
    'Пароль не изменён. Проверьте старый пароль.',
  'vault.security.checkFailed': 'Не удалось выполнить проверку целостности.',
  'vault.security.recoveryFailed':
    'Ключ восстановления не включён. Проверьте пароль.',

  'vault.migration.title': 'Зашифровать хранилище заметок',
  'vault.migration.warning':
    'Сегодня заметки папки — обычные файлы Markdown. Перенос копирует их в зашифрованное хранилище: каждая заметка шифруется в вашем браузере до записи, и сервер никогда не видит заголовок, текст или путь.',
  'vault.migration.list1':
    'Открытые файлы удаляются с диска только после проверки копии и вашего подтверждения.',
  'vault.migration.list2':
    'Приложение не может стереть копии, которые лежат в истории версий облачного провайдера, в снимках или в резервных копиях.',
  'vault.migration.list3':
    'Если перенос прервётся, он продолжится с того места, где остановился, после разблокировки хранилища.',
  'vault.migration.passwordLabel': 'Мастер-пароль зашифрованного хранилища',
  'vault.migration.repeatLabel': 'Повторите пароль',
  'vault.migration.repeatPassword': 'Повторите мастер-пароль',
  'vault.migration.strength.good': 'Надёжный пароль',
  'vault.migration.strength.fair': 'Слабый пароль — используйте не менее 12 символов',
  'vault.migration.strength.weak': 'Очень слабый пароль — используйте не менее 12 символов',
  'vault.migration.mismatch': 'Пароли не совпадают.',
  'vault.migration.progress': 'Скопировано {copied} из {total} заметок',
  'vault.migration.result':
    'Копия сделана и проверена: {count} заметок зашифровано в хранилище, и сервер теперь работает с зашифрованным хранилищем.',
  'vault.migration.plaintextNote':
    'Открытые файлы всё ещё на диске. Они удалятся, только когда вы попросите об этом ниже.',
  'vault.migration.confirmHint':
    'Последний шаг удаляет открытые файлы папки с диска. Это нельзя отменить.',
  'vault.migration.confirmList2':
    'Если оставить файлы, в папке будут и открытые заметки, и зашифрованное хранилище.',
  'vault.migration.done':
    'Перенос завершён: {count} заметок зашифровано, а {deleted} открытых файлов ({bytes} байт) удалено с диска.',
  'vault.migration.doneNote':
    'Копии, которые лежат в истории версий облачного провайдера, в снимках и в резервных копиях, всё ещё там: приложение не может их стереть. Удалите их сами, если они больше не должны существовать.',
  'vault.migration.failed': 'Перенос не удался',
  'vault.migration.verifyFailed':
    'Копию не удалось проверить. Хранилище не переключено, а заметки всё ещё лежат на диске открытым текстом. Исправьте проблему и запустите перенос снова.',
  'vault.migration.purgeFailed': 'Не удалось удалить открытый текст',
  'vault.migration.brokenTitle': 'Объекты, которые не удалось прочитать:',
  'vault.migration.failedPathsTitle': 'Заметки, которые не удалось прочитать:',
  'vault.migration.safeNote':
    'Скопированные заметки в безопасности в зашифрованном хранилище. Перенос можно запустить снова: он продолжит с недостающих заметок.',
  'vault.migration.encrypt': 'Зашифровать хранилище',
  'vault.migration.running': 'Идёт перенос…',
  'vault.migration.keepPlain': 'Оставить открытые файлы',
  'vault.migration.removePlain': 'Удалить открытые файлы с диска',
  'vault.migration.phase.reading': 'Чтение заметок',
  'vault.migration.phase.encrypting': 'Шифрование заметок',
  'vault.migration.phase.verifying': 'Проверка копии',
  'vault.migration.phase.switching': 'Переключение хранилища',
  'vault.migration.phase.purging': 'Удаление открытого текста',
  'vault.migration.phase.done': 'Готово',
  'vault.migration.phase.working': 'Работа'
};
