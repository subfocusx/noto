# Пакет `sqlitestore`

## Назначение

Реализация `port.Store` поверх SQLite (`modernc.org/sqlite`, чистый Go, без
cgo): метаданные заметок, полнотекстовый индекс FTS5 с запасным вариантом
`LIKE`, вложения, корзина, схема и её миграции (`PRAGMA user_version`).

## Публичные типы и функции

| Имя | Что это |
|---|---|
| `Store` | Реализация `port.Store` поверх SQLite. |
| `Open(ctx, dbPath)` | Открывает (или создаёт) базу и применяет миграции. |
| `New(ctx, db)` | Создаёт хранилище поверх уже открытого `*sql.DB`. |

## Что нельзя импортировать отсюда

* `sqlitestore` не импортируется из `internal/notes` — домен знает только
  `port.Store`;
* `sqlitestore` не импортируется из `internal/api`;
* запросы собираются только с параметрами: склейка строк с пользовательскими
  данными запрещена (`internal/notes` и `internal/api` — тоже);
* `schemaVersion`, `schemaStatements`, `fts5TableStatement` — внутренние
  детали схемы; их изменение требует правки `schema_compat_test.go`.

## Проверка

`go test ./internal/sqlitestore` (включая `schema_compat_test.go`) ·
`go run ./cmd/smoke`.
