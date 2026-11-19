import { ApiError } from '../api/api-error';
import { problemMessage } from '../api/problems';
import { markPacked } from './orders-api';
import type { Order, OrderSummary } from './orders-api';

// What became of each order chosen to be packed together.
export type PackResult =
  | { state: 'packed'; order: Order }
  // It moved on meanwhile (packed or cancelled by someone else), or is
  // gone. The rest still go.
  | { state: 'refused'; message: string }
  // Anything else: the run stops here.
  | { state: 'failed'; message: string }
  | { state: 'unsent' };

// Packs the chosen orders one at a time, in the order shown (ADR 0037).
// The API marks one order at a time, so each customer's email and each
// order's packs go exactly as if they were packed one by one. An order the
// API refuses because it moved on (409) or is gone (404) does not stop the
// others. Anything else does: an ended session, or a server that can't be
// reached or is busy, would refuse the rest the same way. Those are left
// unsent, to try again.
export async function packEach(
  orders: readonly OrderSummary[],
  onResult: (id: string, result: PackResult) => void,
): Promise<Map<string, PackResult>> {
  const results = new Map<string, PackResult>();
  let stopped = false;
  for (const order of orders) {
    let result: PackResult;
    if (stopped) {
      result = { state: 'unsent' };
    } else {
      try {
        result = { state: 'packed', order: await markPacked(order.id) };
      } catch (error) {
        const refused =
          error instanceof ApiError &&
          (error.status === 409 || error.status === 404);
        stopped = !refused;
        result = {
          state: refused ? 'refused' : 'failed',
          message: problemMessage(error),
        };
      }
    }
    results.set(order.id, result);
    onResult(order.id, result);
  }
  return results;
}
