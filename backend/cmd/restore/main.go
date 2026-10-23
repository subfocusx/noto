// Command restore restores a Noto backup archive into a data directory.
//
// The command is a thin wrapper around the package internal/restore: it parses
// the flags, runs the restore and prints the report.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"noto/backend/internal/config"
	"noto/backend/internal/restore"
)

func main() {
	fs := flag.NewFlagSet("restore", flag.ExitOnError)
	in := fs.String("in", "", "path of the backup archive to restore (required)")
	dataDir := fs.String("data", "", "override the data directory (default: the configured one)")
	dryRun := fs.Bool("dry-run", false, "only report what would be restored, change nothing")
	force := fs.Bool("force", false, "restore even when the target directory already contains data")
	fs.Parse(os.Args[1:])

	if strings.TrimSpace(*in) == "" {
		fail(errors.New("the -in flag is required"))
	}
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}

	report, err := restore.Run(context.Background(), cfg, restore.Options{
		ArchivePath: *in,
		DataDir:     *dataDir,
		DryRun:      *dryRun,
		Force:       *force,
	})
	if err != nil {
		fail(err)
	}
	restore.PrintReport(os.Stdout, report)
}

// fail prints an error and exits with a non zero status code.
func fail(err error) {
	fmt.Fprintln(os.Stderr, "restore:", err)
	os.Exit(1)
}
