// The templates of the user.
//
// The panel lists the templates the user wrote, lets her write new ones and
// applies a template to the note that is open.
//
// The templates live in the local storage of the browser (see
// `core/templates/templates.ts`); the panel reads them and writes them there.
import { useEffect, useState } from 'preact/hooks';
import {
  addTemplate,
  applyTemplate,
  createTemplate,
  loadTemplates,
  removeTemplate,
  type Template,
} from '../../core/templates/templates';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import '../../styles/panel-templates.css';

export interface TemplatePanelProps {
  /** The content of the note that is open. */
  content: string;
  /** Called with the new content of the note. */
  onChange(content: string): void;
  /** The name of the note that is open; the placeholders use it. */
  title?: string;
  /** Called when the user closes the panel. */
  onClose?(): void;
}

/** The day of today, in the form the placeholders use. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The panel of the templates.
 */
export function TemplatePanel(props: TemplatePanelProps) {
  const t = useT();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const save = (next: Template[]): void => {
    setTemplates(next);
  };

  const add = (): void => {
    const name = title.trim();
    if (!name) return;
    save(addTemplate(templates, createTemplate(name, body)));
    setTitle('');
    setBody('');
  };

  const apply = (template: Template): void => {
    props.onChange(applyTemplate(props.content, template, { title: props.title, date: today() }));
  };

  return (
    <div class="template-panel">
      <div class="template-header">
        <span class="template-title">{t('templates.title')}</span>
        {props.onClose ? (
          <button
            type="button"
            class="icon-button"
            title={t('templates.close')}
            aria-label={t('templates.close')}
            onClick={() => props.onClose?.()}
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>

      {templates.length === 0 ? (
        <p class="template-empty">{t('templates.empty')}</p>
      ) : (
        <ul class="template-list">
          {templates.map((template) => (
            <li key={template.id} class="template-item">
              <button
                type="button"
                class="template-apply"
                onClick={() => apply(template)}
                title={template.body}
              >
                {template.title}
              </button>
              <button
                type="button"
                class="icon-button"
                title={t('templates.remove')}
                aria-label={t('templates.removeTemplate', { name: template.title })}
                onClick={() => save(removeTemplate(templates, template.id))}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        class="template-form"
        aria-label={t('templates.new')}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          type="text"
          class="template-name-input"
          aria-label={t('templates.name')}
          placeholder={t('templates.namePlaceholder')}
          value={title}
          onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
        />
        <textarea
          class="template-body-input"
          aria-label={t('templates.body')}
          placeholder={t('templates.bodyPlaceholder')}
          value={body}
          onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)}
        />
        <button type="submit" class="q9-button" disabled={!title.trim()}>
          {t('common.add')}
        </button>
      </form>
    </div>
  );
}
