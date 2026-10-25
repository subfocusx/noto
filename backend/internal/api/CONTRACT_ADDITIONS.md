# Additions to the contract of the API

This file holds the endpoints that were added by the phases A26 (the
webhooks), A27 (the MCP over HTTP), A28 (the authentication, the accounts and
the multi-user mode) and A31 (the TLS termination). It is meant to be merged
into `docs/CONTRACT.md` (§3 "REST API" and §5 "Security rules") and into
`docs/API.md`.

The envelopes, the codes and the conventions are the ones of the contract:
every answer of the REST API uses `{"error":{"code":...,"message":...}}` for a
failure, the codes are the stable ones of §3, and the JSON bodies are UTF-8.

## The error codes of the new endpoints

The contract has no code for a failed authentication. The closest existing
code is `forbidden`, and it is used with the status `401 Unauthorized`:

| Situation | Status | Code |
| --- | --- | --- |
| the credentials are missing, wrong or expired | `401` | `forbidden` |
| the role of the user is not enough | `403` | `forbidden` |
| the last administrator would be removed or demoted | `409` | `conflict` |
| the name of an account is already taken | `409` | `conflict` |
| the account does not exist | `404` | `not_found` |
| the url or the event of a subscription is invalid | `400` | `bad_request` |
| the authentication is disabled (local single user mode) | `403` | `forbidden` |

**To be merged into the list of §3:** add `unauthenticated` (status `401`) to
the stable codes, so that the failed authentication no longer borrows
`forbidden`.

## The authentication (A28)

* `POST /api/auth/login` — body `{"name":"...","password":"..."}`
  → `200 {"token":"...","user":User,"expiresAt":"RFC3339"}`.
  The session is also written in the cookie `noto_session` (`HttpOnly`,
  `SameSite=Lax`), so that the browser works without a token.
  A wrong name or password → `401 forbidden`.
* `POST /api/auth/logout` → `200 {"ok":true}`. The session of the request is
  removed and the cookie is cleared.
* `GET /api/auth/me` → `200 {"user":{"id":"","name":"...","role":"admin|user"},"authenticated":bool}`.

The credentials are sent with the standard header
`Authorization: Bearer <token>` or with the cookie `noto_session`.

When the authentication is disabled (the default), every request is served as
the local user `local` with the role `admin`, and `GET /api/auth/me` answers
with `"authenticated": false`. The endpoints of the accounts then answer with
`403 forbidden`.

### The accounts (the administrator only)

* `GET /api/users` → `200 {"users":[User]}`
* `POST /api/users` — body `{"name":"...","password":"...","role":"admin|user"}`
  → `200 User`. The role defaults to `user`.
* `DELETE /api/users/{id}` → `200 {"ok":true}`. The last administrator cannot
  be removed → `409 conflict`.
* `POST /api/users/{id}/role` — body `{"role":"admin|user"}` → `200 User`.
  The last administrator cannot be demoted → `409 conflict`.

`User` is `{"id":"...","name":"...","role":"admin|user","createdAt":"RFC3339"}`.

## The audit log (A29)

* `GET /api/audit?limit=100&action=...&user=...` → `200 {"entries":[Entry]}`.
  Only an administrator reads it. `limit` is optional (100 by default, 1000 at
  most); `action` and `user` filter the entries.

`Entry` is `{"id":1,"time":"RFC3339","user":"...","action":"note.updated","target":"a.md","result":"ok"}`.

The actions are `note.created`, `note.updated`, `note.renamed`, `note.moved`,
`note.deleted`, `note.restored`, `note.imported`, `file.created` and
`folder.created`. The result is `ok` or `error`. The log never holds the
content of a note: only the identifiers.

## The webhooks (A26)

* `GET /api/webhooks` → `200 {"subscriptions":[Subscription]}`. An
  administrator may ask for the subscriptions of every user with `?all=true`.
* `POST /api/webhooks` — body `{"url":"https://...","events":["note.created",...]}`
  → `200 Subscription`. The answer carries the `secret` of the subscription:
  it is the only time the secret leaves the server. An empty list of events
  means every event.
* `DELETE /api/webhooks/{id}` → `200 {"ok":true}`.
* `GET /api/webhooks/deliveries?limit=100` → `200 {"deliveries":[Delivery]}`.
* `POST /api/webhooks/deliveries/{id}/redeliver` → `200 {"ok":true}`. The
  delivery goes back into the outbox.

`Subscription` is `{"id":"...","owner":"...","url":"...","events":[...],"secret":"...","createdAt":"RFC3339"}`.
The `secret` is empty in every answer but the creation.

`Delivery` is `{"id":1,"subscriptionId":"...","event":"note.created","payload":"{...}","state":"pending|delivered|failed","attempts":0,"nextAttempt":"RFC3339","lastError":"...","createdAt":"RFC3339"}`.

The events are `note.created`, `note.updated`, `note.deleted`, `note.renamed`,
`note.moved` and `note.restored`.

The guard against the server side request forgery: only `https` is accepted,
and a plain `http` is only accepted for a loopback address (`localhost`,
`127.0.0.1`, `::1`). Every other url → `400 bad_request`.

The delivery is a `POST` with the body of the event, the header
`X-Noto-Signature: sha256=<hexadecimal HMAC-SHA256 of the body with the
secret of the subscription>`, the header `X-Noto-Event` and the header
`X-Noto-Delivery`. A delivery that fails is retried with a backoff
(30 s, 60 s, 120 s…) and is marked as `failed` after five attempts.

## The MCP over HTTP (A27)

* `POST /api/mcp` — the body is a JSON-RPC 2.0 request or a batch of
  requests. The answer is the raw JSON of the protocol (the envelope of the
  REST API is not used).

The methods are `initialize`, `tools/list` and `tools/call`. The tools are
`notes.list`, `notes.read`, `notes.create`, `notes.update`, `notes.delete`
and `notes.search`.

The errors of the protocol follow JSON-RPC 2.0: `-32700` (parse), `-32600`
(invalid request), `-32601` (unknown method), `-32602` (invalid params, and
an unknown tool) and `-32603` (internal error).

## The TLS (A31)

The server serves HTTPS when the environment sets `NOTO_TLS_CERT_FILE` and
`NOTO_TLS_KEY_FILE`. Nothing changes in the API: the routes, the envelopes
and the codes are the same over HTTPS.

The other variables of the phases:

| Variable | Meaning | Default |
| --- | --- | --- |
| `NOTO_AUTH_ENABLED` | the authentication is required | `false` |
| `NOTO_CREDENTIALS_PATH` | the SQLite file of the accounts | `<data>/credentials.db` |
| `NOTO_SESSION_TTL_SEC` | the lifetime of a session | `86400` |
| `NOTO_AUDIT_PATH` | the SQLite file of the audit log | `<data>/audit.db` |
| `NOTO_WEBHOOKS_PATH` | the SQLite file of the webhooks | `<data>/webhooks.db` |
| `NOTO_ADMIN_PASSWORD` | the password of the first administrator | generated |
| `NOTO_TLS_CERT_FILE` | the certificate of the server | — |
| `NOTO_TLS_KEY_FILE` | the key of the certificate | — |

The accounts, the audit log and the webhooks keep their own SQLite file
inside the data directory of the vault. They are deliberately independent from
the database of the notes: the notes stay readable when the credentials are
lost.

## The security rules to be added to §5

* Every endpoint of the API except `GET /api/health` and
  `POST /api/auth/login` needs valid credentials when the authentication is
  enabled. The credentials are the header `Authorization: Bearer <token>` or
  the cookie `noto_session`.
* The endpoints of the accounts and the audit log need the role `admin`.
* The password of an account is stored with PBKDF2-HMAC-SHA256 (600 000
  iterations) and a random salt. The repository has no dependency on
  `golang.org/x/crypto`, so the derivation is implemented with the standard
  library; the encoded hash is self describing, so the parameters can be
  raised later.
* The secret of a webhook subscription is generated by the server and never
  returned in clear after the creation of the subscription.
