package main

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// --------------------------------------------------------------- smoke state --

type smoke struct {
	base    string
	dataDir string
	notes   string
	dbPath  string
	server  *exec.Cmd
	logBuf  *bytes.Buffer
}

func (s *smoke) url(path string) string { return s.base + path }

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// findBackendDir walks up from the working directory until it finds the
// go.mod of the backend module.
func findBackendDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("cannot find the backend module (no go.mod above %s)", dir)
}

func goBinary() string {
	candidates := []string{
		filepath.Join(runtime.GOROOT(), "bin", "go.exe"),
		filepath.Join(runtime.GOROOT(), "bin", "go"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("go"); err == nil {
		return p
	}
	return ""
}

// ---------------------------------------------------------------- the server --

func (s *smoke) start(serverBin string, port int) error {
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		"NOTO_ADDR=127.0.0.1:"+fmt.Sprint(port),
		"NOTO_DATA_DIR="+s.dataDir,
		"NOTO_ALLOW_PUBLIC=false",
		"NOTO_STATIC_DIR=",
		"NOTO_LOG_LEVEL=info",
		"NOTO_MAX_UPLOAD_MB=2",
	)
	cmd.Stdout = s.logBuf
	cmd.Stderr = s.logBuf
	if err := cmd.Start(); err != nil {
		return err
	}
	s.server = cmd
	return nil
}

func (s *smoke) stop() {
	if s.server == nil || s.server.Process == nil {
		return
	}
	_ = s.server.Process.Kill()
	_, _ = s.server.Process.Wait()
}

func (s *smoke) waitHealthy(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		r, err := request(http.MethodGet, s.url("/api/health"), nil, nil)
		if err == nil {
			if r.status == http.StatusOK {
				return nil
			}
			last = fmt.Errorf("health returned status %d: %s", r.status, r.truncated())
		} else {
			last = err
		}
		time.Sleep(200 * time.Millisecond)
	}
	if last == nil {
		last = fmt.Errorf("timeout")
	}
	return last
}

// fetchTree reads the tree of the notes directory.
func (s *smoke) fetchTree() *treeResponse {
	r, err := request(http.MethodGet, s.url("/api/tree"), nil, nil)
	if err != nil || r.status != http.StatusOK {
		return nil
	}
	var t treeResponse
	if err := decode(r, &t); err != nil {
		return nil
	}
	return &t
}

// checkLoopbackGuard makes sure that the server refuses to listen on an
// address without a host: it would be reachable from the whole network.
func (s *smoke) checkLoopbackGuard(serverBin string) {
	port, err := freePort()
	if err != nil {
		record("loopback-guard", false, "cannot find a free port: "+err.Error())
		return
	}
	dataDir, err := os.MkdirTemp("", "noto-smoke-guard-*")
	if err != nil {
		record("loopback-guard", false, "cannot create a temporary data directory: "+err.Error())
		return
	}
	defer os.RemoveAll(dataDir)
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		"NOTO_ADDR=:"+fmt.Sprint(port),
		"NOTO_DATA_DIR="+dataDir,
		"NOTO_ALLOW_PUBLIC=false",
	)
	out, err := cmd.CombinedOutput()
	if err == nil {
		record("loopback-guard", false, "the server started with an address without a host")
		return
	}
	msg := strings.TrimSpace(string(out))
	if len(msg) > 300 {
		msg = msg[:300] + "..."
	}
	record("loopback-guard", true, "the server refused to start: "+msg)
}
