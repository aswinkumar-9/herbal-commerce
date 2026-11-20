import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { listAudit } from './audit-api';
import type { AuditQuery } from './audit-api';

export const auditKeys = {
  all: ['audit'] as const,
  list: (query: Omit<AuditQuery, 'before'>) => ['audit', query] as const,
};

// The log a page at a time, newest first: each page's nextBefore asks for
// the next, older one. While other filters load, the last list stays.
export function useAuditPages(query: Omit<AuditQuery, 'before'>) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(query),
    queryFn: ({ pageParam, signal }) =>
      listAudit({ ...query, before: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    placeholderData: keepPreviousData,
  });
}
