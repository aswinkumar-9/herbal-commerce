import { useState } from 'react';

// The time when a part of the page first drew, so drawing it again gives
// the same answer. Stock dates are days, so a page open for hours is still
// right; a new day is read on the next visit.
export function useNow(): Date {
  const [now] = useState(() => new Date());
  return now;
}
