// Package query implements the query language of Noto: the tokenizer, the
// parser, the intermediate representation (IR) and the compiler from the IR
// into SQL with parameters.
//
// The IR is the contract with the sealed (browser) implementation, so the
// canonical JSON of every node is part of the public API and is covered by
// the golden vectors in shared/query-vectors.json.
package query

import (
	"encoding/json"
	"fmt"
)

// Expr is a node of the intermediate representation of a query.
type Expr interface {
	// exprNode marks the interface; it is not meant to be called.
	exprNode()
}

// And is the conjunction of two expressions.
type And struct {
	L Expr `json:"l"`
	R Expr `json:"r"`
}

// Or is the disjunction of two expressions.
type Or struct {
	L Expr `json:"l"`
	R Expr `json:"r"`
}

// Not is the negation of an expression.
type Not struct {
	E Expr `json:"e"`
}

// Cmp is the comparison of a field with a value.
type Cmp struct {
	F  string `json:"f"`
	Op string `json:"op"`
	V  Value  `json:"v"`
}

// Truthy is a boolean field used on its own: it means "is true".
type Truthy struct {
	F string `json:"f"`
}

func (And) exprNode()    {}
func (Or) exprNode()     {}
func (Not) exprNode()    {}
func (Cmp) exprNode()    {}
func (Truthy) exprNode() {}

// Value is the right hand side of a comparison.
type Value interface {
	// valueNode marks the interface; it is not meant to be called.
	valueNode()
}

// Str is a string value.
type Str struct {
	V string `json:"v"`
}

// Num is a numeric value.
type Num struct {
	V float64 `json:"v"`
}

// Bool is a boolean value.
type Bool struct {
	V bool `json:"v"`
}

// List is a list of values, used by the operator "in".
type List struct {
	Items []Value `json:"items"`
}

// Now is the moment of the execution of the query.
type Now struct{}

// Today is the midnight of the day of the execution, in the local time.
type Today struct{}

// Rel is a moment relative to Now or Today: Base minus Off seconds.
type Rel struct {
	Base string `json:"base"`
	Off  int64  `json:"off"`
}

func (Str) valueNode()   {}
func (Num) valueNode()   {}
func (Bool) valueNode()  {}
func (List) valueNode()  {}
func (Now) valueNode()   {}
func (Today) valueNode() {}
func (Rel) valueNode()   {}

// MarshalJSON implements json.Marshaler.
func (a And) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		L Expr  `json:"l"`
		R Expr  `json:"r"`
	}{"and", a.L, a.R})
}

// MarshalJSON implements json.Marshaler.
func (o Or) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		L Expr  `json:"l"`
		R Expr  `json:"r"`
	}{"or", o.L, o.R})
}

// MarshalJSON implements json.Marshaler.
func (n Not) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		E Expr  `json:"e"`
	}{"not", n.E})
}

// MarshalJSON implements json.Marshaler.
func (c Cmp) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K  string `json:"k"`
		F  string `json:"f"`
		Op string `json:"op"`
		V  Value  `json:"v"`
	}{"cmp", c.F, c.Op, c.V})
}

// MarshalJSON implements json.Marshaler.
func (t Truthy) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		F string `json:"f"`
	}{"truthy", t.F})
}

// MarshalJSON implements json.Marshaler.
func (s Str) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		V string `json:"v"`
	}{"str", s.V})
}

// MarshalJSON implements json.Marshaler.
func (n Num) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string  `json:"k"`
		V float64 `json:"v"`
	}{"num", n.V})
}

// MarshalJSON implements json.Marshaler.
func (b Bool) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
		V bool   `json:"v"`
	}{"bool", b.V})
}

// MarshalJSON implements json.Marshaler.
func (l List) MarshalJSON() ([]byte, error) {
	items := l.Items
	if items == nil {
		items = []Value{}
	}
	return json.Marshal(struct {
		K     string `json:"k"`
		Items []Value `json:"items"`
	}{"list", items})
}

// MarshalJSON implements json.Marshaler.
func (Now) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
	}{"now"})
}

// MarshalJSON implements json.Marshaler.
func (Today) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K string `json:"k"`
	}{"today"})
}

// MarshalJSON implements json.Marshaler.
func (r Rel) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		K    string `json:"k"`
		Base string `json:"base"`
		Off  int64  `json:"off"`
	}{"rel", r.Base, r.Off})
}

// Canonical returns the canonical JSON of an expression. The very same bytes
// are produced by the browser implementation, which is what makes the golden
// vectors useful.
func Canonical(e Expr) ([]byte, error) {
	if e == nil {
		return []byte("null"), nil
	}
	return json.Marshal(e)
}

// CanonicalString returns the canonical JSON of an expression as a string.
func CanonicalString(e Expr) (string, error) {
	b, err := Canonical(e)
	if err != nil {
		return "", fmt.Errorf("query: canonical json: %w", err)
	}
	return string(b), nil
}
