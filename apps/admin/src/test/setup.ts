import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';

// Tests check what the console shows, not how it moves: every animation
// jumps straight to its end.
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
});
