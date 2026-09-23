/**
 * StatusChip — the fixed status-to-colour map, shared with the portal. ui-tokens.md §1.
 * Changing a colour here without changing docs/Agents/ui-tokens.md breaks that contract.
 */

import { Chip, type ChipProps } from '../atoms';
import { type ColorToken } from '../tokens';

export type CaseStatus = 'new' | 'scheduled' | 'in_progress' | 'completed' | 'overdue';

const tones: Record<CaseStatus, ColorToken> = {
  new: 'statusNew',
  scheduled: 'statusScheduled',
  in_progress: 'statusProgress',
  completed: 'statusDone',
  overdue: 'statusOverdue',
};

const labels: Record<CaseStatus, string> = {
  new: 'New',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  overdue: 'Overdue',
};

export type StatusChipProps = Omit<ChipProps, 'label' | 'tone'> & {
  status: CaseStatus;
  /** Override only for a status the API names differently; the colour stays mapped. */
  label?: string;
};

// The dot is on by default because a chip is scanned before it is read.
export function StatusChip({ status, label, dot = true, ...rest }: StatusChipProps) {
  return <Chip {...rest} dot={dot} label={label ?? labels[status]} tone={tones[status]} />;
}
