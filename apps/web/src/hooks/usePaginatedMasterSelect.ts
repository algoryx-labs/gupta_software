import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PaginatedResponse } from '@gupta/shared';

const DEFAULT_PAGE_SIZE = 50;

type FetchPageFn<T> = (params: {
  page: number;
  limit: number;
  search?: string;
}) => Promise<PaginatedResponse<T>>;

export function usePaginatedMasterSelect<T extends { _id: string }>({
  queryKey,
  fetchPage,
  enabled = true,
  pageSize = DEFAULT_PAGE_SIZE,
  debounceMs = 300,
}: {
  queryKey: string[];
  fetchPage: FetchPageFn<T>;
  enabled?: boolean;
  pageSize?: number;
  debounceMs?: number;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), debounceMs);
    return () => window.clearTimeout(timer);
  }, [search, debounceMs]);

  const query = useInfiniteQuery({
    queryKey: [...queryKey, debouncedSearch],
    queryFn: ({ pageParam }) =>
      fetchPage({
        page: pageParam,
        limit: pageSize,
        search: debouncedSearch || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
    enabled,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.data) {
        if (!seen.has(item._id)) {
          seen.add(item._id);
          result.push(item);
        }
      }
    }
    return result;
  }, [query.data]);

  const resetSearch = () => {
    setSearch('');
    setDebouncedSearch('');
  };

  return {
    items,
    search,
    setSearch,
    resetSearch,
    debouncedSearch,
    fetchNextPage: query.fetchNextPage,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
  };
}
