// The tests of the templates of the user.
//
// A template is a piece of markdown the user writes once and applies to the
// note she is working on. The templates live in the local storage of the
// browser, like the preferences.
import { afterEach, describe, expect, it } from 'vitest';
import {
  addTemplate,
  applyTemplate,
  createTemplate,
  editTemplateBody,
  fillPlaceholders,
  findTemplate,
  loadTemplates,
  normalizeTemplate,
  parseTemplates,
  removeTemplate,
  renameTemplate,
  TEMPLATES_KEY,
} from '../core/templates/templates';

afterEach(() => {
  localStorage.clear();
});

describe('the templates of the user', () => {
  it('reads the templates of the storage', () => {
    localStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([{ id: 'a', title: 'Meeting', body: '# Meeting' }]),
    );
    expect(loadTemplates()).toEqual([{ id: 'a', title: 'Meeting', body: '# Meeting' }]);
  });

  it('reads nothing out of a broken storage', () => {
    localStorage.setItem(TEMPLATES_KEY, 'not a list');
    expect(loadTemplates()).toEqual([]);
  });

  it('drops the templates without a title', () => {
    expect(parseTemplates(JSON.stringify([{ id: 'a', title: '  ', body: 'x' }]))).toEqual([]);
  });

  it('gives a template without an identifier a new one', () => {
    const template = normalizeTemplate({ title: 'Note', body: '' });
    expect(template?.id).toBeTruthy();
    expect(template?.title).toBe('Note');
  });

  it('adds a template to the list of the user', () => {
    const template = createTemplate('Meeting', '# Meeting');
    const list = addTemplate([], template);
    expect(list).toHaveLength(1);
    expect(loadTemplates()).toHaveLength(1);
  });

  it('removes a template from the list of the user', () => {
    const template = createTemplate('Meeting', '# Meeting');
    const list = addTemplate([], template);
    expect(removeTemplate(list, template.id)).toEqual([]);
    expect(loadTemplates()).toEqual([]);
  });

  it('renames a template of the user', () => {
    const template = createTemplate('Meeting', '# Meeting');
    const list = addTemplate([], template);
    const renamed = renameTemplate(list, template.id, 'Daily');
    expect(findTemplate(renamed, template.id)?.title).toBe('Daily');
  });

  it('changes the body of a template of the user', () => {
    const template = createTemplate('Meeting', '# Meeting');
    const list = addTemplate([], template);
    const edited = editTemplateBody(list, template.id, '# Daily');
    expect(findTemplate(edited, template.id)?.body).toBe('# Daily');
  });
});

describe('the application of a template', () => {
  it('adds the body of the template under the note', () => {
    const template = createTemplate('Meeting', '# Meeting');
    expect(applyTemplate('Hello', template)).toBe('Hello\n\n# Meeting');
  });

  it('gives the body alone to an empty note', () => {
    const template = createTemplate('Meeting', '# Meeting');
    expect(applyTemplate('', template)).toBe('# Meeting');
  });

  it('replaces the placeholders of the template', () => {
    expect(fillPlaceholders('# {{title}} of {{date}}', { title: 'Note', date: '2026-10-24' })).toBe(
      '# Note of 2026-10-24',
    );
  });

  it('replaces a placeholder without a value by nothing', () => {
    expect(fillPlaceholders('# {{title}}')).toBe('# ');
  });
});
