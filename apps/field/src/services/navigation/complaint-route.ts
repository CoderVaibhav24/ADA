// The complaint detail exists in both tab stacks under one URL; callers name the stack so the right tab stays raised.
export const COMPLAINT_IN_COMPLAINTS = '/(app)/(tabs)/(complaints)/complaint/[caseRef]' as const;
export const COMPLAINT_IN_INSPECTIONS = '/(app)/(tabs)/(inspections)/complaint/[caseRef]' as const;

// The complaint detail inside the tab the caller came from.
export function complaintPath(tab: 'complaints' | 'inspections') {
  return tab === 'inspections' ? COMPLAINT_IN_INSPECTIONS : COMPLAINT_IN_COMPLAINTS;
}
