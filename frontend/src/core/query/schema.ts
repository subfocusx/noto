/**
 * The schema of the query language: the fields, their types and the
 * operators that fit them.
 *
 * See `docs/QUERY_LANGUAGE.md`, sections 2 and 3. The backend compiles the
 * same IR into SQL, so the names below are a contract.
 */

/** The type of a field. */
export type FieldType = 'string' | 'list' | 'boolean' | 'timestamp';

/** The fields of a note, with their types. */
export const QUERY_FIELDS = {
  path: 'string',
  name: 'string',
  title: 'string',
  tag: 'list',
  folder: 'string',
  ext: 'string',
  content: 'string',
  has_task_list: 'boolean',
  has_incomplete_tasks: 'boolean',
  has_code: 'boolean',
  has_image: 'boolean',
  has_link: 'boolean',
  has_attachments: 'boolean',
  created_at: 'timestamp',
  updated_at: 'timestamp',
} as const satisfies Record<string, FieldType>;

/** The name of a field. */
export type QueryField = keyof typeof QUERY_FIELDS;

/** Every operator of the language. */
export const QUERY_OPERATORS = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'in',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
] as const;

/** The name of an operator. */
export type QueryOperator = (typeof QUERY_OPERATORS)[number];

/** The operators that compare two timestamps. */
const TIMESTAMP_OPERATORS: readonly QueryOperator[] = ['>', '>=', '<', '<='];

/** The operators that compare a text with a text. */
const TEXT_OPERATORS: readonly QueryOperator[] = ['contains', 'startsWith', 'endsWith'];

/**
 * The fields whose text is matched by a regular expression.
 *
 * The operator `matches` looks for the expression in these fields: the path of
 * the note, its name, its title, its folder, its extension, its text and its
 * tags.
 */
const REGEX_FIELDS: readonly QueryField[] = [
  'path',
  'name',
  'title',
  'folder',
  'ext',
  'content',
  'tag',
];

/** The fields every operator works with. */
const ALL_FIELDS: readonly QueryField[] = Object.keys(QUERY_FIELDS) as QueryField[];

/**
 * True when the name is a field of the language.
 */
export function isQueryField(name: string): name is QueryField {
  return Object.prototype.hasOwnProperty.call(QUERY_FIELDS, name);
}

/**
 * The type of a field.
 */
export function fieldType(field: QueryField): FieldType {
  return QUERY_FIELDS[field];
}

/**
 * True when the name is an operator of the language.
 */
export function isQueryOperator(name: string): name is QueryOperator {
  return (QUERY_OPERATORS as readonly string[]).includes(name);
}

/**
 * True when the operator exists and fits the field.
 *
 * `==` and `!=` work with every field, the comparison operators only with
 * the timestamps, `in` only with the list of tags, `contains` only with the
 * text of a note and `startsWith` / `endsWith` only with its path-like
 * fields. `matches` works with the fields that hold the text of a note.
 */
export function operatorFits(operator: QueryOperator, field: QueryField): boolean {
  if (operator === '==' || operator === '!=') return true;
  if (operator === 'in') return field === 'tag';
  if (operator === 'matches') return REGEX_FIELDS.includes(field);
  if (TIMESTAMP_OPERATORS.includes(operator)) {
    return field === 'created_at' || field === 'updated_at';
  }
  if (TEXT_OPERATORS.includes(operator)) {
    if (operator === 'contains') return field === 'content' || field === 'name';
    return field === 'path' || field === 'name' || field === 'title' || field === 'folder';
  }
  return false;
}

/** Every field, in the order of the documentation. */
export const ALL_QUERY_FIELDS: readonly QueryField[] = ALL_FIELDS;
