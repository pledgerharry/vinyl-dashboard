export default async function handler(req, res) {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  async function followRedirects(url, method, body) {
    let response;
    for (let i = 0; i < 6; i++) {
      const opts = {
        method,
        redirect: 'manual',
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}
      };
      if (body) opts.body = body;
      response = await fetch(url, opts);
      const loc = response.headers.get('location');
      if (response.status >= 301 && response.status <= 308 && loc) {
        url = loc;
        continue;
      }
      break;
    }
    return response;
  }

  try {
    if (req.method === 'GET') {
      const response = await followRedirects(`${scriptUrl}?action=read`, 'GET', null);
      const text = await response.text();
      // Always try to parse JSON — if it fails, return a clear error but still 200
      // so the client can fall back to seed data gracefully without a network error
      try {
        const data = JSON.parse(text);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(data);
      } catch {
        console.error('Apps Script returned non-JSON:', text.slice(0, 300));
        // Return empty collections so app loads rather than crashing
        return res.status(200).json({ collection: [], wishlist: [] });
      }
    }

    if (req.method === 'POST') {
      const body = JSON.stringify(req.body);
      const response = await followRedirects(scriptUrl, 'POST', body);
      let data = { ok: true };
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { data = await response.json(); } catch {}
      }
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error('Sheets proxy error:', err);
    // Return empty rather than 500 so app still loads
    if (req.method === 'GET') return res.status(200).json({ collection: [], wishlist: [] });
    return res.status(200).json({ ok: false, error: err.toString() });
  }
}
