// Command noto starts the Noto server: the REST API and the single page
// application.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"noto/backend/internal/api"
	"noto/backend/internal/config"
	"noto/backend/internal/notes"
	"noto/backend/internal/sqlitestore"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "noto:", err)
		os.Exit(1)
	}
}

// run starts the server and blocks until the process is asked to stop.
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	listenAddr, err := resolveListenAddr(cfg)
	if err != nil {
		return err
	}
	if err := cfg.EnsureDirs(); err != nil {
		return err
	}
	logger := newLogger(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := sqlitestore.Open(ctx, cfg.DBPath)
	if err != nil {
		return fmt.Errorf("cannot open the database: %w", err)
	}
	defer func() {
		if cerr := store.Close(); cerr != nil {
			logger.Error("cannot close the database", "err", cerr)
		}
	}()

	svc, err := notes.NewService(cfg, store)
	if err != nil {
		return fmt.Errorf("cannot create the notes service: %w", err)
	}

	// Make sure the search index matches the notes directory.
	if count, err := svc.Reindex(ctx); err != nil {
		logger.Warn("cannot rebuild the search index", "err", err)
	} else {
		logger.Info("search index is up to date", "indexed", count)
	}

	apiServer, err := api.New(cfg, svc, logger)
	if err != nil {
		return fmt.Errorf("cannot create the API server: %w", err)
	}

	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       cfg.RequestTimeout,
		WriteTimeout:      cfg.RequestTimeout,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	printBanner(cfg, listenAddr, logger)

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server started", "addr", listenAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown failed: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

// newLogger builds the structured logger of the server.
func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}

// resolveListenAddr returns the address the server listens on.
//
// The host of the configured address decides whether the server is reachable
// from the network. An empty host (":8139") listens on every interface, so
// it is not a loopback address and the server refuses to start unless
// NOTO_ALLOW_PUBLIC is set.
func resolveListenAddr(cfg config.Config) (string, error) {
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		return "", fmt.Errorf("the listen address %q is invalid: %w", cfg.Addr, err)
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		if !cfg.AllowPublic {
			return "", fmt.Errorf("refusing to listen on %q: an address without a host listens on every "+
				"interface and the API has no authentication. Bind to 127.0.0.1:%s or set "+
				"NOTO_ALLOW_PUBLIC=true if you understand the risk", cfg.Addr, port)
		}
		return cfg.Addr, nil
	}
	if !isLoopbackHost(host) && !cfg.AllowPublic {
		return "", fmt.Errorf("refusing to listen on %q: the API has no authentication. "+
			"Bind to a loopback address or set NOTO_ALLOW_PUBLIC=true if you understand the risk", cfg.Addr)
	}
	return cfg.Addr, nil
}

// isLoopbackHost reports whether the host part of a listen address is a
// loopback address.
func isLoopbackHost(host string) bool {
	host = strings.ToLower(strings.Trim(host, "[]"))
	switch host {
	case "localhost":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// printBanner writes the startup information to the console.
func printBanner(cfg config.Config, listenAddr string, logger *slog.Logger) {
	fmt.Println("Noto is starting")
	fmt.Printf("  URL:      http://%s\n", listenAddr)
	fmt.Printf("  Data dir: %s\n", cfg.DataDir)
	fmt.Printf("  Notes:    %s\n", cfg.NotesDir)
	if !isLoopbackHost(hostOf(listenAddr)) {
		fmt.Println("  WARNING: the server is not bound to a loopback address and the API has no authentication.")
		fmt.Println("           Only run it behind a trusted reverse proxy.")
	}
	logger.Info("configuration loaded", "addr", listenAddr, "data_dir", cfg.DataDir)
}

// hostOf returns the host part of an address.
func hostOf(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}
