import { useEffect, useState } from 'react';
import { todayInIndia } from '../stock/batch-forms';
import { addDays } from './sales-periods';

// Today in India, moving on to the next day at midnight there while the
// page stays open.
export function useIndiaToday(): string {
  const [today, setToday] = useState(() => todayInIndia(new Date()));
  useEffect(() => {
    const midnight =
      Date.parse(`${addDays(today, 1)}T00:00:00.000Z`) - 330 * 60_000;
    const timer = window.setTimeout(
      () => setToday(todayInIndia(new Date())),
      Math.max(1_000, midnight - Date.now() + 1_000),
    );
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}
