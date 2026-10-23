// Command noto starts the Noto server: the REST API and the single page
// application.
//
// The command without a subcommand starts the server. The subcommand
// "reconcile" compares the notes directory with the database, the subcommand
// "restore" restores a backup archive into a data directory.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
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
	"noto/backend/internal/restore"
	"noto/backend/internal/sqlitestore"
	"noto/backend/internal/vault"
)

// serve starts the server. It is a variable so that the tests can replace it
// and check the dispatch of the command line without starting a server.
var serve = runServer

func main() {
	os.Exit(run(context.Background(), os.Args[1:]))
}

// run dispatches the command line and returns the exit code of the process.
func run(ctx context.Context, args []string) int {
	if len(args) > 0 {
		switch args[0] {
		case "reconcile":
			return runReconcile(args[1:])
		case "restore":
			return runRestore(ctx, args[1:], os.Stdout)
		case "help", "-h", "--help":
			usage(os.Stdout)
			return 0
		default:
			fmt.Fprintf(os.Stderr, "noto: unknown command %q\n\n", args[0])
			usage(os.Stderr)
			return 1
		}
	}
	if err := serve(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "noto:", err)
		return 1
	}
	return 0
}

// usage writes the help of the command.
func usage(w io.Writer) {
	fmt.Fprintln(w, "noto - the notes server")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  noto                     start the server")
	fmt.Fprintln(w, "  noto reconcile [flags]   compare the notes directory with the database")
	fmt.Fprintln(w, "  noto restore [flags]     restore a backup archive into a data directory")
	fmt.Fprintln(w, "  noto help                show this help")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Flags of the reconcile command:")
	fmt.Fprintln(w, "  --apply        create the metadata rows of the files without a row")
	fmt.Fprintln(w, "  --drop-ghosts  delete the metadata rows without a file")
	fmt.Fprintln(w, "  --dry-run      report the differences without changing anything")
	fmt.Fprintln(w, "  --json         print the report as JSON")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Flags of the restore command:")
	fmt.Fprintln(w, "  -in <file>     path of the backup archive to restore (required)")
	fmt.Fprintln(w, "  -data <dir>    override the data directory (default: the configured one)")
	fmt.Fprintln(w, "  -dry-run       only report what would be restored, change nothing")
	fmt.Fprintln(w, "  -force         restore even when the target directory already contains data")
}

// restoreUsage writes the help of the restore subcommand.
func restoreUsage(w io.Writer) {
	fmt.Fprintln(w, "noto restore - restore a backup archive into a data directory")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  noto restore -in <archive> [-data <dir>] [-dry-run] [-force]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Flags:")
	fmt.Fprintln(w, "  -in <file>     path of the backup archive to restore (required)")
	fmt.Fprintln(w, "  -data <dir>    override the data directory (default: the configured one)")
	fmt.Fprintln(w, "  -dry-run       only report what would be restored, change nothing")
	fmt.Fprintln(w, "  -force         restore even when the target directory already contains data")
}

// runRestore restores a backup archive into a data directory. It returns the
// exit code of the process.
func runRestore(ctx context.Context, args []string, out io.Writer) int {
	fs := flag.NewFlagSet("restore", flag.ContinueOnError)
	fs.SetOutput(out)
	fs.Usage = func() { restoreUsage(out) }
	in := fs.String("in", "", "path of the backup archive to restore (required)")
	dataDir := fs.String("data", "", "override the data directory (default: the configured one)")
	dryRun := fs.Bool("dry-run", false, "only report what would be restored, change nothing")
	force := fs.Bool("force", false, "restore even when the target directory already contains data")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 1
	}
	if strings.TrimSpace(*in) == "" {
		fmt.Fprintln(os.Stderr, "noto restore: the -in flag is required")
		return 1
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto restore:", err)
		return 1
	}

	report, err := restore.Run(ctx, cfg, restore.Options{
		ArchivePath: *in,
		DataDir:     *dataDir,
		DryRun:      *dryRun,
		Force:       *force,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto restore:", err)
		return 1
	}
	restore.PrintReport(out, report)
	return 0
}

// runReconcile compares the notes directory with the database and prints the
// report. It returns the exit code of the process.
func runReconcile(args []string) int {
	fs := flag.NewFlagSet("reconcile", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	apply := fs.Bool("apply", false, "create the metadata rows of the files without a row")
	dropGhosts := fs.Bool("drop-ghosts", false, "delete the metadata rows without a file")
	dryRun := fs.Bool("dry-run", false, "report the differences without changing anything")
	asJSON := fs.Bool("json", false, "print the report as JSON")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 1
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto reconcile:", err)
		return 1
	}
	if err := cfg.EnsureDirs(); err != nil {
		fmt.Fprintln(os.Stderr, "noto reconcile:", err)
		return 1
	}

	ctx := context.Background()
	store, err := sqlitestore.Open(ctx, cfg.DBPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto reconcile: cannot open the database:", err)
		return 1
	}
	defer func() {
		if cerr := store.Close(); cerr != nil {
			fmt.Fprintln(os.Stderr, "noto reconcile: cannot close the database:", cerr)
		}
	}()

	svc, err := notes.NewService(cfg, store)
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto reconcile: cannot create the notes service:", err)
		return 1
	}

	report, err := svc.ReconcileWithOptions(ctx, notes.ReconcileOptions{
		Apply:      *apply,
		DropGhosts: *dropGhosts,
		DryRun:     *dryRun,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "noto reconcile:", err)
		return 1
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			fmt.Fprintln(os.Stderr, "noto reconcile:", err)
			return 1
		}
		return 0
	}

	fmt.Printf("checked:    %d entries\n", report.Checked)
	fmt.Printf("missing in the database: %d\n", len(report.MissingInDB))
	for _, p := range report.MissingInDB {
		fmt.Println("  +", p)
	}
	fmt.Printf("missing on the disk:    %d\n", len(report.MissingOnDisk))
	for _, p := range report.MissingOnDisk {
		fmt.Println("  -", p)
	}
	fmt.Printf("metadata drift:         %d\n", len(report.MetadataDrift))
	for _, d := range report.MetadataDrift {
		fmt.Println("  ~", d)
	}
	if len(report.Restored) > 0 {
		fmt.Printf("restored:               %d\n", len(report.Restored))
		for _, p := range report.Restored {
			fmt.Println("  +", p)
		}
	}
	if len(report.Dropped) > 0 {
		fmt.Printf("dropped:                %d\n", len(report.Dropped))
		for _, p := range report.Dropped {
			fmt.Println("  -", p)
		}
	}
	for _, n := range report.Notes {
		fmt.Println("note:", n)
	}
	return 0
}

// runServer starts the server and blocks until the process is asked to stop.
func runServer(ctx context.Context) error {
	baseCfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := newLogger(baseCfg.LogLevel)
	vaultPath, cfg, err := resolveVault(baseCfg, logger)
	if err != nil {
		return err
	}
	// A storage that was fixed by the environment cannot be changed at
	// runtime, but the user does not have to choose a folder either.
	vaultFixed := vaultFixedByEnv()
	listenAddr, err := resolveListenAddr(cfg)
	if err != nil {
		return err
	}
	if err := cfg.EnsureDirs(); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	factory := newServiceFactory(ctx, baseCfg)
	svc, closer, err := factory(vaultPath)
	if err != nil {
		return fmt.Errorf("cannot create the notes service: %w", err)
	}

	// Make sure the search index matches the notes directory.
	if count, err := svc.Reindex(ctx); err != nil {
		logger.Warn("cannot rebuild the search index", "err", err)
	} else {
		logger.Info("search index is up to date", "indexed", count)
	}

	apiServer, err := api.NewWithFactory(cfg, svc, logger, factory)
	if err != nil {
		closer()
		return fmt.Errorf("cannot create the API server: %w", err)
	}
	apiServer.SetServiceCloser(closer)
	apiServer.SetVaultPath(vaultPath)
	apiServer.SetVaultFixed(vaultFixed)
	defer apiServer.Close()

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

// resolveVault returns the vault the server has to serve and the effective
// configuration.
//
// The environment variables NOTO_DATA_DIR and NOTO_NOTES_DIR have priority
// over the stored vault configuration, so that a test or a CI job can run the
// server in a temporary directory. Such a run uses the default layout and not
// the layout of a vault.
//
// The environment only chooses the default location of the data and of the
// notes. It does not fix the storage: the storage is only fixed when the
// variable NOTO_VAULT_FIXED is set.
func resolveVault(cfg config.Config, logger *slog.Logger) (string, config.Config, error) {
	if _, ok := os.LookupEnv("NOTO_DATA_DIR"); ok {
		return "", cfg, nil
	}
	if _, ok := os.LookupEnv("NOTO_NOTES_DIR"); ok {
		return "", cfg, nil
	}
	vc, ok, err := vault.Read()
	if err != nil {
		logger.Warn("cannot read the vault configuration, using the default directory", "err", err)
		return "", cfg, nil
	}
	if !ok {
		return "", cfg, nil
	}
	newCfg, _, err := vault.ApplyTo(cfg, vc.Path)
	if err != nil {
		logger.Warn("the stored vault is not usable, using the default directory", "err", err)
		return "", cfg, nil
	}
	return newCfg.NotesDir, newCfg, nil
}

// vaultFixedByEnv reports whether the storage of the notes was fixed by the
// environment. Only the variable NOTO_VAULT_FIXED fixes the storage: any
// value except the empty string, "0" and "false" enables the fix.
//
// The variables NOTO_DATA_DIR and NOTO_NOTES_DIR only choose the default
// location of the data and of the notes. They never fix the storage, so the
// user can still change the vault at runtime.
func vaultFixedByEnv() bool {
	value := strings.TrimSpace(os.Getenv("NOTO_VAULT_FIXED"))
	if value == "" {
		return false
	}
	switch strings.ToLower(value) {
	case "0", "false":
		return false
	default:
		return true
	}
}

// newServiceFactory builds the factory that creates the notes service. An
// empty vault path means the default layout of the base configuration.
func newServiceFactory(ctx context.Context, base config.Config) api.ServiceFactory {
	return func(vaultPath string) (*notes.Service, func(), error) {
		cfg := base
		if strings.TrimSpace(vaultPath) != "" {
			var err error
			cfg, _, err = vault.ApplyTo(base, vaultPath)
			if err != nil {
				return nil, nil, err
			}
		}
		if err := cfg.EnsureDirs(); err != nil {
			return nil, nil, err
		}
		store, err := sqlitestore.Open(ctx, cfg.DBPath)
		if err != nil {
			return nil, nil, fmt.Errorf("cannot open the database: %w", err)
		}
		svc, err := notes.NewService(cfg, store)
		if err != nil {
			_ = store.Close()
			return nil, nil, err
		}
		return svc, func() { _ = store.Close() }, nil
	}
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
