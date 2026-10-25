// The tests of the panel of the templates.
//
// The panel lists the templates of the user, writes new ones and applies a
// template to the note that is open.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { TemplatePanel } from '../components/sections/TemplatePanel';
import { createTemplate, TEMPLATES_KEY } from '../core/templates/templates';

afterEach(() => {
  localStorage.clear();
});

describe('the panel of the templates', () => {
  it('says that the user wrote no template yet', () => {
    render(<TemplatePanel content="" onChange={() => undefined} />);
    expect(screen.getByText('No template yet.')).toBeTruthy();
  });

  it('lists the templates of the user', () => {
    localStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([{ id: 'a', title: 'Meeting', body: '# Meeting' }]),
    );
    render(<TemplatePanel content="" onChange={() => undefined} />);
    expect(screen.getByText('Meeting')).toBeTruthy();
  });

  it('writes a new template', () => {
    render(<TemplatePanel content="" onChange={() => undefined} />);
    fireEvent.input(screen.getByLabelText('Name of the template'), { target: { value: 'Meeting' } });
    fireEvent.input(screen.getByLabelText('Body of the template'), {
      target: { value: '# Meeting' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Meeting');
  });

  it('applies a template to the note that is open', () => {
    localStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([{ id: 'a', title: 'Meeting', body: '# Meeting' }]),
    );
    const onChange = vi.fn();
    render(<TemplatePanel content="Hello" onChange={onChange} />);
    fireEvent.click(screen.getByText('Meeting'));
    expect(onChange).toHaveBeenCalledWith('Hello\n\n# Meeting');
  });

  it('removes a template of the user', () => {
    localStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([{ id: 'a', title: 'Meeting', body: '# Meeting' }]),
    );
    render(<TemplatePanel content="" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Meeting' }));
    expect(JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]')).toEqual([]);
  });

  it('keeps the template of the user in the storage', () => {
    const template = createTemplate('Meeting', '# Meeting');
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([template]));
    render(<TemplatePanel content="" onChange={() => undefined} />);
    expect(screen.getByText('Meeting')).toBeTruthy();
  });
});
