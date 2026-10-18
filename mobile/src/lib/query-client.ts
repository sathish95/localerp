import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

// One client for the whole app. Cache is persisted to AsyncStorage so a
// cold start shows the last-known data instantly, then revalidates.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h — long enough for the persister to have something to restore
      retry: 2,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false, // RN has no window; AppState-driven refetch can be added later
    },
    mutations: { retry: 0 },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'neox-rq-cache-v1',
  throttleTime: 1000,
});
