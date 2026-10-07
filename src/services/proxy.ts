const ALLOWED_DOMAINS = new Set([
  'magma.esdm.go.id',
  'www.bmkg.go.id',
  'data.bmkg.go.id',
  'api.bmkg.go.id',
  'inderaja.bmkg.go.id',
  'web-aviation.bmkg.go.id',
  'aviation.bmkg.go.id',
  'inasiam.bmkg.go.id',
  'inasiam.rack.my.id',
  'api.rss2json.com',
  'gis.bnpb.go.id',
  'opsroom.sipongidata.my.id',
  'opsroom-sipongi.gakkum.kehutanan.go.id',
  'ispu.kemenlh.go.id',
  'ispu.menlhk.go.id',
]);

const PUBLIC_PROXIES: Array<{ url: string; wrapped: boolean }> = [
  { url: 'https://corsproxy.io/?', wrapped: false },
  { url: 'https://api.allorigins.win/get?url=', wrapped: true },
  { url: 'https://api.codetabs.com/v1/proxy?quest=', wrapped: false },
];

function isUrlAllowed(url: string): boolean {
  try {
    return ALLOWED_DOMAINS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface FetchProxyOptions { signal?: AbortSignal }

async function fetchViaApiProxy(url: string, signal?: AbortSignal): Promise<Response | null> {
  try {
    const res = await fetch('/api/proxy?url=' + encodeURIComponent(url), { signal });
    if (!res.ok) return null;
    return res;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

async function fetchViaPublicProxies(url: string, signal?: AbortSignal, expectJson = false): Promise<Response | null> {
  for (const proxy of PUBLIC_PROXIES) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const res = await fetch(proxy.url + encodeURIComponent(url), { signal: requestSignal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = proxy.wrapped ? (await res.json()).contents : await res.text();
      if (expectJson) JSON.parse(body);
      return new Response(body, {
        status: res.status,
        headers: { 'content-type': expectJson ? 'application/json' : res.headers.get('content-type') || 'text/plain' },
      });
    } catch {
      signal?.throwIfAborted();
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export async function fetchWithCorsProxy(url: string, { signal }: FetchProxyOptions = {}): Promise<unknown> {
  if (!isUrlAllowed(url)) throw new Error('Domain not allowed: ' + url);
  signal?.throwIfAborted();
  const apiRes = await fetchViaApiProxy(url, signal);
  if (apiRes) {
    try {
      return await apiRes.json();
    } catch {
      signal?.throwIfAborted();
    }
  }
  const pubRes = await fetchViaPublicProxies(url, signal, true);
  if (pubRes) return pubRes.json();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Direct fetch failed: ' + res.status);
  return res.json();
}

export async function fetchHtmlWithCorsProxy(url: string): Promise<string> {
  if (!isUrlAllowed(url)) throw new Error('Domain not allowed: ' + url);
  const apiRes = await fetchViaApiProxy(url);
  if (apiRes) return apiRes.text();
  const pubRes = await fetchViaPublicProxies(url);
  if (pubRes) return pubRes.text();
  const res = await fetch(url);
  if (!res.ok) throw new Error('Direct fetch failed: ' + res.status);
  return res.text();
}
