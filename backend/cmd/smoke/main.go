// Command smoke runs the complete Noto REST API smoke test.
//
// It builds the real server binary, starts it against a throwaway data
// directory, exercises every endpoint of docs/CONTRACT.md and prints a
// PASS/FAIL line for every single check.
//
// Usage (from the backend directory):
//
//	go run ./cmd/smoke
package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// ---------------------------------------------------------------- reporting --

type checkResult struct {
	name   string
	ok     bool
	detail string
}

var results []checkResult

func record(name string, ok bool, detail string) {
	results = append(results, checkResult{name: name, ok: ok, detail: detail})
	mark := "PASS"
	if !ok {
		mark = "FAIL"
	}
	fmt.Printf("[%s] %-4s %s\n", mark, name, detail)
}

// ------------------------------------------------------------------- models --

type apiError struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Current *noteContent `json:"current"`
}

type errorEnvelope struct {
	Error apiError `json:"error"`
}

type noteContent struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision int64  `json:"revision"`
}

type node struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	Type       string `json:"type"`
	ParentPath string `json:"parentPath"`
	Revision   int64  `json:"revision"`
}

type treeResponse struct {
	Folders []node `json:"folders"`
	Files   []node `json:"files"`
}

type searchResponse struct {
	Hits []struct {
		Path string `json:"path"`
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"hits"`
}

type trashResponse struct {
	Entries []node `json:"entries"`
}

type attachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	MIME string `json:"mime"`
}

// --------------------------------------------------------------------- main --

func main() {
	code := run()
	os.Exit(code)
}

func run() int {
	fmt.Println("== Noto backend smoke test ==")

	backendDir, err := findBackendDir()
	if err != nil {
		fmt.Println("FATAL:", err)
		return 1
	}

	dataDir, err := os.MkdirTemp("", "noto-smoke-*")
	if err != nil {
		fmt.Println("FATAL: cannot create the temporary data directory:", err)
		return 1
	}
	defer os.RemoveAll(dataDir)

	port, err := freePort()
	if err != nil {
		fmt.Println("FATAL: cannot find a free port:", err)
		return 1
	}

	goBin := goBinary()
	if goBin == "" {
		fmt.Println("FATAL: cannot find the go tool")
		return 1
	}

	serverBin := filepath.Join(dataDir, "noto-server.exe")
	if runtime.GOOS != "windows" {
		serverBin = filepath.Join(dataDir, "noto-server")
	}
	build := exec.Command(goBin, "build", "-o", serverBin, "./cmd/noto")
	build.Dir = backendDir
	build.Stdout = os.Stderr
	build.Stderr = os.Stderr
	fmt.Printf("building the server: %s build -o %s ./cmd/noto\n", goBin, serverBin)
	if err := build.Run(); err != nil {
		fmt.Println("FATAL: cannot build the server:", err)
		return 1
	}

	sm := &smoke{
		base:    fmt.Sprintf("http://127.0.0.1:%d", port),
		dataDir: dataDir,
		notes:   filepath.Join(dataDir, "notes"),
		dbPath:  filepath.Join(dataDir, "noto.db"),
		logBuf:  &bytes.Buffer{},
	}
	defer sm.stop()

	if err := sm.start(serverBin, port); err != nil {
		fmt.Println("FATAL: cannot start the server:", err)
		fmt.Println("server output:\n" + sm.logBuf.String())
		return 1
	}
	if err := sm.waitHealthy(45 * time.Second); err != nil {
		fmt.Println("FATAL: the server did not become healthy:", err)
		fmt.Println("server output:\n" + sm.logBuf.String())
		return 1
	}
	fmt.Printf("server is healthy at %s (data dir %s)\n\n", sm.base, dataDir)

	sm.runChecks()
	sm.checkLoopbackGuard(serverBin)

	// ------------------------------------------------------------- summary --
	fails := 0
	for _, r := range results {
		if !r.ok {
			fails++
		}
	}
	fmt.Println()
	fmt.Println("== Summary ==")
	fmt.Printf("PASS %d / FAIL %d\n", len(results)-fails, fails)
	if fails > 0 {
		fmt.Println()
		fmt.Println("Failed checks:")
		for _, r := range results {
			if r.ok {
				continue
			}
			fmt.Printf("  - %s: %s\n", r.name, r.detail)
		}
	}
	fmt.Println()
	fmt.Println("Server log (last 4000 bytes):")
	log := sm.logBuf.String()
	if len(log) > 4000 {
		log = log[len(log)-4000:]
	}
	fmt.Println(log)
	if fails > 0 {
		return 1
	}
	return 0
}
