import type { components } from './generated/ada-api';

/*
 * Names for the generated schemas, so callers write `Capabilities` instead of
 * `components['schemas']['CapabilitiesOut']`. Aliases only — no shape is
 * redeclared here. A hand-written interface beside a generated one is a second
 * source of truth that drifts silently, and the symptom is an empty field at
 * runtime instead of a type error at build time.
 */
export type Schemas = components['schemas'];

export type Capabilities = Schemas['CapabilitiesOut'];
export type CapabilityAction = Schemas['ActionOut'];
export type CodeValue = Schemas['CodeValueOut'];
export type CodeValuePage = Schemas['Page_CodeValueOut_'];
export type WorkflowTransition = Schemas['TransitionOut'];
export type CaseRow = Schemas['CaseRow'];
export type CasePage = Schemas['Page_CaseRow_'];
export type CaseDetail = Schemas['CaseDetail'];

// The inspection loop, Batch 3 (`backend/api/app/icms/inspection_schemas.py`).
export type InspectionRow = Schemas['InspectionRow'];
export type InspectionPage = Schemas['Page_InspectionRow_'];
export type InspectionDetail = Schemas['InspectionDetail'];
export type InspectionOpen = Schemas['InspectionOpen'];
export type CheckInCreate = Schemas['CheckInCreate'];
export type CheckInOut = Schemas['CheckInOut'];
export type EvidenceOut = Schemas['EvidenceOut'];
export type FindingsPut = Schemas['FindingsPut'];
export type SubmitRequest = Schemas['SubmitRequest'];
