import { Dialog } from './Dialog';
import { TrashList } from './TrashList';

export interface TrashPanelProps {
  open: boolean;
  onClose(): void;
  onRestored(): void;
}

export function TrashPanel(props: TrashPanelProps) {
  return (
    <Dialog title="Trash" open={props.open} onClose={props.onClose}>
      <TrashList onRestored={props.onRestored} />
    </Dialog>
  );
}
