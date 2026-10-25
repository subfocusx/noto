# THIRD_PARTY — сторонние лицензии и атрибуции

Noto — самостоятельное приложение. Этот файл перечисляет всё, что пришло
извне: **идеи**, которые были прочитаны и позаимствованы, и **зависимости**,
которые исполняются в составе приложения.

Правило: любая новая зависимость или новая заимствованная идея добавляется
в этот файл **в том же изменении**, что и код (см. `AGENTS.md` §8).

---

## 1. Источники идей

### usememos/memos

* **Лицензия:** MIT
* **Авторские права:** Copyright (c) 2022 usememos
* **Адрес:** https://github.com/usememos/memos
* **Роль:** **источник идей** (не зависимость и не код).

Что было позаимствовано **по смыслу**:

| Идея | Где в Noto |
|---|---|
| Язык фильтров (поля, операторы, `&&` / `\|\|`, относительное время) | [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md), карточка [`design/D1`](design/D1-query-language.md) |
| Вычисляемые (производные) свойства заметки | [`design/D2`](design/D2-derived-note-properties.md) |
| Дерево тегов | волна 4 (интерфейс) |
| Тепловая карта активности | [`design/D6`](design/D6-activity-heatmap.md) |
| Приёмы UX: сохранённые фильтры, компактная левая колонка, работа без аккаунтов | волны 4 и 7 |

**NOT-а-копия.** Фрагменты кода `usememos/memos` **не копировались**.
Реализация собственная по мотивам: грамматика, IR, оба компилятора и
golden-векторы написаны в этом репозитории; в коде нет ни файла, ни
фрагмента, взятого из проекта memos.

### Другие проекты, идеи которых были прочитаны

| Проект | Лицензия | Что позаимствовано | Копирование кода |
|---|---|---|---|
| `Vinzent03/obsidian-git` | MIT | правило «иконка вместо дублированного текста», `aria-label` и подсказка у каждой иконочной кнопки | кода не копировалось |
| `laurent22/joplin` | AGPL-3.0 | только идеи: ровный шаг отступа в дереве | кода не копировалось |
| `siyuan-note/siyuan` | AGPL-3.0 | только идеи: компактная строка состояния | кода не копировалось |
| `github.com` (график вкладов) | MIT | идея тепловой карты активности (день × неделя, пять уровней) | кода не копировалось |

Проекты под AGPL-3.0 использованы **только как источник идей**: ни одна
строка их кода не попала в репозиторий. Код Noto — MIT, как и у memos.

---

## 2. Зависимости фронтенда

Все зависимости — из `frontend/package.json` (или из корневого
`package.json`, для Playwright). Лицензии взяты из поля `license` в
`node_modules/<пакет>/package.json`.

### Прямые зависимости (рантайм)

| Пакет | Версия | Лицензия | Зачем |
|---|---|---|---|
| `preact` | ^10.22.0 | MIT | UI-библиотека |
| `@codemirror/state` | ^6.4.1 | MIT | состояние редактора CodeMirror 6 |
| `@codemirror/view` | ^6.26.3 | MIT | вид редактора CodeMirror 6 |
| `@codemirror/commands` | ^6.6.0 | MIT | команды редактора |
| `@codemirror/search` | ^6.5.6 | MIT | поиск внутри редактора |
| `@codemirror/lang-markdown` | ^6.2.5 | MIT | подсветка Markdown |
| `@codemirror/language-data` | ^6.5.0 | MIT | данные о языках для CodeMirror |
| `marked` | ^12.0.2 | MIT | разбор Markdown в HTML |
| `dompurify` | ^3.1.5 | MPL-2.0 OR Apache-2.0 | санитизация HTML (безопасный рендер) |
| `idb` | ^8.0.0 | ISC | обёртка над IndexedDB (черновики) |
| `lucide-preact` | ^1.61.0 | ISC | набор иконок |
| `hash-wasm` | ^4.12.0 | MIT | хеши (используется криптоядром) |

### Зависимости разработки

| Пакет | Версия | Лицензия | Зачем |
|---|---|---|---|
| `vite` | ^5.3.4 | MIT | сборка |
| `vitest` | ^1.6.0 | MIT | юнит-тесты |
| `typescript` | ^5.5.3 | Apache-2.0 | типы и `tsc --noEmit` |
| `@preact/preset-vite` | ^2.8.2 | MIT | пресет Vite для Preact |
| `jsdom` | ^24.1.0 | MIT | окружение DOM для тестов |
| `fake-indexeddb` | ^6.2.6 | Apache-2.0 | IndexedDB для тестов |
| `@testing-library/preact` | ^3.2.4 | MIT | утилиты тестирования |
| `@types/dompurify` | ^3.0.5 | MIT | типы `dompurify` |
| `@playwright/test` (корень) | ^1.49.0 | Apache-2.0 | сквозные тесты |

---

## 3. Зависимости бэкенда

Из `backend/go.mod`. Лицензии — из файлов `LICENSE` в кэше модулей Go.

| Модуль | Версия | Лицензия | Зачем |
|---|---|---|---|
| `modernc.org/sqlite` | v1.34.5 | MIT | чистый Go-драйвер SQLite (без cgo) |
| `golang.org/x/sys` | v0.22.0 | BSD-3-Clause | системные вызовы (зависимость драйвера) |
| `modernc.org/libc` | v1.55.3 | MIT | трансляция libc для «чистого Go» (косвенная) |
| `modernc.org/mathutil` | v1.6.0 | MIT | косвенная |
| `modernc.org/memory` | v1.8.0 | MIT | косвенная |
| `github.com/ncruces/go-strftime` | v0.1.9 | MIT | косвенная |
| `github.com/dustin/go-humanize` | v1.0.1 | MIT | косвенная |
| `github.com/google/uuid` | v1.6.0 | BSD-3-Clause | косвенная |
| `github.com/mattn/go-isatty` | v0.0.20 | MIT | косвенная |
| `github.com/remyoudompheng/bigfft` | v0.0.0-20230129092748 | MIT | косвенная |

Косвенные зависимости подтягиваются драйвером SQLite; они указаны здесь
для полноты, потому что `go.mod` их перечисляет.

---

## 4. Прочее

* **Шрифты.** `frontend/public/fonts` — Inter и JetBrains Mono, оба под
  лицензией **SIL Open Font License 1.1** (свободная лицензия шрифтов).
* **Иконки PWA** (`frontend/public/icons`) генерируются скриптом
  `frontend/scripts/gen-icons.mjs` — это собственная графика, не сторонняя.
* **Стандарт HTTP, JSON, SQLite, ZIP, Markdown** — спецификации и
  реализации стандартов; в репозитории нет их кода.
* **Сгенерированные файлы.** `backend/internal/web/dist` — это собранный
  фронтенд Noto, а не сторонний код.

---

## 5. Как проверить

```powershell
# Фронтенд: лицензии из package.json в node_modules
cd E:\Code\Software\noto\frontend
node -e "for (const p of ['preact','marked','dompurify','idb','lucide-preact','hash-wasm']) console.log(p, require(p + '/package.json').license)"

# Бэкенд: go.mod и файл LICENSE каждого модуля
cd E:\Code\Software\noto\backend
& "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe" list -m all
```

Если версия зависимости изменилась — обновите таблицу выше в том же
изменении.
