# Пакет `web`

## Назначение

Раздача интерфейса: встроенная сборка фронтенда (`backend/internal/web/dist`,
наполняется `npm run build` в `frontend/`) либо каталог из
`NOTO_STATIC_DIR`, с SPA-маршрутизацией (любой неизвестный путь отдаёт
`index.html`) и правильными MIME-типами.

## Публичные типы и функции

| Имя | Что это |
|---|---|
| `Handler(staticDir)` | HTTP-обработчик статики и SPA. |
| `distFS` / `placeholderFS` | встроенные файлы: собранный фронтенд и заглушка (внутренние, но доступны пакету). |

## Что нельзя импортировать отсюда

* `web` не импортируется из `internal/notes`, `internal/port` и
  `internal/sqlitestore` — это лист графа;
* `web` не импортируется из `internal/api`: подключение обработчика делает
  `cmd/noto`;
* встроенную сборку фронтенда нельзя править руками: она перезаписывается
  при каждой сборке (`frontend/scripts/copy-dist.mjs`).

## Проверка

`go test ./internal/web` · `npm run build` в `frontend/` перед
`go build ./...` · `docs/DESIGN_SYSTEM.md`.
