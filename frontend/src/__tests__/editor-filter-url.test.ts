import { describe, expect, it } from 'vitest';
import { parseFilterUrl, serializeFilterUrl } from '../lib/editor/filterUrl';

describe('the filter and the address bar', () => {
  it('reads the query out of the address', () => {
    expect(parseFilterUrl('?q=tag%20%3D%3D%20%22work%22').query).toBe('tag == "work"');
  });

  it('reads the tag and the saved filter out of the address', () => {
    const state = parseFilterUrl('?tag=work&view=Today');
    expect(state.tag).toBe('work');
    expect(state.view).toBe('Today');
  });

  it('reads an empty address as an empty filter', () => {
    expect(parseFilterUrl('')).toEqual({ query: '', tag: null, view: null });
  });

  it('ignores an unknown parameter', () => {
    expect(parseFilterUrl('?other=1').query).toBe('');
  });

  it('takes the parameters of an object as well', () => {
    const params = new URLSearchParams();
    params.set('q', 'work');
    expect(parseFilterUrl(params).query).toBe('work');
  });

  it('writes the query into the address', () => {
    expect(serializeFilterUrl({ query: 'tag == "work"', tag: null, view: null })).toBe(
      '?q=tag+%3D%3D+%22work%22',
    );
  });

  it('writes nothing when the filter is empty', () => {
    expect(serializeFilterUrl({ query: '   ', tag: null, view: null })).toBe('');
  });

  it('writes the tag and the saved filter', () => {
    expect(serializeFilterUrl({ query: '', tag: 'work', view: null })).toBe('?tag=work');
    expect(serializeFilterUrl({ query: '', tag: null, view: 'Today' })).toBe('?view=Today');
  });

  it('reads back what it has written', () => {
    const state = { query: 'tag == "work"', tag: 'work', view: 'Today' };
    expect(parseFilterUrl(serializeFilterUrl(state))).toEqual(state);
  });
});
