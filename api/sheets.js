// Large imports (bulkSync) can take longer than Vercel's default limit.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Apps Script runs the request, then answers with a redirect to the result.
  // The result must be fetched with GET: re-sending the POST there loses the
  // script's real answer (including any error). 307/308 keep the method.
  async function callScript(url, method, body) {
    let response = await fetch(url, {
      method,
      redirect: 'manual',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: body || undefined
    });
    for (let i = 0; i < 5; i++) {
      const loc = response.headers.get('location');
      if (response.status < 301 || response.status > 308 || !loc) break;
      const keep = response.status === 307 || response.status === 308;
      response = await fetch(loc, keep
        ? { method, redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: body || undefined }
        : { method: 'GET', redirect: 'manual' });
    }
    return response;
  }

  async function readJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, error: 'Apps Script returned something that isn\'t JSON: ' + text.slice(0, 160) }; }
  }

  try {
    if (req.method === 'GET') {
      const data = await readJson(await callScript(`${scriptUrl}?action=read`, 'GET', null));
      if (data.error || data.ok === false) {
        console.error('Apps Script read failed:', data.error);
        return res.status(502).json({ error: data.error || 'Read failed' });
      }
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const data = await readJson(await callScript(scriptUrl, 'POST', JSON.stringify(req.body)));
      if (data.error || data.ok === false) {
        console.error('Apps Script write failed:', req.body && req.body.action, data.error);
        return res.status(502).json({ ok: false, error: data.error || 'Write failed' });
      }
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sheets proxy error:', err);
    return res.status(502).json({ ok: false, error: String(err) });
  }
}
