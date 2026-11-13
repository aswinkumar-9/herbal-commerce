import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { Button } from './Button';
import { Dialog } from './Dialog';

// Whether a part of the page holds changes not saved yet.
type Report = (part: string, unsaved: boolean) => void;

const PartsOfPage = createContext<Report | null>(null);

interface UnsavedChanges {
  // The question, for the page to show.
  prompt: ReactNode;
  // Lets the next move through: call it right before leaving after a save,
  // as the page has not yet drawn itself without the changes.
  allowLeaving: () => void;
  // For UnsavedParts, around the parts of the page with changes of their own.
  report: Report;
}

// Asks before staff leave a page whose changes are not saved: a link, the
// menu, the back button, or closing or reloading the tab. Signing out (by
// hand or after 30 idle minutes) is never held up: the page closes first.
export function useUnsavedChanges(when: boolean): UnsavedChanges {
  // The parts of the page that hold changes, such as a dialog's form.
  const [parts, setParts] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<Report>((part, unsaved) => {
    setParts((current) => {
      if (current.has(part) === unsaved) {
        return current;
      }
      const next = new Set(current);
      if (unsaved) {
        next.add(part);
      } else {
        next.delete(part);
      }
      return next;
    });
  }, []);
  const anything = when || parts.size > 0;

  // Read when staff try to leave, not when the page was drawn.
  const unsaved = useRef(anything);
  useEffect(() => {
    unsaved.current = anything;
  }, [anything]);

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
    if (!anything) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anything]);

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
  return { prompt, allowLeaving, report };
}

// Around the parts of a page that hold changes of their own, such as a
// dialog's form or images still uploading. A router keeps one guard only
// (React Router asks the newest one, and warns), so they tell the page's.
export function UnsavedParts({
  report,
  children,
}: {
  report: Report;
  children: ReactNode;
}) {
  return <PartsOfPage.Provider value={report}>{children}</PartsOfPage.Provider>;
}

// For a part of a page, inside UnsavedParts: while `when` holds, staff are
// asked before they leave the page, as for the page's own changes.
export function useUnsavedPart(when: boolean): void {
  const report = useContext(PartsOfPage);
  const part = useId();
  useEffect(() => {
    if (!when || !report) {
      return;
    }
    report(part, true);
    return () => report(part, false);
  }, [report, part, when]);
  if (!report) {
    throw new Error('useUnsavedPart is used outside UnsavedParts');
  }
}
