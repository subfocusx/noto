# Noto Phase 2 — рабочий чек-лист (живой файл)

> Этот файл — единственный источник статуса Phase 2. Владелец: **root**. После завершения каждой задачи root немедленно обновляет строку статуса (`DONE` / `PARTIAL` / `BLOCKED`) с указанием файлов и реального результата проверок.
> Источник истины по API — `docs/CONTRACT.md`. План фазы — `PHASE2_PLAN.md` (этот файл) и утверждённый план фазы 2.

## Соглашения

- Одновременно работают **не более 4 субагентов**; каждый владеет **непересекающимся** набором файлов.
- `App.tsx` — файл интеграции: его правит **только root** (после передачи контекста от исполнителя).
- Субагент, которому нужен чужой файл, **сообщает root**, а не правит его сам.
- Каждый исполнитель приводит в отчёте **реальный вывод** команд проверки.
- Статусы: `TODO` · `WIP` · `DONE` · `PARTIAL` · `BLOCKED` (с причиной).

## Baseline (зафиксирован до изменений)

| Проверка | Команда | Результат |
|---|---|---|
| Go build | `go build ./...` (backend) | exit 0 |
| Go vet | `go vet ./...` | exit 0 |
| Go tests | `go test ./... -count=1` | все пакеты ok |
| HTTP smoke | `go run ./cmd/smoke` | **PASS 43 / FAIL 0** |
| Frontend tests | `npm test` (frontend) | **8 файлов / 51 тест passed** |
| VCS | `git init` + коммит `phase1 baseline` | `5c3523b` |

Ограничения окружения: Go только в `.tools\goroot`; Docker не установлен; `playwright install` недоступен (CDN 403) → E2E на локальном кэше Chromium (`channel: 'chromium'`); `-race` требует cgo (gcc в `C:\msys64\mingw64\bin`); удаление в `C:\Windows` запрещено (PoC-файлы `evil.md`, `small.md`, `pwned_dir` остаются на ручное удаление).

---

## Волна 0 — фундамент

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T0.1 | `git init`, базовый коммит, живой чек-лист, baseline-прогоны | root | `.git/`, `PHASE2_PLAN.md` | **DONE** | коммит `5c3523b`; build/vet/test ok; smoke 43/0; vitest 51/51 |
| T0.2 | Golden-контракт бэкенда + conformance `port.Store` + тест совместимости схемы | worker A | `backend/internal/api/contract_test.go`, `backend/internal/port/store_conformance_test.go`, `backend/internal/sqlitestore/schema_compat_test.go` | **DONE** | + новый пакет `backend/internal/port/porttest/` (переиспользуемая сюита, 13 кейсов); 44 сабтеста контракта (22 маршрута, 6 типов JSON, 11 кодов ошибок, security-заголовки, порядок middleware); schema compat: user_version=1 переживает reopen, 999 отвергается; `go vet` + `go test -race` — exit 0; 4 известных расхождения MemStore vs sqlitestore зафиксированы как «known divergence, tracked» |
| T0.3 | `docs/ARCHITECTURE_AUDIT.md` + `docs/ARCHITECTURE.md` | worker B | `docs/ARCHITECTURE_AUDIT.md`, `docs/ARCHITECTURE.md` | **DONE** | ARCHITECTURE.md 713 строк / 13 разделов (карта слоёв, потоки данных, конкурентность, точки расширения, что можно/нельзя менять); ARCHITECTURE_AUDIT.md 709 строк / 12 разделов (18 сильных сторон, 12 проблем связности с file:line, oversized-файлы, security-границы, 9 разделов с измерениями, пробелы в тестах, план P0/P1/P2). Найдена реальная проблема: `GET /api/tree` на 2000 заметок ≈418 мс из-за N+1 `GetNote` на узел (`notes/service.go:216`) → кандидат фазы 3 |
| T0.4 | Скрипт архитектурных границ фронтенда + npm-скрипты `typecheck`/`measure` | worker C | `frontend/scripts/check-boundaries.mjs`, `frontend/package.json` | **DONE** | 8 правил R1–R8; `check:boundaries` → OK: 26 файлов, нарушений нет; `npm run typecheck` exit 0; npm-скрипты `typecheck`/`measure`/`check:boundaries` добавлены |

## Волна 1 — модуляризация

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T1.1 | Разбиение крупных файлов бэкенда по пакетам, удаление мёртвого `internal/deps`, `go mod tidy` | worker D | `backend/internal/notes/*`, `backend/internal/sqlitestore/*`, `backend/internal/api/*`, `backend/cmd/smoke/*`, `backend/internal/deps/` | **DONE** | notes: service+locks+fsatomic, notes+notes_move, import_files/import_zip/export; sqlitestore: store+store_schema/notes/index/attachments/trash; api: handlers_* по доменам; cmd/smoke: 8 файлов; `internal/deps` удалён; `go.mod` без изменений; build/vet ok, `go test -race` ok, smoke **PASS 43 / FAIL 0** |
| T1.2 | `core/store/appStore.ts`, `App.tsx` → композитор, разбиение `api/*` и `lib/utils.ts` | worker E | `frontend/src/App.tsx`, `frontend/src/core/store/**`, `frontend/src/api/**`, `frontend/src/lib/**`, `frontend/src/components/*` | **DONE** | `App.tsx` 679 → **203 LOC**, 0 useState/useRef; стор: types/state/actions/appStore/hooks (24 действия, `useSyncExternalStore`); `api/` → 9 модулей, `client.ts` — фасад-реэкспорт (23 имени, `vi.mock` в тестах работает); `lib/utils.ts` → debounce/format/ordering/errors + шим; +3 компонента (AppHeader/AppFooter/NoteDialogs); тесты 51 → **56**; typecheck/boundaries(48 файлов)/build — exit 0 |
| T1.3 | `sw.js`: приватные API-ответы не кэшируем; фикс комментария build-id; `manualChunks` + расширенный замер бандла | worker F | `frontend/public/sw.js`, `frontend/vite.config.ts`, `frontend/scripts/measure-bundle.mjs` | **DONE** | SW: `/api/*` → networkOnly (офлайн → 503 + конверт `network_error`), мутации чистят кэш, legacy `-api`-кэши удаляются; бандл: entry 652,02 kB → **36,52 kB** (gzip 225,53 → 11,96 kB) при неизменных суммарных байтах (ре-партиционирование, не экономия); E2E 16 passed / 10 skipped; проверено: 0 `/api/*` в кэшах, офлайн → 503, а не устаревшее тело |

## Волна 2 — плагин-платформа

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T2.1 | Контракт и ядро платформы: `contract.ts`, `manifest.ts`, `registry.ts`, `host.ts`, `loader.ts`, `core/{events,commands,settings,diagnostics,api}` | worker G | `frontend/src/plugins/{contract,manifest,registry,host,loader}.ts`, `frontend/src/core/{events,commands,settings,diagnostics,api}/**` | **DONE** | Контракт v1.0.0 (8 permissions, 9 событий, 6 UI-точек, `PluginEditor` без `setText`); `validateManifest`/`isCompatible`; `PluginRegistry` (дубликаты → отказ, несовместимость → `incompatible`); `PluginHost` (activate/deactivate/disposeAll, ошибка плагина → `failed`, наружу не пробрасывается); `EventBus` (синхронно, try/catch, защита от рекурсии); `CommandRegistry`; `SettingsStore` (БД `noto-plugins`, namespace по pluginId, миграции, dynamic `idb`); `createLogger`; `createPluginApi`; 30 тестов; 106 total; `idb` больше не preload-ится |
| T2.2 | Бэкенд-точка расширения: `notes/noteapi.go` (`NoteService`, `NoteEvent`, `Hook`, `AddHook`) + тесты | worker H | `backend/internal/notes/noteapi.go`, `backend/internal/notes/noteapi_test.go`, точечные правки `notes/{service,notes,trash}.go` | **DONE** | `NoteService` (Read/Write одной заметки) + `AddHook`; 6 Op (created/updated/deleted/renamed/moved/restored); хук срабатывает ПОСЛЕ «диск→индекс→метаданные» и ПОСЛЕ снятия блокировок, синхронно, с recover; ошибка → хук не вызывается; 8 тестов; build/vet ok, `go test -race` ok, smoke PASS 43/FAIL 0 |
| T2.3 | UI-точки вклада + расширенный `PluginEditor` + `Compartment` + error-boundary | worker I | `frontend/src/components/{Editor,PluginManagerPanel,PluginSlots}.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/__tests__/plugin-ui.test.tsx` | **DONE** | `EditorHandle` +6 методов (`getSelection/getCursor/insertAt/replaceSelection/onChange/onSelectionChange/setExtensions`) + `Compartment` для расширений плагинов, документ/история сохраняются; `PluginSlots.tsx` (Sidebar/Panel/Toolbar/ContextMenu/Command + `PluginErrorBoundary`); `PluginManagerPanel.tsx` (статусы, enable/disable, ошибки, сброс настроек, предупреждение о доверии); host подключён в App.tsx, события эмитятся ПОСЛЕ ответа сервера; 15 новых тестов; 106 total |
| T1.4 | Ленивая загрузка `marked`/`dompurify` (превью) и `idb` (черновики) | worker L | `frontend/src/lib/{markdownLoader.ts,drafts.ts}`, `frontend/src/components/Preview.tsx`, `frontend/src/__tests__/preview-lazy.test.tsx` | **DONE** | новый `markdownLoader.ts` (dynamic import + кэш промиса + сброс при ошибке); Preview до загрузки рендерит **текст** (без `innerHTML`), после — санитизированный HTML, при ошибке «Предпросмотр недоступен»; `idb` в drafts — dynamic; тесты 56 → **106**; эффект: 66 kB / 22,8 kB gzip перестали грузиться на старте (нет `modulepreload` на markdown-чанк), суммарный размер почти не изменился (отмечено честно) |
| T2.4 | Устранение расхождений `MemStore` vs `sqlitestore` (conformance = 0 расхождений) | worker G | `backend/internal/testutil/{store.go,search.go}`, `backend/internal/port/porttest/porttest.go`, `backend/internal/port/store_conformance_test.go` | **DONE** | `MoveNote` переносит поддерево + строки индекса; `Search` ищет по имени И содержимому (имя раньше, дедуп, limit на общем списке); пустой запрос → 0 совпадений; `KnownDivergences` пуст, 4 маркера сняты, сюита требует 0 расхождений; `go test -race` ok, smoke PASS 43/FAIL 0 |

## Волна 3 — продукты платформы

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T3.1 | Пример-плагин Word Count + тесты | worker J | `frontend/src/plugins/builtin/word-count/**`, `frontend/src/__tests__/plugin-word-count.test.tsx` | TODO | |
| T3.2 | Пример-плагин Insert Template + тесты | worker K | `frontend/src/plugins/builtin/insert-template/**`, `frontend/src/__tests__/plugin-insert-template.test.tsx` | TODO | |
| T3.3 | Экран управления плагинами + тесты | worker L | `frontend/src/components/PluginManagerPanel.tsx`, `frontend/src/__tests__/plugin-manager.test.tsx` | TODO | |

## Волна 4 — тесты, E2E, документация

| ID | Задача | Владелец | Файлы | Статус | Результат / примечание |
|---|---|---|---|---|---|
| T4.1 | Тесты плагин-API (манифест, дубликаты, версии, enable/disable, cleanup, сбой, подписчик, настройки, команды) | worker M | `frontend/src/__tests__/plugin-*.test.ts(x)` | TODO | |
| T4.2 | E2E: включить плагин → вклад → выключить → cleanup → заметки целы → reload → устойчивость к падению | worker N | `e2e/specs/plugins.spec.ts` | TODO | |
| T4.3 | `PLUGIN_API.md`, `PLUGIN_SECURITY.md`, `PLUGIN_DEVELOPMENT.md` + синхронизация `CONTRACT.md`/`SECURITY.md`/`README.md`/`IMPLEMENTATION_STATUS.md` | worker O | `docs/PLUGIN_*.md`, `docs/CONTRACT.md`, `docs/SECURITY.md`, `README.md`, `IMPLEMENTATION_STATUS.md` | TODO | |
| T4.4 | Финальная верификация, сверка DoD §19 (18 пунктов), финальный отчёт | root | `PHASE2_PLAN.md` | TODO | |

## Фаза 3 — новые задачи (после зелёного DoD фазы 2)

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| 3.1 | Discovery кандидатов (4 направления, до 4 read-only субагентов) | TODO | |
| 3.2 | Отбор 4–8 задач root'ом, карточки в этом файле | TODO | |
| 3.3 | Реализация волнами (≤4 субагента, непересекающиеся файлы) | TODO | |
| 3.4 | Полный прогон + обновление docs + честный отчёт | TODO | |

---

## Журнал проверок (по мере выполнения)

| Дата/время | Что прогонялось | Результат |
|---|---|---|
| baseline | go build/vet/test, smoke, vitest | build ok · vet ok · tests ok · smoke PASS 43/FAIL 0 · vitest 51/51 |
