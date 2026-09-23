/**
 * PriorityChip — HIGH / MEDIUM / LOW, with the priority colour map from ui-tokens.md §1.
 */

import { Chip, type ChipProps } from '../atoms';
import { type ColorToken } from '../tokens';

export type CasePriority = 'high' | 'medium' | 'low';

const tones: Record<CasePriority, ColorToken> = {
  high: 'priorityHigh',
  medium: 'priorityMedium',
  low: 'priorityLow',
};

const labels: Record<CasePriority, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export type PriorityChipProps = Omit<ChipProps, 'label' | 'tone'> & {
  priority: CasePriority;
};

// Priority reads as a filled pill on the complaint card, which is how the designs draw it.
export function PriorityChip({ priority, appearance = 'solid', size = 'sm', ...rest }: PriorityChipProps) {
  return (
    <Chip
      {...rest}
      appearance={appearance}
      size={size}
      label={labels[priority]}
      tone={tones[priority]}
      accessibilityLabel={`Priority ${labels[priority]}`}
    />
  );
}
