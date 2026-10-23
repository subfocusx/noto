// Package deps pins the pure-Go SQLite driver so that it is always part of the
// module graph even when no other package imports it directly.
package deps

import (
	_ "modernc.org/sqlite"
)
