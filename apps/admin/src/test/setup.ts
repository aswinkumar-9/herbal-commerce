import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';

// Tests check what the console shows, not how it moves: every animation
// jumps straight to its end.
MotionGlobalConfig.skipAnimations = true;

// A page's first test signs in and draws the page from cold while every
// other test file runs too: on a busy computer that takes over the usual
// second. A wait gives up after 3 instead; a test that passes is no slower.
configure({ asyncUtilTimeout: 3000 });

// jsdom has <dialog> but not its methods: enough of them for the tests. The
// real modal behaviour (the page behind cannot be reached) is the browser's.
HTMLDialogElement.prototype.showModal ??= function showModal(
  this: HTMLDialogElement,
) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  if (this.hasAttribute('open')) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setAccessToken(null);
  localStorage.clear();
});
