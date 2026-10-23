# Noto — security model

This document describes what Noto protects against, what it does **not**
protect against, and how to harden a deployment. The authoritative rules live
in `docs/CONTRACT.md` section 5.

## The one thing to understand first

**Noto has no user accounts.** There is no registration, no login, no
password, no session, no token and no per-user data model. The server treats
every request that reaches it as a fully privileged request from the owner of
the notes.

The consequence is simple and absolute:

> Anyone who can open a TCP connection to the Noto server can read, write,
> delete and export every note.

Everything below is either a mitigation of that fact or an explicit refusal
to pretend the problem does not exist. CORS headers are **not** an
authentication mechanism — a browser-side policy that a non-browser client
ignores entirely.

## Threat model

### In scope — the server defends against these

| Threat | Mitigation |
| --- | --- |
| Accidental exposure to the local network | The server binds `127.0.0.1:8080` by default. Binding a non-loopback address without `NOTO_ALLOW_PUBLIC=true` is refused at startup with a clear error. An address without a host (`NOTO_ADDR=":8080"`) is **not** loopback and is therefore refused as well; the startup banner always prints the effective listen address. |
| Path traversal (`../`, absolute paths, drive letters, NUL bytes, backslashes) | All client-supplied paths are normalised with `path.Clean` and rejected when they are absolute, contain `..` or empty segments, contain a drive letter, a backslash or a NUL byte, or escape the notes root after cleaning. The resolved absolute path must still have the notes root as prefix. |
| Symlink or Windows junction escape | Every component of a resolved path is checked. Symbolic links **and Windows reparse points / junctions** inside the notes root are never followed out of it: the component is refused with `invalid_path` for reads, writes, deletes, moves, imports and exports. |
| Zip-slip during import | Archive entries with absolute paths, `..` segments or symlinks are rejected. Each entry is capped by `NOTO_MAX_UPLOAD_MB`, the cumulative number of extracted bytes is capped by `NOTO_MAX_ARCHIVE_MB` and the entry count is capped. |
| Malicious attachment uploads | The content type is sniffed from the bytes (`http.DetectContentType`), not taken from the client. Only PNG, JPEG, GIF, WebP, SVG, PDF and plain text are accepted. The stored name and mime type are generated server side. Attachments are served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. |
| XSS through the markdown preview | Rendered HTML is sanitised with DOMPurify in the frontend; raw HTML from notes is never injected. The server also sends a restrictive `Content-Security-Policy` with `script-src 'self'`. |
| Clickjacking and MIME sniffing | Every response carries `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`. |
| Cross-site request forgery from a browser on another origin | No `Access-Control-Allow-Origin` header is sent by default. A state-changing request whose `Origin` is **same-origin** (host:port equal to the request `Host`, default ports normalised) or whose `Origin` is absent is allowed; a request with a foreign `Origin` is rejected with `403 forbidden`. The `Host` header must be `localhost`, `127.0.0.1`, `::1` or an explicitly allowed host. |
| Oversized requests and zip bombs | `http.MaxBytesReader` bounds every request body, including the total size of a multipart upload (`NOTO_MAX_UPLOAD_MB`); archives have a separate uncompressed-size cap. |
| Lost updates from concurrent writes | Every note carries a revision. A write with a stale revision is rejected with `409 revision_conflict` and the current server copy is returned instead of being overwritten. Renaming or moving a folder takes a hierarchical lock that also covers writes inside it, so a concurrent write can never split the tree. A write to a note that was moved away returns `409 conflict`, and a write to a missing parent folder returns `not_found` instead of re-creating the folder. |
| Information disclosure through error messages | Errors return a stable code and a short message. Stack traces and absolute server paths are never returned; they are logged server side. Note contents are never logged. |
| Private API payloads surviving in the browser cache | The service worker serves every `/api/*` route `network-only` (`frontend/public/sw.js`): a private response is never written to a cache, an offline request fails with an explicit `503 network_error` envelope instead of a stale body, and a successful mutation purges any leftover private-API cache. Only static assets and the app shell are cached. |
| Resource exhaustion from a slow client | Every request is bounded by `NOTO_REQUEST_TIMEOUT_SEC` and shutdown by `NOTO_SHUTDOWN_TIMEOUT_SEC`. |

### Out of scope — the server does **not** defend against these

* **Unauthenticated access.** There is no login. Network reachability is
  equivalent to full access.
* **A malicious local user** on the same machine who can read the data
  directory or the notes directly.
* **A malicious browser extension** running in the same browser profile.
* **Traffic interception** on a non-HTTPS deployment. Note bodies and
  attachments travel in clear text unless you terminate TLS in front of Noto.
* **Physical access** to the machine or the disk image.
* **Multi-user operation.** The data model has no user dimension; two people
  sharing one server share one notebook.
* **Encryption at rest.** Notes, attachments and the SQLite database are
  stored unencrypted. Use full-disk encryption (BitLocker, LUKS, FileVault)
  if that matters.
* **Audit logging.** There is no record of who changed what.
* **A malicious built-in plugin.** Plugins run as trusted code inside the
  application; see the section below.

## Plugins

Phase 2 added a plugin platform. The short version: **a built-in plugin is
trusted code, not a sandboxed extension.** The full model is in
[`docs/PLUGIN_SECURITY.md`](PLUGIN_SECURITY.md).

* **Trust model.** Built-in plugins are compiled into the application and
  execute in the same context as the app itself. There is **no** iframe
  sandbox, no separate origin, no separate process and no capability
  sandboxing. The plugin management screen says so explicitly.
* **Permissions are enforced at runtime.** A manifest may request eight
  permissions (`notes.read`, `notes.write`, `tree.read`, `search.read`,
  `editor.read`, `editor.write`, `ui.contribute`, `settings.write`). The
  manifest validator rejects unknown names and duplicates, and every capability
  handed to a plugin checks the declared rights before the call: a refusal
  raises a `PluginPermissionError` (`frontend/src/core/api/pluginApi.ts`,
  `frontend/src/plugins/host.ts`). The checks cover the data API, the editor,
  the UI contributions and the settings; they do **not** cover network requests
  the plugin makes itself (`fetch` is still available to it), and there is no
  sandbox.
* **No dynamic loading.** There is no `eval`, no `new Function`, no dynamic
  `import()` by a runtime path, no `import.meta.glob` and no remote code
  loading in `frontend/src/plugins/**`. The list of plugins is a static array
  (`frontend/src/plugins/loader.ts`); plugin ids are never used as a path or a
  module specifier, and a plugin cannot register itself under an id that comes
  from user input.
* **No plugin installation from disk or the network.** Only built-in plugins
  exist in this phase. User-supplied plugins with an iframe sandbox and a
  strict CSP are a possible future phase, not a current feature.
* **Data integrity is still enforced.** A plugin writes only through
  `ctx.api.saveNote(path, content, revision)`, i.e. with optimistic locking:
  a stale revision is rejected with `409 revision_conflict` and the current
  server copy is returned, so a plugin cannot silently overwrite someone
  else's edit. Note events are emitted after the operation succeeded.
* **Private API responses are never cached.** Because `/api/*` is
  `network-only`, data a plugin fetched through the API does not survive
  offline in a cache.

Because plugins are trusted code, the practical mitigation is the supply chain:
plugins live in this repository, are reviewed like any other code and are
covered by the same tests and boundary checks (`npm run check:boundaries`).

## Hardening checklist

Work through this before putting Noto on a network you do not fully control.

1. **Keep the default bind address.** `NOTO_ADDR` should stay
   `127.0.0.1:8080`. Only change it when a reverse proxy or VPN terminates
   the connection.
2. **Do not set `NOTO_ALLOW_PUBLIC=true` unless you understand why.** It only
   disables the localhost-only startup guard; it adds no protection.
3. **Put an authenticating reverse proxy in front of Noto** if it must be
   reachable from anywhere other than this machine. The proxy must enforce
   authentication (HTTP Basic with a strong password, or an OIDC/OAuth
   provider such as Authelia, oauth2-proxy or Cloudflare Access).
4. **Terminate TLS.** Noto does not serve HTTPS itself. Use Caddy or nginx to
   terminate TLS and proxy to `127.0.0.1:8080`. Browsers only install a
   service worker over HTTPS (or `localhost`), so the Android PWA install
   also requires it.
5. **Restrict CORS.** Leave `NOTO_ALLOWED_ORIGINS` empty unless a separate
   front-end origin genuinely needs to call the API. Listing an origin means
   "this browser origin may send API requests" — it is not an access control.
6. **Limit request sizes** to what you actually need via
   `NOTO_MAX_UPLOAD_MB` and `NOTO_MAX_ARCHIVE_MB`.
7. **Encrypt the disk** that holds the data directory.
8. **Back up the data directory** regularly and keep at least one copy off the
   machine (see `README.md` → Backup and restore).
9. **Run as a non-privileged user.** The Docker image already runs as the
   unprivileged `noto` user.
10. **Keep the data directory out of version control.** `.gitignore` excludes
    `noto-data/`, `*.db`, `*.db-wal` and `*.db-shm`.

## Reverse proxy examples

The proxy is the security boundary. Noto behind it is only as safe as the
proxy's authentication.

### Caddy

Caddy obtains and renews TLS certificates automatically. The
`basicauth` directive protects the whole site.

```caddyfile
notes.example.com {
    basicauth {
        # bcrypt hash, not the plain password
        # generate with: caddy hash-password --plaintext 'your-password'
        you $2a$14$REPLACE_WITH_THE_HASH_FROM_CADDY_HASH_PASSWORD
    }

    reverse_proxy 127.0.0.1:8080 {
        # Noto validates the Host header itself; keep it intact.
        header_up Host {host}
    }
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    ssl_certificate     /etc/letsencrypt/live/notes.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

    # Basic auth is the simplest option. Prefer an OIDC proxy in production.
    auth_basic "Noto";
    auth_basic_user_file /etc/nginx/.htpasswd;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name notes.example.com;
    return 301 https://$host$request_uri;
}
```

With a reverse proxy the host header check in Noto must accept the public
name. Either run Noto on `127.0.0.1:8080` and allow the proxy's `Host`
explicitly, or set `NOTO_ALLOWED_ORIGINS` to the exact public origin
(`https://notes.example.com`) so browser requests are accepted while
cross-origin requests from other sites are still rejected.

## VPN alternative

If Noto should only be reachable from your own devices, skip the public
reverse proxy and expose it over a VPN instead:

* Run Tailscale, WireGuard or ZeroTier on the host and on the client devices.
* Keep `NOTO_ADDR=127.0.0.1:8080` and forward the VPN address to that port,
  or set `NOTO_ADDR` to the VPN interface address together with
  `NOTO_ALLOW_PUBLIC=true`.

The VPN becomes the authentication boundary, and it is a much better one than
a shared password in front of a read/write API.

## Reporting a vulnerability

This is a personal, self-hosted project with no published disclosure process.
If you find a security issue, open an issue in the repository describing the
reproduction steps, or patch it locally and open a pull request.
