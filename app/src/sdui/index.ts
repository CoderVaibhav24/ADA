/*
 * Server-driven UI. A screen is a JSON definition served by `/api/app/screens`,
 * rendered from the design system through a fixed component and action registry.
 * docs/Agents-Mobile/sdui.md is the reference.
 */
export { SDUI_RUNTIME, SUPPORTED_SCHEMA_VERSIONS } from './contract';
export { SduiScreen, hasOwnHeader, type SduiScreenProps } from './SduiScreen';
export { sduiKeys, useScreenDefinition, useScreenIndex } from './screen-api';
export type { ScreenEnvelope, ScreenIndexItem, SduiNode } from './types';
