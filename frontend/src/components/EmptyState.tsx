import type { ComponentChildren } from 'preact';
import { Icon } from '../ui/icons';

export interface EmptyStateProps {
  /** The name of an icon of the registry; an unknown name falls back to a dot. */
  icon?: string;
  title: string;
  description?: string;
  action?: ComponentChildren;
}

/**
 * The placeholder of an empty pane.
 *
 * The component does not set a test id: the shell that hosts it owns the
 * `empty-state` test id, so the same component can be used more than once.
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="empty-state">
      {props.icon ? (
        <span class="empty-state-icon">
          <Icon name={props.icon} size={32} />
        </span>
      ) : null}
      <h2>{props.title}</h2>
      {props.description ? <p>{props.description}</p> : null}
      {props.action ? <div class="empty-state-action">{props.action}</div> : null}
    </div>
  );
}
