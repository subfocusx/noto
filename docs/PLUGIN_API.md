# Noto — Plugin API (v1.3.0)

Справочник публичного контракта плагинов. Источник истины — код:

* `frontend/src/plugins/contract.ts` — единственный модуль, доступный плагину;
* `frontend/src/plugins/manifest.ts` — валидация манифеста и совместимость версий;
* `frontend/src/plugins/registry.ts` — реестр и состояния;
* `frontend/src/plugins/host.ts` — активация, владение регистрациями;
* `frontend/src/core/**` — шина событий, реестр команд, хранилище настроек, логгер, фасад API.

Сопутствующие документы: [PLUGIN_SECURITY.md](PLUGIN_SECURITY.md) (модель доверия),
[PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md) (как писать плагин).

---

## 1. Версия API

```ts
// frontend/src/plugins/contract.ts
export const PLUGIN_API_VERSION = '1.3.0';
```

Версия `1.3.0` добавила три вещи:

* **операцию открытия заметки** — `ctx.openNote(path)` (§4.2);
* **песочницу плагинов** — `manifest.sandbox` и `plugin.sandboxSource` (§4.3);
* **журнал аудита действий плагинов** — `PluginAuditEntry` (§13).

Изменение аддитивное: новые члены необязательны в типе, поэтому плагин,
объявивший `minApiVersion: '1.0.0'`, продолжает работать без единой правки.

Версия `1.2.0` добавила **возможность запроса**: `ctx.api.query()` и
`ctx.api.tags()` за новым правом `query.read` (§3, §5.1). Изменение
аддитивное: новые члены необязательны в типе, поэтому плагин, объявивший
`minApiVersion: '1.0.0'`, продолжает работать без единой правки.

Версия `1.1.0` добавила **одно** необязательное поле — состояние
запечатанного хранилища `ctx.vault` (§4.1). Изменение аддитивное: плагин,
объявивший `minApiVersion: '1.0.0'`, продолжает работать без единой правки.

Плагин объявляет в манифесте минимальную версию API, с которой он совместим:

```ts
minApiVersion: '1.0.0'
```

Проверка совместимости — `isCompatible(minApiVersion, apiVersion)`
(`frontend/src/plugins/manifest.ts:168`):

* major-версии должны совпадать; при несовпадении плагин получает состояние
  `incompatible` и не активируется;
* minor-версия плагина должна быть **не больше** minor-версии API
  (`plugin.minor <= api.minor`), то есть плагин может требовать более старый
  minor, но не более новый;
* patch-версии в сравнении не участвуют.

Правила совместимости:

| Изменение | Что требуется |
| --- | --- |
| Добавление нового экспорта в `contract.ts` | Допустимо в пределах minor: bump `1.0.0 → 1.1.0`, старые плагины продолжают работать. |
| Добавление нового необязательного поля манифеста | Допустимо в пределах minor (bump minor), поле должно иметь значение по умолчанию. |
| Переименование или изменение формы экспорта `contract.ts` | Ломающее изменение: bump major (`1.x.0 → 2.0.0`), старые плагины помечаются `incompatible`. |
| Изменение сигнатуры метода `PluginContext` / `PluginEditor` / `PluginApi` | Ломающее изменение: bump major. |

Плагин, объявивший `minApiVersion` с major, отличным от текущего, не запускается
вообще — он остаётся в реестре в состоянии `incompatible` с сообщением
`plugin requires API X, current API is Y` (`frontend/src/plugins/registry.ts:62`).

---

## 2. Манифест

Тип `PluginManifest` (`frontend/src/plugins/contract.ts:38`).

| Поле | Тип | Обязательное | Значение |
| --- | --- | --- | --- |
| `id` | `string` | да | Идентификатор плагина. Должен совпадать с `/^[a-z0-9][a-z0-9._-]*$/`, длина 2–64 символа. Используется как ключ пространства настроек и как префикс логгера `[noto:<id>]`. |
| `name` | `string` | да | Отображаемое имя (непустая строка). |
| `version` | `string` | да | Semver `x.y.z` (разрешены пре- и билд-суффиксы). |
| `manifestVersion` | `1` | да | Версия формата манифеста. Сейчас только `1`. |
| `minApiVersion` | `string` | да | Минимальная версия Plugin API. Semver. |
| `permissions` | `PluginPermission[]` | да | Запрашиваемые права (см. §3). Дубликаты и неизвестные имена отклоняются. |
| `description` | `string` | нет | Текстовое описание, показывается в панели плагинов. |
| `author` | `string` | нет | Автор. |
| `settings` | `PluginSettingSchema[]` | нет | Схема пользовательских настроек плагина. |
| `settingsVersion` | `number` | нет | Версия схемы настроек (неотрицательное целое). |
| `settingsMigrations` | `Record<string, (value: unknown) => unknown>` | нет | Миграции настроек: ключ — номер исходной версии строкой (`"1"`), значение — функция `N → N+1`. |
| `sandbox` | `boolean` | нет | Плагин просит песочницу (API 1.3.0): его код выполняется внутри iframe со строгой CSP и общается с хостом через мост (см. §4.3). Плагин без `sandboxSource` отвергается хостом (состояние `failed`). |

Схема одной настройки (`PluginSettingSchema`):

| Поле | Тип | Обязательное |
| --- | --- | --- |
| `key` | `string` (непустая, уникальная в пределах плагина) | да |
| `label` | `string` (непустая) | да |
| `type` | `'string' \| 'number' \| 'boolean'` | да |
| `default` | значение того же типа, что и `type` | да |
| `description` | `string` | нет |

Валидация выполняется функцией `validateManifest(manifest)`
(`frontend/src/plugins/manifest.ts:48`). Плагин с невалидным манифестом
регистрируется в состоянии `failed`, список ошибок показывается в панели
плагинов; код плагина при этом не выполняется.

---

## 3. Права (`permissions`)

Полный набор — `PLUGIN_PERMISSIONS` (`frontend/src/plugins/manifest.ts:16`),
тип `PluginPermission` (`frontend/src/plugins/contract.ts:18`). Ровно девять прав.

| Право | Что оно означает по смыслу | Что даёт на практике сейчас |
| --- | --- | --- |
| `notes.read` | Чтение содержимого заметок | `ctx.api.getNote(path)` возвращает тело заметки вместе с ревизией. Требуется и для `ctx.openNote(path)` — плагин переходит только к заметке, которую ему разрешено читать (§4.2). |
| `notes.write` | Запись заметок | `ctx.api.saveNote(path, content, revision)` — запись идёт через optimistic locking. |
| `tree.read` | Чтение дерева заметок | `ctx.api.getTree()` возвращает `{ folders, files }`. |
| `search.read` | Поиск по заметкам | `ctx.api.search(query, limit?)`. |
| `query.read` | Выборка заметок языком запросов (API 1.2.0) | `ctx.api.query(query, limit?)` и `ctx.api.tags()`. Плагин видит пути, имена и сниппеты совпавших заметок — но никогда материал ключей. |
| `editor.read` | Чтение текста открытой заметки | `ctx.editor.getText()`, `getSelection()`, `getCursor()`, подписки `onChange` / `onSelectionChange`. |
| `editor.write` | Изменение текста открытой заметки | `ctx.editor.insert()`, `insertAt()`, `replaceSelection()` — изменения идут через CodeMirror, поэтому автосохранение продолжает работать. |
| `ui.contribute` | Вклад в интерфейс | Регистрация панели, пункта сайдбара, пункта контекстного меню, кнопки тулбара, секции настроек, команды. |
| `settings.write` | Запись собственных настроек | `ctx.settings.set(...)`, `reset(...)`. |

### Как применяются права

Проверка выполняется в рантайме. Механизм — в
`frontend/src/core/api/pluginApi.ts`:

* `PluginPermissionError` — класс ошибки; он живёт в `core`, потому что
  `core/**` не может импортировать `src/plugins/**` (правило R1), и
  **реэкспортируется из контракта** (`export { PluginPermissionError } from
  '../core/api/pluginApi'` в `frontend/src/plugins/contract.ts`), поэтому
  плагин может поймать его по типу;
* `requirePermission(pluginId, permissions, permission)` — бросает
  `PluginPermissionError`, если права нет;
* `PLUGIN_API_PERMISSIONS` — таблица «операция → право» для API;
* `restrictPluginApi(api, pluginId, permissions)` — возвращает **новый**
  объект API, который проверяет права перед каждым вызовом; плагин никогда не
  получает ссылку на неограниченную реализацию.

Хост собирает контекст так, что каждая возможность проверена:

| Операция | Требуемое право | Где проверяется |
| --- | --- | --- |
| `ctx.api.getNote(path)` | `notes.read` | `restrictPluginApi` |
| `ctx.api.saveNote(path, content, revision)` | `notes.write` | `restrictPluginApi` |
| `ctx.api.getTree()` | `tree.read` | `restrictPluginApi` |
| `ctx.api.search(query, limit?)` | `search.read` | `restrictPluginApi` |
| `ctx.api.query(query, limit?)` | `query.read` | `restrictPluginApi` |
| `ctx.api.tags()` | `query.read` | `restrictPluginApi` |
| `ctx.editor.getText()` / `getSelection()` / `getCursor()` | `editor.read` | `restrictEditor` |
| `ctx.editor.onChange()` / `onSelectionChange()` | `editor.read` | `restrictEditor` |
| `ctx.editor.insert()` / `insertAt()` / `replaceSelection()` | `editor.write` | `restrictEditor` |
| `ctx.editor.focus()` / `openSearch()` / `getPath()` | без права | не читают и не меняют содержимое; `getPath()` — метаданные |
| `ctx.registerCommand()` и остальные `register*` | `ui.contribute` | `requirePermission` в хосте |
| `ctx.settings.set()` / `reset()` | `settings.write` | `requirePermission` в хосте |
| `ctx.settings.get()` / `all()` | без права | пространство принадлежит самому плагину |
| `ctx.on(...)` | без права | подписка на метаданные событий |

Набор прав, действующий для плагина, — замороженная копия
`manifest.permissions` (`Object.freeze([...manifest.permissions])`), плагин не
может изменить её изнутри.

Отказ — это **исключение в коде плагина**, а не тихий no-op:

```ts
try {
  await ctx.api.saveNote(path, text, revision);
} catch (err) {
  if (err instanceof PluginPermissionError) {
    ctx.logger.warn('permission denied', err.permission);
  }
}
```

Если `PluginPermissionError` брошен **во время `activate`**, хост считает это
не поломкой плагина: плагин остаётся `active` со своими регистрациями, а
причина попадает в реестр (`frontend/src/plugins/host.ts`: «plugin activation
stopped by a permission error»).

Чего enforcement **не** покрывает: сетевых вызовов мимо API (плагин может
вызвать `fetch` сам — CSP разрешает `connect-src 'self'`), содержимого,
которое плагин уже прочитал, и возможностей самого языка. Песочницы нет:
плагин — доверенный код. Подробности — в
[PLUGIN_SECURITY.md](PLUGIN_SECURITY.md), § «Модель разрешений».


---

## 4. Контекст плагина (`PluginContext`)

`frontend/src/plugins/contract.ts:206`. Контекст создаёт хост
(`PluginHost.createContext`, `frontend/src/plugins/host.ts:309`) — он и есть
граница возможностей плагина.

| Член | Тип | Смысл |
| --- | --- | --- |
| `id` | `readonly string` | Идентификатор плагина. |
| `version` | `readonly string` | Версия плагина из манифеста. |
| `logger` | `readonly PluginLogger` | Логгер с префиксом `[noto:<id>]` (`core/diagnostics/logger.ts`). |
| `permissions` | `readonly PluginPermission[]` | Заявленные права (см. оговорку выше). |
| `api` | `readonly PluginApi` | Доступ к данным (см. §5). |
| `vault` | `readonly PluginVaultState \| undefined` | Состояние запечатанного хранилища (см. §4.1). Необязательное поле, добавленное в API 1.1.0. |
| `editor` | `readonly PluginEditor \| null` | Ручка редактора (с проверкой прав) или `null`, если заметка не открыта. Это **геттер**: значение вычисляется при каждом обращении, поэтому плагин, активированный до открытия заметки, получит редактор позже. |
| `settings` | `readonly PluginSettings` | Собственные настройки плагина (см. §8). |
| `registerCommand(cmd)` | `() => void` | Регистрирует команду палитры. Требует `ui.contribute`. |
| `registerPanel(p)` | `() => void` | Регистрирует панель. Требует `ui.contribute`. |
| `registerSidebarItem(i)` | `() => void` | Регистрирует пункт сайдбара. Требует `ui.contribute`. |
| `registerContextMenuItem(i)` | `() => void` | Регистрирует пункт контекстного меню. Требует `ui.contribute`. |
| `registerToolbarItem(i)` | `() => void` | Регистрирует кнопку тулбара. Требует `ui.contribute`. |
| `registerSettingsSection(s)` | `() => void` | Регистрирует секцию настроек. Требует `ui.contribute`. |
| `on(event, cb)` | `() => void` | Подписка на событие платформы. |
| `onEditor(cb)` | `() => void` | Подписка на редактор приложения: колбэк вызывается сразу с текущим редактором (или `null`), затем при каждой смене. Поле **необязательное** (`onEditor?`), чтобы контексты, собранные вручную в тестах компонентов, оставались валидными. |
| `onDeactivate(cb)` | `void` | Колбэк, который будет вызван при деактивации. |
| `openNote(path)` | `void` | Открывает заметку в редакторе (API 1.3.0, право `notes.read`). Необязательный член — см. §4.2. |

### Функции, возвращающие `() => void`

Все методы `register*` и `on` возвращают **функцию отмены** (unsubscribe).
Она идемпотентна: повторный вызов ничего не делает. Пример:

```ts
const off = ctx.registerCommand({ id: 'my-plugin.run', title: 'Run', run: () => {} });
off(); // команда снята
```

Кроме того, хост сам снимает **все** регистрации плагина при деактивации
(`cleanupRuntime`, `frontend/src/plugins/host.ts:276`): команды удаляются через
`CommandRegistry.unregisterAll(owner)`, панели/пункты/секции удаляются из
коллекций, подписки на события отписываются, колбэки `onDeactivate`
выполняются в обратном порядке регистрации. Поэтому явная отмена в
`onDeactivate` — это «подстраховка» (как в `insert-template`), а не
единственный способ убрать команду.

`onDeactivate(cb)` — единственный метод, возвращающий `void`: он не
отменяется, а добавляет колбэк в очередь деактивации.

### 4.1. Состояние хранилища (`ctx.vault`, API 1.1.0)

`ctx.vault` — необязательный член контекста. Он появляется в версии `1.1.0` и
сообщает плагину **состояние** хранилища, ничего больше:

```ts
// frontend/src/plugins/contract.ts
export interface PluginVaultState {
  readonly mode: 'open' | 'sealed';
  readonly encrypted: boolean;
  readonly locked: boolean;
  readonly formatVersion: number;
}
```

| Поле | Тип | Смысл |
| --- | --- | --- |
| `mode` | `'open' \| 'sealed'` | `sealed` — содержимое шифруется браузером; `open` — обычный Markdown на диске |
| `encrypted` | `boolean` | То же самое, что `mode === 'sealed'`, но в виде булева флага — так его удобнее проверять |
| `locked` | `boolean` | Хранилище заблокировано: плагин не может прочитать ничего |
| `formatVersion` | `number` | Версия формата запечатанного хранилища; `0`, когда хранилище не зашифровано |

Правила:

* Поле **необязательное**. Пока приложение ничего не опубликовало, плагин
  видит `ctx.vault === undefined` — то есть «состояние неизвестно», а не
  «хранилище открыто». Поэтому код плагина обязан писать `ctx.vault?.encrypted`,
  а не `ctx.vault.encrypted`.
* Значение — **замороженная копия** (`Object.freeze` в
  `frontend/src/core/api/pluginApi.ts`). Плагин может прочитать состояние, но
  не может его изменить и не может изменить состояние приложения.
* Поле **не перечисляемое** (`enumerable: false`): набор ключей `ctx.api`
  остаётся ровно тем же, что в API 1.0.0, поэтому плагин, который
  перечисляет ключи, не ломается.
* Публикация состояния **не требует права**: это не операция над данными, а
  факт о хранилище. Права нужны только для чтения и записи заметок.
* Состояние публикует приложение (`frontend/src/App.tsx`, `getVaultState`),
  а фасад API — `createPluginApi({ vaultState })`.
* То же состояние доступно и как `ctx.api.vault`
  (`frontend/src/core/api/pluginApi.ts`): там оно тоже замороженная копия и тоже
  не перечисляемое. Два имени — одно значение, чтобы плагин мог читать его
  там, где у него уже есть `ctx.api`.

**Плагин никогда не видит материал ключей.** В состоянии нет и не может быть
мастер-пароля, KEK или DEK. Проверка границ (`frontend/scripts/check-boundaries.mjs`,
правила **R11** и **R12**) запрещает плагину импортировать крипто-ядро, так
что это не обещание, а запрет компилятора. Подробнее —
[PLUGIN_SECURITY.md](PLUGIN_SECURITY.md).

Пример:

```ts
export function activate(ctx: PluginContext): void {
  ctx.registerCommand({
    id: 'my-plugin.state',
    title: 'Show the state of the storage',
    run: () => {
      const vault = ctx.vault;
      if (!vault) {
        ctx.logger.info('the state of the storage is unknown');
        return;
      }
      ctx.logger.info(
        vault.encrypted
          ? `the storage is encrypted (format ${vault.formatVersion})` +
            (vault.locked ? ' and locked' : '')
          : 'the storage is plain',
      );
    },
  });
}
```

### 4.2. Открытие заметки (`ctx.openNote`, API 1.3.0)

`ctx.openNote(path)` — необязательный член контекста: он появился в версии
`1.3.0` и открывает заметку в редакторе приложения.

```ts
export interface PluginContext {
  // ...
  openNote?(path: string): void;
}
```

Правила:

* операция требует права **`notes.read`**: плагин переходит только к заметке,
  которую ему разрешено читать; без права бросается `PluginPermissionError`;
* операция **не даёт** содержимое заметки — чтобы прочитать её, плагин
  обращается к `ctx.api.getNote(path)`;
* если хост не умеет открывать заметки (зависимость `openNote` не передана),
  операция бросает `Error('the host cannot open notes')` — молчаливого
  no-op нет;
* действие записывается в журнал аудита (§13).

Встроенный плагин `backlinks` использует операцию: ссылки панели открывают
заметку.

```ts
ctx.registerPanel({
  id: 'my-plugin.panel',
  title: 'My plugin',
  render: () =>
    h('button', { onClick: () => ctx.openNote?.('notes/alpha.md') }, 'Alpha'),
});
```

### 4.3. Песочница плагинов (API 1.3.0)

Плагин, чей манифест объявляет `sandbox: true`, **не выполняется** в контексте
приложения: его код живёт в строке `plugin.sandboxSource` и выполняется внутри
`iframe` со строгой политикой безопасности.

| Свойство | Значение |
| --- | --- |
| Атрибут `sandbox` кадра | `allow-scripts` — **без** `allow-same-origin`, поэтому документ имеет непрозрачный origin |
| Политика (CSP) | `default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` — без `unsafe-inline` и без `unsafe-eval` |
| Мост | `postMessage` с проверкой канала, идентификатора плагина, идентификатора запроса и списка разрешённых методов |
| Разрешённые методы | `api.getNote`, `api.getTree`, `api.search`, `api.query`, `api.tags`, `editor.getText`, `editor.getSelection`, `editor.getCursor`, `editor.getPath`, `openNote`, `log` |
| Права | Те же, что и у обычного плагина: обработчики моста строятся из ограниченных возможностей плагина, поэтому `PluginPermissionError` работает и в песочнице |

Внутри кадра плагин пользуется только `window.notoPlugin`:

```js
const tree = await window.notoPlugin.api.getTree();
```

Исходный код песочницы **не должен** содержать `eval`, `new Function`,
динамический `import()`, `fetch`, `XMLHttpRequest` или `WebSocket` — это
проверяет новое правило границ **R17**
(`frontend/scripts/check-boundaries.mjs`).

---

## 5. Доступ к данным (`PluginApi`)
`frontend/src/plugins/contract.ts:117`. Реализация — фасад
`createPluginApi()` (`frontend/src/core/api/pluginApi.ts:28`), который
делегирует в `src/api/notes.ts`, `src/api/tree.ts`, `src/api/search.ts`.
Фасад **не вызывает `fetch` сам** — HTTP идёт через общий клиент приложения.

| Метод | Сигнатура | Что делает |
| --- | --- | --- |
| `getNote` | `(path: string) => Promise<NoteContent>` | Читает заметку: тело, ревизия, таймстемпы. |
| `getTree` | `() => Promise<{ folders: Node[]; files: Node[] }>` | Дерево заметок плоскими массивами. |
| `search` | `(query: string, limit?: number) => Promise<SearchHit[]>` | Полнотекстовый поиск. Значение `limit` по умолчанию — `50` (`core/api/pluginApi.ts:39`). |
| `saveNote` | `(path: string, content: string, revision: number) => Promise<SaveNoteResponse>` | Записывает заметку с optimistic locking. |
| `query` | `(query: string, limit?: number) => Promise<PluginQueryResult>` | Выборка заметок языком запросов (API 1.2.0, право `query.read`). |
| `tags` | `() => Promise<TagCount[]>` | Теги хранилища с числом заметок (API 1.2.0, право `query.read`). |

### 5.1. Возможность запроса (API 1.2.0)

Язык запросов описан в [`QUERY_LANGUAGE.md`](QUERY_LANGUAGE.md). Плагин
спрашивает хранилище тем же языком, что и человек:

```ts
const answer = await ctx.api.query?.("tag == 'work' && !has_incomplete_tasks");
for (const hit of answer?.hits ?? []) {
  console.log(hit.path, hit.title ?? hit.name);
}
const tags = await ctx.api.tags?.();
// [{ tag: 'work', count: 12 }, { tag: 'home', count: 3 }]
```

| Поле ответа | Тип | Смысл |
| --- | --- | --- |
| `hits` | `PluginQueryHit[]` | Совпавшие заметки: путь, имя, сниппет и, когда хост знает, заголовок и таймстемпы. |
| `total` | `number` | Число совпавших заметок до применения ограничения. |
| `partial` | `boolean` | `true`, если свойства части заметок не удалось пересчитать, — ответ может быть неполным. |

Как это работает в двух режимах хранения:

* **открытое хранилище** — запрос уходит на сервер (`POST /api/query`), ответ
  строит SQL-компилятор языка;
* **запечатанное хранилище** — запрос выполняется **в браузере** над
  расшифрованными заметками (`frontend/src/core/api/pluginQuery.ts`), поэтому
  ключевой материал наружу не выходит никогда.

Плагин без права `query.read` получает `PluginPermissionError` — тихого
no-op здесь нет.

Про `saveNote` важно:

* передавайте `revision`, которую плагин прочитал; сервер отвечает
  `409 revision_conflict` (`ApiError` с `code === 'revision_conflict'`), если
  ревизия устарела, и возвращает актуальное состояние заметки — ошибка
  пробрасывается без изменений, её может обработать плагин;
* `revision === 0` означает «принудительная запись» (так работает импорт) —
  плагинам это поведение давать не следует.

Второй путь к данным — бэкенд. `backend/internal/notes/noteapi.go` определяет
узкий интерфейс `NoteService` (`Read` / `Write` одной заметки), тип `NoteEvent`
и механизм хуков `AddHook`. Хук вызывается **после** того, как диск, поисковый
индекс и метаданные пришли в согласованное состояние, и **после** снятия
блокировок (`backend/internal/notes/notes.go:99-108`,
`backend/internal/notes/notes_move.go:136-145`,
`backend/internal/notes/trash.go:67-76`). Паника в хуке восстанавливается и
логируется, операция при этом сохраняет свой результат. Фронтенд эти хуки
пока не подключает: события для плагинов эмитит сам `App.tsx`.

---

## 6. Редактор (`PluginEditor`)

`frontend/src/plugins/contract.ts:88`. Реализация собирается в `App.tsx:89-105`
поверх `EditorHandle` (`frontend/src/components/Editor.tsx:23`).

| Метод | Сигнатура | Смысл |
| --- | --- | --- |
| `getText` | `() => string` | Текст открытой заметки. |
| `getSelection` | `() => string` | Текст основного выделения. |
| `getCursor` | `() => { from: number; to: number }` | Границы основного выделения. |
| `insert` | `(text: string) => void` | Вставляет текст, заменяя текущее выделение. |
| `insertAt` | `(text: string, from: number, to: number) => void` | Заменяет диапазон `[from, to)` на текст. `from === to` — вставка без замены. |
| `replaceSelection` | `(text: string) => void` | Заменяет текущее выделение. |
| `focus` | `() => void` | Фокус на редакторе. |
| `openSearch` | `() => void` | Открывает панель поиска CodeMirror. |
| `getPath` | `() => string \| null` | Путь открытой заметки. Права не требует: это метаданные, а не содержимое. |
| `onChange` | `(cb: (text: string) => void) => () => void` | Подписка на изменение документа; возвращает отмену. |
| `onSelectionChange` | `(cb: (sel: { from: number; to: number }) => void) => () => void` | Подписка на изменение выделения; возвращает отмену. |

### Почему `setText` отсутствует

В контракте **нет** `setText()`. Замена всего документа «за спиной» редактора
не порождает событие изменения, которое слушает приложение, — автосохранение
не сработает, и правка может молча потеряться. Поэтому доступны только
`insert`, `insertAt` и `replaceSelection`: все три идут через CodeMirror
(`EditorHandle.insertAt` / `replaceSelection`, `frontend/src/components/Editor.tsx:260-279`),
поэтому изменение видно приложению и сохраняется как обычно.

У `EditorHandle` (внутренний интерфейс редактора) `setText` есть, но он не
выведен в контракт плагинов.

### Редактор — живой, а не снимок

`ctx.editor` — это **геттер**: хост опрашивает приложение при каждом обращении
(`currentEditor()`, `frontend/src/plugins/host.ts`), поэтому:

* плагин, активированный до открытия первой заметки, всё равно получит
  редактор позже — `ctx.editor` перестаёт быть `null`;
* когда заметка закрывается, `ctx.editor` снова становится `null`;
* при каждом обращении возвращается **новый ограниченный объект**
  (`restrictEditor`), поэтому права проверяются на каждое вызов, а не один раз
  при активации.

Если плагину нужно узнать о смене редактора, у него есть два способа:

* подписаться на событие `editor.available` (`{ path: string | null }`);
* использовать `ctx.onEditor(cb)` — колбэк вызывается немедленно с текущим
  редактором и затем при каждой смене; возвращает идемпотентную отмену.

Хост узнаёт о смене редактора двумя способами: push-подпиской
`deps.subscribeEditor` (если интеграция её передала) или опросом
`deps.getEditor()` при каждом обращении к `ctx.editor` и при каждой эмиссии
события. Смена определяется по «подписи» редактора (путь + доступность).

Плагин, который читает `ctx.editor` один раз и запоминает результат
(`const editor = ctx.editor` на активации), получает снимок: это работает, но
не переживает смену заметки — для этого нужен `ctx.onEditor` или
`editor.available`.

### Расширения CodeMirror

`EditorHandle.setExtensions(extensions)` (`frontend/src/components/Editor.tsx:42`)
позволяет плагину добавить расширение CodeMirror: расширения живут в отдельной
`Compartment`, документ и история заметки при перенастройке сохраняются. В
контракт плагинов этот метод пока **не** выведен — `PluginEditor` ограничен
десятью методами выше.

---

## 7. События (`PluginEventMap`)

`frontend/src/plugins/contract.ts:177`. Десять событий:

| Событие | Payload |
| --- | --- |
| `note.created` | `{ path: string }` |
| `note.updated` | `{ path: string; revision: number }` |
| `note.deleted` | `{ path: string }` |
| `note.renamed` | `{ path: string; previousPath: string }` |
| `note.moved` | `{ path: string; previousPath: string }` |
| `folder.created` | `{ path: string }` |
| `folder.moved` | `{ path: string; previousPath: string }` |
| `editor.saved` | `{ path: string; revision: number }` |
| `editor.available` | `{ path: string \| null }` — редактор приложения появился или сменился; `path` равен `null`, когда заметка не открыта. |
| `workspace.opened` | `{ path: string \| null }` |

Payload **никогда не содержит содержимого заметки** — только пути и
метаданные. Это зафиксировано и в контракте, и в реализации: подписчики
получают `{ path, revision }`, а не тело документа.

Доставка — `EventBus` (`frontend/src/core/events/eventBus.ts`):

* доставка **синхронная**, в порядке подписки;
* каждый подписчик выполняется в своём `try/catch`: падение одного не мешает
  остальным, ошибка логируется как `[noto:events] subscriber failed`;
* повторная эмиссия **того же** события во время его доставки игнорируется
  (защита от рекурсии);
* `on()` возвращает идемпотентную функцию отмены.

Кто эмитит события сейчас: `frontend/src/App.tsx` — `note.updated` и
`workspace.opened` после открытия заметки (`:215-216`), `note.created`,
`folder.created`, `note.renamed`, `note.moved`, `note.deleted` после
соответствующих операций (`:233-250`), `editor.saved` после успешного
сохранения (`:259-262`). Событие `editor.available` эмитит сам хост, когда
заметка редактора сменилась (`frontend/src/plugins/host.ts`).

**Оговорка:** событие `folder.moved` объявлено в контракте, но фронтенд его
сейчас не эмитит — перенос папки в UI отдаёт `note.moved` только для файлов.
Подписка на `folder.moved` безопасна (событие просто не придёт), но полагаться
на него нельзя.

---

## 8. Команды и UI-точки вклада

### Команда (`PluginCommand`)

```ts
export interface PluginCommand {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  run(): void | Promise<void>;
}
```

Команды хранятся в `CommandRegistry` (`frontend/src/core/commands/commandRegistry.ts`):

* идентификатор команды глобален; повторная регистрация с тем же `id`
  отклоняется (в консоль идёт `[noto:commands] duplicate command id ignored`),
  первая команда сохраняется;
* `unregisterAll(owner)` снимает все команды владельца — этим пользуется хост
  при деактивации;
* `run(id)` возвращает результат `cmd.run()`; неизвестный id не бросает
  исключение, а логирует `[noto:commands] unknown command`.

### Панель (`PluginPanel`)

```ts
export interface PluginPanel {
  id: string;
  title: string;
  render(): ComponentChildren;
}
```

Панели рендерятся как переключаемые вкладки (`PluginPanelSlot`,
`frontend/src/components/PluginSlots.tsx:115`). `render()` вызывается при
каждом рендере; компонент плагина сам решает, как часто перерисовываться
(в `word-count` для этого сделан маленький store с подписками).

### Пункт сайдбара (`PluginSidebarItem`)

```ts
export interface PluginSidebarItem {
  id: string;
  title: string;
  icon?: string;
  onSelect(): void;
}
```

`icon` — **имя иконки** из общего реестра (`frontend/src/ui/icons.tsx`):
`file-text`, `folder`, `folder-open`, `search`, `settings`, `list-tree` и
другие (полный список — в `docs/DESIGN_SYSTEM.md`). Неизвестное имя не
является ошибкой: показывается нейтральная точка, поэтому старые значения
продолжают работать.

### Пункт контекстного меню (`PluginContextMenuItem`)

```ts
export interface PluginContextMenuItem {
  id: string;
  title: string;
  appliesTo(path: string): boolean;
  run(path: string): void | Promise<void>;
}
```

`appliesTo` вызывается для пути текущей заметки; исключение внутри него
перехватывается, пункт просто не показывается
(`frontend/src/components/PluginSlots.tsx:205-211`).

### Кнопка тулбара (`PluginToolbarItem`)

```ts
export interface PluginToolbarItem {
  id: string;
  title: string;
  icon?: string;
  run(): void | Promise<void>;
}
```

`icon` — имя иконки из общего реестра, как и у пункта сайдбара.

### Секция настроек (`PluginSettingsSection`)

```ts
export interface PluginSettingsSection {
  id: string;
  title: string;
  render(): ComponentChildren;
}
```

Секции рендерятся в диалоге настроек плагина (`frontend/src/App.tsx:528-532`).

### Где всё это отображается

| Точка | Компонент | Место в UI |
| --- | --- | --- |
| Панель | `PluginPanelSlot` | Под редактором и предпросмотром. |
| Пункт сайдбара | `PluginSidebarSlot` | Боковая колонка под деревом заметок. |
| Контекстное меню | `PluginContextMenuSlot` | Рядом с деревом заметок. |
| Кнопка тулбара | `PluginToolbarSlot` | Над редактором. |
| Команды | `PluginCommandSlot` | В диалоге «Plugins» (палитра команд). |
| Секция настроек | — | В диалоге настроек конкретного плагина. |

Каждый вклад обёрнут в `PluginErrorBoundary`
(`frontend/src/components/PluginSlots.tsx:38`): ошибка рендера плагина
заменяется сообщением «Ошибка плагина: …» и не ломает страницу.

---

## 9. Настройки плагина

`PluginSettings` (`frontend/src/plugins/contract.ts:193`):

| Метод | Сигнатура | Смысл |
| --- | --- | --- |
| `get` | `<T>(key: string) => Promise<T \| undefined>` | Читает значение; при отсутствии возвращает `default` из схемы манифеста, `undefined` — если ключа нет в схеме. |
| `set` | `<T>(key: string, value: T) => Promise<void>` | Записывает значение; значение должно быть JSON-совместимым, иначе `TypeError`. |
| `reset` | `(key?: string) => Promise<void>` | Удаляет одно значение или все значения плагина. |
| `all` | `() => Promise<Record<string, unknown>>` | Все значения плагина; ключи из схемы присутствуют со значением по умолчанию, если не сохранены. |

Хранилище — `SettingsStore` (`frontend/src/core/settings/settingsStore.ts`):

* отдельная база IndexedDB **`noto-plugins`** (не та, что у черновиков),
  версия 1, хранилища `settings` и `meta`;
* пространство имён: составной ключ `<pluginId>:<settingKey>`; все публичные
  методы принимают `pluginId` явным параметром, и знает его только хост —
  плагин не может обратиться к чужому пространству;
* значение, которое не переживает JSON-цикл, считается битым: `get`
  возвращает значение по умолчанию и пишет
  `[noto:settings] corrupted value for <id>:<key>, using default`;
* если ключ есть в схеме манифеста, значение **неверного типа** тоже
  заменяется значением по умолчанию (`[noto:settings] value for <id>:<key> has
  type …, expected …, using default`); для ключей вне схемы тип не
  проверяется и значение возвращается как есть;
* `settings.set` и `settings.reset` требуют права `settings.write`; чтение
  (`get`, `all`) — нет;
* состояние «включён/выключен» плагинов хранится в том же `meta`-хранилище
  (`getEnabledStates` / `setEnabledStates`) и переживает перезагрузку;
* библиотека `idb` подключается **динамически** (`import('idb')`), чтобы не
  попасть в стартовый бандл.

### Миграции `settingsVersion` / `settingsMigrations`

Манифест может объявить `settingsVersion: N` и карту миграций
`settingsMigrations: { '1': (value) => nextValue }`. При активации хост вызывает
`SettingsStore.migrateSettings(pluginId, target, migrations)`
(`frontend/src/core/settings/settingsStore.ts:193`):

* миграции применяются по порядку, каждая переводит одно сохранённое значение
  из версии `N` в версию `N+1`;
* если для текущей версии нет миграции, цикл прерывается, и сохранённая версия
  остаётся прежней;
* ошибка миграции одного значения не останавливает остальные: она логируется
  (`[noto:settings] migration N -> N+1 failed`), значение пропускается;
* результат миграции должен быть JSON-совместимым, иначе значение не
  записывается;
* фактическая версия схемы хранится в `meta` (`<pluginId>:settings-version`);
  миграции выполняются только если сохранённая версия меньше целевой.

Ошибка миграции **не** проваливает активацию: хост логирует
`settings migration failed` и продолжает (`frontend/src/plugins/host.ts:302-306`).

---

## 10. Жизненный цикл

### Состояния

Тип `PluginState` (`frontend/src/plugins/contract.ts:63`):

```
discovered → validated → enabled → loading → active
                                  ↘ failed
                                  ↘ incompatible
                          ↘ disabled
```

| Состояние | Когда |
| --- | --- |
| `discovered` | Манифест принят, плагин зарегистрирован (`registry.register`). |
| `validated` | Манифест и совместимость версий проверены; хост переводит плагин в это состояние перед загрузкой (`frontend/src/plugins/host.ts`, `registry.setState(id, 'validated')`). |
| `enabled` | Плагин включён, активация ещё не началась (или идёт). |
| `loading` | Хост выполняет активацию: применяются миграции настроек, затем вызывается `activate`. |
| `active` | `activate` завершился успешно. |
| `failed` | Манифест невалиден, либо `activate` бросил исключение, либо `activate` вернул отклонённый промис. |
| `disabled` | Плагин выключен (`disable` / `deactivate`). |
| `incompatible` | `minApiVersion` несовместима с текущей версией API. |

### Переходы

* `register(plugin)` — валидация манифеста, проверка дубликата `id` и
  совместимости; состояние `discovered` / `failed` / `incompatible`.
* `enable(id)` → `activate(id)` → `loading` → `active` (или `failed`).
* `disable(id)` → `deactivate(id)` → `disabled`.
* `deactivate(id)` снимает все регистрации, выполняет `plugin.deactivate?.()` и
  колбэки `onDeactivate` в обратном порядке.

### Исключение в `activate`

Хост ловит исключение (`frontend/src/plugins/host.ts`):

1. **Ошибка прав** (`PluginPermissionError`) — это не поломка плагина: хост
   логирует `plugin activation stopped by a permission error`, оставляет
   плагина в состоянии `active` (с теми регистрациями, которые он успел
   сделать) и записывает причину в реестр;
2. **Любое другое исключение** — хост логирует `plugin activation failed` с
   идентификатором плагина, снимает всё, что плагин успел зарегистрировать
   (`cleanupRuntime`), удаляет его рантайм и переводит плагина в `failed`; текст
   ошибки (`err.message`) попадает в реестр и показывается в панели плагинов.

**Ошибка не пробрасывается наружу**: приложение продолжает работать, остальные
плагины активируются штатно. То же верно для исключения в `plugin.deactivate`
(логируется и не ломает деактивацию) и для исключения в колбэке
`onDeactivate` (логируется, остальные колбэки выполняются).

### Гарантия отсутствия дублей

* Повторный `activate` одного и того же плагина игнорируется: хост проверяет
  `this.runtimes.has(id)` и выходит (`frontend/src/plugins/host.ts:109`).
* Повторная регистрация команды с тем же `id` отклоняется реестром команд.
* `deactivate` снимает всё, а `activate` снова создаёт чистое состояние, так
  что цикл activate → deactivate → activate не оставляет дублей. Это
  зафиксировано тестами «keeps exactly one command and one listener after a
  reactivate cycle» (`frontend/src/__tests__/plugin-api.test.ts`) и «does not
  duplicate registrations on repeated activate/deactivate cycles»
  (`frontend/src/__tests__/plugin-core.test.ts`).
* `PluginErrorBoundary` изолирует ошибки рендера вклад плагина.

---

## 11. Примеры

Все примеры основаны на реальном коде
(`frontend/src/plugins/builtin/word-count/index.ts`,
`frontend/src/plugins/builtin/insert-template/index.ts`).

### Минимальный плагин

```ts
// frontend/src/plugins/builtin/hello/index.ts
import type { Plugin, PluginContext, PluginManifest } from '../../contract';

export const helloManifest: PluginManifest = {
  id: 'hello',
  name: 'Hello',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  permissions: [],
};

export const helloPlugin: Plugin = {
  manifest: helloManifest,
  activate(ctx: PluginContext): void {
    ctx.logger.info('hello plugin activated');
  },
};
```

### Плагин с командой

```ts
import type { Plugin, PluginContext, PluginManifest } from '../../contract';

/** Id of the command contributed by the plugin. */
export const INSERT_TEMPLATE_COMMAND_ID = 'insert-template:insert';

export const insertTemplateManifest: PluginManifest = {
  id: 'insert-template',
  name: 'Insert Template',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description: 'Вставляет настраиваемый Markdown-шаблон в активную заметку.',
  author: 'Noto',
  permissions: ['editor.write', 'ui.contribute'],
  settings: [
    {
      key: 'template',
      label: 'Шаблон',
      type: 'string',
      default: '# Новая заметка\n\n',
      description: 'Markdown-текст, который вставляется в заметку.',
    },
  ],
};

export function createInsertTemplatePlugin(): Plugin {
  let unregisterCommand: (() => void) | null = null;

  return {
    manifest: insertTemplateManifest,
    activate(ctx: PluginContext): void {
      const unregister = ctx.registerCommand({
        id: INSERT_TEMPLATE_COMMAND_ID,
        title: 'Вставить шаблон',
        description: 'Вставляет Markdown-шаблон в активную заметку по позиции курсора.',
        run: () => runInsertTemplate(ctx),
      });
      unregisterCommand = unregister;

      ctx.onDeactivate(() => {
        unregister();
        unregisterCommand = null;
      });
    },
    deactivate(): void {
      unregisterCommand?.();
      unregisterCommand = null;
    },
  };
}
```

Обратите внимание: команда возвращает промис, поэтому `run` объявлен как
`() => void | Promise<void>`.

### Плагин с панелью

```ts
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginEditor, PluginManifest } from '../../contract';

export const wordCountManifest: PluginManifest = {
  id: 'word-count',
  name: 'Word Count',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.0.0',
  description: 'Считает слова и символы активной заметки.',
  author: 'Noto',
  permissions: ['editor.read', 'ui.contribute'],
  settings: [
    {
      key: 'countChars',
      label: 'Считать символы',
      type: 'boolean',
      default: true,
      description: 'Показывать количество символов вместе с количеством слов.',
    },
  ],
};

export const wordCountPlugin: Plugin = {
  manifest: wordCountManifest,

  async activate(ctx: PluginContext): Promise<void> {
    // The editor is live: `ctx.onEditor` is called immediately and then on
    // every change of the editor of the application.
    let off: (() => void) | null = null;

    const unsubscribe = ctx.onEditor?.((editor) => {
      off?.();
      off = null;
      if (!editor) return;
      const apply = (text: string): void => {
        const stats = { words: countWords(text), characters: Array.from(text).length };
        ctx.logger.debug('word count updated', stats);
      };
      apply(editor.getText());
      off = editor.onChange(apply);
    });

    ctx.onDeactivate(() => {
      off?.();
      off = null;
      unsubscribe?.();
    });

    ctx.registerPanel({
      id: 'word-count.panel',
      title: 'Word Count',
      render: () => h('div', { class: 'noto-word-count' }, '...'),
    });

    ctx.registerCommand({
      id: 'word-count.count',
      title: 'Word Count: показать счётчик',
      run: () => {
        ctx.logger.info('word count');
      },
    });
  },
};
```

### Использование настроек

```ts
// Чтение с fallback на значение по умолчанию из схемы.
const showChars = await ctx.settings.get<boolean>('countChars');
if (showChars === undefined) return true;   // значения ещё нет

// Запись.
await ctx.settings.set('countChars', false);

// Сброс всех настроек плагина.
await ctx.settings.reset();

// Все значения плагина (ключи схемы + сохранённые).
const all = await ctx.settings.all();
```

Правила: значение должно быть JSON-совместимым, `settings.write` объявляется
в манифесте, а чужое пространство настроек недоступно — `pluginId` известен
только хосту.

---

## 12. Что может плагин, а что — нет

| Может | Не может |
| --- | --- |
| Читать и писать заметки через `ctx.api` | Менять схему базы данных или миграции SQLite |
| Читать дерево и искать по заметкам | Обходить ревизии: `saveNote` требует актуальную ревизию и получает `409 revision_conflict` при расхождении |
| Читать и изменять текст открытой заметки через `ctx.editor` | Заменить документ целиком в обход автосохранения (`setText` отсутствует в контракте) |
| Вкладываться в UI: панель, сайдбар, контекстное меню, тулбар, секция настроек, команда | Зарегистрировать вкладку, точку вклада или команду по идентификатору из пользовательского ввода |
| Хранить свои настройки в пространстве `<pluginId>:*` | Читать или писать чужое пространство настроек |
| Подписываться на события `note.*`, `folder.*`, `editor.*`, `workspace.opened` | Получить содержимое заметки из payload события — там только пути и метаданные |
| Выполнить операцию, на которую объявил право | Выполнить операцию без нужного права: будет `PluginPermissionError` (кроме сетевых вызовов мимо API — их enforcement не покрывает) |
| Импортировать `src/plugins/contract.ts` и свои собственные файлы | Импортировать `src/api/client.ts`, `src/core/**` или модули другого плагина (правила R3, R8 проверяются скриптом) |
| Узнать состояние хранилища через `ctx.vault` / `ctx.api.vault` (API 1.1.0) | Получить мастер-пароль, KEK или DEK: в состоянии их нет, а импорт крипто-ядра запрещён правилами R11 и R12 |
| Выполняться как встроенный код приложения | Загружать удалённый JS: `import()`, `import.meta.glob`, `eval` и `new Function` в плагинах не используются и не поддерживаются |

---

## 13. Журнал аудита действий плагинов (API 1.3.0)

Каждое действие плагина записывается в журнал аудита: идентификатор
плагина, действие, момент и цель.

| Действие | Когда записывается | Пример цели |
| --- | --- | --- |
| `read` | Плагин прочитал данные хранилища (`getNote`, `getTree`, `search`, `query`, `tags`) | `notes/alpha.md`, `tree`, `query:path != ""` |
| `write` | Плагин записал заметку (`saveNote`) | `notes/alpha.md` |
| `open` | Плагин попросил открыть заметку (`ctx.openNote`) | `notes/alpha.md` |
| `command` | Плагин выполнил зарегистрированную команду | `backlinks.show` |

Журнал — ограниченное кольцо на 500 записей
(`PluginAuditLog`, `frontend/src/plugins/audit.ts`): когда он переполняется, самая
старая запись вытесняется. Запись **никогда** не содержит содержимого заметки —
только путь, вид запроса и идентификатор команды.

Журнал показывает панель управления плагинами
(`PluginManagerPanel`, свойство `audit`).

---

## 14. Где искать ещё

* Модель доверия, ограничения и что **не** защищает enforcement:
  [PLUGIN_SECURITY.md](PLUGIN_SECURITY.md).
* Как создать плагин, какие тесты обязательны, как отлаживать:
  [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md).
* Архитектурные правила импортов: `frontend/scripts/check-boundaries.mjs`.
* Бэкенд-точка расширения: `backend/internal/notes/noteapi.go`.
* Механизм песочницы и мост: `frontend/src/plugins/sandbox.ts`.
* Журнал аудита: `frontend/src/plugins/audit.ts`.
* Установка плагинов из файла и из URL: `frontend/src/plugins/loader.ts`.
