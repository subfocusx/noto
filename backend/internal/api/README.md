# Пакет `api`

## Назначение

HTTP-слой Noto: маршрутизация, декодирование JSON, middleware (безопасность,
лимиты тела, origin/host), конверт ошибок и раздача статики. Пакет **не
знает** о домене: он переводит HTTP в вызовы `notes.Service` и обратно.

## Публичные типы и функции

| Имя | Что это |
|---|---|
| `Server` | HTTP-сервер Noto (роутер + middleware). |
| `New(cfg, svc, logger)` | Создаёт сервер. |
| `NewWithFactory(cfg, svc, logger, factory)` | То же, но сервис создаётся фабрикой (нужно для запечатанного режима). |
| `ServiceFactory` | Фабрика `*notes.Service`. |
| `Version` | Версия сборки пакета (отдаётся в `GET /api/health`). |
| `CodeVaultSealed` | Код ошибки `vault_sealed`. |
| `MaintenanceEnabledEnv` | Имя переменной окружения `NOTO_MAINTENANCE`. |

## Что нельзя импортировать отсюда

* `api` не импортируется из `internal/notes`, `internal/port` и
  `internal/sqlitestore` — зависимость строго `api → notes → port`;
* `api` не импортируется из `cmd/*`, кроме `cmd/noto` (точка входа);
* внутренние хелперы (`writeJSON`, `decodeJSON`, `statusFor`) намеренно
  не экспортированы: их нельзя вызывать извне пакета.

## Проверка

`go test ./internal/api` · `go run ./cmd/smoke` — контракт описан в
`docs/CONTRACT.md`, проверяется `contract_test.go`.
