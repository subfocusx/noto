/**
 * The tokenizer and the recursive descent parser of the query language.
 *
 * The grammar is the one of `docs/QUERY_LANGUAGE.md`, section 1:
 *
 *   query      := orExpr
 *   orExpr     := andExpr ( "||" andExpr )*
 *   andExpr    := unary ( "&&" unary )*
 *   unary      := "!" unary | primary
 *   primary    := "(" orExpr ")" | comparison
 *   comparison := field operator value | field   -- a flag on its own
 *
 * The parser produces the IR of `ir.ts`; the canonical JSON of the result
 * must match the golden vectors exactly.
 */

import {
  fieldType,
  isQueryField,
  isQueryOperator,
  operatorFits,
  type QueryField,
  type QueryOperator,
} from './schema';
import type {
  BoolValue,
  ListValue,
  NumValue,
  QueryNode,
  QueryValue,
  RelValue,
  StrValue,
} from './ir';

/** The error of the parser. Its message is the message of the spec. */
export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryParseError';
  }
}

type TokenKind = 'ident' | 'string' | 'number' | 'symbol' | 'eof';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: string | number;
}

/** The two character operators. */
const DOUBLE_SYMBOLS = ['==', '!=', '>=', '<=', '&&', '||'];

/** The single character symbols. */
const SINGLE_SYMBOLS = '><!-[](),.~';

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\p{L}]/u.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_\p{L}\p{N}]/u.test(ch);
}

/**
 * Splits the source into tokens.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] as string;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let text = '';
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          text += source[i + 1];
          i += 2;
        } else {
          text += source[i];
          i += 1;
        }
      }
      if (i >= source.length) {
        throw new QueryParseError('unexpected end of query');
      }
      i += 1; // the closing quote
      tokens.push({ kind: 'string', text, value: text });
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < source.length && source[j]! >= '0' && source[j]! <= '9') j += 1;
      if (source[j] === '.') {
        j += 1;
        while (j < source.length && source[j]! >= '0' && source[j]! <= '9') j += 1;
      }
      const text = source.slice(i, j);
      i = j;
      tokens.push({ kind: 'number', text, value: Number(text) });
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < source.length && isIdentPart(source[j] as string)) j += 1;
      const text = source.slice(i, j);
      i = j;
      tokens.push({ kind: 'ident', text });
      continue;
    }

    const pair = source.slice(i, i + 2);
    if (DOUBLE_SYMBOLS.includes(pair)) {
      tokens.push({ kind: 'symbol', text: pair });
      i += 2;
      continue;
    }

    if (SINGLE_SYMBOLS.includes(ch)) {
      tokens.push({ kind: 'symbol', text: ch });
      i += 1;
      continue;
    }

    throw new QueryParseError(`unexpected token: ${ch}`);
  }

  tokens.push({ kind: 'eof', text: '' });
  return tokens;
}

/** The number of seconds of a duration unit. */
const DURATION_UNITS: Record<string, number> = { d: 86400, h: 3600, m: 60 };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  /** The current token, without consuming it. */
  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const token = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return token;
  }

  private isSymbol(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'symbol' && token.text === text;
  }

  parse(): QueryNode {
    return this.parseOr();
  }

  private parseOr(): QueryNode {
    let left = this.parseAnd();
    while (this.isSymbol('||')) {
      this.next();
      const right = this.parseAnd();
      left = { k: 'or', l: left, r: right };
    }
    return left;
  }

  private parseAnd(): QueryNode {
    let left = this.parseUnary();
    while (this.isSymbol('&&')) {
      this.next();
      const right = this.parseUnary();
      left = { k: 'and', l: left, r: right };
    }
    return left;
  }

  private parseUnary(): QueryNode {
    if (this.isSymbol('!')) {
      this.next();
      return { k: 'not', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const token = this.peek();
    if (token.kind === 'symbol' && token.text === '(') {
      this.next();
      const inner = this.parseOr();
      if (!this.isSymbol(')')) {
        throw new QueryParseError('expected )');
      }
      this.next();
      return inner;
    }
    if (token.kind === 'ident') {
      return this.parseComparison();
    }
    if (token.kind === 'eof') {
      throw new QueryParseError('unexpected end of query');
    }
    throw new QueryParseError(`unexpected token: ${token.text}`);
  }

  private parseComparison(): QueryNode {
    const nameToken = this.next();
    const field = nameToken.text;
    if (!isQueryField(field)) {
      throw new QueryParseError(`unknown field: ${field}`);
    }

    // The method form: `content.contains("x")`.
    if (this.isSymbol('.')) {
      this.next();
      const operatorToken = this.next();
      if (operatorToken.kind !== 'ident' || !isQueryOperator(operatorToken.text)) {
        throw new QueryParseError(`unknown operator: ${operatorToken.text}`);
      }
      if (!this.isSymbol('(')) {
        throw new QueryParseError('expected a value');
      }
      this.next();
      const value = this.parseValue();
      if (!this.isSymbol(')')) {
        throw new QueryParseError('expected )');
      }
      this.next();
      return this.makeComparison(field, operatorToken.text, value);
    }

    const operatorToken = this.peek();
    if (operatorToken.kind === 'symbol' && isQueryOperator(operatorToken.text)) {
      this.next();
      const value = this.parseValue();
      return this.makeComparison(field, operatorToken.text, value);
    }
    if (operatorToken.kind === 'ident') {
      if (isQueryOperator(operatorToken.text)) {
        this.next();
        const value = this.parseValue();
        return this.makeComparison(field, operatorToken.text, value);
      }
      throw new QueryParseError(`unknown operator: ${operatorToken.text}`);
    }
    if (operatorToken.kind === 'symbol') {
      // The logical operators and the closing parenthesis end the comparison:
      // the field stands alone (a boolean field on its own).
      if (operatorToken.text !== '&&' && operatorToken.text !== '||' && operatorToken.text !== ')') {
        throw new QueryParseError(`unknown operator: ${operatorToken.text}`);
      }
    }

    // The field stands alone: only a boolean field may do that.
    if (fieldType(field) === 'boolean') {
      return { k: 'truthy', f: field };
    }
    if (operatorToken.kind === 'eof') {
      throw new QueryParseError('unexpected end of query');
    }
    throw new QueryParseError('expected a value');
  }

  private makeComparison(field: QueryField, operator: QueryOperator, value: QueryValue): QueryNode {
    if (!operatorFits(operator, field)) {
      throw new QueryParseError(`operator ${operator} does not fit the field ${field}`);
    }
    if (operator === 'in' && value.k !== 'list') {
      throw new QueryParseError('expected a value');
    }
    return { k: 'cmp', f: field, op: operator, v: value };
  }

  private parseValue(): QueryValue {
    const token = this.peek();

    if (token.kind === 'string') {
      this.next();
      const value: StrValue = { k: 'str', v: token.value as string };
      return value;
    }

    if (token.kind === 'number') {
      this.next();
      const value: NumValue = { k: 'num', v: token.value as number };
      return value;
    }

    if (token.kind === 'ident') {
      if (token.text === 'true' || token.text === 'false') {
        this.next();
        const value: BoolValue = { k: 'bool', v: token.text === 'true' };
        return value;
      }
      if (token.text === 'now' || token.text === 'today') {
        this.next();
        if (this.isSymbol('-')) {
          this.next();
          const amount = this.peek();
          if (amount.kind !== 'number') {
            throw new QueryParseError('expected a value');
          }
          this.next();
          const unit = this.next();
          const factor = DURATION_UNITS[unit.text];
          if (factor === undefined) {
            throw new QueryParseError(`unexpected token: ${unit.text}`);
          }
          const value: RelValue = {
            k: 'rel',
            base: token.text as 'now' | 'today',
            off: -(amount.value as number) * factor,
          };
          return value;
        }
        return token.text === 'now' ? { k: 'now' } : { k: 'today' };
      }
    }

    if (token.kind === 'symbol' && token.text === '[') {
      this.next();
      const items: QueryValue[] = [];
      if (!this.isSymbol(']')) {
        for (;;) {
          items.push(this.parseValue());
          if (this.isSymbol(',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      if (!this.isSymbol(']')) {
        throw new QueryParseError('expected ]');
      }
      this.next();
      const value: ListValue = { k: 'list', items };
      return value;
    }

    throw new QueryParseError('expected a value');
  }
}

/**
 * Parses a query into the IR.
 *
 * An empty query is not an error: it matches nothing, so the result is
 * `null`. Any other problem throws a `QueryParseError` whose message is one
 * of the messages of the specification.
 */
export function parseQuery(source: string): QueryNode | null {
  if (source.trim() === '') return null;
  const parser = new Parser(tokenize(source));
  const node = parser.parse();
  if (parser.peek().kind !== 'eof') {
    const token = parser.peek();
    throw new QueryParseError(`unexpected token: ${token.text}`);
  }
  return node;
}
