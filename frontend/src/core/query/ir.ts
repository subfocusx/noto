/**
 * The intermediate representation of the query language.
 *
 * The IR is the contract between the two implementations of the language:
 * the backend compiles it into SQL, the browser compiles it into a predicate
 * over the notes of the vault. The canonical JSON of a node is the JSON of
 * the golden vectors (`shared/query-vectors.json`).
 */

import type { QueryField, QueryOperator } from './schema';

/** A conjunction. */
export interface AndNode {
  readonly k: 'and';
  readonly l: QueryNode;
  readonly r: QueryNode;
}

/** A disjunction. */
export interface OrNode {
  readonly k: 'or';
  readonly l: QueryNode;
  readonly r: QueryNode;
}

/** A negation. */
export interface NotNode {
  readonly k: 'not';
  readonly e: QueryNode;
}

/** A comparison of a field with a value. */
export interface CmpNode {
  readonly k: 'cmp';
  readonly f: QueryField;
  readonly op: QueryOperator;
  readonly v: QueryValue;
}

/** A boolean field on its own: the field is true. */
export interface TruthyNode {
  readonly k: 'truthy';
  readonly f: QueryField;
}

/** Every node of the IR. */
export type QueryNode = AndNode | OrNode | NotNode | CmpNode | TruthyNode;

/** A string value. */
export interface StrValue {
  readonly k: 'str';
  readonly v: string;
}

/** A number value. */
export interface NumValue {
  readonly k: 'num';
  readonly v: number;
}

/** A boolean value. */
export interface BoolValue {
  readonly k: 'bool';
  readonly v: boolean;
}

/** A list of values. The list is never null, it may be empty. */
export interface ListValue {
  readonly k: 'list';
  readonly items: QueryValue[];
}

/** The moment of the execution of the query. */
export interface NowValue {
  readonly k: 'now';
}

/** The midnight of the day of the execution, in the local time. */
export interface TodayValue {
  readonly k: 'today';
}

/** A moment relative to `now` or `today`: `base` plus `off` seconds. */
export interface RelValue {
  readonly k: 'rel';
  readonly base: 'now' | 'today';
  readonly off: number;
}

/** Every value of the IR. */
export type QueryValue =
  | StrValue
  | NumValue
  | BoolValue
  | ListValue
  | NowValue
  | TodayValue
  | RelValue;

/** Every node or value of the IR. */
export type QueryTerm = QueryNode | QueryValue;

/**
 * The canonical JSON of a node or a value: a plain object with the same
 * keys as the golden vectors, in the same order.
 */
export function toCanonical(term: QueryTerm | null): unknown {
  if (term === null) return null;
  switch (term.k) {
    case 'and':
      return { k: 'and', l: toCanonical(term.l), r: toCanonical(term.r) };
    case 'or':
      return { k: 'or', l: toCanonical(term.l), r: toCanonical(term.r) };
    case 'not':
      return { k: 'not', e: toCanonical(term.e) };
    case 'cmp':
      return { k: 'cmp', f: term.f, op: term.op, v: toCanonical(term.v) };
    case 'truthy':
      return { k: 'truthy', f: term.f };
    case 'str':
      return { k: 'str', v: term.v };
    case 'num':
      return { k: 'num', v: term.v };
    case 'bool':
      return { k: 'bool', v: term.v };
    case 'list':
      return { k: 'list', items: term.items.map((item) => toCanonical(item)) };
    case 'now':
      return { k: 'now' };
    case 'today':
      return { k: 'today' };
    case 'rel':
      return { k: 'rel', base: term.base, off: term.off };
    default:
      return null;
  }
}

/**
 * The canonical JSON of a node or a value, as a string.
 */
export function canonicalJson(term: QueryTerm | null): string {
  return JSON.stringify(toCanonical(term));
}
