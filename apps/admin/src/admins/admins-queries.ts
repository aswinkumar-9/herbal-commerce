import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { listAdmins } from './admins-api';
import type { Admin } from './admins-api';

export const adminKeys = {
  all: ['admins'] as const,
  list: () => ['admins', 'list'] as const,
};

// Every Admin, the first invited first. Read again when the console comes
// back into view, so an invitation accepted meanwhile shows.
export function useAdmins() {
  return useQuery({
    queryKey: adminKeys.list(),
    queryFn: ({ signal }) => listAdmins(signal),
  });
}

// An Admin as the server now has it: in the list at once, then the list
// read again, as others may have changed meanwhile.
export function adminChanged(queryClient: QueryClient, saved: Admin): void {
  queryClient.setQueryData<Admin[]>(adminKeys.list(), (admins) =>
    admins?.map((admin) => (admin.id === saved.id ? saved : admin)),
  );
  void queryClient.invalidateQueries({ queryKey: adminKeys.all });
}

// Anything else, such as an invitation: the list is read again.
export function adminsChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: adminKeys.all });
}
