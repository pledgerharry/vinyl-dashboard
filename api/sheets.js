export default async function handler(req, res) {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${scriptUrl}?action=read`);
      const d = await r.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(d);
    }

    if (req.method === 'POST') {
      const r = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        redirect: 'follow'
      });
      const d = await r.json();
      return res.status(200).json(d);
    }
  } catch (err) {
    return res.status(500).json({ error: err.toString() });
  }
}
