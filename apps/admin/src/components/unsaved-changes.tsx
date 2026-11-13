import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface UnsavedChanges {
  // The question, for the page to show.
  prompt: ReactNode;
  // Lets the next move through: call it right before leaving after a save,
  // as the page has not yet drawn itself without the changes.
  allowLeaving: () => void;
}

// Asks before staff leave a page whose changes are not saved: a link, the
// menu, the back button, or closing or reloading the tab. Signing out (by
// hand or after 30 idle minutes) is never held up: the page closes first.
export function useUnsavedChanges(when: boolean): UnsavedChanges {
  // Read when staff try to leave, not when the page was drawn.
  const unsaved = useRef(when);
  useEffect(() => {
    unsaved.current = when;
  }, [when]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      unsaved.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const allowLeaving = useCallback(() => {
    unsaved.current = false;
  }, []);

  // Closing or reloading the tab: the browser asks, in its own words.
  useEffect(() => {
    if (!when) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);

  const stay = () => blocker.reset?.();
  const prompt = (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={stay}
      tone="danger"
      title="Leave without saving?"
      description={
        <p>
          Your changes on this page are not saved yet. If you leave, they are
          lost.
        </p>
      }
      actions={
        <>
          <Button onClick={stay}>Keep editing</Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Leave without saving
          </Button>
        </>
      }
    />
  );
  return { prompt, allowLeaving };
}
