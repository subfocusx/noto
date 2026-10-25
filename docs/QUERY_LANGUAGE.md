# The query language of Noto

**Status:** Implemented (phase 8; the operator `matches` and the prefix form
`match:` came later).
**Source of truth:** this document plus the golden vectors `shared/query-vectors.json`
and `shared/vectors/regex.json`.

The language answers one question: *which notes of the vault match?* It is used
by the search panel, by the saved views, by the tag tree, by the plugins and by
the graph — and it works **the same way in both storage modes**: the open mode
(the backend compiles the query into SQL) and the sealed mode (the browser
compiles the query into a predicate over the decrypted tree in memory).

The syntax is inspired by the filter language of `usememos/memos` (MIT), but the
implementation is our own: no `cel-go`, no runtime of expressions, no new
dependency.

---

## 1. Grammar

```
query      := orExpr
orExpr     := andExpr ( "||" andExpr )*
andExpr    := unary ( "&&" unary )*
unary      := "!" unary | primary
primary    := "(" orExpr ")" | regexPrefix | comparison
regexPrefix:= "match" ":" ( string | raw )
comparison := field operator value
            | field "." operator "(" value ")"
            | field                       -- a flag on its own means "is true"
operator   := "==" | "!=" | ">" | ">=" | "<" | "<="
            | "in" | "contains" | "startsWith" | "endsWith" | "matches"
value      := string | number | "true" | "false"
            | "now" | "today" | relative
            | "[" [ value { "," value } ] "]"
relative   := ( "now" | "today" ) "-" number duration
duration   := "d" | "h" | "m"
```

* `&&` binds tighter than `||`; `!` binds tighter than both.
* A field on its own is only allowed for a **boolean** field and means
  `field == true`.
* The right hand side of a comparison is always a **value**, never a field:
  there are no comparisons between two fields.
* The operator can be written in two ways: `field contains "x"` and
  `field.contains("x")` mean the same thing.
* The prefix form `match:<expression>` is a comparison in disguise: it looks
  for the expression in the `title`, in the `content`, in the `path` and in
  the `tag` of the note (see §3).

### Tokens

* Identifiers: letters, digits and `_`, starting with a letter or `_`.
* Strings: `'...'` or `"..."`. A backslash escapes the next character.
* Numbers: digits with an optional decimal part.
* The operators are the ones above; `&&` and `||` are written as two characters.

### Comments and whitespace

Whitespace between the tokens is free. There are **no comments** in the query
language.

---

## 2. Fields

| Field | Type | Meaning |
|---|---|---|
| `path` | string | The path of the note relative to the root of the vault (`notes/todo.md`). |
| `name` | string | The file name of the note (`todo.md`). |
| `title` | string | The title of the note: the text of the first `# heading`, empty when there is none. |
| `tag` | list of strings | The tags of the note, without the `#`, lower cased, in the order of appearance, without duplicates. |
| `folder` | string | The directory of the note, relative to the root of the vault (`""` for a note at the root). |
| `ext` | string | The extension of the file name, without the dot, lower cased (`md`). |
| `content` | string | The whole text of the note. |
| `has_task_list` | boolean | The note contains a task list (`- [ ]` or `- [x]`). |
| `has_incomplete_tasks` | boolean | The note contains a task that is **not** done. |
| `has_code` | boolean | The note contains a code block or inline code. |
| `has_image` | boolean | The note contains an image (`![...](...)`). |
| `has_link` | boolean | The note contains a link (a wiki link `[[...]]` or a markdown link). |
| `has_attachments` | boolean | The note has at least one attachment. |
| `created_at` | timestamp | The moment the note was created (unix seconds). |
| `updated_at` | timestamp | The moment the note was changed the last time (unix seconds). |

An unknown field is an error: `unknown field: <name>`.

---

## 3. Operators

| Operator | Fields | Semantics |
|---|---|---|
| `==` | all | Equal. For `tag`: the tag list contains the value. For a string field: case **sensitive** equality, except for `content` and `name`, which are compared case insensitively. |
| `!=` | all | The negation of `==`. |
| `>` `>=` `<` `<=` | `created_at`, `updated_at` | Comparison of the timestamps. |
| `in` | `tag` | The tag list contains at least one of the values of the list. |
| `contains` | `content`, `name` | The text contains the value, case insensitively. |
| `startsWith` | `path`, `name`, `title`, `folder` | The text starts with the value, case insensitively. |
| `endsWith` | `path`, `name`, `title`, `folder` | The text ends with the value, case insensitively. |
| `matches` | `path`, `name`, `title`, `folder`, `ext`, `content`, `tag` | The text of the field matches the regular expression of the value. |

An operator that does not exist (`~`) is an error:
`unknown operator: <name>`. An operator that does not fit the field is an
error too: `operator <op> does not fit the field <field>`.

### The regular expressions

The operator `matches` takes a **regular expression**, and the prefix form
`match:` does the same without naming a field:

```
title matches "^A"
content matches "(foo|bar)"
match:^#\w+$
```

* The prefix form `match:<expression>` looks for the expression in the
  `title`, in the `content`, in the `path` and in the `tag` of the note — it
  is the disjunction of the four comparisons.
* The expression of the prefix form is either a quoted string (`match:"^#"`),
  or a raw text that ends at the first space (`match:^#\w+$`).
* The expression is compiled when the query is parsed, never when it is run:
  a broken expression is an error of the query, not a failure in the middle
  of the answer.
* The expression is bounded: it may not be longer than 512 bytes.
* The backend compiles the expression with **RE2** (the engine of Go): it is
  linear, it has no back reference and no look around. The browser compiles
  it with the `RegExp` of JavaScript, whose language is close but not the
  same. The golden vectors of the regular expressions
  (`shared/vectors/regex.json`) hold only the expressions that **both**
  engines understand, and both implementations must produce exactly the same
  intermediate representation of them.

---

## 4. Time

* `now` — the moment of the execution of the query.
* `today` — midnight of the day of the execution, in the local time of the
  machine.
* `now - 7d` — a moment in the past. The duration is a number and a unit:
  `d` (days), `h` (hours), `m` (minutes). The unit is required.

The moment of the execution is frozen for the whole query: `now` inside one
query always means the same instant.

---

## 5. Examples

```
tag == "work"
tag in ["work", "urgent"]
!has_task_list
has_task_list && !has_incomplete_tasks
(has_code || has_image) && tag == "x"
content.contains("pineapple")
path startsWith "projects/"
created_at >= now - 7d
created_at >= today
folder != ""
title matches "^A"
content matches "(foo|bar)"
match:^#\w+$
```

---

## 6. Errors

| Situation | Message |
|---|---|
| The field does not exist | `unknown field: <name>` |
| The operator does not exist | `unknown operator: <name>` |
| The operator does not fit the field | `operator <op> does not fit the field <field>` |
| The value is missing | `expected a value` |
| A parenthesis is not closed | `expected )` |
| The query ends in the middle | `unexpected end of query` |
| The text is not a query at all | `unexpected token: <token>` |
| The expression of `matches` (or of `match:`) is broken | `invalid regular expression: <reason>` |
| The expression of `matches` is longer than 512 bytes | `invalid regular expression: the expression is longer than 512 bytes` |

An empty query is not an error: it matches nothing.

---

## 7. How the query is executed

The query is parsed **once** into an intermediate representation (IR). The IR
is dialect free and is the contract between the two implementations:

```
and{l,r}  or{l,r}  not{e}  cmp{f,op,v}  truthy{f}
str{v}  num{v}  bool{v}  list{items}  now  today  rel{base,off}
```

* **The open mode**: the backend compiles the IR into SQL with parameters
  (`backend/internal/query`). The values are always parameters — a query can
  never inject SQL.
* **The sealed mode**: the browser compiles the IR into a predicate over the
  notes of the vault, which live in the memory of the tab
  (`frontend/src/core/query`).

Both implementations read the same golden vectors (`shared/query-vectors.json`)
and must produce exactly the same IR. The test of the conformance reads the
same file in both languages: the language cannot drift. The regular expressions
have their own file of vectors (`shared/vectors/regex.json`), read by the two
implementations in the same way.

---

## 8. The derived properties

The fields `title`, `tag` and the flags are **derived** from the text of the
note in one pass (`backend/internal/metadata`, `frontend/src/core/metadata`).
They are a cache, not a source of truth: the file `.md` is the truth, and the
properties are recalculated when the note is saved and when the index is
rebuilt.

The cache lives in the database (the table `note_props` of the schema of
SQLite) and it carries the flag `stale`: a note that changed since the last
calculation is marked, and the recalculation is a separate, explicit step.
The answer of the query says `partial: true` when the properties of some
notes could not be recalculated.

The rules are simple and are covered by the golden vectors:

* the title is the text of the **first** `# heading` of the note;
* a tag is a `#` followed by a word of letters, digits, `_`, `-` and `/`; the
  tag ends at the first character that cannot be part of it;
* the tags are lower cased and keep the order of appearance, without
  duplicates;
* a `#` inside a fenced code block is not a tag;
* a task list is a line that starts with `- [ ]` or `- [x]` (also `*` and
  `+`); a task that is not done makes `has_incomplete_tasks` true;
* an image is `![...](...)`, a link is `[[...]]` or `[...](...)`.

---

## 9. The language in the interface

The block **Filter** of the left column is the entry point of the language. It
holds three things, and each of them has one job:

| Part | What it is | What it does |
|---|---|---|
| the field | the query itself (`tag == "work" && !has_task_list`) | narrows the tree of the notes to the notes that match; the number of the matches is shown next to the field |
| **Tags** | the chips of the tags of the vault with their counters | a click puts `tag == "name"` into the field and runs it |
| **Saved** | the filters under a name | a click applies the filter again; `+` saves the current one |

The filter is a **view** of the tree, not of the storage: the notes that do not
match stay in the vault and stay reachable through the tabs of the editor. The
button with the cross in the field clears the filter and brings the whole tree
back.

The tags of a note are written in its text as `#word`. The strip of the tags
above the editor shows them and lets the user add or remove one: adding a tag
writes `#word` into the text at the cursor, removing it cuts the token out.
There is no separate field for the tags of a note — the text is the only place
where they live, also in the encrypted storage.
