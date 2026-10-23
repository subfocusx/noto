# Noto — аудит архитектуры

Аудит выполнен по рабочему дереву репозитория `E:\Code\Software\noto`
(базовый коммит `5c3523b` + незакоммиченный рефакторинг). Метод: чтение кода
всех пакетов `backend/internal/**`, `backend/cmd/**`, `frontend/src/**`,
`frontend/public/sw.js`, `frontend/vite.config.ts`, `docs/*`, `e2e/*`,
`scripts/*`; статический анализ графа импортов; запуск тестов, сборки,
проверки границ фронтенда и измерений производительности. Утверждения снабжены
ссылками `file:line`; измерения сопровождаются методикой.

Соглашение: «LOC» — число непустых строк.

> **Снимок.** Рабочее дерево менялось параллельным рефакторингом во время
> аудита (разбиение крупных файлов бэкенда, выделение фронтенд-стора,
> добавление контрактных тестов). Ссылки `file:line` соответствуют состоянию
> на момент чтения; раздел 12 фиксирует ограничения этого обстоятельства.

---

## 1. Сводка

| Область | Оценка | Ключевое наблюдение |
|---|---|---|
| Слоистость бэкенда | Хорошо | `api → notes → port ← sqlitestore`, циклов нет, `notes` не знает про SQL |
| Связность бэкенда | Средняя | `api` держит конкретный `*notes.Service`; домен дублирует часть логики хранилища (перенос поддерева, поиск по имени) |
| Связность фронтенда | Средняя | «God-компонент» заменён на «god-стор»: `core/store/appStore.ts` — 485 LOC, 26 действий, состояние + автосохранение + черновики + UI |
| Контракты | Хорошо | Коды ошибок, JSON-контракт, маршруты и схема БД закреплены тестами (`contract_test.go`, `schema_compat_test.go`) |
| Безопасность | Хорошо для локального приложения | Защита от выхода за корень ФС и от junction; аутентификации нет by design |
| Производительность | Средняя | `GET /api/tree` — ≈ 418 мс на 2 000 заметок (N+1 к БД); поиск вычитывает полный текст совпадений |
| Тесты | Средняя | 51 фронтенд-тест, бэкенд-пакеты с тестами; `cmd/smoke` — бинарник, а не `go test`; ветки не покрыты |
| Инфраструктура | Не проверена | Docker в среде отсутствует; E2E — на локальном кэше Chromium |

---

## 2. Карта зависимостей

### 2.1. Бэкенд

```
cmd/noto ──▶ api ──▶ notes ──▶ port
   │           │        │        ▲
   │           │        │        │
   │           │        └────────┼──▶ model   (leaf)
   │           ├───────────────▶ config (leaf)
   │           └───────────────▶ web    (leaf, embed)
   ├────────▶ sqlitestore ─────────┘ (реализация port.Store)
   ├────────▶ notes
   └────────▶ config, sqlitestore

cmd/backup ──▶ config
cmd/smoke  ──▶ стандартная библиотека + os/exec к go (сервер поднимается как
               отдельный процесс), HTTP-клиент собственной реализации

model, config, web — листья, обратных зависимостей нет.
Циклов импортов в графе нет.
```

Подтверждено перечислением внутренних импортов всех пакетов:

* `backend/internal/notes/*` импортирует `model`, `config`, `port` — и **ни**
  `sqlitestore`, **ни** `api`.
* `backend/internal/api/*` импортирует `notes`, `model`, `config`, `web` — и
  **ни** `sqlitestore`, **ни** `port`.
* `backend/internal/sqlitestore/*` импортирует только `model` — даже `port`
  не импортируется, поэтому соответствие интерфейсу проверяется лишь
  компиляцией в точке сборки (`backend/cmd/noto/main.go:59`).
* Пакет `internal/deps` (blank-импорт драйвера SQLite, мёртвый код) **удалён**
  в текущем дереве — одно из замечаний прошлых ревизий снято.

### 2.2. Фронтенд

```
main.tsx ──▶ App.tsx ──┬──▶ core/store/{appStore,hooks,types}
                        │        └──▶ api/client.ts ──▶ api/{http,notes,tree,
                        │            search,transfer,trash,attachments,health}
                        │                  └──▶ fetch (единственная точка)
                        ├──▶ components/{Sidebar,Editor,Preview,SearchPanel,
                        │              TransferPanel,TrashPanel,AttachmentsPanel,
                        │              Dialog,AppHeader,AppFooter,NoteDialogs}
                        └──▶ lib/{autosave,drafts,markdown,wiki,tree,
                                  debounce,errors,format,ordering}
```

* `fetch` встречается ровно один раз — `frontend/src/api/http.ts:70`.
* `api/client.ts` (14 строк) — фасад-реэкспорт; `lib/utils.ts` (8 строк) —
  такой же фасад над `lib/debounce|errors|format|ordering`. Потребители
  импортируют фасады (`frontend/src/App.tsx:2-12`).
* `lib/markdown.ts:4` импортирует `WIKI_LINK_RE` из `lib/wiki.ts` — рендер
  Markdown зависит от резолвера wiki-ссылок.
* `components/Preview.tsx:32` — единственное место с `dangerouslySetInnerHTML`;
  барьер — DOMPurify внутри `renderSafeMarkdown`.
* Границы проверяются скриптом `frontend/scripts/check-boundaries.mjs`
  (не закоммичен): прогон — «OK: 44 файлов проверено, нарушений нет».

---

## 3. Сильные стороны

1. **Чистое направление зависимостей на бэкенде.** Домен не зависит от
   инфраструктуры: `notes.Service` работает только через `port.Store`
   (`backend/internal/notes/service.go:16-19`, `:26`); смена хранилища не
   затрагивает ни `notes`, ни `api`.
2. **Файловая система как источник истины, БД — как индекс.** Отсюда
   работоспособность `Reindex` как восстановительной операции
   (`backend/internal/notes/search.go:66`).
3. **Корректная защита путей.** `resolve` реализует цепочку
   `normalizeRel → withinRoot → checkComponents (symlink/reparse-point каждого
   компонента) → realPath → withinRoot`
   (`backend/internal/notes/paths.go:161-181`, `:189-216`). Windows-джанкшены
   учитываются отдельно, потому что `filepath.EvalSymlinks` их не разрешает
   (`backend/internal/notes/reparse_windows.go`).
4. **Иерархические блокировки с глобальным порядком.** `lockKeys` +
   `lockKeyOrder` + `acquireLocks` исключают деадлоки по построению
   (`backend/internal/notes/locks.go:28`, `:43`, `:49`), а `relocate` берёт
   сразу четыре группы ключей, чтобы параллельная запись внутрь
   перемещаемой папки не разорвала дерево
   (`backend/internal/notes/notes_move.go:84`).
5. **Атомарность записи на уровне файла.** Temp-файл в том же каталоге,
   `fsync`, `chmod`, `rename` (`backend/internal/notes/fsatomic.go:22`);
   `writeFileAtomicNoMkdir` не даёт пересоздать исчезнувший родительский
   каталог (`backend/internal/notes/notes.go:207-212`).
6. **Защита от «записи по перемещённому пути».** Карта `moved` с TTL 5 минут
   превращает позднюю запись в `conflict`, а не в создание дубликата
   (`backend/internal/notes/notes.go:217-222`,
   `backend/internal/notes/locks.go:104`).
7. **Версионирование схемы.** `PRAGMA user_version` + отказ открывать БД новее
   поддерживаемой версии (`backend/internal/sqlitestore/store_schema.go:11`,
   `:58`); поведение закреплено тестом
   (`backend/internal/sqlitestore/schema_compat_test.go:206`).
8. **Деградация поиска без падения.** Отсутствие FTS5 обнаруживается пробным
   созданием таблицы и `integrity-check`, после чего работает LIKE-фолбэк
   с предупреждением в лог (`backend/internal/sqlitestore/search.go:18`).
9. **Контракт ошибок машинно-читаем** и закреплён тестом: единый конверт,
   стабильные коды, явная таблица «код → HTTP-статус»
   (`backend/internal/api/errors.go:15-34`, `:49-63`;
   тест `backend/internal/api/contract_test.go:610`).
10. **Контракт маршрутов и полей закреплён тестом**
    (`backend/internal/api/contract_test.go:203` — маршруты и методы,
    `:517` — имена полей типов), это закрывает главный риск регрессии при
    рефакторинге HTTP-слоя.
11. **Безопасные заголовки и защита от CSRF/DNS-rebinding.** CSP без
    `unsafe-inline` в `script-src`, `hostCheck`, `originCheck`
    (`backend/internal/api/middleware.go:35-112`); порядок middleware и
    заголовки закреплены тестом (`backend/internal/api/contract_test.go:715`,
    `:730`).
12. **Автосохранение не теряет правки.** Черновик до и после запроса, гарды по
    последовательности и активному пути
    (`frontend/src/lib/autosave.ts:47-61`), восстановление только если
    черновик новее серверного (`frontend/src/lib/drafts.ts:54-59`).
13. **Service worker не кэширует приватные данные.** `/api/*` — `network-only`
    с синтетической ошибкой `network_error` при офлайне
    (`frontend/public/sw.js:116-126`, `:186-202`).
14. **Единая точка входа в состояние фронтенда.** `core/store` даёт
    компонентам подписку (`useSyncExternalStore`,
    `frontend/src/core/store/hooks.ts:11-13`) и стабильный набор действий
    (`frontend/src/core/store/appStore.ts:515`) — вместо 19 независимых
    `useState` в компоненте.
15. **Conformance-набор для хранилища.** `porttest` проверяет любую реализацию
    `port.Store` по общему набору сценариев
    (`backend/internal/port/porttest/porttest.go:67`), и `go test ./...` в
    пакете `port` проходит.
16. **Graceful shutdown и защита от не-loopback.** `srv.Shutdown` с таймаутом
    (`backend/cmd/noto/main.go:105-109`) и отказ стартовать на публичном
    адресе без явного флага (`backend/cmd/noto/main.go:136-155`).
17. **Консистентный бэкап.** `wal_checkpoint(TRUNCATE)` + `VACUUM INTO` дают
    согласованную копию БД; в архив попадает и корзина
    (`backend/cmd/backup/main.go:92`, `:164`).

---

## 4. Проблемы связности

### 4.1. `api` зависит от конкретного `*notes.Service`

`backend/internal/api/api.go:20-25` — поле `svc *notes.Service`, а не
интерфейс. Следствия:

* Подменить сервис заглушкой нельзя без реализации всего `port.Store`;
  тесты HTTP-слоя вынуждены поднимать `testutil.MemStore` и настоящий
  `notes.Service`.
* Любая новая доменная возможность тянет изменение `api` — «бог-интерфейс»
  из 26 публичных методов `notes.Service`
  (`backend/internal/notes/*.go`; перечень — `docs/ARCHITECTURE.md` §3.2).
* Нет места для сквозных хуков (события «после записи», «перед удалением»):
  точки расширения в коде отсутствуют.

### 4.2. Домен дублирует поиск по имени файла

`backend/internal/notes/search.go:38-57` повторно ищет совпадения по имени,
обходя **все** заметки (`store.ListNotes`), хотя хранилище уже возвращает
именные совпадения из FTS5-колонки `name`
(`backend/internal/sqlitestore/search.go:55-93`). Результаты дедуплицируются
вручную (`notes/search.go:28-50`).

### 4.3. Поиск теряет релевантность

`backend/internal/notes/search.go:58-61` сортирует объединённый результат
**по пути** и только затем усекает до `limit`. Ранжирование `bm25()`,
вычисленное хранилищем (`backend/internal/sqlitestore/search.go:96-104`),
до клиента не доходит: контентные совпадения вытесняются именными,
объявленными позже. Это функциональный дефект, а не только
неоптимальность.

### 4.4. Перемещение поддерева реализовано дважды

* Домен: `collectSubtree` + `rekey` для каждого потомка
  (`backend/internal/notes/notes_move.go:102-118`, `:124-140`, `:145-175`).
* Хранилище: `Store.MoveNote` сам переименовывает всех потомков префиксной
  заменой в одной транзакции
  (`backend/internal/sqlitestore/store_notes.go:69`, `:97-120`).

При этом ошибки вызовов хранилища в `rekey` **намеренно игнорируются**:

```go
_ = s.store.MoveNote(ctx, oldPath, newPath)          // notes_move.go:152
if _, found, err := s.store.GetNote(ctx, oldPath); err == nil && found {
    _ = s.store.DeleteNote(ctx, oldPath)              // notes_move.go:154
}
```

`backend/internal/notes/notes_move.go:151-154` — рассинхронизация метаданных и
индекса при ошибке БД обнаруживается только косвенно (поиск перестаёт находить
файл), без диагностики в лог.

### 4.5. God-компонент сменился на god-стор

`frontend/src/core/store/appStore.ts` — 485 LOC: типы состояния, 26 действий,
автосохранение, черновики, диалоги, тема, онлайн-статус, баннеры
(`:488-513` — интерфейс `AppActions`, `:515` — реализация). `App.tsx`
сократился до 225 строк и превратился в композицию, но связность не ушла —
она переехала в одно место. Модуль не разделён по доменам (дерево / заметка /
импорт / настройки), поэтому любое новое состояние требует правки
`appStore.ts` и `core/store/types.ts`.

### 4.6. `Sidebar` — 16 пропсов и рекурсивное перепротаскивание

`frontend/src/components/Sidebar.tsx:4-21` — 16 членов `SidebarProps`;
`FolderItemProps` (`:23-36`) — 13, из них 11 пересылаются на каждый уровень
рекурсии (`:114-124`). Любое изменение дерева требует правки в трёх местах.

### 4.7. `lib/markdown.ts` зависит от `lib/wiki.ts`

`frontend/src/lib/markdown.ts:4` — `import { WIKI_LINK_RE, type WikiResolver }
from './wiki'`. Рендер Markdown нельзя использовать без резолвера ссылок;
при этом `Preview` получает резолвер через пропс
(`frontend/src/components/Preview.tsx:7`, `:13`), а `App` строит его
`useMemo` от дерева (`frontend/src/App.tsx:65`) — правка дерева перерисовывает
предпросмотр целиком, даже если открытая заметка не менялась.

### 4.8. Дублирование модели между Go и TypeScript

`frontend/src/types.ts:1` объявляет зеркало `backend/internal/model/model.go`.
Ручная синхронизация 73 строк типов. Go-сторона теперь закреплена тестом
(`backend/internal/api/contract_test.go:517`), но TS-сторона не сверяется ни с
чем: расхождение возможно и не будет замечено.

### 4.9. `sqlitestore` не связан с `port` на уровне компиляции

В пакете нет `var _ port.Store = (*Store)(nil)`
(`backend/internal/sqlitestore/store.go`), поэтому расхождение сигнатур
обнаружится только в `cmd/noto` — при сборке приложения, а не пакета.
Conformance-набор (`porttest`) частично компенсирует это, но проверяет
поведение, а не компиляцию.

### 4.10. `limit` поиска не ограничен сверху

`backend/internal/api/handlers_search.go:11-13` принимает любое положительное
значение `limit` из query-параметра; хранилище ограничивает только
неположительные (`backend/internal/sqlitestore/search.go:30-32`). Клиент может
запросить `limit=100000`, и FTS5-запрос выполнится с соответствующим `LIMIT`,
вычитывая полный `body` каждой строки
(`backend/internal/sqlitestore/search.go:60-62`).

### 4.11. `cmd/smoke` — проверки вне `go test`

`backend/cmd/smoke/` содержит сценарии (`main.go` 169 LOC, `http.go` 111,
`helpers.go` 74, `checks_core.go`, `checks_importexport.go`,
`checks_security.go`, `server.go`, `zip.go`), но это отдельный бинарник:
в `go test ./...` пакет отображается как «no test files», а при падении
сценария прогон `go test` остаётся зелёным.

---

## 5. Дублирование ответственности

| Что | Где дублируется | Файл:строка |
|---|---|---|
| Поиск по имени файла | хранилище (FTS5-колонка `name`) и домен (`ListNotes` + `strings.Contains`) | `backend/internal/sqlitestore/search.go:55-93` и `backend/internal/notes/search.go:38-57` |
| Перенос поддерева | `collectSubtree`+`rekey` в домене и префиксная замена в `Store.MoveNote` | `backend/internal/notes/notes_move.go:102-118` и `backend/internal/sqlitestore/store_notes.go:97-120` |
| Обход дерева файлов | `walkNotes` (обход + метаданные) и `Reindex` (обход + метаданные + индекс) | `backend/internal/notes/service.go:172-183` и `backend/internal/notes/search.go:66` |
| Рекурсивное копирование | `copyPath` в `notes` и `copyTree`/`copyFile` в `cmd/backup` | `backend/internal/notes/fsatomic.go:74` и `backend/cmd/backup/main.go:111-163` |
| Экспорт | `ExportFolder`/`ExportAll` (в поток) и `ExportFolderBytes`/`ExportAllBytes` (в память) | `backend/internal/notes/export.go:41`, `:64`, `:125`, `:134` |
| Сопоставление кодов ошибок со статусами | `api.statusFor` и `http.codeForStatus` на фронтенде | `backend/internal/api/errors.go:15-34` и `frontend/src/api/http.ts:27-40` |
| Архивирование | `zipTree` в `notes` и `zipDir` в `cmd/backup` | `backend/internal/notes/export.go:69` и `backend/cmd/backup/main.go:200` |
| Поверхности импорта фронтенда | `api/client.ts` и `api/*`; `lib/utils.ts` и `lib/*` | `frontend/src/api/client.ts:7-14`, `frontend/src/lib/utils.ts:5-8` |
| Модель предметной области | `backend/internal/model/model.go` и `frontend/src/types.ts` | `backend/internal/model/model.go:19-66`, `frontend/src/types.ts:5-46` |

Фасады `api/client.ts` и `lib/utils.ts` — переходная мера: сами по себе
безвредны, но держат два способа импорта одного и того же, и при добавлении
экспорта легко получить расхождение (что уже произошло с
`frontend/src/lib/utils.ts` → `debounce/errors/format/ordering`).

---

## 6. Oversized-файлы

| Файл | LOC (всего) | Чем плох |
|---|---|---|
| `frontend/src/core/store/appStore.ts` | 485 (552) | Состояние + 26 действий + автосохранение + черновики + диалоги + тема в одном модуле; нет внутреннего деления по доменам |
| `backend/internal/notes/notes.go` | 285 (297) | CRUD заметок + создание папок/файлов + конфликт ревизии |
| `backend/internal/notes/service.go` | 236 (257) | Состояние сервиса, обход дерева, `Tree` |
| `backend/internal/notes/paths.go` | 238 (252) | Нормализация, проверки границ, `checkComponents` |
| `backend/internal/notes/notes_move.go` | 194 (203) | Переименование, перемещение, `collectSubtree`, `rekey` |
| `backend/internal/notes/import_files.go` | 191 (202) | Импорт файлов, политики конфликта |
| `backend/internal/sqlitestore/search.go` | 309 (329) | FTS5-поиск, LIKE-фолбэк, токенизация, сниппеты |
| `backend/internal/sqlitestore/store_notes.go` | 172 (186) | Метаданные заметок + транзакция переноса поддерева |
| `backend/internal/api/handlers_notes.go` | 176 (194) | 7 хендлеров заметок (чтение, запись, rename, move, delete, restore, trash) |
| `backend/internal/api/handlers_importexport.go` | 143 (152) | 5 хендлеров импорта/экспорта |
| `backend/internal/port/porttest/porttest.go` | 504 (550) | Conformance-набор — большой, но это тестовый артефакт, приемлемо |
| `frontend/src/components/Sidebar.tsx` | 293 (304) | Три компонента в одном файле + рекурсивная передача пропсов |

Рефакторинг заметно улучшил ситуацию: до него максимальный файл backend'а —
`cmd/smoke/main.go` (1 259 LOC) и `sqlitestore/store.go` (621 LOC) — разделён
на 169/111/74 и 128/172/109/106/75/67 соответственно
(`docs/ARCHITECTURE.md` §12).

---

## 7. Публичные контракты, которые должны остаться стабильными

| Контракт | Где определён | Чем защищён |
|---|---|---|
| Маршруты и методы `/api/*` (22 маршрута) | `backend/internal/api/api.go:46-68` | `backend/internal/api/contract_test.go:203` |
| Имена и типы полей `Node`, `NoteContent`, `SearchHit`, `Attachment`, `ImportResult`, конверт ошибки | `backend/internal/model/model.go:19-66` ↔ `frontend/src/types.ts:5-46` | `backend/internal/api/contract_test.go:517` (только Go-сторона) |
| Коды ошибок и соответствие HTTP-статусам | `backend/internal/notes/errors.go:11-23`, `backend/internal/api/errors.go:15-34` | `backend/internal/api/contract_test.go:610` |
| Формат пути: slash-разделитель, относительно корня notes, без ведущего слэша | `backend/internal/model/model.go:17-18`, `backend/internal/notes/paths.go` | Тестов нет — риск |
| Поведение `revision`: `0` — принудительная запись, иначе — проверка | `backend/internal/notes/notes.go:182-183`, `:233-244` | Тестов нет на уровне API — риск |
| Схема БД и `PRAGMA user_version = 1` | `backend/internal/sqlitestore/store_schema.go:11`, `:58` | `backend/internal/sqlitestore/schema_compat_test.go:140`, `:206` |
| Интерфейс `port.Store` (17 методов) | `backend/internal/port/port.go:15-53` | `backend/internal/port/store_conformance_test.go`, `porttest/porttest.go:67` |
| Политика service worker для `/api/*` (`network-only`) | `frontend/public/sw.js:116-126` | Тестов нет — риск |
| Семантика `EditorHandle.setText` — не вызывает `onChange` | `frontend/src/components/Editor.tsx:30`, `:169-176` | Покрыт лишь частично (`frontend/src/__tests__/editor.test.tsx`) |
| Список разрешённых MIME вложений | `backend/internal/notes/attachments.go:16-35` | Тестов нет — риск |
| Заголовки безопасности и порядок middleware | `backend/internal/api/middleware.go:35-112` | `backend/internal/api/contract_test.go:715`, `:730` |

---

## 8. Security-границы

### 8.1. Реализованные границы

* **Сеть.** По умолчанию `127.0.0.1:8080`
  (`backend/internal/config/config.go:51`); отказ стартовать на публичном
  адресе без `NOTO_ALLOW_PUBLIC=true`
  (`backend/cmd/noto/main.go:136-155`).
* **Host / DNS-rebinding.** `hostCheck`
  (`backend/internal/api/middleware.go:48`), список допустимых хостов
  (`backend/internal/api/api.go:117`).
* **Origin / CSRF.** `originCheck`
  (`backend/internal/api/middleware.go:77`): same-origin и пустой Origin
  разрешены; иностранный origin для изменяющих методов → `403`.
* **Заголовки.** CSP `script-src 'self'` без `unsafe-inline`,
  `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP
  (`backend/internal/api/middleware.go:35-45`).
* **Файловая система.** `resolve` + `checkComponents` + `realPath`
  (`backend/internal/notes/paths.go:161-216`); отказ на symlink/reparse-point
  (`backend/internal/notes/reparse_windows.go`, `reparse_other.go`); архивы:
  отказ на симлинках и проверка каждого имени записи
  (`backend/internal/notes/import_zip.go:35-54`, `:108`).
* **Загрузки.** MIME определяется по содержимому, а не по имени клиента, и
  проверяется по белому списку
  (`backend/internal/notes/attachments.go:46`, `:16-24`); лимиты тела JSON
  (4 МБ — `backend/internal/api/api.go:17`), загрузки и архива
  (`backend/internal/config/config.go:60-61`).
* **XSS.** DOMPurify — единственный барьер перед `dangerouslySetInnerHTML`
  (`frontend/src/lib/markdown.ts`, `frontend/src/components/Preview.tsx:32`).
  Вложения отдаются с `Content-Disposition: attachment` и `nosniff`
  (`backend/internal/api/handlers_attachments.go`), поэтому загруженный SVG не
  исполняется в origin приложения.
* **Утечки.** Абсолютные пути сервера не попадают в сообщения об ошибках
  (`backend/internal/notes/errors.go:46-47`); содержимое заметок не
  логируется (`backend/internal/api/middleware.go:197-198`).

### 8.2. Осознанные ограничения (не дефекты)

* **Аутентификации нет.** Модель «одно персональное приложение на локальной
  машине»; при `NOTO_ALLOW_PUBLIC=true` любой, кто достигнет порта, получает
  полный доступ к API (зафиксировано в `docs/SECURITY.md` и в сообщениях
  сервера — `backend/cmd/noto/main.go:144-152`).
* **Полноценной offline-синхронизации нет.** Service worker отдаёт статику,
  но приватные данные не кэширует
  (`frontend/public/sw.js:191-202`); доступны только черновики (IndexedDB) и
  уже открытый текст. Синхронизации «по кругу», разрешения конфликтов на
  стороне клиента и очереди операций нет.

### 8.3. Зоны, требующие внимания

* CSP разрешает `style-src 'unsafe-inline'`
  (`backend/internal/api/middleware.go:42`) — нужно из-за inline-стилей;
  при усилении CSP потребуется nonce-подход.
* `limit` поиска не ограничен сверху
  (`backend/internal/api/handlers_search.go:11-13`) — на локальном приложении
  не критично, но при публикации это вектор нагрузки.
* `NOTO_ALLOWED_ORIGINS` автоматически расширяет список допустимых Host
  (`backend/internal/api/api.go:132-144`) — ошибка в конфигурации расширяет
  доверие.

---

## 9. Узкие места производительности

### 9.1. Измерения

Методика: собран сервер текущего дерева (`go build ./cmd/noto`), поднят на
`127.0.0.1:8141` с временным каталогом данных, в нём 2 000 Markdown-файлов
(~1 КБ каждый), клиент — `Invoke-WebRequest` из PowerShell (Windows).

| Запрос | Прогонов | Среднее | Комментарий |
|---|---|---|---|
| `GET /api/health` | 10 | ≈ 17,5 мс | базовый накладной расход клиента (PowerShell + TCP) |
| `GET /api/tree` | 5 | ≈ 418 мс | **главное узкое место** |
| `GET /api/search?q=lorem&limit=50` | 5 | ≈ 29 мс | FTS5 быстр; ≈ 12 мс серверной части |
| `GET /api/notes?path=n1.md` | 20 | ≈ 11,8 мс | практически только накладной расход клиента |

Вычитая накладной расход клиента (~17,5 мс), серверная часть `/api/tree` —
около **400 мс на 2 000 файлов** (≈ 0,2 мс на файл). Результаты
воспроизводятся: до рефакторинга измерялось 428 мс при накладных 36 мс —
то есть серверная доля практически не изменилась (логика `Tree` не
переписывалась).

Размер бандла (`node scripts/measure-bundle.mjs`):

| Сборка | Entry-чанк | gzip | JS-чанков | JS всего (raw/gzip) |
|---|---|---|---|---|
| коммит `5c3523b` (без `manualChunks`) | 658 056 B | 227 414 B | 114 | 1 672,70 kB / 615,57 kB |
| текущее дерево (с `manualChunks`) | 33 559 B | 11 253 B | 118 | 1 672,47 kB / 616,01 kB |

Крупнейший чанк после разделения — `codemirror`: 528,76 kB raw / 182,44 kB
gzip. Число чанков (118) определяется ленивым импортом
`@codemirror/language-data` (`frontend/src/components/Editor.tsx:107`):
около сотни языковых режимов попадают в отдельные файлы — это осознанный
размен «entry-чанк против числа запросов».

### 9.2. `GET /api/tree` — N+1 к базе и полный обход ФС

`notes.Tree` обходит весь notes-корень
(`backend/internal/notes/service.go:172-183`) и **для каждого** узла делает
отдельный `store.GetNote` (`backend/internal/notes/service.go:211`) — 1 + N
обращений к SQLite за один запрос дерева. При 2 000 заметок это ~2 000
round-trip'ов за ≈ 400 мс. Дерево запрашивается при каждом обновлении UI
(`frontend/src/core/store/appStore.ts`), то есть после каждого создания,
переименования, перемещения, удаления и импорта.

Устранение: один запрос `SELECT … FROM notes` с построением дерева в памяти
(метаданные в БД уже есть) либо кэш дерева с инвалидацией по событиям
изменений.

### 9.3. Поиск читает полный текст совпадений

FTS5-запрос выбирает колонку `body` целиком
(`backend/internal/sqlitestore/search.go:60-62`), а `LIMIT` берётся из
пользовательского параметра без верхней границы
(`backend/internal/api/handlers_search.go:11-13`). При `limit=100000` в память
попадает до 100 000 полных текстов заметок. Сниппеты вычисляются уже в Go
(`backend/internal/sqlitestore/search.go:82`), то есть вычитывать тело
целиком не требуется — достаточно `snippet()` на стороне SQLite.

Дополнительно: `notes.Search` на каждый запрос тянет `store.ListNotes` — все
метаданные всех заметок (`backend/internal/notes/search.go:38`), то есть ещё
один полный проход по таблице.

### 9.4. Перемещение поддерева — лишние запросы

`relocate` обходит поддерево и для каждого потомка вызывает `rekey`, который
сам вызывает `store.MoveNote`, `store.GetNote` и `store.DeleteNote`
(`backend/internal/notes/notes_move.go:124-140`, `:145-175`), хотя
`sqlitestore.MoveNote` уже переименовал всех потомков одной транзакцией
(`backend/internal/sqlitestore/store_notes.go:69`, `:97-120`). На дереве из M
узлов — примерно 5M SQL-операций вместо M.

### 9.5. Поиск по имени в домене — лишний полный проход

`backend/internal/notes/search.go:38-57`: `ListNotes` + `strings.Contains` по
каждой заметке. При 2 000 заметок это 2 000 сравнений на каждый запрос поиска
поверх уже готового результата FTS5.

### 9.6. Перезапись индекса при перемещении

`rekey` перечитывает файл и полностью переиндексирует его
(`backend/internal/notes/notes_move.go:161-170`) — для больших заметок это
лишнее чтение и запись в FTS5 при каждом переименовании.

### 9.7. Перерисовка предпросмотра

`wikiResolver` пересоздаётся `useMemo` при каждом изменении дерева
(`frontend/src/App.tsx:65`), а `Preview` пересчитывает HTML при смене
`resolve` (`frontend/src/components/Preview.tsx:12-15`) — правка дерева
перерисовывает предпросмотр целиком.

### 9.8. Отсутствие индексов и пагинации

* Таблица `notes` имеет `PRIMARY KEY(path)`, но индекса по `parent_path` нет —
  при росте дерева обходы по каталогам деградируют.
* Ни один список не пагинируется: `/api/tree` возвращает всё дерево,
  `/api/trash` — всю корзину, `/api/attachments` — все вложения.

### 9.9. Бандл

До включения `manualChunks` entry-чанк составлял 658 056 B — это блокирующий
рендер первого экрана. Сейчас entry — 33,5 kB, но общий объём JS не изменился
(≈ 1,67 MB raw / 616 kB gzip), а `codemirror` занимает 528 kB raw отдельным
чанком. Дальнейшее снижение требует отказа от `@codemirror/language-data`
в пользу подмножества языков.

---

## 10. Пробелы в тестах

| Пробел | Доказательство |
|---|---|
| `cmd/smoke` — бинарник, а не go-тест | `backend/cmd/smoke/` (7 файлов); в `go test ./...` отображается как «no test files», падение сценария не ломает `go test` |
| TS-зеркало Go-модели не сверяется | `frontend/src/types.ts` дублирует `backend/internal/model/model.go` без кодогенерации; `contract_test.go:517` проверяет только Go-имена |
| Формат пути и семантика `revision` не закреплены тестами | `backend/internal/model/model.go:17-18`, `backend/internal/notes/notes.go:182-183` — нет golden-теста |
| Политика service worker не покрыта | `frontend/src/__tests__/` — 9 файлов; SW не покрыт ни одним тестом, при том что кэширование приватных данных — security-значимое поведение |
| `EditorHandle` покрыт частично | `frontend/src/__tests__/editor.test.tsx` — 2 теста; `setText`/`insert`/`openSearch` не проверены, хотя именно `setText` не вызывает `onChange` (`frontend/src/components/Editor.tsx:169-176`) |
| Панели покрыты частично | Тесты есть для `SearchPanel` и `Sidebar`; `TransferPanel`, `TrashPanel`, `AttachmentsPanel`, `Dialog` — без тестов |
| LIKE-фолбэк поиска практически не покрыт | Ветка `searchLike` (`backend/internal/sqlitestore/search.go:123-160`) требует окружения без FTS5; в тестах не моделируется |
| Частичная запись (диск → индекс → метаданные) не проверяется на сбои | Порядок в `backend/internal/notes/notes.go:245`, `:268`, `:271`; нет теста на отказ `UpsertNote`/`IndexContent` |
| Ошибки хранилища в `rekey` игнорируются без теста | `backend/internal/notes/notes_move.go:151-154`; нет теста, фиксирующего ожидаемое поведение при ошибке БД |
| Нет бенчмарков | В `backend/` нет ни одной функции `Benchmark`; узкие места §9.2–9.6 измеряются вручную |
| Миграций схемы больше одной нет | `schemaVersion = 1` (`backend/internal/sqlitestore/store_schema.go:11`); механизм миграции проверен лишь на текущей версии и на отказе открыть более новую (`schema_compat_test.go:206`) |

---

## 11. Приоритизированный план устранения

### P0 — немедленно (риск потери данных и корректности)

1. **Не игнорировать ошибки хранилища в `rekey`.**
   `backend/internal/notes/notes_move.go:151-154`: ошибка БД при перемещении
   оставляет файл на диске, а метаданные и индекс — на старом пути, без
   диагностики. Нужен `errors.Join`/лог и явная транзакционная семантика.
2. **Устранить двойную реализацию переноса поддерева.** Выбрать одного
   владельца (хранилище: `sqlitestore.MoveNote` уже переносит потомков в
   транзакции, `store_notes.go:97-120`) и убрать второй проход
   (`notes_move.go:124-140`).
3. **Вернуть ранжирование поиска.** Не сортировать объединённый результат по
   пути (`backend/internal/notes/search.go:58-61`): ранжирование `bm25`
   должно сохраняться, а имя и содержимое — иметь явный приоритет.
4. **Ограничить `limit` поиска сверху** на уровне API
   (`backend/internal/api/handlers_search.go:11-13`) и хранилища.
5. **Перевести `cmd/smoke` в `go test`** (или хотя бы добавить пакет
   `smoke_test`, вызывающий те же сценарии), чтобы падение проверок было
   видно в `go test ./...`.

### P1 — ближайший цикл (связность и производительность)

6. **Убрать N+1 в `Tree`:** один запрос метаданных вместо `GetNote` на каждый
   узел (`backend/internal/notes/service.go:211`).
7. **Убрать дублирование поиска по имени:** либо хранилище возвращает именные
   совпадения, либо домен — но не оба
   (`backend/internal/notes/search.go:38-57` против
   `backend/internal/sqlitestore/search.go:55-93`).
8. **Не читать `body` целиком в FTS5-запросе:** вычислять сниппет средствами
   SQLite (`snippet()`) вместо выборки всей колонки
   (`backend/internal/sqlitestore/search.go:60-62`).
9. **Ввести интерфейс вместо `*notes.Service` в `api`**
   (`backend/internal/api/api.go:22`): узкий интерфейс на используемые
   методы либо набор интерфейсов по ресурсам. Это разблокирует тестирование
   HTTP-слоя без хранилища и даст точку для хуков.
10. **Разделить `core/store/appStore.ts` (485 LOC)** на доменные модули
    (`tree`, `note`, `transfer`, `ui`, `env`) с единым фасадом
    `actions` — по образцу уже сделанного разбиения бэкенда.
11. **Сократить пропсы `Sidebar`:** передавать контекст операций одним
    объектом вместо 11 колбэков на каждый уровень рекурсии
    (`frontend/src/components/Sidebar.tsx:114-124`).
12. **Заменить дублирование модели кодогенерацией** (или сверкой TS-типов с
    Go-моделью в CI) — `frontend/src/types.ts` ↔
    `backend/internal/model/model.go`.
13. **Закрыть тестовые пробелы:** политика SW, `EditorHandle.setText`/`insert`,
    панели `Transfer`/`Trash`/`Attachments`, golden-тест формата пути и
    семантики `revision`, тест на частичную запись.
14. **Добавить `var _ port.Store = (*Store)(nil)`** в `sqlitestore`.
15. **Добавить бенчмарки** `Tree`/`Search`/`Reindex` (`go test -bench`), иначе
    узкие места придётся измерять вручную, как в §9.1.

### P2 — дальнейшее развитие (структура и производительность)

16. **Реализовать или удалить объявленные плагинные слои.** `check-boundaries.mjs`
    описывает `src/plugins/{contract,host,registry,builtin}`, которых нет;
    скрипт подключён как `npm run check:boundaries`, но не входит в
    `npm run build` — сейчас это «зелёная» проверка несуществующей
    архитектуры.
17. **Разделить `backend/internal/sqlitestore/search.go`** (309 LOC) на
    FTS5-часть, LIKE-фолбэк и построение сниппетов.
18. **Разделить `backend/internal/api/handlers_notes.go`** (176 LOC) по
    операциям; вынести общие операции (multipart, потоковая выдача экспорта)
    в отдельные файлы.
19. **Свести экспорт к одному потоковому варианту** вместо четырёх
    (`backend/internal/notes/export.go:41`, `:64`, `:125`, `:134`).
20. **Свести рекурсивное копирование к одной реализации** для `notes` и
    `cmd/backup` (`backend/internal/notes/fsatomic.go:74` и
    `backend/cmd/backup/main.go:111-163`); то же для архивирования
    (`export.go:69` и `cmd/backup/main.go:200`).
21. **Пагинация и индексы:** индекс по `parent_path` в `notes`,
    постраничная выдача `/api/tree`, `/api/trash`, `/api/attachments`.
22. **Кэш дерева** с инвалидацией по событиям изменений, если после P1
    `/api/tree` остаётся заметно медленным.
23. **Сократить бандл:** отказ от `@codemirror/language-data` в пользу
    подмножества языков (сейчас — 528,76 kB raw отдельного чанка и 118
    JS-чанков).

---

## 12. Ограничения аудита

* **Docker не собирался и не запускался:** Docker в среде отсутствует.
  `Dockerfile` и `docker-compose.yml` не верифицированы — утверждения о
  контейнеризации основаны только на чтении файлов.
* **E2E не прогонялся в рамках аудита.** `playwright.config.ts:58` задаёт
  `channel: 'chromium'`, потому что сборка headless-shell с
  `cdn.playwright.dev` недоступна из этой сети (комментарий
  `playwright.config.ts:14-17`); зафиксировано только наличие 8 спеков
  (`e2e/specs/*`).
* **`go test -race` не выполнялся:** требует cgo и C-компилятора, в среде не
  проверены. Выводы о конкурентности сделаны по коду
  (`backend/internal/notes/locks.go:12-116`).
* **Полноценная offline-синхронизация не реализована** и не оценивалась:
  сервис-воркер работает в режиме `network-only` для приватных данных
  (`frontend/public/sw.js:191-202`); синхронизации между устройствами,
  разрешения конфликтов на клиенте и очереди операций нет.
* **Аудит выполнялся на изменяющемся рабочем дереве:** параллельно шёл
  рефакторинг (разбиение `api/handlers.go`, `notes/importexport.go`,
  `sqlitestore/store.go`, `cmd/smoke/main.go`; выделение `core/store`;
  удаление `internal/deps`; добавление `contract_test.go`,
  `schema_compat_test.go`, `porttest`). Ссылки `file:line` соответствуют
  состоянию на момент чтения; при продолжении рефакторинга они сместятся.
  Два промежуточных состояния дерева были временно не компилируемыми
  (`internal/notes/trash.go` без импорта `time`; рассогласование
  `internal/web/dist` при параллельной пересборке фронтенда) — это следствие
  параллельной правки, а не дефект кода; финальная проверка
  `go build ./...` и `go test ./...` проходит.
* **Conformance-набор `port.Store` проверен на исполнение:** пакет
  `internal/port` проходит `go test`; расхождения `MemStore`/`sqlitestore`
  (потомки не переносятся при `MoveNote`, поиск по имени не выполняется,
  `limit` для именных совпадений не соблюдается, пустой запрос возвращает
  совпадения) зафиксированы как известные особенности набора
  (`backend/internal/port/porttest/porttest.go:213-380`) и требуют отдельного
  решения — либо исправления `MemStore`, либо ослабления ожиданий набора.
* **Нагрузочное тестирование не проводилось:** измерения §9.1 выполнены на
  синтетическом наборе из 2 000 файлов; поведение при 10 000+ заметок и при
  параллельной нагрузке не измерялось.
* **Внешние интеграции отсутствуют:** OAuth, синхронизация, плагины сторонних
  разработчиков не оценивались, так как соответствующего кода в репозитории
  нет.
