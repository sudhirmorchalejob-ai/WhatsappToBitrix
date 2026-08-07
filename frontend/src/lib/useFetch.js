import { useState, useEffect, useCallback, useRef } from 'react';

// TTL cache (module-level so it survives component unmount/remount and is
// shared across every page). Keyed by `token:path` so different sessions
// never see each other's data.
const cache = new Map();
// In-flight request map: concurrent mounters of the same URL share one
// network call instead of firing duplicate requests.
const inflight = new Map();

// Minimum time a fresh load must show the loader, so fast responses don't
// cause a flicker of skeleton -> content.
const MIN_LOADING_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function clearApiCache() {
  cache.clear();
  inflight.clear();
}

async function fetchPayload(path, token, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  // The API envelope is { success, data, meta } — expose the `data` payload
  // so every view consumes the same shape regardless of backend contract.
  return json?.data ?? null;
}

/**
 * Data-fetching hook with built-in caching, polling, and loading/error state.
 *
 * @param {string|null} path  URL to fetch; pass null/skip to disable.
 * @param {object} opts
 *   - token       bearer token (required unless `skip`)
 *   - ttl         cache freshness in ms (default 15000)
 *   - poll        if > 0, re-fetch in the background every `poll` ms
 *   - skip        when true the request is not issued
 * @returns {{ data, error, loading, refreshing, refetch, setData }}
 *   - data        payload (cached value is returned instantly when fresh)
 *   - loading     true only while the FIRST load of that URL is in flight
 *   - refreshing  true during background/poll refetches
 *   - refetch     manually re-fetch; { force:true } bypasses cache,
 *                 { background:true } refreshes without flipping `loading`
 */
export function useFetch(path, { token, ttl = 15000, poll = 0, skip = false } = {}) {
  const cacheKey = token && path ? `${token}:${path}` : null;
  const cached = cacheKey ? cache.get(cacheKey) : undefined;
  const cachedFresh = Boolean(cached && Date.now() - cached.fetchedAt < ttl);

  // Restore a fresh cache entry synchronously so re-mounting a page shows
  // data instantly (no skeleton flash) while it silently refreshes.
  const [data, setData] = useState(cachedFresh ? cached.data : undefined);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!cachedFresh);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode = 'initial') => {
      if (!path || skip || !token) return;
      const reqId = ++requestRef.current;
      const key = `${token}:${path}`;

      if (mode === 'initial') {
        const entry = cache.get(key);
        if (entry && Date.now() - entry.fetchedAt < ttl) {
          setData(entry.data);
          setError(null);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const startedAt = Date.now();
      try {
        let promise = inflight.get(key);
        if (!promise) {
          promise = fetchPayload(path, token).then((payload) => {
            cache.set(key, { data: payload, fetchedAt: Date.now() });
            inflight.delete(key);
            return payload;
          });
          // remove the shared promise if the underlying call rejects
          promise.catch(() => inflight.delete(key));
          inflight.set(key, promise);
        }
        const result = await promise;

        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_LOADING_MS) await sleep(MIN_LOADING_MS - elapsed);
        if (reqId !== requestRef.current) return;

        setData(result);
        setError(null);
      } catch (err) {
        if (reqId !== requestRef.current) return;
        setError(err.message || 'Failed to load data');
      } finally {
        if (reqId === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path, token, ttl, skip]
  );

  // Initial + path/token/skip change
  useEffect(() => {
    if (!path || skip || !token) return;
    load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, token, skip, load]);

  // Background polling (stops while the tab is hidden)
  useEffect(() => {
    if (!poll || !path || skip || !token) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      load('refresh');
    }, poll);
    return () => clearInterval(timer);
  }, [poll, path, skip, token, load]);

  const refetch = useCallback(
    (opts = {}) => {
      const cacheKey = `${token}:${path}`;
      if (opts.force) {
        inflight.delete(cacheKey);
        cache.delete(cacheKey);
      }
      return load(opts.background ? 'refresh' : 'initial');
    },
    [load, path, token]
  );

  return { data, error, loading, refreshing, refetch, setData };
}
