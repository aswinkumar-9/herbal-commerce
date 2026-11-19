// The design system (ADR 0036): the foundations every look shares, and the
// looks. The console and the website read the CSS made from them
// (css/<look>.css); the apps can read these values as they are.
import { CONSOLE_MOTION, consoleLook } from './looks/console.ts';

export * from './foundations.ts';
export * from './color.ts';
export type { Group, Look, Palette } from './look.ts';
export { CONSOLE_MOTION, consoleLook };

export const LOOKS = [consoleLook] as const;
