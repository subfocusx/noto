# Noto Phase 8 — рабочий чек-лист (живой файл)

> Этот файл — единственный источник статуса Phase 8. Владелец: **root**. После завершения каждой задачи root немедленно обновляет строку статуса (`DONE` / `PARTIAL` / `BLOCKED`) с указанием файлов и реального результата проверок.
> Источник истины по API — `docs/CONTRACT.md`. Спецификация языка запросов — `docs/QUERY_LANGUAGE.md`. Контракт двух реализаций языка — `shared/query-vectors.json`.

## Соглашения

- Одновременно работают **не более 4 субагентов**; каждый владеет **непересекающимся** набором файлов.
- Каждый исполнитель приводит в отчёте **реальный вывод** команд проверки.
- Статусы: `TODO` · `WIP` · `DONE` · `PARTIAL` · `BLOCKED` (с причиной).
- Фаза 8 **не меняет** стек: Preact + TypeScript strict + Vite + CodeMirror 6; Go + stdlib + modernc.org/sqlite.

## Идея фазы

Из `usememos/memos` (MIT) берём **идеи и приёмы**, а не стек: язык запросов,
производные свойства заметок (заголовок, теги, флаги), выборки и сохранённые
представления, плагины графа/тегов/активности, приёмы UX. `cel-go` не
подключаем — свой мини-язык, две реализации (SQL для открытого режима,
предикат по дереву для зашифрованного), один файл золотых векторов.

## Baseline (зафиксирован до изменений)

| Проверка | Команда | Результат |
|---|---|---|
| Go build | `go build ./...` (backend) | exit 0 |
| Go vet | `go vet ./...` | exit 0 |
| Go tests | `go test ./... -count=1` | все пакеты ok |
| Frontend tests | `npm test` (frontend) | 46 файлов / 473 теста passed |
| Границы | `npm run check:boundaries` | OK, нарушений нет (R1–R12) |
| Бандл | `npm run measure` | entry 41,88 kB gzip |
| E2E | `npx playwright test` | 106 passed / 32 skipped / 0 failed |

Ограничения окружения: Go только в `.tools\goroot`; `-race` требует cgo (gcc в
`C:\msys64\mingw64\bin`); `playwright install` недоступен (CDN 403) → E2E на
локальном кэше Chromium (`channel: 'chromium'`).

---

## Волна 0 — фундамент

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T0.1 | Соглашения репозитория и словарь предметной области | worker C | `AGENTS.md`, `CONTEXT.md` | **DONE** | 17 терминов словаря (заметка, тег, свойства заметки, запрос, представление, запечатанное хранилище…) |
| T0.2 | Карточки дизайна и журнал API | worker C | `docs/design/D1..D6.md`, `docs/design/README.md`, `docs/API-CHANGELOG.md` | **DONE** | 6 карточек: язык запросов, свойства, выборки, плагины, UX, бэкап |
| T0.3 | Лицензии третьих лиц и README пакетов | worker C | `docs/THIRD_PARTY.md`, `backend/internal/*/README.md` | **DONE** | memos — MIT (атрибуция); AGPL-части не копируются; `cel-go` не подключается |
| T0.4 | CI: бэкенд, фронтенд, E2E, upgrade-smoke | root | `.github/workflows/*.yml` | **DONE** | 4 workflow; `playwright.config.ts` теперь берёт Go из `NOTO_GO_BIN` или из PATH — на CI работает Linux-путь |
| T0.5 | Smoke восстановления из бэкапа | worker C | `scripts/restore-smoke.ps1` | **DONE** | backup → restore → smoke во временном каталоге; ничего не трогает в данных пользователя |

## Волна 1 — язык запросов

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T1.1 | Спецификация языка | root | `docs/QUERY_LANGUAGE.md` | **DONE** | EBNF, поля, операторы, время (unix-секунды), ошибки, правила извлечения свойств |
| T1.2 | Золотые векторы — контракт двух реализаций | root | `shared/query-vectors.json` | **DONE** | 45 векторов запросов + 23 вектора свойств; канонический JSON AST; читается Go- и TS-тестами |
| T1.3 | Ядро языка на TypeScript | worker C | `frontend/src/core/query/{grammar,ir,schema,predicate,highlight}.ts` | **DONE** | парсер → IR → предикат по дереву + подсветка совпадений; конформанс-тесты идут по тем же векторам |
| T1.4 | Ядро языка на Go | worker A + root | `backend/internal/query/{grammar,ir,schema,render,predicate}.go` | **DONE** | два компилятора: `Compile` (SQL) и `CompilePredicate` (дерево) |
| T1.5 | Извлечение свойств заметки | worker C / root | `frontend/src/core/metadata/extract.ts`, `backend/internal/metadata/extract.go` | **DONE** | заголовок (первый H1), теги (`#` + слово без пробела), флаги задач/кода/картинок/ссылок |
| T1.6 | Паритет двух реализаций | root | `backend/internal/query/parity_test.go` | **DONE** | 28 вопросов на одном хранилище: SQL и предикат дают одинаковые множества. **Найден и исправлен дефект**: моменты времени хранятся в миллисекундах, а компилятор сравнивал в секундах (`render.go`, умножение на 1000) |

## Волна 2 — свойства, хранилище, API

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T2.1 | Схема SQLite v2 | worker A | `backend/internal/sqlitestore/store_schema.go`, `schema_compat_test.go` | **DONE** | `user_version` 1 → 2, таблица `note_props` + индекс; миграция идемпотентна, данные v1 не трогаются |
| T2.2 | Порт: свойства и запросы | worker A | `backend/internal/port/port.go`, `port/porttest/porttest.go` | **DONE** | `Upsert/Get/List/DeleteNoteProps` и `QueryNotes(expr, limit)`; конформанс-сюита выросла на 2 кейса |
| T2.3 | Извлечение и хранение свойств | worker A | `backend/internal/sqlitestore/store_props.go`, `backend/internal/notes/query.go`, `notes/service.go` | **DONE** | свойства — кэш: пересчёт при сохранении, бит `PropStale` при ошибке, ответ помечается `partial: true` |
| T2.4 | HTTP-эндпоинты | worker A | `backend/internal/api/handlers_query.go`, `api.go` | **DONE** | `POST /api/query`, `GET /api/tags`; контрактный тест закрыт, добавлены 8 тестов эндпоинтов |
| T2.5 | Запечатанное хранилище и MemStore | worker A | `backend/internal/sealed/blocked_store.go`, `backend/internal/testutil/store.go` | **DONE** | запечатанный режим отвечает `ErrVaultSealed`; MemStore отвечает предикатом |

## Волна 3 — интерфейс

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T3.1 | Сервис запросов для обоих режимов | worker A | `frontend/src/core/query/service.ts` | **DONE** | открытый режим — сервер, запечатанный — локальный предикат над расшифрованными заметками |
| T3.2 | Действия стора | worker A | `frontend/src/core/store/actions.ts` | **DONE** | `setQuery`, `runQuery`, `clearQuery`, `loadTags`; ошибка запроса — типизированная, не парсится строкой |
| T3.3 | Компоненты выборки | worker A | `frontend/src/components/{QueryBar,SavedViews,TagTree}.tsx` | **DONE** | строка запроса со счётчиком и предупреждением `partial`, сохранённые представления, дерево тегов |
| T3.4 | Интеграция в оболочку | worker A | `frontend/src/components/Sidebar.tsx` | **DONE** | выборки живут в сайдбаре рядом с деревом |
| T3.5 | Представления без иконок в ядре | worker A | `frontend/src/core/views/types.ts` | **DONE** | ядро не знает про `ui/icons` (иначе ломается граница R1/R9) |

## Волна 4 — плагины

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T4.1 | Контракт 1.2.0 | worker B | `frontend/src/plugins/contract.ts` | **DONE** | `PLUGIN_API_VERSION = '1.2.0'`, новое право `query.read`, `ctx.api.query()` и `ctx.api.tags()`; изменение аддитивное — `minApiVersion` старых плагинов остаётся `1.0.0` |
| T4.2 | Возможность запроса для плагинов | worker B + root | `frontend/src/core/api/pluginQuery.ts`, `core/api/pluginApi.ts` | **DONE** | в открытом режиме — HTTP, в запечатанном — локальная оценка над расшифрованными заметками; право проверяется в `restrictPluginApi` (без права — `PluginPermissionError`) |
| T4.3 | Встроенные плагины | worker B | `frontend/src/plugins/builtin/{graph,tags,activity,links}/index.ts` | **DONE** | граф связей, дерево тегов, календарь активности, карточки ссылок; зарегистрированы в `plugins/loader.ts` |
| T4.4 | Новые границы R13–R16 | worker B | `frontend/scripts/check-boundaries.mjs`, `docs/PLUGIN_DEVELOPMENT.md` | **DONE** | 4 новых правила, каждое — с тестом (`src/__tests__/plugin-q.test.ts`) и строкой в документации |
| T4.5 | Документация плагинов | worker B + root | `docs/PLUGIN_API.md`, `PLUGIN_SECURITY.md` | **DONE** | API 1.2.0, право `query.read`, что видно через запрос и чего не видно |

## Волна 5 — приёмка

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| T5.1 | Go build / vet / test / test -race | **DONE** | exit 0, все пакеты ok (включая `-race`) |
| T5.2 | `tsc --noEmit`, vitest, `check:boundaries` | **DONE** | exit 0; 48 файлов / 589 тестов passed; границы: 166 файлов, нарушений нет |
| T5.3 | Сборка фронтенда и замер бандла | **DONE** | entry 43,41 kB gzip (лимит 46 kB); панели плагинов вынесены в отдельный чанк |
| T5.4 | E2E Playwright | **DONE** | 106 passed / 32 skipped / 0 failed |
| T5.5 | `scripts/restore-smoke.ps1` | **DONE** | backup → restore → smoke, exit 0 (скрипт теперь поднимает настоящий сервер, чтобы в архиве была настоящая база) |
| T5.6 | Коммиты по волнам | **DONE** | коммиты `phase8: …` |

## Что осталось за рамками фазы 8 (TODO на будущее)

| ID | Задача | Статус | Примечание |
|---|---|---|---|
| F8.1 | Подсветка совпадений запроса в редакторе, автодополнение тегов, drop файла, сброс черновика | **DONE** | сделано в пакете от 2026-10-25: `frontend/src/lib/editor/{matchRanges,tags}.ts`, drop файла и сброс черновика — в `frontend/src/components/Editor.tsx` и `frontend/src/lib/drafts.ts` (`resetDraft`) |
| F8.2 | Режим фокуса, отмена удаления, карточка заметки | **DONE** | `frontend/src/core/editor/{focusMode,undoDelete}.ts` (тост живёт 5000 мс), `frontend/src/components/NoteCard.tsx` |
| F8.3 | Синхронизация фильтра с URL | **DONE** | `frontend/src/lib/editor/filterUrl.ts` |
| F8.4 | Регулярные выражения в языке | **DONE** | оператор `matches` и префикс `match:`; RE2 в бэкенде (`backend/internal/query/regex.go`), `RegExp` в браузере (`frontend/src/core/query/regex.ts`), векторы — `shared/vectors/regex.json`. Разница RE2 и JavaScript остаётся и записана в `docs/NOT_IMPLEMENTED.md` (B1) |

## Журнал проверок

| Дата | Проверка | Результат |
|---|---|---|
| 2026-10-24 | `go build ./...`, `go vet ./...` | exit 0 |
| 2026-10-24 | `go test ./... -count=1` | все пакеты ok (включая паритет SQL ↔ предикат) |
| 2026-10-24 | `go test ./... -race -count=1` | exit 0 |
| 2026-10-24 | `npx tsc --noEmit` | exit 0 |
| 2026-10-24 | `npx vitest run` | 48 файлов / 589 тестов passed |
| 2026-10-24 | `node scripts/check-boundaries.mjs` | OK: 166 файлов, нарушений нет |
| 2026-10-24 | `npm run build` + `npm run measure` | entry 43,41 kB gzip |
| 2026-10-24 | `npx playwright test` | 106 passed / 32 skipped / 0 failed |
| 2026-10-24 | `scripts/restore-smoke.ps1` | exit 0 |
