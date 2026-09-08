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

async function fetchViaApiProxy(url: string): Promise<Response | null> {
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

async function fetchViaPublicProxies(url: string): Promise<Response | null> {
  for (const proxy of PUBLIC_PROXIES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const proxiedUrl = `${proxy.url}${encodeURIComponent(url)}`;
      const res = await fetch(proxiedUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = proxy.wrapped
        ? (await res.json()).contents
        : await res.text();

      return new Response(body, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'text/plain' },
      });
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchWithCorsProxy(url: string): Promise<unknown> {
  if (!isUrlAllowed(url)) throw new Error(`Domain not allowed: ${url}`);

  const apiRes = await fetchViaApiProxy(url);
  if (apiRes) return apiRes.json();

  const pubRes = await fetchViaPublicProxies(url);
  if (pubRes) return pubRes.json();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchHtmlWithCorsProxy(url: string): Promise<string> {
  if (!isUrlAllowed(url)) throw new Error(`Domain not allowed: ${url}`);

  const apiRes = await fetchViaApiProxy(url);
  if (apiRes) return apiRes.text();

  const pubRes = await fetchViaPublicProxies(url);
  if (pubRes) return pubRes.text();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
  return res.text();
}
