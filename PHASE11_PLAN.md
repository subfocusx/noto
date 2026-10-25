# Noto Phase 11 — рабочий чек-лист (живой файл)

## Задача фазы

Семь пунктов из жалобы пользователя (скриншоты от 2026-10-24, 21:45) плюс модуль
календаря и модель уведомлений. Стек, контракты API, схема SQLite и контракт
плагинов (1.2.0) не меняются.

## Диагноз (что показали скриншоты и код)

| № | Жалоба | Причина | Где чинить |
|---|---|---|---|
| 1 | «Каракули», появляются, когда заметка вложена в папку | Кадр 40×266 — это **рельса**: под иконками нарисованы буквы `E/S/F/H/T` (скриншот увеличен в 8 разNearestNeighbor — видно глифы). Никакого «мусора» в редакторе нет; проблема в подписях рельсы | `components/Rail.tsx`, `styles/rail.css` |
| 2 | Нет возможности создавать папки внутри папок | Бэкенд умеет (`POST /api/folders` с `parentPath`), меню строки умеет («New folder»), но **правый клик по строке не перехвачен** — меню доступно только через кнопку «⋯» | `components/TreeRow.tsx`, `components/TreeContextMenu.tsx` |
| 3 | Убрать буквы под иконками | То же, что п. 1 | `components/Rail.tsx`, `styles/rail.css` |
| 4 | Палитра команд — полноэкранный список вместо окна | **Правил `.noto-palette*` нет ни в одном css-файле** — они были в `components.css` фазы 4 и потерялись при реорганизации стилей | новый `styles/palette.css` |
| 5 | «1 note matches» не пропадает | Счётчик и кнопка очистки дублируются в разделе Search, где запроса нет; текст обрезается кнопкой «×» | `components/sections/SearchSection.tsx`, `components/FilterPanel.tsx` |
| 6 | Иконки расставлены нелогично | Порядок и набор иконок не взяты из референсов (Obsidian — рельса без букв, Mem — строка видов) | `core/commands/appCommands.ts`, `components/Rail.tsx`, `ui/icons.tsx` |
| 7 | Нужен модуль календаря и модель уведомлений | Не существует вовсе | новые `core/calendar/`, `core/notifications/`, разделы `CalendarSection`, `NotificationsSection` |

### Референсы (проверены)

* **Obsidian** (`usememos`-скриншот пользователя): узкая вертикальная рельса слева,
  только иконки, без букв; иконки сгруппированы, внизу отдельная группа.
  Подписи живут в тултипе, не под иконкой.
* **Mem** (репозиторий `usememos/memos`, `web/src/components/AppSidebar/`):
  `sidebar-layout.ts` — «The sidebar is drawn on one shared rail», компактная
  навигация — квадрат 28 px, строка резервирует 20 px под иконку; виды
  (Timeline / Calendar / Memos / Search) собраны в одну группу, теги — в другую.
* Вывод: рельса Noto остаётся рельсой (как в Obsidian), но **без букв**, с
  **явными группами** и с **семантичными иконками** (как в Mem).

## Решения фазы

1. **Рельса без букв.** Подпись раздела живёт в `aria-label` и в `title`.
   Поле `letter` исчезает из `RAIL_SECTIONS`.
2. **Порядок и иконки разделов** (одна логика — «что я пишу» → «что случилось»):

   | Группа | Раздел | Иконка | Ярлык |
   |---|---|---|---|
   | Заметки | Explorer | `folder` | Ctrl+Alt+E |
   | | Calendar | `calendar` | Ctrl+Alt+C |
   | | Search | `search` | Ctrl+Alt+S |
   | | Filters | `filter` | Ctrl+Alt+F |
   | Жизнь хранилища | History | `clock` | Ctrl+Alt+H |
   | | Notifications | `bell` | Ctrl+Alt+B |
   | | Trash | `trash` | Ctrl+Alt+D |

   Между группами — тонкий разделитель, как в Obsidian.
3. **Палитра — модальное окно.** Стили возвращаются в отдельный
   `styles/palette.css`; заголовок и описание команды встают в две строки.
4. **Счётчик фильтра живёт только в Filters.** Раздел Search показывает поиск по
   тексту и сохранённые фильтры; число совпадений и кнопка очистки — только там,
   где живёт сам запрос.
5. **Папка в папке** — правый клик по строке открывает то же меню, что и «⋯».
   Меню папки показывает «New folder» (создаёт внутри) и «New note».
6. **Календарь** — новый раздел рельсы. Данные берутся из дерева: у каждой
   заметки есть `createdAt` и `updatedAt`. Месяц рисуется как в Mem (шапка с
   ‹ ›, ряд дней недели, сетка). День с заметками помечен; выбранный день
   показывает список заметок; кнопка создаёт заметку дня `YYYY-MM-DD.md`
   (та же команда, что «Daily note»).
7. **Уведомления** — типизированная модель в `core/notifications/` и раздел
   рельсы со списком. Источники: ошибка сохранения, конфликт версии, ошибка
   запроса, миграция хранилища. Непрочитанные помечаются счётчиком на иконке.
   Хранение — в памяти сессии (лимит 50 записей).

## Baseline (перед изменениями)

| Проверка | Результат |
|---|---|
| `go build ./...`, `go vet ./...`, `go test ./... -count=1` | exit 0 |
| `go test ./... -race -count=1` | exit 0 |
| `go run ./cmd/smoke` | PASS 43 / FAIL 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm test` (frontend) | 53 файла / 626 тестов passed |
| `npm run check:boundaries` | OK: 180 файлов, нарушений нет (R1–R16) |
| `npm run measure` | entry 43,68 kB gzip (бюджет 46 kB) |
| `npx playwright test` | 128 passed / 42 skipped / 0 failed |

## Волна 1 — оболочка (четыре агента, файлы не пересекаются)

| ID | Задача | Владелец файлов | Статус |
|---|---|---|---|
| W1.1 | Рельса без букв, группы, иконки | `components/Rail.tsx`, `styles/rail.css`, `__tests__/rail.test.tsx` | сделано |
| W1.2 | Палитра — модальное окно | `components/CommandPalette.tsx`, `styles/palette.css` (новый) | сделано |
| W1.3 | Счётчик — только в Filters | `components/sections/SearchSection.tsx`, `components/FilterPanel.tsx`, `__tests__/query-ui.test.tsx` | сделано |
| W1.4 | Папка в папке (правый клик) | `components/TreeRow.tsx`, `components/TreeContextMenu.tsx`, `__tests__/tree.test.tsx` | сделано |

## Волна 2 — новые модули

| ID | Задача | Владелец файлов | Статус |
|---|---|---|---|
| W2.1 | Модуль календаря | `core/calendar/**`, `components/sections/CalendarSection.tsx`, `styles/calendar.css` (новый), `__tests__/calendar.test.ts` | сделано |
| W2.2 | Модель уведомлений | `core/notifications/**`, `components/sections/NotificationsSection.tsx`, `styles/notifications.css` (новый), `__tests__/notifications.test.tsx` | сделано |

## Волна 3 — ядро (root)

| ID | Задача | Статус |
|---|---|---|
| W3.1 | `RailSection`: + `calendar`, + `notifications`; `RAIL_SECTIONS` без `letter`, новые иконки, группы | сделано |
| W3.2 | Стор: `ui.notifications`, `ui.calendarMonth`, `ui.calendarDay`, действия уведомлений | сделано |
| W3.3 | `App.tsx`: разделы календаря и уведомлений, источники уведомлений (ошибка сохранения, конфликт), колбэк «Open the filters» | сделано |
| W3.4 | `Sidebar.tsx`: рендер новых разделов; `LazySections.tsx`: ленивая загрузка | сделано |
| W3.5 | `ui/icons.tsx`: + `calendar`, `bell`, `filter` (`Funnel` в lucide); `__tests__/icons.test.tsx` | сделано |
| W3.6 | `core/commands/shortcuts.ts`: `Ctrl+Alt+C` (календарь), `Ctrl+Alt+B` (уведомления) | сделано |

## Волна 4 — проверки и документация

| ID | Задача | Статус |
|---|---|---|
| W4.1 | Юнит-тесты (рельса, палитра, календарь, уведомления, дерево, счётчик) | сделано |
| W4.2 | E2E: рельса, палитра-модалка, календарь, уведомления, папка в папке | сделано |
| W4.3 | `scripts\verify.ps1 -Skip e2e`, затем Playwright | сделано |
| W4.4 | `docs/DESIGN_SYSTEM.md` (§1, §4, §6.4, §6.5), `IMPLEMENTATION_STATUS.md`, `README.md` | сделано |

## Отклонения и риски

* Бэкенд, схема SQLite и контракт API не меняются: календарь считает дни по
  метаданным дерева (`createdAt`/`updatedAt`), уведомления — клиентские.
* Уведомления живут в памяти сессии: сохранение в `localStorage` — за пределами
  фазы (записано в `IMPLEMENTATION_STATUS.md` как известное ограничение).
* Бюджет entry-чанка — 46 kB gzip; базовый размер 43,68 kB. Новые разделы
  грузятся лениво (`LazySections.tsx`), чтобы не выйти из бюджета.
