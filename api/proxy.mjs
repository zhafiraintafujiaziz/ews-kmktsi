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
  'sipongi.menlhk.go.id',
  'ispu.kemenlh.go.id',
  'ispu.menlhk.go.id',
]);

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(obj);
  }
  return res.end(JSON.stringify(obj));
}

function sendText(res, status, body, contentType) {
  res.statusCode = status;
  if (contentType) res.setHeader('content-type', contentType);
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(status).send(body);
  }
  return res.end(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const urlParam = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.get('url');
  if (!urlParam) {
    return sendJson(res, 400, { error: 'Missing url query parameter' });
  }

  try {
    const parsed = new URL(urlParam);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) {
      return sendJson(res, 403, { error: `Domain ${parsed.hostname} not allowed` });
    }

    const response = await fetch(urlParam, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      }
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type');

    return sendText(res, response.status, body, contentType);
  } catch (err) {
    return sendJson(res, 500, { error: 'Failed to fetch target URL', details: err?.message });
  }
}
