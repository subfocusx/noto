package testutil

import (
	"sort"
	"strings"
	"unicode"
)

// maxSnippetLen is the maximum length of a snippet returned by Search.
const maxSnippetLen = 160

// stopWords are the search operator words. They are dropped, so that a query
// such as "alpha OR beta" searches for "alpha beta" instead of failing.
var stopWords = map[string]bool{
	"and":  true,
	"or":   true,
	"not":  true,
	"near": true,
}

// tokenize splits a user query into safe search tokens. Every character that
// is not a letter, a digit or an underscore is dropped, so that no special
// character can leak into the query. The tokens are lower case.
func tokenize(query string) []string {
	var tokens []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	for _, r := range query {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			cur.WriteRune(unicode.ToLower(r))
		default:
			flush()
		}
	}
	flush()

	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if stopWords[t] {
			continue
		}
		out = append(out, t)
	}
	return out
}

// matchesTokens reports whether every token occurs in the given text. A token
// matches when it is the prefix of a word of the text, like the prefix query
// of the SQLite index does.
func matchesTokens(text string, tokens []string) bool {
	if len(tokens) == 0 {
		return false
	}
	words := wordsOf(text)
	for _, t := range tokens {
		found := false
		for _, w := range words {
			if strings.HasPrefix(w, t) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// wordsOf splits a text into its lower case words.
func wordsOf(text string) []string {
	var words []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			words = append(words, cur.String())
			cur.Reset()
		}
	}
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			cur.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return words
}

// snippet extracts a short excerpt around the first matching token and
// highlights every match inside it.
func snippet(text string, tokens []string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	pos := -1
	for _, t := range tokens {
		if i := strings.Index(lower, t); i >= 0 && (pos < 0 || i < pos) {
			pos = i
		}
	}
	if pos < 0 {
		pos = 0
	}
	start := 0
	if pos > 40 {
		start = pos - 40
	}
	end := len(text)
	if start+maxSnippetLen < end {
		end = start + maxSnippetLen
	}
	// Do not cut in the middle of a rune.
	for start > 0 && start < len(text) && !isRuneStart(text[start]) {
		start--
	}
	for end < len(text) && !isRuneStart(text[end]) {
		end++
	}
	out := highlight(text[start:end], tokens)
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}

// isRuneStart reports whether b starts a UTF-8 rune.
func isRuneStart(b byte) bool { return b&0xC0 != 0x80 }

// highlight wraps every occurrence of the tokens in ** **.
func highlight(text string, tokens []string) string {
	lower := strings.ToLower(text)
	type span struct{ start, end int }
	var spans []span
	for _, t := range tokens {
		if t == "" {
			continue
		}
		from := 0
		for {
			i := strings.Index(lower[from:], t)
			if i < 0 {
				break
			}
			spans = append(spans, span{from + i, from + i + len(t)})
			from += i + len(t)
		}
	}
	if len(spans) == 0 {
		return text
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	merged := []span{spans[0]}
	for _, sp := range spans[1:] {
		last := &merged[len(merged)-1]
		if sp.start <= last.end {
			if sp.end > last.end {
				last.end = sp.end
			}
			continue
		}
		merged = append(merged, sp)
	}
	var b strings.Builder
	prev := 0
	for _, sp := range merged {
		b.WriteString(text[prev:sp.start])
		b.WriteString("**")
		b.WriteString(text[sp.start:sp.end])
		b.WriteString("**")
		prev = sp.end
	}
	b.WriteString(text[prev:])
	return b.String()
}
