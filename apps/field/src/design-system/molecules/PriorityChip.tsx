/**
 * PriorityChip — HIGH / MEDIUM / LOW, with the priority colour map from ui-tokens.md §1.
 */

import { useT, type MessageKey } from '@/services/i18n';

import { Chip, type ChipProps } from '../atoms';
import { type ColorToken } from '../tokens';

export type CasePriority = 'high' | 'medium' | 'low';

const tones: Record<CasePriority, ColorToken> = {
  high: 'priorityHigh',
  medium: 'priorityMedium',
  low: 'priorityLow',
};

const labels = {
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
} as const satisfies Record<CasePriority, MessageKey>;

export type PriorityChipProps = Omit<ChipProps, 'label' | 'tone'> & {
  priority: CasePriority;
};

// Priority reads as a filled pill on the complaint card, which is how the designs draw it.
export function PriorityChip({ priority, appearance = 'solid', size = 'sm', ...rest }: PriorityChipProps) {
  const t = useT();
  const label = t(labels[priority]);
  return (
    <Chip
      {...rest}
      appearance={appearance}
      size={size}
      label={label}
      tone={tones[priority]}
      accessibilityLabel={t('priority.a11y', { level: label })}
    />
  );
}
