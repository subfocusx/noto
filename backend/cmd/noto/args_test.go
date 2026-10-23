package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// TestRunWithoutSubcommandStartsTheServer makes sure that the command line
// without a subcommand starts the server and not the restore command.
func TestRunWithoutSubcommandStartsTheServer(t *testing.T) {
	original := serve
	defer func() { serve = original }()

	started := 0
	serve = func(ctx context.Context) error {
		started++
		return nil
	}

	if code := run(context.Background(), []string{}); code != 0 {
		t.Fatalf("the exit code is %d, want 0", code)
	}
	if started != 1 {
		t.Fatalf("the server was started %d times, want 1", started)
	}
}

// TestRunUnknownSubcommand makes sure that an unknown subcommand is refused
// with the exit code 1.
func TestRunUnknownSubcommand(t *testing.T) {
	original := serve
	defer func() { serve = original }()

	started := 0
	serve = func(ctx context.Context) error {
		started++
		return nil
	}

	if code := run(context.Background(), []string{"nope"}); code != 1 {
		t.Fatalf("the exit code is %d, want 1", code)
	}
	if started != 0 {
		t.Fatalf("the server was started for an unknown command")
	}
}

// TestRunRestoreHelp makes sure that the help of the restore subcommand is
// printed and that the exit code is 0.
func TestRunRestoreHelp(t *testing.T) {
	var out bytes.Buffer
	if code := runRestore(context.Background(), []string{"--help"}, &out); code != 0 {
		t.Fatalf("the exit code is %d, want 0", code)
	}
	text := out.String()
	for _, want := range []string{"noto restore", "-in", "-data", "-dry-run", "-force"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the help does not mention %q:\n%s", want, text)
		}
	}
}

// TestRunRestoreRequiresAnArchive makes sure that the restore subcommand
// refuses to run without an archive.
func TestRunRestoreRequiresAnArchive(t *testing.T) {
	var out bytes.Buffer
	if code := runRestore(context.Background(), []string{}, &out); code != 1 {
		t.Fatalf("the exit code is %d, want 1", code)
	}
}

// TestRunReconcileHelp makes sure that the help of the reconcile subcommand
// still works.
func TestRunReconcileHelp(t *testing.T) {
	if code := runReconcile([]string{"--help"}); code != 0 {
		t.Fatalf("the exit code is %d, want 0", code)
	}
}

// TestUsageMentionsRestore makes sure that the help of the command lists the
// restore subcommand.
func TestUsageMentionsRestore(t *testing.T) {
	var out bytes.Buffer
	usage(&out)
	if !strings.Contains(out.String(), "noto restore") {
		t.Fatalf("the usage does not mention the restore command:\n%s", out.String())
	}
}
