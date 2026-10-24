# Noto — разработка плагина

Пошаговая инструкция: как создать встроенный плагин, как его зарегистрировать,
какие тесты обязательны и как отлаживать.

Связанные документы: [PLUGIN_API.md](PLUGIN_API.md) (контракт),
[PLUGIN_SECURITY.md](PLUGIN_SECURITY.md) (модель доверия и ограничения).

---

## 1. Что нужно знать до начала

* Плагин — это **встроенный** код: он собирается вместе с приложением. Свои
  плагины с диска или из сети Noto не грузит и не поддерживает.
* Плагин исполняется как доверенный код в контексте приложения: песочницы нет
  (см. [PLUGIN_SECURITY.md §1](PLUGIN_SECURITY.md#1-модель-доверия--честно)).
* Единственный модуль, который плагин может импортировать из платформы, —
  `src/plugins/contract.ts`. Всё остальное приложения недоступно.
* Плагин не может заменить документ целиком: в контракте нет `setText`.
  Используйте `insert`, `insertAt`, `replaceSelection` — так работает
  автосохранение.

---

## 2. Шаг 1. Создать каталог плагина

```text
frontend/src/plugins/builtin/<plugin-id>/
└── index.ts
```

Идентификатор каталога и `manifest.id` должны совпадать. Требования к `id`
(`frontend/src/plugins/manifest.ts:27`):

* регулярное выражение `/^[a-z0-9][a-z0-9._-]*$/` — строчные латинские буквы,
  цифры, точка, подчёркивание, дефис;
* длина от 2 до 64 символов.

Рекомендуется держать плагин в одном файле: как показано в примерах
(`word-count/index.ts` — 234 LOC, `insert-template/index.ts` — 154 LOC), весь
плагин помещается в один модуль, и тогда правило границ импортов не требует
думать о внутренних файлах. Если файлов несколько, они должны лежать в том же
каталоге: плагин имеет право импортировать **свои собственные** файлы, но не
файлы другого плагина.

---

## 3. Шаг 2. Написать манифест и плагин

Минимальный шаблон (по образцу `frontend/src/plugins/builtin/insert-template/index.ts`):

```ts
import type { Plugin, PluginContext, PluginManifest } from '../../contract';

/** Static description of the plugin. */
export const myPluginManifest: PluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description: 'Что делает плагин.',
  author: 'Noto',
  permissions: [],
};

/** The plugin. */
export const myPlugin: Plugin = {
  manifest: myPluginManifest,

  activate(ctx: PluginContext): void {
    ctx.logger.info('activated');
  },
};
```

Обязательные требования к коду:

1. `activate(ctx)` не бросает исключений «вверх» — если исключение все же
   произошло, хост поймает его, снимет все регистрации и переведет плагин в
   `failed`, но лучше обрабатывать ошибки внутри плагина (как делает
   `insert-template`: `try/catch` вокруг вставки и `ctx.logger.error(...)`).
   Исключение `PluginPermissionError` — особый случай: плагин остаётся
   `active`, а причина попадает в реестр.
2. **Объявляйте все нужные права.** Права проверяются в рантайме: без
   `ui.contribute` не зарегистрируются панель и команда, без `editor.write` не
   вставится текст, без `settings.write` не запишутся настройки. Отказ —
   `PluginPermissionError` в коде плагина.
3. `ctx.editor` может быть `null` — это нормальная ситуация (заметка не
   открыта в момент обращения). Обрабатывайте её; чтобы узнать о появлении
   редактора, используйте `ctx.onEditor(...)` или событие `editor.available`.
3. Всё, что плагин регистрирует, снимается при деактивации автоматически.
   Дополнительно можно подстраховаться через `ctx.onDeactivate(...)`.
4. Подписки на редактор снимаются: `const off = ctx.editor.onChange(cb)` →
   `off()` в `ctx.onDeactivate(...)`.
5. Не логируйте содержимое заметок — только метаданные и счётчики.
6. Не используйте `eval`, `new Function`, динамический `import()` и
   `import.meta.glob`.

Полный справочник по контексту, событиям, командам и настройкам —
[PLUGIN_API.md](PLUGIN_API.md).

---

## 4. Шаг 3. Зарегистрировать плагин

Список встроенных плагинов — статический массив в
`frontend/src/plugins/loader.ts`:

```ts
import type { Plugin } from './contract';
import { insertTemplatePlugin } from './builtin/insert-template';
import { myPlugin } from './builtin/my-plugin';
import { wordCountPlugin } from './builtin/word-count';

/**
 * The built-in plugins known to this build.
 *
 * Each entry is a static object literal created by the integration layer.
 * The order defines the order in the plugin manager panel.
 */
export const builtinPlugins: Plugin[] = [wordCountPlugin, insertTemplatePlugin, myPlugin];
```

Правила:

* список **статический** — никаких `import()` и никаких вычисляемых
  спецификаторов; иначе появился бы путь выполнения произвольного кода;
* порядок элементов задаёт порядок в панели плагинов;
* приложение само регистрирует плагины при старте
  (`frontend/src/App.tsx:129-151`): читает сохранённые состояния
  «включён/выключен», регистрирует каждый плагин и активирует те, которые
  включены.

Файлы `frontend/src/plugins/loader.ts` и `frontend/src/App.tsx` входят в
интеграционный слой и правятся владельцем интеграции, а не автором плагина:
при добавлении нового плагина в список вносите изменение в `loader.ts` через
запрос на изменение чужого файла.

---

## 5. Шаг 4. Написать тесты

Тесты лежат в `frontend/src/__tests__/` и подхватываются Vitest по маске
`src/**/*.test.ts` и `src/**/*.test.tsx`
(`frontend/vite.config.ts`, секция `test`). Для плагинов используется
префикс `plugin-`:

```text
frontend/src/__tests__/
├─ plugin-api.test.ts          ядро платформы: манифест, реестр, хост, шина, команды, настройки, логгер
├─ plugin-core.test.ts         манифест, шина, команды, настройки, логгер, API, реестр и хост, загрузчик
├─ plugin-ui.test.tsx          панель управления плагинами, слоты вклада, точки расширения редактора
├─ plugin-word-count.test.tsx  тесты плагина word-count
└─ plugin-insert-template.test.tsx  тесты плагина insert-template
```

Vitest запускается в окружении `jsdom` (`frontend/vite.config.ts`, секция
`test`), а `frontend/vitest.setup.ts` делает только `cleanup()` от
`@testing-library/preact`. Если тесту нужна IndexedDB (например, проверка
`SettingsStore`), он импортирует `fake-indexeddb/auto` сам — так делают
`plugin-api.test.ts`, `plugin-core.test.ts`, `plugin-word-count.test.tsx` и
`drafts.test.ts`.

Тест плагина обычно состоит из двух частей: «чистый» контекст (заглушка
`PluginContext`) и «в хосте» (`PluginHost` с настоящими реестром, шиной,
командами и хранилищем настроек).

Минимальная заготовка:

```ts
import { describe, expect, it } from 'vitest';
import { PluginHost } from '../plugins/host';
import { PluginRegistry } from '../plugins/registry';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { myPlugin, myPluginManifest } from '../plugins/builtin/my-plugin';

describe('my-plugin', () => {
  it('has a valid manifest', () => {
    expect(myPluginManifest.permissions).toEqual(['editor.read']);
  });

  it('registers its panel and removes it on deactivate', async () => {
    const registry = new PluginRegistry();
    const host = new PluginHost({
      registry,
      bus: new EventBus(),
      commands: new CommandRegistry(),
      settings: new SettingsStore(),
      createApi: () => ({}) as never,
      getEditor: () => null,
    });
    registry.register(myPlugin);
    await host.activate(myPluginManifest.id);
    expect(host.panels()).toHaveLength(1);
    await host.deactivate(myPluginManifest.id);
    expect(host.panels()).toHaveLength(0);
  });
});
```

---

## 6. Шаг 5. Прогнать проверки

Все команды — из каталога `frontend`:

```powershell
cd E:\Code\Software\noto\frontend
npm run typecheck        # tsc --noEmit
npm run check:boundaries # node scripts/check-boundaries.mjs
npm test                 # vitest run
npm run build            # tsc --noEmit && vite build
```

Полный набор проверок репозитория (бэкенд + фронтенд + сборка + замер
бандла):

```powershell
cd E:\Code\Software\noto
.\scripts\verify.ps1
```

`scripts/verify.ps1` выполняет шаги: `go build ./...`, `go vet ./...`,
`go test ./... -race -count=1`, `go run ./cmd/smoke`,
`npm run check:boundaries`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run measure`; E2E (`npx playwright test`) — только с ключом `-E2E`.
Скрипт не останавливается на первой ошибке, а в конце печатает сводку
PASS/FAIL по каждому шагу. Шаги можно пропустить: `-Skip e2e,smoke`.

Для бэкенда — только Go:

```powershell
cd E:\Code\Software\noto\backend
$go = "E:\Code\Software\noto\.tools\goroot\go\bin\go.exe"
& $go build ./...
& $go vet ./...
& $go test ./... -race -count=1
```

`-race` требует cgo и C-компилятора (`C:\msys64\mingw64\bin` на этой
машине).

---

## 7. Правила границ импортов (R1–R12)

Проверяются скриптом `frontend/scripts/check-boundaries.mjs`
(`npm run check:boundaries`). Скрипт разбирает `import`/`export ... from`,
динамический `import()` и `require()` во всех `.ts`/`.tsx` файлах `src/`.

| Правило | Что запрещает |
| --- | --- |
| **R1** | `src/core/**` не может импортировать `src/plugins/**` — ядро не зависит от платформы; поэтому `core` объявляет структурные типы (`CommandLike`, `LoggerLike`, `PluginApiLike`) вместо импорта контракта. |
| **R2** | `src/api/**` и `src/lib/**` не могут импортировать `src/plugins/**`. `src/components/**` — только из явно разрешённого списка. |
| **R3** | `src/plugins/builtin/**` может импортировать **только** `src/plugins/contract.ts` и свои собственные файлы (тот же каталог пакета). |
| **R4** | Импорт из `src/plugins/**` в `src/core/**` и в `src/plugins/builtin/**` — только типизированный (`import type { ... }`). Исключение: builtin-плагин может импортировать свои собственные файлы в рантайме. |
| **R5** | `src/plugins/contract.ts` — граница типов: не импортирует `src/components/**` и не содержит рантаймовых импортов из `src/plugins/**`. |
| **R6** | `src/components/**` может импортировать из `src/plugins/**` только `src/plugins/contract`, `src/plugins/host`, `src/plugins/registry`. Список — `ALLOWED_COMPONENT_PLUGIN_IMPORTS` в скрипте; при появлении новой публичной точки входа список надо расширить. |
| **R7** | `src/plugins/builtin/**` импортируется только из `src/plugins/**`. **Исключение: `src/__tests__/**` — тесты вправе импортировать builtin-плагины**, чтобы проверять их напрямую. |
| **R8** | `src/plugins/builtin/**` не может импортировать `src/api/client.ts` напрямую — только через публичный фасад. |
| **R9** | `src/core/**` не может импортировать `src/components/**` — ядро не зависит от интерфейса. |
| **R10** | `src/core/crypto/**` не может импортировать `src/core/vault/**` — зависимость направлена только в одну сторону, крипто-ядро остаётся листом графа. |
| **R11** | `src/plugins/**` не может импортировать `src/core/crypto/**` — плагин никогда не видит ключи. |
| **R12** | `src/core/crypto/keys` и `src/core/crypto/sealed` может импортировать только `src/core/crypto/**` и `src/core/vault/**` — материалом ключей пользуется только ядро. |

Практические следствия для плагина:

* `import type { Plugin, PluginContext, PluginManifest } from '../../contract';` —
  можно (это type-only импорт, но R3 разрешает и рантайм-импорт
  `contract.ts` целиком);
* `import { h } from 'preact'` — можно: это внешний пакет, не `src/**`;
* `import { fetchNote } from '../../../api/notes'` — нельзя (R3);
* `import { createPluginApi } from '../../../core/api/pluginApi'` — нельзя (R3);
* `import { wordCountPlugin } from '../word-count'` из соседнего плагина —
  нельзя (R3: чужой пакет).

Тесты плагинов — исключение из R7, поэтому `plugin-word-count.test.tsx`
импортирует `../plugins/builtin/word-count` законно.

---

## 8. Чек-лист качества плагина

Обязательные тесты:

- [ ] **Манифест валиден** — `validateManifest(myManifest).ok === true`;
      проверьте `id` (регулярное выражение, длина), semver `version`,
      `manifestVersion: 1`, semver `minApiVersion`, права из
      `PLUGIN_PERMISSIONS` без дубликатов.
- [ ] **Права объявлены полностью** — запрашивайте ровно те права, которые
      используете: `editor.read` для чтения, `editor.write` для записи текста,
      `ui.contribute` для панели/сайдбара/меню/тулбара/секции/команды,
      `settings.write` для записи настроек, `notes.read` / `notes.write` /
      `tree.read` / `search.read` — для работы с данными через `ctx.api`.
- [ ] **Отказ по правам проверен** — вызов без нужного права бросает
      `PluginPermissionError`, а не выполняется молча.
- [ ] **Команда регистрируется и снимается** — после `activate` команда есть
      в `commands.list()`, после `deactivate` её нет.
- [ ] **Деактивация снимает подписки** — `onChange`/`onSelectionChange`
      отписаны, счётчик подписчиков события вернулся к исходному.
- [ ] **Панель/вклад снимается** — `host.panels()` пуст после деактивации.
- [ ] **Нет записи без права** — плагин, который пишет, объявляет
      `editor.write` (или `notes.write`); плагин-наблюдатель не вызывает
      `insert`/`insertAt`/`replaceSelection`/`saveNote` ни разу.
- [ ] **Отсутствие заметки не ломает плагин** — `ctx.editor === null` не
      приводит к исключению (сценарий «заметка не открыта»).
- [ ] **Ошибка не выходит наружу** — исключение внутри `activate` приводит к
      состоянию `failed`, а не к падению приложения.
- [ ] **Нет дублей после цикла** — `activate → deactivate → activate` не
      оставляет вторую копию команды или подписки.
- [ ] **Настройки изолированы** — значение, записанное одним плагином, не
      видно другому; удаление (`reset`) возвращает значение по умолчанию из
      схемы.
- [ ] **События не содержат содержимого заметок** — payload'ы состоят только из
      путей и ревизий.
- [ ] **Логи не содержат текста заметки** — в лог уходят только счётчики и
      метаданные.
- [ ] **Зашифрованное хранилище не ломает плагин** — поведение при
      `ctx.vault.locked === true` и при `ctx.vault === undefined` проверено
      (см. §10).

Дополнительно (по желанию, но полезно):

- [ ] Тест подсчёта/логики плагина на чистых функциях (как
      `word-count`: слова, символы, кириллица).
- [ ] Тест на поведение при `settings.write` и миграции `settingsVersion`.

---

## 9. Отладка

### Логи плагина

Каждый вызов `ctx.logger.*` печатается с префиксом `[noto:<pluginId>]`:

```text
[noto:word-count] word count updated { words: 12, characters: 87 }
[noto:insert-template] шаблон вставлен в заметку
```

Уровни: `debug`, `info`, `warn`, `error` (`core/diagnostics/logger.ts`).
Префикс добавляет `createLogger(scope)`, где `scope` — идентификатор
плагина; сам логгер **не фильтрует** и **не инспектирует** переданные
значения — не пишите в лог текст заметок.

### Состояния плагинов

Экран «Plugins» в приложении (`frontend/src/components/PluginManagerPanel.tsx`)
показывает для каждого плагина статус:

| Статус | Значение |
| --- | --- |
| `Active` | Плагин активирован. |
| `Disabled` | Плагин выключен; кнопка **Enable** его включает. |
| `Failed` | Плагин упал; показывается текст ошибки и кнопка «Отключить и перезагрузить». |
| `Incompatible` | `minApiVersion` несовместим с текущей версией API. |

Там же: список вклад в диалоге (палитра команд) и кнопки «Открыть настройки»
/ «Сбросить настройки» для плагинов со схемой настроек.

Состояния можно читать и программно:

```ts
registry.states();            // Map<pluginId, PluginState>
registry.onStateChange((id, state, error) => { /* ... */ });
host.counts();                // счётчики регистраций (для тестов и диагностики)
```

### Шина событий

Подписчик, который бросает исключение, не ломает доставку: ошибка
логируется как `[noto:events] subscriber failed` в `console.warn`
(`frontend/src/core/events/eventBus.ts:78`). Если событие не приходит —
проверьте, что оно действительно эмитится: `folder.moved` объявлен в
контракте, но фронтенд его сейчас не эмитит.

### Реестр команд

Дубликат идентификатора команды игнорируется с предупреждением
`[noto:commands] duplicate command id ignored`; запуск неизвестной команды
логирует `[noto:commands] unknown command` и не бросает исключение.

### Хранилище настроек

Битое значение: `[noto:settings] corrupted value for <id>:<key>, using default`.
Ошибка миграции: `[noto:settings] migration N -> N+1 failed`.

### Частые грабли

* **Плагин ничего не показывает.** Проверьте: плагин включён (состояние
  `Active`), в манифесте есть `ui.contribute` (иначе `registerPanel` бросит
  `PluginPermissionError` и панель не зарегистрируется), а `ctx.editor` не
  `null` (заметка открыта).
* **Отказ по правам.** В панели плагинов или в реестре появится сообщение
  «plugin activation stopped by a permission error» — плагин не объявил право,
  которое использует (чаще всего забытое `ui.contribute` или `editor.write`).
  Сообщение об ошибке содержит только идентификатор плагина и имя
  недостающего права.
* **Команда не выполняется.** Проверьте `id` команды: он глобален, и дубликат
  отбрасывается; второй плагин с тем же `id` молча останется без команды.
* **Двойное срабатывание.** Подписка на `editor.onChange` не снята — добавьте
  `ctx.onDeactivate(() => off())`.
* **Правки не сохраняются.** Используйте `insert`/`insertAt`/`replaceSelection`,
  а не прямую замену документа: иначе автосохранение не сработает.
* **Настройка не применяется.** Значение читается через
  `ctx.settings.get(key)`; если ключа нет в схеме манифеста, `get` вернёт
  `undefined` — добавьте ключ в `manifest.settings`.
* **Нарушение границ.** `npm run check:boundaries` печатает файл, строку и
  правило (`R3`, `R7`, `R8` и т. д.) — по номеру правила понятно, что именно
  запрещено.

---

## 10. Плагин в зашифрованном хранилище

Хранилище заметок бывает открытым и зашифрованным (запечатанным). Для плагина
разницы почти нет — и в этом весь смысл: **плагин не должен знать, зашифровано
ли хранилище**.

### 10.1. Тот же API

Чтение и запись идут через **тот же** `ctx.api`:

```ts
const note = await ctx.api.getNote('journal/day1.md');
await ctx.api.saveNote('journal/day1.md', '# Hello', note.revision);
```

В зашифрованном режиме шифрует и расшифровывает ядро
(`frontend/src/core/vault/**`); плагин получает обычный Markdown на входе и
на выходе. Ничего переписывать не нужно, репозиторий подключать не нужно,
формат контейнера знать не нужно.

### 10.2. Когда хранилище заперто

Пока хранилище заблокировано, чтение и запись невозможны: ядро бросает
`VaultLockedError`, а состояние видно через `ctx.vault`:

```ts
if (ctx.vault?.locked) {
  // показать пользователю, что нужно разблокировать хранилище
  return;
}
```

`ctx.vault` необязателен: пока приложение ничего не опубликовало, значение —
`undefined`, а не «хранилище открыто». Поэтому проверка всегда через `?.`.

### 10.3. Три правила, которые нельзя нарушать

1. **Не кэшировать содержимое заметки вне ядра.** Расшифрованный текст живёт в
   памяти ядра и в редакторе. Если плагин положит его в `localStorage`, в
   `IndexedDB`, в свой лог или в состояние своей панели — открытый текст
   окажется на диске, и обещание «на диске только шифротекст» перестанет
   быть правдой. Плагин может держать свёдение (счётчик слов, дату,
   идентификатор), но не сам текст.
2. **Не читать файлы хранилища напрямую.** Никаких `fetch` по путям внутри
   `.noto`, никаких обращений к `objects/`, `manifests/` и `keystore.json`.
   Эти файлы запечатаны, и их структура — часть формата, а не API.
3. **Не просить ключи.** Ключевого материала в API нет и быть не может:
   `src/plugins/**` не может импортировать `src/core/crypto/**` (правило
   **R11**), а сам крипто-ядро импортируется только из `src/core/crypto/**` и
   `src/core/vault/**` (правило **R12**). Нарушение — падение
   `npm run check:boundaries`.

### 10.4. Что можно сделать «лучше» в зашифрованном режиме

* Сообщить пользователю, что хранилище заперто, вместо того чтобы молча
  показывать пустой список.
* Не пытаться «смягчить» блокировку повторными попытками чтения: они только
  замедлят разблокировку.
* Не складывать в лог ничего, что выглядит как содержимое заметки, даже
  обрезанное: лог плагина — это тоже текст, который кто-то прочитает.

Подробнее о границе ключевого материала — [PLUGIN_SECURITY.md](PLUGIN_SECURITY.md).
