package vault

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Dir is a subdirectory of a browsed directory.
type Dir struct {
	// Name is the name of the directory.
	Name string `json:"name"`
	// Path is the absolute path of the directory.
	Path string `json:"path"`
}

// BrowseResult is the result of a directory listing.
type BrowseResult struct {
	// Path is the absolute path of the listed directory.
	Path string `json:"path"`
	// Parent is the absolute path of the parent directory. It is empty for
	// the root of a volume.
	Parent string `json:"parent"`
	// Dirs holds the visible subdirectories, sorted by name.
	Dirs []Dir `json:"dirs"`
}

// Browse lists the visible subdirectories of the given directory. An empty
// path lists the root of the volume the server runs on. The listing is read
// only: no file is opened and only the names of the directories are returned.
func Browse(path string) (BrowseResult, error) {
	target := strings.TrimSpace(path)
	if target == "" {
		target = Root()
	}
	if strings.ContainsRune(target, 0) {
		return BrowseResult{}, fmt.Errorf("%w: the path contains a NUL byte", ErrInvalidPath)
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		return BrowseResult{}, fmt.Errorf("%w: cannot resolve the path", ErrInvalidPath)
	}
	abs = filepath.Clean(abs)
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return BrowseResult{}, fmt.Errorf("%w: the directory does not exist", ErrInvalidPath)
		}
		return BrowseResult{}, fmt.Errorf("%w: cannot stat the directory", ErrInvalidPath)
	}
	if !info.IsDir() {
		return BrowseResult{}, fmt.Errorf("%w: the path is not a directory", ErrInvalidPath)
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return BrowseResult{}, fmt.Errorf("%w: cannot list the directory", ErrInvalidPath)
	}
	out := BrowseResult{Path: abs, Parent: parentOf(abs), Dirs: []Dir{}}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if !e.IsDir() {
			continue
		}
		out.Dirs = append(out.Dirs, Dir{Name: name, Path: filepath.Join(abs, name)})
	}
	sort.Slice(out.Dirs, func(i, j int) bool { return out.Dirs[i].Name < out.Dirs[j].Name })
	return out, nil
}

// Root returns the root directory of the volume the server runs on.
func Root() string {
	if runtime.GOOS == "windows" {
		vol := filepath.VolumeName(os.TempDir())
		if vol == "" {
			if wd, err := os.Getwd(); err == nil {
				vol = filepath.VolumeName(wd)
			}
		}
		if vol != "" {
			return vol + string(filepath.Separator)
		}
	}
	return string(filepath.Separator)
}

// parentOf returns the parent of an absolute path. The parent of a volume
// root is the empty string.
func parentOf(abs string) string {
	parent := filepath.Dir(abs)
	if parent == abs {
		return ""
	}
	return parent
}
