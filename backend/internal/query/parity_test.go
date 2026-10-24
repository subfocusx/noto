package query_test

import (
	"context"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"noto/backend/internal/metadata"
	"noto/backend/internal/model"
	"noto/backend/internal/query"
	"noto/backend/internal/sqlitestore"
)

// The parity of the two implementations of the query language.
//
// The open storage answers a query with SQL (the compiler of the package
// `query`), the encrypted storage answers it with a predicate over the notes
// of the browser. The two answers must be the same for the same vault: this
// test builds a small vault, asks the same questions to both implementations
// and compares the sets of the matching notes.
//
// The vectors of `shared/query-vectors.json` freeze the syntax and the
// representation of the queries; the questions of this file freeze the
// behaviour of the two engines.

// parityNote is a note of the vault of the parity test.
type parityNote struct {
	path    string
	name    string
	folder  string
	content string
	created int64
	updated int64
	// hasAttachment marks the notes that carry an attachment.
	hasAttachment bool
}

// theParityVault is the vault of the parity test.
var theParityVault = []parityNote{
	{
		path:    "notes/alpha.md",
		name:    "alpha.md",
		folder:  "notes",
		content: "# Alpha\n\n#work #urgent\n\n- [ ] a task that is not done\n",
		created: 1000,
		updated: 2000,
	},
	{
		path:    "notes/beta.md",
		name:    "beta.md",
		folder:  "notes",
		content: "# Beta\n\n#work\n\n```go\nfmt.Println(\"pineapple\")\n```\n",
		created: 1500,
		updated: 2500,
	},
	{
		path:    "gamma.md",
		name:    "gamma.md",
		folder:  "",
		content: "# Gamma\n\n![a picture](photo.png)\n\nSee [[notes/alpha]] for the details.\n",
		created: 1200,
		updated: 1200,
		hasAttachment: true,
	},
	{
		path:    "notes/delta.md",
		name:    "delta.md",
		folder:  "notes",
		content: "# Delta\n\n#home\n\n- [x] a task that is done\n",
		created: 900,
		updated: 3000,
	},
}

// theParityQuestions are the questions asked to both implementations.
var theParityQuestions = []string{
	"tag == 'work'",
	"tag != 'work'",
	"tag in ['work', 'home']",
	"title == 'Alpha'",
	"title != 'Alpha'",
	"name endsWith '.md'",
	"path startsWith 'notes/'",
	"name contains 'alpha'",
	"folder == 'notes'",
	"folder != ''",
	"ext == 'md'",
	"has_task_list",
	"has_incomplete_tasks",
	"has_code",
	"has_image",
	"has_link",
	"has_attachments",
	"content contains 'pineapple'",
	"content contains 'PINEAPPLE'",
	"created_at >= 1000",
	"created_at < 1200",
	"updated_at > 2000",
	"updated_at <= 2500",
	"!has_task_list",
	"has_task_list && !has_incomplete_tasks",
	"(has_code || has_image) && tag == 'work'",
	"tag == 'work' && folder == 'notes'",
}

// openParityVault fills a SQLite store with the vault of the test and returns
// the store.
func openParityVault(t *testing.T) *sqlitestore.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "parity.db")
	store, err := sqlitestore.Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open the store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	for _, note := range theParityVault {
		created := time.Unix(note.created, 0).UTC()
		updated := time.Unix(note.updated, 0).UTC()
		if err := store.UpsertNote(ctx, model.Node{
			Path:      note.path,
			Name:      note.name,
			Type:      model.NodeFile,
			ParentPath: note.folder,
			CreatedAt: created,
			UpdatedAt: updated,
		}); err != nil {
			t.Fatalf("upsert the note %q: %v", note.path, err)
		}
		if err := store.IndexContent(ctx, note.path, note.name, note.content); err != nil {
			t.Fatalf("index the note %q: %v", note.path, err)
		}
		props := metadata.Extract(note.content)
		if err := store.UpsertNoteProps(ctx, model.NoteProps{
			Path:      note.path,
			Name:      note.name,
			Title:     props.Title,
			Tags:      props.Tags,
			Flags:     props.Flags(),
			UpdatedAt: updated,
		}); err != nil {
			t.Fatalf("store the properties of %q: %v", note.path, err)
		}
		if note.hasAttachment {
			if err := store.PutAttachment(ctx, model.Attachment{
				ID:       "att-" + note.path,
				Name:     "photo.png",
				MIME:     "image/png",
				Size:     10,
				NotePath: note.path,
				CreatedAt: created,
			}); err != nil {
				t.Fatalf("store the attachment of %q: %v", note.path, err)
			}
		}
	}
	return store
}

// predicateNote builds the note of the predicate from a note of the vault.
func predicateNote(note parityNote) query.Note {
	props := metadata.Extract(note.content)
	ext := ""
	if dot := lastDot(note.name); dot >= 0 {
		ext = note.name[dot+1:]
	}
	return query.Note{
		Path:               note.path,
		Name:               note.name,
		Content:            note.content,
		Title:              props.Title,
		Tags:               props.Tags,
		Folder:             note.folder,
		Ext:                ext,
		CreatedAt:          note.created,
		UpdatedAt:          note.updated,
		HasTaskList:        props.HasTaskList,
		HasIncompleteTasks: props.HasIncompleteTasks,
		HasCode:            props.HasCode,
		HasImage:           props.HasImage,
		HasLink:            props.HasLink,
		HasAttachments:     note.hasAttachment,
	}
}

// lastDot returns the position of the last dot of a name, or -1.
func lastDot(name string) int {
	for i := len(name) - 1; i >= 0; i-- {
		if name[i] == '.' {
			return i
		}
	}
	return -1
}

// TestQueryParity compares the two implementations of the query language on
// the same vault.
func TestQueryParity(t *testing.T) {
	store := openParityVault(t)
	ctx := context.Background()
	now := time.Now()

	for _, question := range theParityQuestions {
		question := question
		t.Run(question, func(t *testing.T) {
			expr, err := query.Parse(question)
			if err != nil {
				t.Fatalf("parse the question: %v", err)
			}

			// The open storage: the query is compiled into SQL.
			hits, err := store.QueryNotes(ctx, expr, 100)
			if err != nil {
				t.Fatalf("run the query in SQL: %v", err)
			}
			sqlPaths := make([]string, 0, len(hits))
			for _, hit := range hits {
				sqlPaths = append(sqlPaths, hit.Path)
			}
			sort.Strings(sqlPaths)

			// The encrypted storage: the query is a predicate over the notes.
			predicate := query.CompilePredicate(expr, now)
			predicatePaths := []string{}
			for _, note := range theParityVault {
				if predicate(predicateNote(note)) {
					predicatePaths = append(predicatePaths, note.path)
				}
			}
			sort.Strings(predicatePaths)

			if len(sqlPaths) != len(predicatePaths) {
				t.Fatalf("the two implementations disagree: SQL %v, predicate %v", sqlPaths, predicatePaths)
			}
			for i := range sqlPaths {
				if sqlPaths[i] != predicatePaths[i] {
					t.Fatalf("the two implementations disagree: SQL %v, predicate %v", sqlPaths, predicatePaths)
				}
			}
		})
	}
}
