# Noto — архитектура

Документ описывает **фактическое** состояние репозитория `E:\Code\Software\noto`
на момент снимка: рабочее дерево, в котором базовый коммит `5c3523b` дополнен
незакоммиченным рефакторингом (разбиение крупных файлов бэкенда, выделение
фронтенд-стора, включение `manualChunks`, новые контрактные тесты). Все
утверждения снабжены ссылками `file:line`.

Соглашение о размерах: «LOC» — число непустых строк; в скобках — общее число
строк.

> **Снимок.** Во время подготовки документа рабочее дерево менялось
> параллельным рефакторингом. Раздел 12 перечисляет, что именно изменено
> относительно коммита `5c3523b`; ссылки `file:line` соответствуют состоянию
> на момент чтения (начало правок раздела 13).

---

## 1. Назначение и границы

Noto — персональное PWA-приложение для Markdown-заметок.

* **Источник истины по содержимому** — файловая система: `*.md` внутри
  `NOTO_NOTES_DIR` (`backend/internal/notes/service.go:20-23`).
* **Метаданные и полнотекстовый индекс** — SQLite (`noto.db`), доступ только
  через интерфейс `port.Store` (`backend/internal/port/port.go:15-53`).
* **Корзина и вложения** — отдельные каталоги `NOTO_TRASH_DIR`,
  `NOTO_ATTACHMENTS_DIR` (`backend/internal/config/config.go:24-25`).
* **Транспорт** — REST/JSON поверх `net/http`, префикс `/api`
  (`backend/internal/api/api.go:46-68`).
* **Клиент** — SPA на Preact/TypeScript, собирается Vite, раздаётся тем же
  Go-сервером (`backend/internal/web/web.go:30-62`).

Вне границ: аутентификация пользователей, многопользовательский режим,
серверная синхронизация между устройствами, индексация содержимого вложений.

---

## 2. Общая карта системы

```
                          ┌───────────────────────────────────────────────────┐
   Браузер / PWA          │  frontend/src (Preact + TypeScript + Vite)        │
                          │                                                   │
                          │  main.tsx → App.tsx (225 LOC, только композиция)    │
                          │      ├── core/store/{appStore,actions,state,types,hooks}         │
                          │      │      └── actions → api/* → fetch (http.ts)  │
                          │      ├── plugins/{contract,manifest} (контракт)    │
                          │      ├── components/{Sidebar,Editor,Preview,…}     │
                          │      └── lib/{autosave,drafts,markdown,wiki,tree,   │
                          │               debounce,errors,format,ordering}     │
                          └──────────────────────────┬────────────────────────┘
                                                      │ fetch(`${API_BASE}${path}`)
                                                      │ HTTP/JSON
   ┌──────────────────────────────────────────────────▼─────────────────────┐
   │  backend/internal/api — HTTP-слой                                        │
   │  api.go:46-97 маршруты · handlers_{notes,search,importexport,attachments} │
   │  middleware.go:22-215 заголовки / host / origin / логирование             │
   └──────────────────────────┬──────────────────────────────────────────────┘
                              │ вызывает только *notes.Service
   ┌──────────────────────────▼──────────────────────────────────────────────┐
   │  backend/internal/notes — доменная логика                                │
   │  service.go · notes.go · notes_move.go · locks.go · fsatomic.go ·         │
   │  paths.go · trash.go · search.go · attachments.go · export.go ·           │
   │  import_files.go · import_zip.go · errors.go                             │
   └──────────────────────────┬──────────────────────────────────────────────┘
                              │ зависит только от интерфейса port.Store
   ┌──────────────────────────▼──────────────┐  ┌───────────────────────────┐
   │  backend/internal/port (Store, 17 методов) │◄─┤ backend/internal/sqlitestore│
   │  backend/internal/port/porttest (conformance)│  │ store*.go · search.go      │
   └────────────────────────────────────────────┘  └───────────────────────────┘

   Листья: model (69 LOC), config (138), web (133).
   Пакет internal/deps удалён (был мёртвым кодом).
```

Правило направления зависимостей (проверено перечислением всех внутренних
импортов):

```
api  ──▶  notes  ──▶  port  ◀──  sqlitestore
 │         │                      (реализация интерфейса)
 │         ├──▶ model
 │         └──▶ config
 └──▶ web            (изолированный лист)

model, config, web — листья. Циклов в графе импортов нет.
```

Инварианты:

* `backend/internal/notes` **не импортирует** `sqlitestore` — вся работа с
  SQLite скрыта за `port.Store`
  (`backend/internal/notes/service.go:16-19`, `:26`).
* `backend/internal/api` **не знает про SQL**: единственная зависимость от
  домена — конкретный тип `*notes.Service`
  (`backend/internal/api/api.go:20-25`).
* `sqlitestore` не импортирует `port` — соответствие интерфейсу проверяется
  только в точке сборки `cmd/noto` (`backend/cmd/noto/main.go:59`).
* Фронтенд: единственная точка `fetch` — `frontend/src/api/http.ts:70`.

---

## 3. Бэкенд: карта пакетов

| Пакет | Файлы (LOC) | Назначение |
|---|---|---|
| `internal/api` | `api.go` 134 (146), `handlers_notes.go` 176 (194), `handlers_importexport.go` 143 (152), `handlers_attachments.go` 87 (94), `handlers_search.go` 30 (33), `middleware.go` 200 (215), `errors.go` 71 (77) | HTTP-слой: маршруты, хендлеры, JSON-энкодирование, конвертация ошибок, security-заголовки, host/origin-проверки, логирование |
| `internal/notes` | `notes.go` 285 (297), `service.go` 236 (257), `paths.go` 238 (252), `trash.go` 199 (209), `notes_move.go` 194 (203), `import_files.go` 191 (202), `attachments.go` 161 (173), `export.go` 133 (140), `import_zip.go` 126 (130), `errors.go` 127 (139), `locks.go` 109 (116), `fsatomic.go` 96 (102), `search.go` 95 (99), `reparse_windows.go` 40 (44), `reparse_other.go` 27 (30), `reconcile.go` 321 (352) | Доменная логика: ФС, нормализация и защита путей, блокировки, атомарная запись, корзина, импорт/экспорт, вложения, поиск, сверка ФС↔БД, типизированные ошибки |
| `internal/sqlitestore` | `search.go` 309 (329), `store_notes.go` 172 (186), `store.go` 128 (145), `store_index.go` 109 (116), `store_schema.go` 106 (113), `store_attachments.go` 75 (82), `store_trash.go` 67 (73) | Реализация `port.Store`: схема и миграции, метаданные, индекс (FTS5 + LIKE), вложения, корзина |
| `internal/port` | `port.go` 47 (54), `porttest/porttest.go` 504 (550) | Интерфейс хранилища (17 методов) и переиспользуемый conformance-набор |
| `internal/model` | `model.go` 69 (79) | Общие типы домена; одновременно контракт JSON API |
| `internal/config` | `config.go` 138 (148) | Конфигурация из переменных окружения, умолчания, создание каталогов |
| `internal/web` | `web.go` 133 (141) | Раздача SPA: `embed` сборки, fallback на `index.html`, `Content-Type` по расширению |
| `internal/testutil` | `store.go` 272 (301), `service.go` 37 (41) | `MemStore` — in-memory реализация `port.Store`, фабрика конфигурации для тестов |
| `cmd/noto` | `main.go` 170 (189) | Точка входа сервера: конфигурация, логгер, БД, сборка сервиса и API, graceful shutdown, запрет не-loopback адреса. Содержит подкоманды `reconcile` и `restore` |
| `cmd/backup` | `main.go` 234 (248) | Консистентный бэкап каталога данных в ZIP (notes, attachments, trash, БД через `VACUUM INTO`, `manifest.json`) |
| `cmd/restore` | `main.go` 51 | Тонкая CLI-обёртка над `internal/restore`: разбор флагов, запуск восстановления, печать отчёта. Поведение и тексты ошибок совпадают с подкомандой `noto restore` |
| `internal/restore` | `restore.go` 430 | Логика восстановления: проверка контрольных сумм, `-dry-run`, `-force`, сохранение текущей БД как `noto.db.pre-restore-<timestamp>`, атомарная подмена БД, удаление `-wal`/`-shm`, проверка схемы, откат при непригодной схеме |
| `internal/backuppkg` | `archive.go` 439 (476), `create.go` 160 (176), `manifest.go` 145 (160) | Формат архива: манифест версии 2 с SHA-256 каждого файла, создание (во временный файл + rename), открытие и проверка |
| `cmd/smoke` | `main.go` 169 (195), `http.go` 111 (124), `helpers.go` 74 (81) | Smoke-проверка REST API: собирает сервер, поднимает на временном порту, прогоняет сценарии, печатает PASS/FAIL. Это бинарник, а не `go test` |
| `internal/sealed` | `store.go` (396), `blocked_store.go` | Слепое объектное хранилище запечатанного vault: каталог `.noto` (`objects/`, `manifests/`, `keystore.json`, `config.json`), запись и чтение байтов по идентификатору, поколения манифестов, лимиты размера. Хранилище **не знает** ключа и **не разбирает** контейнер: оно хранит байты |

### 3.1. `internal/api`

Маршруты (22) регистрируются в `Server.routes()`
(`backend/internal/api/api.go:46-68`):

```
GET    /api/health            GET  /api/search            POST /api/import/files
GET    /api/tree              POST /api/search/reindex    POST /api/import/zip
POST   /api/folders           GET  /api/export/note       GET  /api/export/folder
POST   /api/files             GET  /api/export/all        GET  /api/attachments
GET    /api/notes             POST /api/attachments       GET  /api/attachments/{id}/raw
PUT    /api/notes             DELETE /api/attachments/{id}
POST   /api/notes/rename
POST   /api/notes/move
DELETE /api/notes
POST   /api/notes/restore
GET    /api/trash
```

Хендлеры распределены по файлам: `handlers_notes.go` (заметки: чтение,
запись, переименование, перемещение, удаление, восстановление),
`handlers_importexport.go` (импорт/экспорт), `handlers_attachments.go`
(вложения), `handlers_search.go` (поиск и переиндексация).

Фаза 3 добавила `handlers_maintenance.go` с единственным маршрутом
`POST /api/maintenance/reconcile`. Он регистрируется **только** при
`NOTO_MAINTENANCE=1` (`backend/internal/api/api.go:73-75`), поэтому в
обычной сборке маршрута нет и запрос получает `404 not_found`. Тело
необязательно: `{"apply":bool,"dropGhosts":bool}`; без флагов вызывается
только отчёт.

### 3.2. Режим `sealed` (фаза 7)

Когда vault запечатан, сервер перестаёт быть хранилищем заметок и становится
**слепым объектным хранилищем**. Маршруты запечатанного режима
(`backend/internal/api/api.go:222-234`) зарегистрированы всегда, но данные
носят только в запечатанном режиме:

```
GET    /api/vault/sealed/status
GET    /api/vault/sealed/keystore        PUT /api/vault/sealed/keystore
GET    /api/vault/sealed/objects         PUT /api/vault/sealed/objects/{id}
GET    /api/vault/sealed/objects/{id}    DELETE /api/vault/sealed/objects/{id}
GET    /api/vault/sealed/manifests       PUT /api/vault/sealed/manifests/{gen}
GET    /api/vault/sealed/manifests/{gen} DELETE /api/vault/sealed/manifests/{gen}
POST   /api/vault/sealed/enable          POST /api/vault/sealed/purge-plaintext
```

Все маршруты «открытого» конвейера (дерево, заметки, поиск, импорт, экспорт,
вложения, корзина) обёрнуты в `openRoute`
(`backend/internal/api/api.go:190-211`). Обёртка отвечает `409` с кодом
`vault_sealed`, как только хранилище запечатано: сервер тогда физически не
может записать открытый текст — ни намеренно, ни по ошибке.

Режим хранилища хранится в файле `<vault>/.noto/config.json` (`mode`, `format`),
поэтому «запечатанность» — это факт на диске, а не состояние процесса: после
перезапуска сервер поднимается в том же режиме. Всё, что касается формата и
гарантий, описано в [`ENCRYPTION.md`](ENCRYPTION.md) и
[`API.md`](API.md).

Порядок middleware (снаружи внутрь):
`recoverer → securityHeaders → hostCheck → originCheck → logger → mux`
(`backend/internal/api/api.go:100-102`).

Конверт ошибки `{ "error": { "code", "message", "current"? } }`
(`backend/internal/api/errors.go:49-63`), таблица «код → HTTP-статус» —
`backend/internal/api/errors.go:15-34`, список стабильных кодов —
`backend/internal/notes/errors.go:11-23`.

### 3.2. `internal/notes`

Публичные методы `*notes.Service` (26):

```
Config · Store · Tree · CreateFolder · CreateFile · Read · Write · Rename ·
Move · Delete · Restore · Trash · Search · Reindex · ImportFiles · ImportZip ·
ExportNote · ExportFolder · ExportFolderBytes · ExportAll · ExportAllBytes ·
UploadAttachment · ListAttachments · GetAttachment · AttachmentContent ·
DeleteAttachment
```

Опорные механизмы и их файлы:

* **Нормализация пути** — `paths.go`: `normalizeRel`, `joinRel`,
  `validateName`, `withinRoot` (`:126-138`), `realPath` (`:142-156`).
* **Защита от выхода за корень и от junction** — `paths.go:161-181`
  (`resolve`): `normalizeRel` → `withinRoot` → `checkComponents` (`:189-216`,
  проверка каждого компонента на symlink/reparse point) → `realPath` →
  повторный `withinRoot`. Windows-специфика — `reparse_windows.go`,
  `reparse_other.go`.
* **Блокировки** — `locks.go`: `pathLock` (`:12`), `lockKeys` (`:28`),
  `lockKeyOrder` (`:43`), `acquireLocks` (`:53`), `markMoved` (`:80`),
  `wasMoved` (`:104`, TTL 5 минут).
* **Атомарная запись** — `fsatomic.go`: `writeFileAtomic` (`:10`),
  `writeFileAtomicNoMkdir` (`:17`), `writeFileAtomicMode` (`:22`),
  `movePath` (`:59`), `copyPath` (`:74`).
* **Типизированные ошибки** — `errors.go`: коды (`:11-23`), sentinels
  (`:27-39`), `Error` (`:44-53`), `Code` (`:85`), `Message` (`:120`),
  `CurrentContent` (`:133`).
* **Точки расширения домена** — `noteapi.go` (125 LOC): узкий интерфейс
  `NoteService` (`:79-85`) для потребителей-плагинов, типы событий
  `NoteOp` (`:12-32`) и `NoteEvent` (`:36-47`), тип хука `Hook` (`:53`),
  регистрация `AddHook` (`:93-100`), вызов `fireHooks` (`:108-122`) с
  восстановлением паники (`:125-135`). Хуки вызываются после освобождения
  блокировок, когда диск, индекс и метаданные согласованы
  (`backend/internal/notes/notes.go:306-316`).

### 3.3. `internal/sqlitestore`

* Схема: `notes`, теневой `notes_fts` и виртуальная `notes_fts_v` (FTS5) —
  `backend/internal/sqlitestore/store_schema.go`.
* Версия схемы `schemaVersion = 1` (`store_schema.go:11`), хранится в
  `PRAGMA user_version`; при `version > schemaVersion` — отказ открыть БД
  (`store_schema.go:58`). Миграция одна: полный набор идемпотентных
  `CREATE … IF NOT EXISTS` выполняется при каждом открытии.
* Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`;
  пул соединений ограничен 8 (`backend/internal/sqlitestore/store.go`).
* Наличие FTS5 определяется пробным созданием таблицы и `integrity-check`;
  иначе — LIKE-фолбэк с предупреждением в лог.
* Поиск: FTS5 — два запроса (колонки `name` и `body`) с ранжированием
  `bm25()` (`backend/internal/sqlitestore/search.go:55-119`); LIKE-фолбэк —
  ограниченный скан `fallbackScanLimit = 2000` строк
  (`backend/internal/sqlitestore/search.go:18`, `:123`).

### 3.4. `internal/web`

`web.Handler(staticDir)` отдаёт собранный фронтенд из `NOTO_STATIC_DIR`, иначе
из `embed`-содержимого `backend/internal/web/dist`
(`backend/internal/web/web.go:16-17`, `:43-49`), при отсутствии сборки —
встроенный `placeholder.html` (`:50-56`). Неизвестные пути отдают
`index.html` (SPA fallback), `/api*` — никогда (`:70-74`).

---

## 4. Фронтенд: карта модулей

| Модуль | LOC (всего) | Назначение |
|---|---|---|
| `src/core/store/actions.ts` | 370 (399) | 30 действий приложения: дерево, заметка, автосохранение, черновики, диалоги, тема, баннер |
| `src/core/store/state.ts` | 95 (109) | Состояние: начальный снимок, `update`, `patchNote`, `subscribe`, `getSnapshot`, `resetState`, внутренние ссылки |
| `src/core/store/types.ts` | 71 (79) | Типы состояния: `TreeState`, `NoteState`, `UiState`, `EnvState`, `DialogState`, `AppState` |
| `src/core/store/appStore.ts` | 88 (93) | Фасад стора: подписка, жизненный цикл (`start`/`stop`/`reset`), ссылка на `actions` |
| `src/core/store/hooks.ts` | 16 (18) | Привязка стора к Preact: `useSyncExternalStore` (`hooks.ts:11-13`), `useAppActions` (`:16-18`) |
| `src/core/events/eventBus.ts` | 89 (96) | Шина событий приложения (в работе: хост плагинов) |
| `src/core/commands/commandRegistry.ts` | 80 (87) | Реестр команд (в работе: хост плагинов) |
| `src/core/commands/appCommands.ts` | 107 (117) | Восемь прикладных команд палитры (`app:new-note`, `app:new-folder`, `app:rename-note`, `app:delete-note`, `app:daily-note`, `app:search`, `app:toggle-theme`, `app:open-trash`) |
| `src/components/CommandPalette.tsx` | 208 (228) | Глобальная палитра команд: Ctrl+K / Ctrl+P, поиск по командам, навигация стрелками, вклад в режиме ввода |
| `src/core/settings/settingsStore.ts` | 197 (211) | Хранилище настроек (в работе: хост плагинов) |
| `src/core/diagnostics/logger.ts` | 37 (41) | Логирование для плагинов (в работе) |
| `src/core/crypto/**` | `kdf.ts`, `keys.ts`, `sealed.ts`, `format.ts`, `errors.ts` | Крипто-ядро: Argon2id (`hash-wasm`, ленивый импорт), вывод KEK, иерархия ключей (KEK → DEK), эпохи и key wrapping, контейнер `NOTOSEAL` (заголовок 28 байт как AAD), AES-256-GCM, ключ восстановления. Ядро не знает о vault и не знает об интерфейсе |
| `src/core/vault/**` | `session.ts`, `sealedVault.ts`, `sealedClient.ts`, `sealedIndex.ts`, `conflicts.ts`, `migration.ts`, `autoLock.ts`, `vaultService.ts`, `types.ts` | Слой запечатанного хранилища: манифест и поколения, объекты, поисковый индекс в памяти, слияние и конфликты, миграция с журналом, автоблокировка и единая точка входа `VaultService` |
| `src/core/connection/**` | `types.ts`, `healthMonitor.ts`, `monitor.ts` | Состояние связи с бэкендом: `connected` / `connecting` / `unreachable`, опрос публичного `/api/health` с растущей паузой при отказе, немедленная проверка при возврате вкладки в фокус |
| `src/App.tsx` | 203 (225) | Оболочка приложения: подписка на стор, горячие клавиши, композиция панелей, производные `useMemo` |
| `src/main.tsx` | 12 (14) | Точка входа: `render(<App/>)`, подключение `styles.css` |
| `src/plugins/contract.ts` | 207 (229) | Публичный контракт плагинов: версия API, разрешения, манифест, интерфейсы API и точек вклада в UI, карта событий |
| `src/plugins/manifest.ts` | 158 (179) | Валидация манифеста (`validateManifest`), список разрешений, проверка совместимости версий |
| `src/plugins/builtin/backlinks/index.ts` | 863 (949) | Третий встроенный плагин: обратные ссылки и упоминания. Реализован только через публичный контракт (`plugins/contract.ts`), права `editor.read`, `notes.read`, `tree.read`, `ui.contribute` |
| `src/api/http.ts` | 97 (106) | Транспорт: единственная точка `fetch` (`:70`), `ApiError` (`:8`), разбор конверта ошибок (`:46`), `jsonInit` (`:100`) |
| `src/api/{notes,tree,search,transfer,trash,attachments,health}.ts` | 6–34 каждый | Тонкие обёртки над `request()`; 23 функции |
| `src/api/client.ts` | 14 (14) | Фасад: реэкспорт функций `src/api/*` для совместимости импортов |
| `src/types.ts` | 61 (73) | TypeScript-зеркало `model` бэкенда (`frontend/src/types.ts:1`) |
| `src/components/Sidebar.tsx` | 293 (304) | Дерево папок/файлов, рекурсивный `FolderItem` |
| `src/components/Editor.tsx` | 213 (229) | CodeMirror-редактор, `EditorHandle` (`getText/setText/insert/focus/openSearch`) |
| `src/components/SearchPanel.tsx` | 124 (132) | Поиск с debounce и отменой запросов |
| `src/components/TransferPanel.tsx` | 123 (131) | Импорт (файлы/ZIP) и экспорт |
| `src/components/NoteDialogs.tsx` | 101 (106) | Диалоги создания/переименования/перемещения/удаления и восстановление черновика |
| `src/components/AttachmentsPanel.tsx` | 77 (84) | Загрузка, список и удаление вложений |
| `src/components/Dialog.tsx` | 72 (78) | Модальное окно |
| `src/components/AppHeader.tsx` | — | Шапка приложения **удалена** в фазе 7: бренд и имя открытой заметки живут в шапке колонки дерева, действия — в шапке раздела EXPLORER, состояние документа — в строке состояния |
| `src/components/ConnectionIndicator.tsx` | 51 | Индикатор связи с бэкендом: единственный цветной элемент оболочки (`--success` / `--warning` / `--danger`); при `unreachable` кнопка просит повторить проверку |
| `src/components/Vault{Setup,Migration}Dialog.tsx`, `VaultUnlockScreen.tsx`, `VaultSecuritySection.tsx` | — | Экраны запечатанного хранилища: мастер, миграция, разблокировка, настройки безопасности. Ни один из них не касается материала ключей |
| `src/components/Preview.tsx` | 31 (35) | Рендер Markdown через `renderSafeMarkdown` и `dangerouslySetInnerHTML` (`:32`) |
| `src/components/AppFooter.tsx` | 25 (27) | Подвал: ошибка сохранения и повтор |
| `src/lib/autosave.ts` | 143 (152) | Контроллер автосохранения с debounce и гардами пути/ревизии/последовательности |
| `src/lib/drafts.ts` | 50 (59) | Черновики в IndexedDB (`idb`) |
| `src/lib/markdown.ts` | 65 (72) | `marked` + DOMPurify, поддержка wiki-ссылок |
| `src/lib/tree.ts` | 65 (74) | Построение вложенного дерева из плоских списков |
| `src/lib/wiki.ts` | 51 (57) | Резолвер wiki-ссылок по дереву |
| `src/lib/{debounce,errors,format,ordering}.ts` | 5–38 каждый | `debounce`, `errorMessage`, `formatSize`, `compareStrings` |
| `src/lib/utils.ts` | 8 (8) | Фасад над `lib/debounce|errors|format|ordering` |
| `public/sw.js` | 130 (141) | Service worker: precache оболочки, `network-only` для `/api/*`, `cache-first` для статики |
| `public/sw-policy.js` | 195 (215) | Чистые функции политики service worker (`globalThis.NotoSwPolicy`), вынесены из `sw.js` ради тестируемости без браузера |
| `vite.config.ts` | 63 (69) | Сборка: `preact()`, dev-прокси `/api → 127.0.0.1:8080` (`:45-50`), `manualChunks` (`:27-39`, `:57-61`), параметры `vitest` (`:63-68`) |

Сторонние зависимости (`frontend/package.json:17-28`): `preact`, `marked`,
`dompurify`, `idb`, пакеты CodeMirror 6 (включая `@codemirror/language-data`,
подключаемый лениво — `frontend/src/components/Editor.tsx:107`).

---

## 5. Потоки данных

### 5.1. Открытие заметки

```
Sidebar.onSelect(path)
  → App.tsx:134  → actions.openNote(path)   frontend/src/core/store/actions.ts:113
      ├─ autosave.flush() (если были правки)
      ├─ сброс содержимого ('' и contentPath = null)
      ├─ getNote(path)                       frontend/src/api/notes.ts:5
      │    → GET /api/notes?path=…
      │        → api.handleGetNote           backend/internal/api/handlers_notes.go
      │            → notes.Read              backend/internal/notes/notes.go
      │                ├─ resolve (защита пути)
      │                ├─ os.ReadFile         (файл — источник истины)
      │                └─ store.GetNote       (только ревизия и метаданные)
      ├─ setContent(note.content)
      └─ getDraft(path) → предложить восстановление, если черновик новее
```

### 5.2. Автосохранение

```
CodeMirror onChange
  → App.tsx:158  → actions.editContent(text)   frontend/src/core/store/actions.ts:161
      ├─ patchNote({content, dirty:true})
      ├─ putDraft({path, content, revision, updatedAt})  → IndexedDB
      └─ autosave.markDirty(path, text, revision)  frontend/src/lib/autosave.ts
           └─ debounce(delay = 800, appStore.ts:31) → startSave
                → save(path, content, revision)  → saveNote  frontend/src/api/notes.ts:9
                     → PUT /api/notes
                         → api.handlePutNote     backend/internal/api/handlers_notes.go
                             → notes.Write       backend/internal/notes/notes.go:203
                                 1) проверка ревизии            notes.go:240-271
                                 2) запись на диск               notes.go:272
                                 3) обновление индекса          notes.go:295
                                 4) запись метаданных           notes.go:298
```

Порядок «диск → индекс → метаданные» зафиксирован в коде и является
осознанным (см. §7.3).

Гарды от устаревших ответов: последовательность и активный путь в
контроллере (`frontend/src/lib/autosave.ts:47-61`), проверка активного пути в
`saveNow`.

### 5.3. Поиск

```
SearchPanel → search(query, limit, signal)   frontend/src/api/search.ts:5
   → GET /api/search?q=…&limit=…
       → api.handleSearch                    backend/internal/api/handlers_search.go:9
           → notes.Search                    backend/internal/notes/search.go:15
               ├─ store.Search(query, limit)  backend/internal/sqlitestore/search.go:29
               │    ├─ FTS5: MATCH по name и по body, bm25()   search.go:55-119
               │    └─ иначе LIKE-скан (≤ 2000 строк)           search.go:123
               ├─ store.ListNotes + поиск по имени файла        notes/search.go:38-57
               ├─ дедупликация по (path, kind)                  notes/search.go:28-50
               └─ сортировка по пути и усечение до limit        notes/search.go:58-61
```

### 5.4. Импорт и экспорт

```
TransferPanel → importFiles / importZip   frontend/src/api/transfer.ts:5, :17
   → POST /api/import/files | /api/import/zip
       → api.handleImportFiles / handleImportZip
           backend/internal/api/handlers_importexport.go
       → notes.ImportFiles  backend/internal/notes/import_files.go:46
         notes.ImportZip    backend/internal/notes/import_zip.go:17
             ├─ prepareParent + ensureFolder
             ├─ для каждого файла: importOne (конфликт skip/rename/overwrite)
             │     import_files.go:103-159 — диск → индекс → метаданные
             └─ защита ZIP: лимит записей, MaxArchiveBytes, отказ симлинков,
                   проверка каждого имени записи (import_zip.go:35-54, :108)

Экспорт: exportNoteUrl / exportFolderUrl / exportAllUrl → прямая ссылка
   → GET /api/export/note | /api/export/folder | /api/export/all
       → notes.ExportNote / ExportFolder / ExportAll
         backend/internal/notes/export.go:14, :41, :64
```

### 5.5. Вложения

```
AttachmentsPanel → uploadAttachment(file, notePath)  frontend/src/api/attachments.ts:10
   → POST /api/attachments (multipart) → api.handleUploadAttachment
       backend/internal/api/handlers_attachments.go
   → notes.UploadAttachment   backend/internal/notes/attachments.go:39
       ├─ лимит MaxUploadBytes (32 МБ по умолчанию)   attachments.go:40
       ├─ определение MIME по содержимому (не по имени клиента) attachments.go:46
       ├─ белый список MIME                            attachments.go:16-24
       ├─ запись файла <attachments>/<id><ext>         attachments.go:60-65
       └─ store.PutAttachment → при ошибке файл удаляется  attachments.go:77-80

Чтение: GET /api/attachments/{id}/raw → notes.AttachmentContent → store.GetAttachment
Удаление: DELETE /api/attachments/{id} → notes.DeleteAttachment
```

### 5.6. Корзина

```
Delete → notes.Delete                backend/internal/notes/trash.go:18
   ├─ блокировка пути                trash.go:26
   ├─ movePath(abs, <trash>/<randomID>/<rel>)  trash.go:45
   ├─ collectTrashEntries — обход поддерева   trash.go:89
   └─ для каждой записи: store.PutTrash + store.DeleteNote + removeFromIndex  trash.go:56-62

Список:        GET /api/trash → notes.Trash     trash.go:129
Восстановление: POST /api/notes/restore → notes.Restore  trash.go:152
   ├─ блокировка исходного пути       trash.go:171
   ├─ movePath обратно в notes-корень
   └─ удаление записи корзины
```

### 5.7. Бэкап

```
cmd/backup → runBackup                backend/cmd/backup/main.go:56
   ├─ staging-каталог во временной папке        main.go:68
   ├─ copyTree(notes) → staging/notes            main.go:84
   ├─ copyTree(attachments) → staging/attachments  main.go:87
   ├─ copyTree(trash) → staging/trash            main.go:92
   ├─ copyDatabase: wal_checkpoint(TRUNCATE) + VACUUM INTO  main.go:164
   ├─ manifest.json                              main.go:98
   └─ zipDir(staging, out)                       main.go:200
```

---

## 6. Модель состояния фронтенда

Состояние вынесено в **внешний стор** `core/store/appStore.ts`; React-подобная
привязка — `useSyncExternalStore` (`frontend/src/core/store/hooks.ts:11-13`).

* **Структура состояния** (`frontend/src/core/store/types.ts`):
  `AppState` = `tree` (`TreeState`: folders/files/loading) + `note`
  (`NoteState`: path/content/contentPath/revision/status/dirty/saveError) +
  `dialog` (`DialogState`) + `ui` (`UiState`: mode/expanded/searchOpen/drawerOpen) +
  `env` (`EnvState`: online/theme) + `draftOffer` + `banner`.
* **Хранилище** (`frontend/src/core/store/state.ts`): один объект состояния,
  подписчики — `Set<() => void>` (`state.ts:90`), обновление через
  `update(recipe)` (`state.ts:72`) с иммутабельным обновлением; `patchNote`
  (`state.ts:85`) обновляет только срез заметки; `getSnapshot` (`state.ts:98`).
* **Действия**: 30 методов в `AppActions` (`frontend/src/core/store/actions.ts:347-373`),
  реализация — `actions` (`actions.ts:374`): дерево, заметка, автосохранение,
  черновики, диалоги, тема, баннер. Ссылка стабильна.
* **Жизненный цикл**: `appStore.start()` / `appStore.stop()`
  (`frontend/src/core/store/appStore.ts:29`, `:65`), вызываются из
  `App.tsx:31-34`; `start` поднимает автосохранение, слушатели
  `online`/`offline`, первичную загрузку дерева.
* **Производные данные** остаются в компонентах: дерево
  (`App.tsx:60-63`), резолвер wiki-ссылок (`:65`), список папок (`:67-70`).
* **Локальное персистентное состояние**: черновики в IndexedDB
  (`frontend/src/lib/drafts.ts`), кэш HTTP — только для статики
  (`frontend/public/sw.js:191-202`).
* **Компоненты** получают данные через `useAppState()` и callbacks из
  `useAppActions()`; собственное локальное состояние осталось только у
  `SearchPanel`, `TransferPanel`, `TrashPanel`, `AttachmentsPanel`, `Dialog`.

---

## 7. Модель конкурентности и отказов

### 7.1. Блокировки на бэкенде (`backend/internal/notes/locks.go`)

* `Service.locks: map[string]*sync.Mutex` — по мьютексу на путь;
  `pathLock` (`locks.go:12`) создаёт мьютекс lazily.
* `lockKeys(rel)` (`locks.go:28`) возвращает **цепочку предков** пути.
* `lockKeyOrder(key)` (`locks.go:43`) задаёт глобальный порядок по
  (глубина, путь); `acquireLocks` (`locks.go:49`) сортирует ключи и берёт их
  в этом порядке → дедлоки исключены.
* Операции, берущие блокировки:
  * `Write` — `lockKeys(norm)` (`backend/internal/notes/notes.go:217`),
  * `CreateFolder` / `CreateFile` (`notes.go:26`, `:66`),
  * `Delete` (`backend/internal/notes/trash.go:26`),
  * `Restore` (`trash.go:171`),
  * `relocate` — четыре группы ключей: источник, цель, родитель цели,
    родитель источника (`backend/internal/notes/notes_move.go:89`),
  * `importOne` (`backend/internal/notes/import_files.go:108`).
* Карта `moved` (`backend/internal/notes/service.go:38-39`): `markMoved`
  (`locks.go:80`), `wasMoved` (`locks.go:104`, TTL 5 минут). Поздняя запись
  по перемещённому пути возвращает `conflict`, а не создаёт файл заново
  (`backend/internal/notes/notes.go:240-249`).
* Хранилище обязано быть безопасно при конкурентном использовании
  (`backend/internal/port/port.go:13-14`).

### 7.2. Конфликт ревизии

* Клиент отправляет `revision`; `0` означает «записать принудительно»
  (`backend/internal/notes/notes.go:203, :260-271`).
* При расхождении — ошибка `revision_conflict` с текущим серверным
  содержимым в `current` (`notes.go:260-271`,
  `backend/internal/notes/errors.go:44-53`,
  `backend/internal/api/errors.go:59-61`).
* Фронтенд хранит черновик до и после запроса
  (`frontend/src/core/store/appStore.ts`), а восстановление предлагает, если
  черновик новее серверного (`frontend/src/lib/drafts.ts:54-59`).

### 7.3. Частичная запись и переиндексация

* Запись атомарна на уровне файла (temp + `rename`,
  `backend/internal/notes/fsatomic.go:22`), но не транзакционна между
  файлом, индексом и метаданными: шаги диск → индекс → метаданные
  (`backend/internal/notes/notes.go:272`, `:295`, `:298). Сбой на шаге 3
  оставляет файл новым, а ревизию — прежней.
* Компенсация — `Reindex` (`backend/internal/notes/search.go:66`): полный
  обход notes-корня, перезапись метаданных и индекса. Вызывается при старте
  сервера (`backend/cmd/noto/main.go:65-69`) и доступен как
  `POST /api/search/reindex`.
* `rekey` при перемещении (`backend/internal/notes/notes_move.go:175`)
  перезаписывает индекс заново; ошибки `store.MoveNote` и `store.DeleteNote`
  в нём намеренно игнорируются (`notes_move.go:175-178`).
* `sqlitestore` хранит два индекса: `notes_fts` (теневой, всегда) и
  `notes_fts_v` (FTS5) — при отсутствии FTS5 теневой таблицы достаточно для
  LIKE-фолбэка.

### 7.4. Офлайн

* Service worker: `/api/*` — `network-only`; при недоступности сети
  возвращается синтетическая ошибка `network_error` со статусом 503
  (`frontend/public/sw.js:116-126`, `:186-202`).
* Клиент различает офлайн по `navigator.onLine`
  (`frontend/src/core/store/appStore.ts`) и показывает баннер
  (`frontend/src/App.tsx:104-108`); черновик остаётся в IndexedDB.

---

## 8. Точки расширения

### 8.1. Существующие сегодня

| Точка | Место | Что расширяет |
|---|---|---|
| `port.Store` | `backend/internal/port/port.go:15-53` | Альтернативное хранилище без изменения `notes` и `api` |
| `porttest.Run` | `backend/internal/port/porttest/porttest.go:67` | Переиспользуемый conformance-набор для любой реализации `port.Store` |
| `model.*` | `backend/internal/model/model.go` | Контракт JSON; изменение = ломающее изменение API |
| `notes.Error` + коды | `backend/internal/notes/errors.go:11-53` | Новые машинно-читаемые ошибки (требуют правки `statusFor`) |
| `notes.NoteService` | `backend/internal/notes/noteapi.go:79-85` | Узкий интерфейс «прочитать/записать одну заметку» для потребителей-плагинов |
| `notes.AddHook` / `NoteEvent` | `backend/internal/notes/noteapi.go:53`, `:93-100` | Событийная точка расширения домена: «после создания/записи/переименования/перемещения/удаления/восстановления» |
| Маршруты `api` | `backend/internal/api/api.go:46-68` | Новые эндпоинты; каждый — отдельный хендлер |
| `request()` | `frontend/src/api/http.ts:67-91` | Единая точка для аутентификации, ретраев, трассировки |
| `AppActions` | `frontend/src/core/store/actions.ts:347-373` | Единая точка входа для новых пользовательских намерений; слой «компоненты → стор» |
| `AppState` | `frontend/src/core/store/types.ts` | Единый срез состояния, пригодный для передачи плагин-хосту (комментарий `types.ts:1-3`) |
| `EditorHandle` | `frontend/src/components/Editor.tsx:10-18` | Управление редактором извне |
| `renderSafeMarkdown` | `frontend/src/lib/markdown.ts` | Подключение новых расширений Markdown |
| `web.Handler(staticDir)` | `backend/internal/web/web.go:30` | Раздача фронтенда из внешнего каталога |
| `createAutosave` | `frontend/src/lib/autosave.ts:43` | Альтернативная политика автосохранения |
| `buildTree` | `frontend/src/lib/tree.ts:29` | Альтернативная модель дерева |
| `notes.Reconcile` / `notes.ReconcileWithOptions` | `backend/internal/notes/reconcile.go:70`, `:96` | Сверка ФС↔БД: что добавить (`Apply`), что удалить (`DropGhosts`), только отчёт (`DryRun`) |
| `backuppkg.Create` / `backuppkg.Open` | `backend/internal/backuppkg/create.go`, `archive.go` | Формат архива бэкапа: манифест, контрольные суммы, создание и проверка архива |
| `POST /api/maintenance/reconcile` | `backend/internal/api/handlers_maintenance.go:49` | HTTP-доступ к сверке; включается только через `NOTO_MAINTENANCE=1` |
| `commandRegistry` + `appCommands` | `frontend/src/core/commands/{commandRegistry,appCommands}.ts` | Реестр команд: прикладные команды приложения и команды плагинов попадают в одну палитру |
| `globalThis.NotoSwPolicy` | `frontend/public/sw-policy.js` | Политика service worker как чистые функции — тестируемая и переиспользуемая |

### 8.2. Объявленные, но не доведённые до конца точки расширения

* **Плагинный API фронтенда — в незакоммиченной части дерева.**
  `frontend/src/plugins/contract.ts` (229 LOC) — единственная разрешённая точка
  входа для плагинов: `PLUGIN_API_VERSION` (`:15`), набор разрешений
  `PluginPermission` (`:18-26`), манифест `PluginManifest` (`:38-61`),
  интерфейс API `PluginApi` (`:117`), точки вклада в UI
  (`PluginCommand` `:125`, `PluginPanel` `:134`, `PluginSidebarItem` `:141`,
  `PluginContextMenuItem` `:149`, `PluginToolbarItem` `:157`,
  `PluginSettingsSection` `:165`), карта событий `PluginEventMap` (`:177`),
  контекст `PluginContext` (`:206`) и интерфейс плагина `Plugin` (`:225`).
  `frontend/src/plugins/manifest.ts` (179 LOC) — валидация манифеста
  `validateManifest` (`:48`), список разрешений `PLUGIN_PERMISSIONS` (`:16`),
  проверка совместимости версий `isCompatible` (`:168`).
  Хост плагинов собирается: `core/events/eventBus.ts`,
  `core/commands/commandRegistry.ts`, `core/settings/settingsStore.ts`,
  `core/diagnostics/logger.ts`, компоненты `PluginSlots` и
  `PluginManagerPanel`. Финальный прогон `check-boundaries.mjs` — «OK: 65
  файлов проверено, нарушений нет» (в промежуточном состоянии правило R2
  давало два нарушения). Остаточные риски: скрипт не входит в
  `npm run build`, и 4 фронтенд-теста падают на незакоммиченном коде.
* **Плагинный API бэкенда.** Интерфейс `notes.NoteService` и хуки
  `notes.AddHook` присутствуют (`backend/internal/notes/noteapi.go:79-85`,
  `:93-100`), но потребителей у них нет: ни `api`, ни `cmd/noto` не
  регистрируют хуков и не используют `NoteService`. Комментарий с примером
  ссылается на несуществующую функцию `notes.NewPluginService`
  (`backend/internal/notes/noteapi.go:65`).

---

## 9. Security-границы

* **Сетевая граница**: сервер по умолчанию слушает `127.0.0.1:8080`
  (`backend/internal/config/config.go:51`) и отказывается стартовать на
  не-loopback адресе без `NOTO_ALLOW_PUBLIC=true`
  (`backend/cmd/noto/main.go:136-155`); аутентификации нет.
* **Проверка Host**: `hostCheck` (`backend/internal/api/middleware.go:48`),
  список допустимых хостов (`backend/internal/api/api.go:117`).
* **Проверка Origin / CSRF**: `originCheck`
  (`backend/internal/api/middleware.go:77`).
* **Заголовки**: CSP `default-src 'self'; script-src 'self'`,
  `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP
  (`backend/internal/api/middleware.go:35-45`).
* **Граница файловой системы**: все обращения к диску идут через `resolve`
  (§3.2); архивы: отказ на симлинках и проверка каждого имени записи
  (`backend/internal/notes/import_zip.go:35-54`, `:108`).
* **Лимиты**: тело JSON ≤ 4 МБ (`backend/internal/api/api.go:17`), загрузка ≤
  `MaxUploadBytes` (32 МБ), архив ≤ `MaxArchiveBytes` (256 МБ)
  (`backend/internal/config/config.go:60-61`).
* **XSS**: единственный барьер перед `dangerouslySetInnerHTML` — DOMPurify
  (`frontend/src/lib/markdown.ts`, `frontend/src/components/Preview.tsx:32`).
* **Утечки**: абсолютные пути сервера в сообщениях об ошибках не
  используются (`backend/internal/notes/errors.go:47`), содержимое заметок
  не логируется (`backend/internal/api/middleware.go:197-198`).

Контракт этих правил зафиксирован тестом
(`backend/internal/api/contract_test.go:715` — заголовки безопасности,
`:730` — порядок middleware).

---

## 10. Что можно и что нельзя менять

### 10.1. Нельзя менять без синхронного изменения обеих сторон

* JSON-контракт: имена полей `model.Node`, `model.NoteContent`,
  `model.SearchHit`, `model.Attachment`, `model.ImportResult`, конверт ошибки
  (`backend/internal/model/model.go`, `frontend/src/types.ts:1`). Зафиксировано
  тестом `backend/internal/api/contract_test.go:517`.
* Стабильные коды ошибок и соответствие HTTP-статусам
  (`backend/internal/notes/errors.go:11-23`,
  `backend/internal/api/errors.go:15-34`, тест
  `backend/internal/api/contract_test.go:610`).
* Маршруты и методы `/api/*` (тест `backend/internal/api/contract_test.go:203`).
* Формат пути: slash-разделитель, относительно корня notes, без ведущего
  слэша (`backend/internal/model/model.go:17-18`).
* Схема БД и `PRAGMA user_version` — при `version > 1` сервер отказывается
  открывать базу (`backend/internal/sqlitestore/store_schema.go:58`); тест
  `backend/internal/sqlitestore/schema_compat_test.go:206`.
* Поведение `EditorHandle.setText`: изменение аннотации `EXTERNAL` включило бы
  автосохранение при программной установке текста
  (`frontend/src/components/Editor.tsx:30`, `:169-176`).
* Политика service worker для `/api/*`: переход с `network-only` на
  кэширование вернёт риск отдачи устаревшего тела заметки
  (`frontend/public/sw.js:116-126`).

### 10.2. Можно менять свободно

* Внутренние структуры `notes.Service` и `sqlitestore.Store` внутри пакета.
* Тексты сообщений об ошибках (кроме кодов).
* Раскладку UI, стили, содержимое панелей.
* Файлы скриптов PowerShell и содержимое `docs/`, кроме контрактных
  утверждений.
* Порядок внутренних вызовов внутри `notes` при сохранении инвариантов:
  порядок блокировок, порядок «диск → индекс → метаданные», запрет
  пересоздания отсутствующего родителя при записи
  (`backend/internal/notes/notes.go:231-235`).

---

## 11. Инфраструктура и сборка

| Компонент | Назначение |
|---|---|
| `frontend/package.json:8-9` | `build` = `tsc --noEmit && vite build`; `postbuild` = `node scripts/copy-dist.mjs` (копирование `dist` в `backend/internal/web/dist`) |
| `frontend/vite.config.ts:52-62` | Цель `es2020`, `manualChunks` для vendor-пакетов, без sourcemap; параметры `vitest` (jsdom) |
| `frontend/scripts/copy-dist.mjs` | Копирование сборки в `backend/internal/web/dist` и подстановка `__BUILD_ID__` в `sw.js` |
| `frontend/scripts/measure-bundle.mjs` | Измерение entry-чанка, числа чанков и топ-чанков |
| `frontend/scripts/check-boundaries.mjs` | Проверка границ слоёв фронтенда (не закоммичен; проверка проходит) |
| `scripts/{dev,build,test,backup,smoke}.ps1` | Обёртки PowerShell над `go`/`npm`/`playwright` |
| `scripts/verify.ps1` | Сводная проверка (не закоммичен) |
| `playwright.config.ts` | E2E: база `http://127.0.0.1:8099`, `webServer` = `go run ./cmd/noto`, `channel: 'chromium'`, отдельный каталог данных на прогон |
| `e2e/specs/*` | 8 спеков: заметки, редактор/автосохранение, XSS в предпросмотре, импорт/экспорт, поиск, офлайн, origin, адаптивность, smoke |
| `Dockerfile`, `docker-compose.yml` | Контейнеризация (не проверялась: Docker в среде отсутствует) |

---

## 12. Состояние рабочего дерева относительно коммита `5c3523b`

Всё перечисленное — **незакоммиченные** изменения, сделанные параллельно с
подготовкой документа (другим агентом); они уже отражены в разделах 2–11.

Бэкенд:

* `internal/api/handlers.go` (451 строка) удалён, вместо него
  `handlers_notes.go`, `handlers_search.go`, `handlers_importexport.go`,
  `handlers_attachments.go`.
* `internal/notes/importexport.go` (453 строки) удалён, вместо него
  `export.go`, `import_files.go`, `import_zip.go`.
* `internal/notes/service.go` разделен: выделены `locks.go`, `fsatomic.go`,
  `notes_move.go` (перенос/переименование), `noteapi.go` (интерфейс
  `NoteService` и хуки).
* `internal/sqlitestore/store.go` (672 строки) разделен: `store_schema.go`,
  `store_notes.go`, `store_index.go`, `store_attachments.go`, `store_trash.go`.
* `internal/deps` (мёртвый код) удалён.
* `cmd/smoke/main.go` (1 355 строк) разделен на `main.go`, `http.go`,
  `helpers.go`.
* Добавлены тесты: `internal/port/porttest/` +
  `internal/port/store_conformance_test.go`, `internal/api/contract_test.go`,
  `internal/sqlitestore/schema_compat_test.go`.

Фронтенд:

* `src/api/client.ts` (241 строка) превращён в фасад на 14 строк; реализация
  разнесена по `http.ts`, `notes.ts`, `tree.ts`, `search.ts`, `transfer.ts`,
  `trash.ts`, `attachments.ts`, `health.ts`.
* `src/lib/utils.ts` (64 строки) превращён в фасад на 8 строк; реализация
  разнесена по `debounce.ts`, `errors.ts`, `format.ts`, `ordering.ts`.
* Состояние вынесено из `App.tsx` (679 → 225 строк) в
  `src/core/store/{appStore,actions,state,types,hooks}.ts`; появились компоненты
  `AppHeader.tsx`, `AppFooter.tsx`, `NoteDialogs.tsx`.
* `vite.config.ts`: добавлены `manualChunks` и `chunkSizeWarningLimit: 800`.
* `public/sw.js`: `/api/*` переведено с `network-first` на `network-only`,
  комментарий про `__BUILD_ID__` исправлен на `scripts/copy-dist.mjs`.
* Добавлен `frontend/scripts/check-boundaries.mjs`.

Прочее: `PHASE2_PLAN.md`, `scripts/verify.ps1` — новые файлы.

Позже (после коммита `89c1b32`) в рабочем дереве появились ещё:

* `frontend/src/plugins/contract.ts` и `manifest.ts` — публичный контракт
  плагинов;
* `frontend/src/components/PluginSlots.tsx`, `PluginManagerPanel.tsx` —
  интеграционные компоненты (в момент снимка нарушают правило R2);
* `backend/internal/testutil/search.go`, правки `testutil/store.go`,
  `port/porttest/porttest.go`, `port/store_conformance_test.go`,
  `frontend/src/components/Editor.tsx`.

Коммит `89c1b32` («phase2 wave0-1: golden contract tests, backend split,
frontend store/api split, PWA privacy + chunking, plugin extension point»)
фиксирует большую часть перечисленных выше изменений бэкенда и фронтенда.

---

## 13. Проверки, выполненные при подготовке документа

* `go build ./...` в `backend/` — успешно.
* `go test ./...` в `backend/` — все пакеты с тестами проходят
  (`api`, `notes`, `port`, `sqlitestore`, `web`, `cmd/noto`, `cmd/backup`);
  `cmd/smoke`, `model`, `config`, `testutil`, `port/porttest` — без тестов.
* `npm run test` в `frontend/` — 14 файлов, 107 тестов; **4 теста падают**
  (`src/__tests__/preview-lazy.test.tsx` — 2, `src/__tests__/store.test.tsx` — 1,
  `src/__tests__/app.test.tsx` — 1). Это незакоммиченная работа по ленивому
  превью и хосту плагинов, выполняемая параллельно; на более раннем срезе
  (до появления этих файлов) прогон был полностью зелёным — 11 файлов,
  71 тест.
* `npm run build` (`tsc --noEmit && vite build`) — успешно; `postbuild`
  скопировал `dist` в `backend/internal/web/dist`.
* `node scripts/check-boundaries.mjs` — «OK: 65 файлов проверено, нарушений
  нет» (в промежуточном срезе скрипт падал с двумя нарушениями R2 —
  `src/components/PluginManagerPanel.tsx:6` и
  `src/components/PluginSlots.tsx:11` импортировали `src/plugins/contract`
  напрямую; к финальному прогону нарушения устранены).
* `node scripts/measure-bundle.mjs` — entry-чанк 37 393 B (12 242 B gzip),
  118 JS-чанков, JS всего 1 681,90 kB raw / 619,07 kB gzip.
* Измерение API на временном каталоге с 2 000 заметок (сборка текущего
  дерева): `GET /api/tree` — ≈ 418 мс на запрос (5 прогонов),
  `GET /api/search?q=lorem&limit=50` — ≈ 29 мс, `GET /api/notes` — ≈ 12 мс;
  базовый накладной расход клиента (`/api/health`) — ≈ 17,5 мс.

---

## 14. Фаза 3: новые модули и точки расширения

Раздел дополняет карту из разделов 3, 4 и 8: перечислены модули, которые
появились в фазе 3, и новые точки расширения. Схема базы данных, интерфейс
`port.Store` и публичный контракт плагинов в фазе 3 **не менялись**.

### 14.1. Бэкенд

| Модуль | Назначение | Слой |
|---|---|---|
| `backend/internal/backuppkg/` | Формат архива бэкапа: манифест версии 2 (`files: [{path,size,sha256}]`), создание (во временный файл + `rename`), открытие, проверка контрольных сумм | Не зависит от HTTP и от `notes`; используется `cmd/backup` и `internal/restore` |
| `backend/internal/restore/` | Логика восстановления: проверка сумм, `-dry-run`, сохранение текущей БД как `noto.db.pre-restore-<timestamp>`, атомарная подмена `noto.db`, удаление `-wal`/`-shm`, проверка схемы через `sqlitestore.Open`, откат при ошибке | Не зависит от HTTP; используется подкомандой `noto restore` и обёрткой `cmd/restore` |
| `backend/internal/notes/reconcile.go` | `Reconcile` и `ReconcileWithOptions{Apply, DropGhosts, DryRun}`: обход через существующий безопасный `walkNotes`, корзина исключена | `notes` → `port.Store`; схема SQLite не меняется |
| `backend/internal/api/handlers_maintenance.go` | `POST /api/maintenance/reconcile`, регистрируется только при `NOTO_MAINTENANCE=1` | `api` → `notes` |

Изменение в `notes.Service.Tree` (карточка P3-1): вместо вызова
`store.GetNote` на каждый узел выполняется один `store.ListNotes`, а
метаданные раскладываются по карте путей. `port.Store` при этом не менялся —
использован уже существующий метод интерфейса.

### 14.2. Фронтенд

| Модуль | Назначение |
|---|---|
| `frontend/src/core/commands/appCommands.ts` | Восемь прикладных команд палитры; каждая команда описана через существующий реестр команд, поэтому команды плагинов попадают в ту же палитру |
| `frontend/src/components/CommandPalette.tsx` | Палитра: Ctrl+K / Ctrl+P, фильтр по названию и описанию, навигация стрелками, Enter и Escape |
| `frontend/src/plugins/builtin/backlinks/` | Третий встроенный плагин; реализован только через `plugins/contract.ts`, права `editor.read`, `notes.read`, `tree.read`, `ui.contribute` |
| `frontend/public/sw-policy.js` | Политика service worker как чистые функции (`globalThis.NotoSwPolicy`), подключается через `importScripts`; покрыта 20 unit-тестами |

### 14.3. Новые точки расширения

* **Сверка ФС↔БД как сервис** — `notes.ReconcileWithOptions` позволяет
  добавлять новые стратегии починки, не трогая HTTP-слой.
* **Формат архива бэкапа** — `backuppkg` инкапсулирует манифест и
  контрольные суммы; новая версия манифеста добавляется в одном пакете.
* **Команды приложения** — `appCommands.ts` регистрирует прикладные команды
  в том же реестре, что и плагины, поэтому новая команда не требует правок
  палитры.
* **Политика service worker** — `sw-policy.js` позволяет менять правила
  кэширования и проверять их unit-тестами без браузера.
* **Диагностические CLI-команды** — подкоманды `noto` и отдельные программы
  (`cmd/backup`, `cmd/restore`) построены на одних и тех же пакетах, поэтому
  проверки целостности переиспользуются. Восстановление доступно и как
  подкоманда `noto restore`, и как отдельная программа `cmd/restore`: обе
  точки входа вызывают общий `restore.Run`.

---

## 15. Фаза 7: единый путь хранилища и новые границы

Фаза 7 принесла две вещи: запечатанное (шифрованное на клиенте) хранилище и
редизайн оболочки. Обе описаны подробно в
[`ENCRYPTION.md`](ENCRYPTION.md) и [`UI_AUDIT.md`](UI_AUDIT.md); здесь — карта
связей и правила, которые их держат.

### 15.1. Правило одного пути

Хранилище заметок имеет **два режима** и **один вход**:

```
                      store (core/store/*)
                             │
                             ▼
                     VaultService (core/vault/vaultService.ts)
                        │              │
        open: createOpenVaultService()  sealed: createSealedVaultService()
                        │              │
                        ▼              ▼
        API заметок (/api/notes, …)   SealedVault → SealedClient
                                       → /api/vault/sealed/*
```

* Стор **никогда** не знает, в каком режиме живёт хранилище: он спрашивает
  `getVaultService()` и получает один и тот же интерфейс
  (`listTree`, `readNote`, `saveNote`, `createFile`, `createFolder`,
  `renameNote`, `moveNote`, `deleteNote`, `duplicateNote`, `listTrash`,
  `restoreNote`, `search`, `listAttachments`, `uploadAttachment`,
  `deleteAttachment`) в обоих режимах. Поэтому интерфейс и стор не меняются
  при переходе в запечатанный режим — меняется только адаптер под ними.
* В открытом режиме адаптер — тонкая обёртка над API заметок: поведение
  открытого режима не меняется вообще.
* В запечатанном режиме адаптер работает поверх `SealedVault`: содержимое
  запечатывается до записи и вскрывается после чтения. Заблокированное
  хранилище не работает «вхолостую» — оно бросает `VaultLockedError`.
* **Два режима не используются одновременно.** Синхронизатор
  `syncVaultServiceWithSession()` (`frontend/src/core/vault/vaultService.ts`)
  подписывается на сессию хранилища и устанавливает ровно один сервис.
* Второй рубеж — сервер: в запечатанном режиме все «открытые» маршруты
  отвечают `409 vault_sealed` (`openRoute`,
  `backend/internal/api/api.go:190-211`). Поэтому даже ошибка в клиенте не
  приведёт к записи открытого текста на диск.

### 15.2. Новые модули

| Модуль | Роль | Что ему запрещено |
|---|---|---|
| `frontend/src/core/crypto/**` | Крипто-ядро: KDF, иерархия ключей, контейнер, эпохи, ключ восстановления | Знать о vault (R10) и об интерфейсе (R9) |
| `frontend/src/core/vault/**` | Манифест, объекты, индекс, сессия, миграция, `VaultService` | Импортировать интерфейс (R9) |
| `frontend/src/core/connection/**` | Монитор связи с бэкендом | Знать о хранилище вообще |
| `backend/internal/sealed/**` | Слепое объектное хранилище сервера | Знать ключ и разбирать контейнер (это невозможно по построению: он оперирует байтами) |

### 15.3. Новые правила проверки границ (R9–R12)

`frontend/scripts/check-boundaries.mjs` проверяет импорты между слоями. Фаза 7
добавила четыре правила:

| Правило | Что запрещает | Почему |
|---|---|---|
| **R9** | `src/core/**` не может импортировать `src/components/**` | Ядро не зависит от интерфейса: иначе крипто-ядро пришлось бы переписывать вместе с редизайном, а логику — тестировать вместе с DOM |
| **R10** | `src/core/crypto/**` не может импортировать `src/core/vault/**` | Зависимость направлена только в одну сторону: крипто-ядро остаётся листом графа, и материал ключей нельзя случайно протянуть в прикладной слой |
| **R11** | `src/plugins/**` не может импортировать `src/core/crypto/**` | Плагин никогда не видит ключи — это не обещание в документации, а запрет компилятора |
| **R12** | `src/core/crypto/keys` и `src/core/crypto/sealed` может импортировать только `src/core/crypto/**` и `src/core/vault/**` | Только ядро работает с материалом ключей: интерфейс и плагины до него не дотягиваются |

Нарушение — падение `npm run check:boundaries`, а не замечание на ревью.

### 15.4. Состояние связи

`frontend/src/core/connection/` введён вместе с редизайном: потерянная связь —
это **состояние**, а не ошибка, поэтому она показывается индикатором в шапке
раздела EXPLORER (`--success` / `--warning` / `--danger`), а не красным
баннером. Монитор опрашивает публичный `/api/health`, не касаясь заметок.


