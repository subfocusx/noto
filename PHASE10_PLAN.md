# Noto Phase 10 — рабочий чек-лист (живой файл)

> Этот файл — единственный источник статуса Phase 10. Владелец: **root**. После завершения каждой задачи root немедленно обновляет строку статуса (`DONE` / `PARTIAL` / `BLOCKED`) с указанием файлов и реального результата проверок.
> Источник истины по API — `docs/CONTRACT.md`. Правила вёрстки — `docs/DESIGN_SYSTEM.md`.

## Задача фазы

Фаза 10 отвечает на жалобу пользователя по скриншотам:

1. «сайтбары и линии не сходятся, всё наезжает» — верхние края колонок стояли на
   разной высоте (шапка хранилища 40 px, полоса вкладок 32 px, шапка outline 36 px),
   а фоны шапок были разного тона, поэтому вертикальные разделители начинались и
   заканчивались на разных `y`;
2. «вынесем всё на левую сторону, панель сделаем и вынесем их туда» — узкая рельса
   разделов **E / S / F / H / T** слева; иконка переключает содержимое соседней
   колонки, открыт ровно один раздел;
3. «мы один сайдбар фиксируем… кнопку, где его скрываем, убираем» — левая
   колонка всегда видна и ресайзится, сворачивания больше нет;
4. четыре бага с картинок: папка, названная «New folder», кнопки импорта за рамкой,
   «висящее» поле тега, дублирующее меню в строке дерева.

Решения пользователя: рельса — **аккордеон**; объём — **всё** (рельса + рамка + 4 бага);
левая колонка — **фиксированная и видимая**.

## Baseline (перед изменениями)

| Проверка | Результат |
|---|---|
| `go build ./...`, `go vet ./...`, `go test ./... -count=1` | exit 0 |
| `go test ./... -race -count=1` | exit 0 |
| `go run ./cmd/smoke` | PASS 43 / FAIL 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm test` (frontend) | 50 файлов / 604 теста passed |
| `npm run check:boundaries` | OK: 169 файлов, нарушений нет (R1–R16) |
| `npm run measure` | entry 45,39 kB gzip (бюджет 46 kB) |
| `npx playwright test` | 116 passed / 42 skipped / 0 failed |

**Замер геометрии до изменений** (viewport 1280×720):

```
.sidebar-wrap   x=0    w=280  border-right 1px
.workspace      x=280  w=760  bg --bg-surface, бордеров нет
.tab-strip      h=32   bg --bg-inset,  border-bottom
.breadcrumb-strip h=30 border-bottom
.panel-wrap     x=1040 w=240  border-left 1px
.outline-header h=36
.vault-header   h=40
.app-footer     h=24   border-top
```

---

## Волна 1 — рельса разделов и колонка

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| W1.1 | Токен `--rail-width: 44px`, новый файл стилей `rail.css` | **DONE** | `frontend/src/styles/rail.css` (новый), `tokens.css`, `main.tsx` — подключён после `layout.css` |
| W1.2 | Компонент `Rail.tsx` | **DONE** | пять разделов из общего списка `RAIL_SECTIONS` (ядро), у активного `aria-current="page"`, внизу тема и настройки |
| W1.3 | Состояние раздела в сторе | **DONE** | `RailSection` в `core/store/types.ts`, `ui.railSection` в `state.ts`, действие `setRailSection` в `actions.ts`, поле `Prefs.railSection` в `prefs.ts` (нормализуется) |
| W1.4 | Панели разделов | **DONE** | `components/sections/{Explorer,Search,Filters,History,Trash}Section.tsx`; четыре из них грузятся лениво через `components/LazySections.tsx` |
| W1.5 | `Sidebar.tsx` → колонка разделов | **DONE** | принимает `section`, рисует активную панель; `nav-list` (All notes / Trash), блок фильтра и список недавних ушли в разделы |
| W1.6 | Горячие клавиши разделов | **DONE** | `Ctrl+Alt+E/S/F/H` — разделы, `Ctrl+Alt+D` — корзина (см. отклонение ниже), `Ctrl+Alt+T` остался за темой |

## Волна 2 — одна линия рамки

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| W2.1 | Общая высота шапок | **DONE** | `--header-height: 40px`; `.column-header`, `.vault-header`, `.tab-strip`, `.outline-header` — все 40 px, фон `--bg-sidebar`, нижняя граница 1 px |
| W2.2 | Непрерывные вертикальные разделители | **DONE** | `.rail` (border-right), `.sidebar-wrap` (border-right), `.panel-wrap` (border-left) — 1 px, от верхней до нижней линии |
| W2.3 | Нижняя линия | **DONE** | `.app-footer` — `border-top` 1 px, единая по всей ширине |
| W2.4 | Фоны | **DONE** | полоса вкладок и крошки перешли с `--bg-inset`/`--bg-surface` на `--bg-sidebar`; `--bg-surface` остался только за рабочей областью |
| W2.5 | Крошки и полоса тегов — свои строки | **DONE** | обе `flex: none`, своя высота, разделитель 1 px |
| W2.6 | Границы ширины колонки | **DONE** | `tokens.css` приведён к `prefs.ts`: 200…480 (было 180…420 в токенах и в `Sidebar.tsx`) |

**Замер после изменений** (viewport 1280×720, те же точки):

```
.rail          x=0    w=44   border-right 1px
.sidebar-wrap  x=44   w=280  border-right 1px
.column-header x=44   y=0 h=40  border-bottom 1px
.tab-strip     x=324  y=0 h=40  border-bottom 1px
.outline-header x=1041 y=0 h=40 border-bottom 1px
.panel-wrap    x=1040 w=240  border-left 1px
.app-footer    y=696  h=24   border-top 1px
```

Все четыре шапки стоят на `y=0`, имеют высоту 40 px и одну нижнюю границу — линия
под шапками одна.

## Волна 3 — четыре бага

| ID | Баг | Статус | Результат / примечание |
|---|---|---|---|
| W3.1 | В крошках реальное имя «New folder» | **DONE** | диалог создания открывается с **пустым** значением и плейсхолдером («Folder name» / «Note name»); `confirmDialog` отказывает с пустым именем и не закрывает диалог (`core/store/actions.ts`), предупреждение появляется только после ввода |
| W3.2 | Кнопки импорта за рамкой | **DONE** | нативный file-input скрыт за своими элементами (`.file-picker`), общее правило `.field input` больше не применяется к `input[type='file']` |
| W3.3 | Поле тега «висит» над редактором | **DONE** | `.note-tags-strip` — `flex: none`, фон `--bg-sidebar`, своя граница, своя высота |
| W3.4 | Дублирующее меню в строке дерева | **DONE** | у строки осталась одна кнопка «три точки» (`more-horizontal`); все действия живут в `TreeContextMenu` |

## Волна 4 — левая колонка всегда видна

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| W4.1 | `sidebarCollapsed` из стора и настроек | **DONE** | поле, действие `setSidebarCollapsed`, команда `toggleSidebar` и класс `sidebar-collapsed` удалены |
| W4.2 | Кнопка «Toggle notes panel» | **DONE** | убрана из `AppFooter` (вместе с пропсами `onToggleSidebar` / `sidebarVisible`) |
| W4.3 | Переключатель «Collapse the sidebar» | **DONE** | убран из `SettingsDialog` |
| W4.4 | Команда `toggleSidebar` и `Ctrl+Alt+B` | **DONE** | удалены из палитры команд и из горячих клавиш; `Ctrl+Alt+B` освободился |
| W4.5 | Тест настроек | **DONE** | `prefs.test.ts` проверяет `railSection` вместо `sidebarCollapsed` |
| W4.6 | `Sidebar` без сворачивания | **DONE** | пропсы `collapsed` / `onToggleCollapse` удалены |

## Волна 5 — проверки

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| W5.1–W5.2 | Юнит-тесты рельсы | **DONE** | `frontend/src/__tests__/rail.test.tsx` |
| W5.3 | Регрессия «New folder» | **DONE** | `frontend/src/__tests__/createDialog.test.tsx` |
| W5.4 | Регрессия «три точки» | **DONE** | `frontend/src/__tests__/tree.test.tsx` (переписан), `frontend/src/__tests__/tree-actions.test.tsx` |
| W5.5 | Регрессия импорта | **DONE** | `frontend/src/__tests__/transferPanel.test.tsx` |
| W5.6 | Подвал без переключателя колонки | **DONE** | `frontend/src/__tests__/footer.test.tsx` |
| W5.7 | E2E рельсы | **DONE** | `e2e/specs/rail.spec.ts` (5 проверок) |
| W5.8 | Переписаны спеки, снявшие сворачивание | **DONE** | `e2e/specs/a11y.spec.ts`, `shell.spec.ts`, `shell-actions.spec.ts`, хелперы `e2e/helpers/{app,plugins}.ts` |
| W5.9 | Узкий экран | **DONE** | `e2e/specs/responsive.spec.ts`: рельса остаётся видимой, колонка уезжает в drawer |

## Волна 6 — документация и коммиты

| ID | Задача | Статус | Результат / примечание |
|---|---|---|---|
| W6.1 | `docs/DESIGN_SYSTEM.md` | **DONE** | §1 (стили), §4 (иконка `settings`), новый §7 «Рельса разделов и одна линия рамки» |
| W6.2 | Живой план фазы | **DONE** | этот файл |
| W6.3 | Статус реализации | **DONE** | `IMPLEMENTATION_STATUS.md`: карточки `P10-1…P10-9` + журнал фазы |
| W6.4 | Коммиты | **DONE** | пять волн, сообщения в стиле `phase10: …` |

### Отклонения от исходного плана

| Отклонение | Почему |
|---|---|
| Волны 1 и 4 объединены в один коммит | правки пересекаются в одних и тех же файлах (`App.tsx`, `Sidebar.tsx`, `core/store/**`, `core/settings/prefs.ts`): рельса и «колонка всегда на месте» — одно и то же изменение оболочки |
| Корзина получила `Ctrl+Alt+D`, а не `Ctrl+Alt+T` | `Ctrl+Alt+T` — тема с первого выпуска; контракт горячих клавиш не ломаем, поэтому буква корзины отличается от буквы в рельсе (это отражено в подсказке кнопки) |
| Список горячих клавиш переведён на английский | оболочка английская, а подсказки оставались единственным русским местом в ней; файл `core/commands/shortcuts.ts` — единственный источник подсказок |
| Полоса вкладок отдала свою высоту стилям | `EditorTabs.tsx` задавал высоту инлайновым стилем (32 px) и правил токен; теперь высоту задаёт `--tab-height` |
| История версий — вне объёма | API версий нет (`docs/CONTRACT.md` знает только `revision` в `PUT /api/notes`); раздел `H` показывает недавние заметки и честно говорит, что версий пока нет |

### Что осталось за фазой

* история версий заметок (нужен эндпоинт в API — отдельная фаза);
* переработка правой панели (outline) — она осталась как была;
* раздел `H` в полном виде (версии) и подсветка совпадений в поиске.
