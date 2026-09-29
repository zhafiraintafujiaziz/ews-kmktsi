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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const urlParam = new URL(req.url, `http://${req.headers.host}`).searchParams.get('url');
  if (!urlParam) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }

  try {
    const parsed = new URL(urlParam);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) {
      return res.status(403).json({ error: `Domain ${parsed.hostname} not allowed` });
    }

    const response = await fetch(urlParam);
    const body = await response.text();

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }

    return res.status(response.status).send(body);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch target URL' });
  }
}
