import { describe, expect, it } from 'vitest';
import { DURATION, rise, STAGGER, transition } from './motion';

describe('the motion', () => {
  it('stays between 150 and 250 ms, so it never slows staff down', () => {
    for (const seconds of Object.values(DURATION)) {
      expect(seconds).toBeGreaterThanOrEqual(0.15);
      expect(seconds).toBeLessThanOrEqual(0.25);
    }
    expect(transition.duration).toBe(DURATION.base);
    expect(STAGGER).toBeLessThanOrEqual(0.05);
  });

  it('moves a card only a few pixels, and leaves faster than it arrives', () => {
    expect(rise.hidden).toEqual({ opacity: 0, y: 8 });
    expect(rise.shown).toMatchObject({ opacity: 1, y: 0 });
    expect(rise.gone).toMatchObject({
      opacity: 0,
      transition: { duration: DURATION.fast },
    });
  });
});
