package query

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// tokenKind is the kind of a lexical token.
type tokenKind int

const (
	tokEOF tokenKind = iota
	tokIdent
	tokString
	tokNumber
	tokSymbol
)

// token is one lexical token.
type token struct {
	kind tokenKind
	text string
	num  float64
	unit string
}

// String returns the readable form of a token, used in the error messages.
func (t token) String() string {
	if t.kind == tokEOF {
		return "end of query"
	}
	return t.text
}

// tokenize splits the source into tokens.
func tokenize(src string) ([]token, error) {
	var out []token
	i := 0
	for i < len(src) {
		r, size := utf8.DecodeRuneInString(src[i:])
		switch {
		case unicode.IsSpace(r):
			i += size
		case r == '\'' || r == '"':
			s, n, err := scanString(src[i:])
			if err != nil {
				return nil, err
			}
			out = append(out, token{kind: tokString, text: s})
			i += n
		case unicode.IsDigit(r):
			tok, n, err := scanNumber(src[i:])
			if err != nil {
				return nil, err
			}
			out = append(out, tok)
			i += n
		case r == '_' || unicode.IsLetter(r):
			start := i
			for i < len(src) {
				r2, size2 := utf8.DecodeRuneInString(src[i:])
				if r2 != '_' && !unicode.IsLetter(r2) && !unicode.IsDigit(r2) {
					break
				}
				i += size2
			}
			out = append(out, token{kind: tokIdent, text: src[start:i]})
		default:
			sym, n := scanSymbol(src[i:])
			out = append(out, token{kind: tokSymbol, text: sym})
			i += n
		}
	}
	out = append(out, token{kind: tokEOF})
	return out, nil
}

// scanString reads a quoted string and returns its unescaped content and the
// number of bytes consumed (the opening quote included).
func scanString(src string) (string, int, error) {
	quote := src[0]
	var b strings.Builder
	i := 1
	for i < len(src) {
		c := src[i]
		if c == '\\' && i+1 < len(src) {
			b.WriteByte(src[i+1])
			i += 2
			continue
		}
		if c == quote {
			return b.String(), i + 1, nil
		}
		b.WriteByte(c)
		i++
	}
	return "", 0, fmt.Errorf("expected a value")
}

// scanNumber reads a number with an optional decimal part and an optional
// duration unit (d, h or m) directly attached to it.
func scanNumber(src string) (token, int, error) {
	i := 0
	for i < len(src) && src[i] >= '0' && src[i] <= '9' {
		i++
	}
	if i < len(src) && src[i] == '.' && i+1 < len(src) && src[i+1] >= '0' && src[i+1] <= '9' {
		j := i + 1
		for j < len(src) && src[j] >= '0' && src[j] <= '9' {
			j++
		}
		i = j
	}
	num, err := strconv.ParseFloat(src[:i], 64)
	if err != nil {
		return token{}, 0, fmt.Errorf("unexpected token: %s", src[:i])
	}
	unitStart := i
	for i < len(src) {
		r, size := utf8.DecodeRuneInString(src[i:])
		if !unicode.IsLetter(r) {
			break
		}
		i += size
	}
	unit := src[unitStart:i]
	return token{kind: tokNumber, text: src[:i], num: num, unit: unit}, i, nil
}

// scanSymbol reads an operator or a punctuation mark.
func scanSymbol(src string) (string, int) {
	two := ""
	if len(src) >= 2 {
		two = src[:2]
	}
	switch two {
	case "==", "!=", ">=", "<=", "&&", "||":
		return two, 2
	}
	r, size := utf8.DecodeRuneInString(src)
	return string(r), size
}

// parser parses a token stream into an Expr.
type parser struct {
	toks []token
	pos  int
}

// parseError is the error of the parser. Its message is the message of the
// specification, without any prefix.
type parseError struct {
	msg string
}

func (e *parseError) Error() string { return e.msg }

func errf(format string, args ...any) error {
	return &parseError{msg: fmt.Sprintf(format, args...)}
}

// Parse parses a query into its intermediate representation. An empty query
// is not an error: it returns a nil expression, which matches nothing.
func Parse(source string) (Expr, error) {
	toks, err := tokenize(source)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	if p.peek().kind == tokEOF {
		return nil, nil
	}
	e, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tokEOF {
		return nil, errf("unexpected token: %s", p.peek().String())
	}
	return e, nil
}

// peek returns the current token.
func (p *parser) peek() token { return p.toks[p.pos] }

// next consumes and returns the current token.
func (p *parser) next() token {
	t := p.toks[p.pos]
	if t.kind != tokEOF {
		p.pos++
	}
	return t
}

// atSymbol reports whether the current token is the given symbol.
func (p *parser) atSymbol(sym string) bool {
	t := p.peek()
	return t.kind == tokSymbol && t.text == sym
}

// parseOr parses the disjunction.
func (p *parser) parseOr() (Expr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.atSymbol("||") {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = Or{L: left, R: right}
	}
	return left, nil
}

// parseAnd parses the conjunction.
func (p *parser) parseAnd() (Expr, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for p.atSymbol("&&") {
		p.next()
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = And{L: left, R: right}
	}
	return left, nil
}

// parseUnary parses the negation.
func (p *parser) parseUnary() (Expr, error) {
	if p.atSymbol("!") {
		p.next()
		e, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return Not{E: e}, nil
	}
	return p.parsePrimary()
}

// parsePrimary parses a parenthesized expression or a comparison.
func (p *parser) parsePrimary() (Expr, error) {
	if p.atSymbol("(") {
		p.next()
		e, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if !p.atSymbol(")") {
			return nil, errf("expected )")
		}
		p.next()
		return e, nil
	}
	return p.parseComparison()
}

// parseComparison parses "field operator value" or a lone boolean field.
func (p *parser) parseComparison() (Expr, error) {
	t := p.peek()
	if t.kind == tokEOF {
		return nil, errf("unexpected end of query")
	}
	if t.kind != tokIdent {
		return nil, errf("unexpected token: %s", t.String())
	}
	p.next()
	name := t.text
	field, ok := LookupField(name)
	if !ok {
		return nil, errf("unknown field: %s", name)
	}

	// The method form: field.contains("value").
	if p.atSymbol(".") {
		p.next()
		opTok := p.peek()
		if opTok.kind != tokIdent {
			if opTok.kind == tokEOF {
				return nil, errf("unexpected end of query")
			}
			return nil, errf("unexpected token: %s", opTok.String())
		}
		p.next()
		if err := checkOperator(field, opTok.text); err != nil {
			return nil, err
		}
		if !p.atSymbol("(") {
			if p.peek().kind == tokEOF {
				return nil, errf("unexpected end of query")
			}
			return nil, errf("unexpected token: %s", p.peek().String())
		}
		p.next()
		v, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		if !p.atSymbol(")") {
			return nil, errf("expected )")
		}
		p.next()
		return Cmp{F: field.Name, Op: opTok.text, V: v}, nil
	}

	// The operator form.
	nt := p.peek()
	switch {
	case nt.kind == tokSymbol && (nt.text == "==" || nt.text == "!=" || nt.text == ">" ||
		nt.text == ">=" || nt.text == "<" || nt.text == "<="):
		p.next()
		if err := checkOperator(field, nt.text); err != nil {
			return nil, err
		}
		v, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		return Cmp{F: field.Name, Op: nt.text, V: v}, nil
	case nt.kind == tokIdent:
		p.next()
		if err := checkOperator(field, nt.text); err != nil {
			return nil, err
		}
		v, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		return Cmp{F: field.Name, Op: nt.text, V: v}, nil
	case nt.kind == tokSymbol && (nt.text == "~" || nt.text == "@" || nt.text == "#" ||
		nt.text == "$" || nt.text == "^" || nt.text == "?"):
		return nil, errf("unknown operator: %s", nt.text)
	}

	// A field on its own: only a boolean field may be used this way.
	if field.Type == TypeBool {
		return Truthy{F: field.Name}, nil
	}
	return nil, errf("unexpected token: %s", name)
}

// checkOperator verifies that the operator exists and that it fits the field.
func checkOperator(field Field, op string) error {
	if !IsKnownOperator(op) {
		return errf("unknown operator: %s", op)
	}
	if !OperatorAllowed(field.Name, op) {
		return errf("operator %s does not fit the field %s", op, field.Name)
	}
	return nil
}

// parseValue parses the right hand side of a comparison.
func (p *parser) parseValue() (Value, error) {
	t := p.peek()
	switch t.kind {
	case tokEOF:
		return nil, errf("expected a value")
	case tokString:
		p.next()
		return Str{V: t.text}, nil
	case tokNumber:
		p.next()
		if t.unit != "" {
			return nil, errf("unexpected token: %s", t.text)
		}
		return Num{V: t.num}, nil
	case tokSymbol:
		if t.text == "[" {
			return p.parseList()
		}
		return nil, errf("unexpected token: %s", t.String())
	case tokIdent:
		switch t.text {
		case "true":
			p.next()
			return Bool{V: true}, nil
		case "false":
			p.next()
			return Bool{V: false}, nil
		case "now", "today":
			p.next()
			if !p.atSymbol("-") {
				// The moment itself: "now" or "today".
				if t.text == "now" {
					return Now{}, nil
				}
				return Today{}, nil
			}
			return p.parseRelative(t.text)
		}
		return nil, errf("unexpected token: %s", t.String())
	}
	return nil, errf("expected a value")
}

// parseList parses "[ value, value ]".
func (p *parser) parseList() (Value, error) {
	p.next() // consume "["
	items := []Value{}
	if p.atSymbol("]") {
		p.next()
		return List{Items: items}, nil
	}
	for {
		v, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		items = append(items, v)
		if p.atSymbol(",") {
			p.next()
			continue
		}
		break
	}
	if !p.atSymbol("]") {
		if p.peek().kind == tokEOF {
			return nil, errf("unexpected end of query")
		}
		return nil, errf("unexpected token: %s", p.peek().String())
	}
	p.next()
	return List{Items: items}, nil
}

// durationSeconds maps a duration unit to its length in seconds.
var durationSeconds = map[string]int64{
	"d": 86400,
	"h": 3600,
	"m": 60,
}

// parseRelative parses "now - 7d" and "today - 3h".
func (p *parser) parseRelative(base string) (Value, error) {
	if !p.atSymbol("-") {
		return nil, errf("expected a value")
	}
	p.next()
	t := p.peek()
	if t.kind == tokEOF {
		return nil, errf("expected a value")
	}
	if t.kind != tokNumber {
		return nil, errf("unexpected token: %s", t.String())
	}
	p.next()
	unit, ok := durationSeconds[t.unit]
	if !ok {
		return nil, errf("unexpected token: %s", t.text)
	}
	off := int64(t.num) * unit
	return Rel{Base: base, Off: -off}, nil
}
