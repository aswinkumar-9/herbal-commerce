import type { PackUnit } from './catalog.server.ts';
import { count } from './price.ts';
import { text } from './text/en.ts';

// A pack's net quantity, as its label gives it: 60 capsules, 1,000 g.
export const packName = ({
  quantity,
  unit,
}: {
  quantity: number;
  unit: PackUnit;
}): string => text.productPage.units[unit](count(quantity));

// A cart holds at most 4 packs of one product, all its pack sizes
// together (ADR 0025).
export const MOST_PACKS = 4;

// How many packs a customer may choose at once: 1 to 4.
export const PACK_CHOICES = [1, 2, 3, 4] as const;
