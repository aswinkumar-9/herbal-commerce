import { useLocation } from 'react-router';

// A list's filters, when staff came from it (passed as the link's state),
// so the way back goes to the list as they left it.
export function useListSearch(): string {
  const { state } = useLocation() as { state: unknown };
  const search =
    state && typeof state === 'object' && 'listSearch' in state
      ? state.listSearch
      : '';
  return typeof search === 'string' ? search : '';
}
