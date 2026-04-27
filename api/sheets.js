export default async function handler(req, res) {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${scriptUrl}?action=read`, { redirect: 'follow' });
      const d = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(d);
    }

    if (req.method === 'POST') {
      // Google Apps Script redirects POST to a new URL.
      // We must follow the redirect manually, re-sending the body each time.
      const body = JSON.stringify(req.body);
      let url = scriptUrl;
      let response;

      for (let i = 0; i < 5; i++) {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          redirect: 'manual' // catch redirects ourselves
        });

        if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
          url = response.headers.get('location');
          if (!url) break;
          continue;
        }
        break;
      }

      const d = await response.json();
      return res.status(200).json(d);
    }
  } catch (err) {
    return res.status(500).json({ error: err.toString() });
  }
}
