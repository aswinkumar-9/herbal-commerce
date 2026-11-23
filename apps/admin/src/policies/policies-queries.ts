import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  getPolicyPage,
  getVersion,
  listPolicyPages,
  listVersions,
} from './policies-api';
import type { PolicyPageDetail } from './policies-api';
import type { PolicyPageName } from './policy-pages';

export const policyKeys = {
  all: ['policies'] as const,
  list: () => ['policies', 'list'] as const,
  page: (page: PolicyPageName) => ['policies', 'page', page] as const,
  versions: (page: PolicyPageName) => ['policies', 'versions', page] as const,
  version: (page: PolicyPageName, version: number) =>
    ['policies', 'version', page, version] as const,
};

export function usePolicyPages() {
  return useQuery({
    queryKey: policyKeys.list(),
    queryFn: ({ signal }) => listPolicyPages(signal),
  });
}

// Read again when the console comes back into view, so a change another
// Super User saved meanwhile shows.
export function usePolicyPage(page: PolicyPageName) {
  return useQuery({
    queryKey: policyKeys.page(page),
    queryFn: ({ signal }) => getPolicyPage(page, signal),
  });
}

// The versions a page at a time, the newest first: each page's nextBefore
// asks for the next, older one.
export function usePolicyVersions(page: PolicyPageName) {
  return useInfiniteQuery({
    queryKey: policyKeys.versions(page),
    queryFn: ({ pageParam, signal }) => listVersions(page, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

// A published version never changes, so once read it is kept.
export function usePolicyVersion(page: PolicyPageName, version: number) {
  return useQuery({
    queryKey: policyKeys.version(page, version),
    queryFn: ({ signal }) => getVersion(page, version, signal),
    staleTime: Infinity,
  });
}

// A page as the server now has it: shown at once, then the list and the
// versions read again.
export function policyChanged(
  queryClient: QueryClient,
  saved: PolicyPageDetail,
): void {
  queryClient.setQueryData(policyKeys.page(saved.page), saved);
  void queryClient.invalidateQueries({ queryKey: policyKeys.list() });
  void queryClient.invalidateQueries({
    queryKey: policyKeys.versions(saved.page),
  });
}
