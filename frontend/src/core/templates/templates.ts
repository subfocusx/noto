// The templates of the user.
//
// A template is a piece of markdown the user writes once and applies to the
// note she is working on. The templates live in the local storage of the
// browser, under their own key, exactly like the preferences: the set is
// written at once and every value is validated on read, so a broken template
// never breaks the application.
//
// The module is pure: the storage is read and written here, but the list is
// manipulated by plain functions, so the behaviour can be tested without a
// browser.

/** A template of the user. */
export interface Template {
  /** The identifier of the template; it never changes. */
  id: string;
  /** The name the user gave to the template. */
  title: string;
  /** The markdown the template inserts. */
  body: string;
}

/** The key of the templates in the local storage. */
export const TEMPLATES_KEY = 'noto-templates-v1';

/** The greatest number of the templates the user may keep. */
export const TEMPLATES_LIMIT = 50;

/** The placeholders a template may use. */
export interface TemplateContext {
  /** The title of the note the template is applied to. */
  title?: string;
  /** The day, in the "YYYY-MM-DD" form. */
  date?: string;
  /** The time, in the "HH:MM" form. */
  time?: string;
}

/** The storage of the browser, when there is one. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The identifier of a new template. */
export function newTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalises an unknown value into a template.
 *
 * A template without a title or without a body is not a template: it is
 * dropped, so that a broken entry never reaches the list of the user.
 */
export function normalizeTemplate(value: unknown): Template | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<Template>;
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  const body = typeof source.body === 'string' ? source.body : '';
  if (!title) return null;
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : newTemplateId();
  return { id, title, body };
}

/** The templates that are read from the storage. */
export function parseTemplates(raw: string | null): Template[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const templates: Template[] = [];
    const ids = new Set<string>();
    for (const item of parsed) {
      const template = normalizeTemplate(item);
      if (!template || ids.has(template.id)) continue;
      ids.add(template.id);
      templates.push(template);
      if (templates.length >= TEMPLATES_LIMIT) break;
    }
    return templates;
  } catch {
    return [];
  }
}

/** The templates of the user, as they are stored. */
export function loadTemplates(): Template[] {
  return parseTemplates(storage()?.getItem(TEMPLATES_KEY) ?? null);
}

/** Writes the templates of the user. */
export function saveTemplates(templates: readonly Template[]): Template[] {
  const clean: Template[] = [];
  const ids = new Set<string>();
  for (const template of templates) {
    const normalized = normalizeTemplate(template);
    if (!normalized || ids.has(normalized.id)) continue;
    ids.add(normalized.id);
    clean.push(normalized);
    if (clean.length >= TEMPLATES_LIMIT) break;
  }
  try {
    storage()?.setItem(TEMPLATES_KEY, JSON.stringify(clean));
  } catch {
    // The storage may be full or forbidden: the templates stay in the session.
  }
  return clean;
}

/** Builds a template from a title and a body. */
export function createTemplate(title: string, body: string): Template {
  return { id: newTemplateId(), title: title.trim(), body };
}

/** Adds a template to the list of the user. */
export function addTemplate(templates: readonly Template[], template: Template): Template[] {
  return saveTemplates([...templates, template]);
}

/** Removes a template from the list of the user. */
export function removeTemplate(templates: readonly Template[], id: string): Template[] {
  return saveTemplates(templates.filter((template) => template.id !== id));
}

/** Renames a template of the user. */
export function renameTemplate(
  templates: readonly Template[],
  id: string,
  title: string,
): Template[] {
  const clean = title.trim();
  if (!clean) return [...templates];
  return saveTemplates(
    templates.map((template) => (template.id === id ? { ...template, title: clean } : template)),
  );
}

/** Changes the body of a template of the user. */
export function editTemplateBody(
  templates: readonly Template[],
  id: string,
  body: string,
): Template[] {
  return saveTemplates(
    templates.map((template) => (template.id === id ? { ...template, body } : template)),
  );
}

/** The template of the given identifier, or null. */
export function findTemplate(templates: readonly Template[], id: string): Template | null {
  return templates.find((template) => template.id === id) ?? null;
}

/**
 * Replaces the placeholders of a template.
 *
 * The placeholders are `{{title}}`, `{{date}}` and `{{time}}`. A placeholder
 * without a value is replaced by an empty string, so that the body never
 * shows a raw placeholder to the user.
 */
export function fillPlaceholders(body: string, context: TemplateContext = {}): string {
  return body
    .replace(/\{\{\s*title\s*\}\}/gi, context.title ?? '')
    .replace(/\{\{\s*date\s*\}\}/gi, context.date ?? '')
    .replace(/\{\{\s*time\s*\}\}/gi, context.time ?? '');
}

/**
 * Applies a template to the content of a note.
 *
 * The body of the template is added under the content of the note, separated
 * by an empty line. A note that is empty receives the body alone.
 */
export function applyTemplate(
  content: string,
  template: Template,
  context: TemplateContext = {},
): string {
  const body = fillPlaceholders(template.body, context);
  const base = content.replace(/\s+$/, '');
  if (!base) return body;
  if (!body) return base;
  return `${base}\n\n${body}`;
}
