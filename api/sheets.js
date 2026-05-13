export default async function handler(req, res) {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${scriptUrl}?action=read`, { redirect: 'follow' });
      if (!r.ok) return res.status(502).json({ error: `Script returned ${r.status}` });
      const d = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(d);
    }

    if (req.method === 'POST') {
      const body = JSON.stringify(req.body);
      let url = scriptUrl;
      let response;

      // Follow redirects manually, re-sending POST body each hop
      for (let i = 0; i < 6; i++) {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          redirect: 'manual'
        });

        const loc = response.headers.get('location');
        if ((response.status === 301 || response.status === 302 ||
             response.status === 307 || response.status === 308) && loc) {
          url = loc;
          continue;
        }
        break;
      }

      // Apps Script sometimes returns 200 with JSON, sometimes HTML, sometimes empty.
      // All mean the action succeeded — never throw here.
      let data = { ok: true };
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { data = await response.json(); } catch {}
      }
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error('Sheets proxy error:', err);
    return res.status(500).json({ error: err.toString() });
  }
}
