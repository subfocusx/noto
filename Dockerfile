# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the Preact frontend with Node.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
# `npm run build` also runs scripts/copy-dist.mjs, which copies frontend/dist
# into backend/internal/web/dist so the Go binary can embed the SPA.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — build the Go binary with the frontend embedded.
# ---------------------------------------------------------------------------
FROM golang:1.23-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum* ./
RUN go mod download
COPY backend/ ./
# Overwrite the placeholder embedded assets with the real frontend build.
COPY --from=frontend /src/frontend/dist/ ./internal/web/dist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/noto ./cmd/noto
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/backup ./cmd/backup

# ---------------------------------------------------------------------------
# Stage 3 — minimal runtime image.
# ---------------------------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -S noto && adduser -S -G noto noto \
    && mkdir -p /data && chown -R noto:noto /data
COPY --from=backend /out/noto /usr/local/bin/noto
COPY --from=backend /out/backup /usr/local/bin/backup
USER noto
ENV NOTO_ADDR=0.0.0.0:8080 \
    NOTO_DATA_DIR=/data \
    NOTO_ALLOW_PUBLIC=true \
    NOTO_LOG_LEVEL=info
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/noto"]
