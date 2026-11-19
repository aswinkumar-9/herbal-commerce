// The design system (ADR 0036): the foundations every look shares, and the
// looks. The console and the website read the CSS made from them
// (css/<look>.css); the apps can read these values as they are.
import { CONSOLE_MOTION, consoleLook } from './looks/console.ts';
import { SHOP_MOTION, shopLook } from './looks/shop.ts';

export * from './foundations.ts';
export * from './color.ts';
export * from './theme.ts';
export type { Group, Look, Palette } from './look.ts';
export { CONSOLE_MOTION, consoleLook, SHOP_MOTION, shopLook };

export const LOOKS = [consoleLook, shopLook] as const;
