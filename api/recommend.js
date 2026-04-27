export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const GENRE_CONTEXT = `Their taste is heavily weighted towards soul, funk, Motown, hip-hop, neo-soul and leftfield R&B. They occasionally enjoy reggae, jazz, electronic and rock/new wave. They collect on vinyl.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' });

  // Parse body — req.body is auto-parsed by Vercel for JSON content-type
  const body = req.body || {};
  const collection = body.collection || [];
  const wishlist = body.wishlist || [];
  const skipped = body.skipped || [];

  if (!collection.length) {
    return res.status(400).json({ error: 'No collection data received', bodyKeys: Object.keys(body) });
  }

  // Trim fields to keep prompt small — just artist, title, year, genre
  const collSummary = collection
    .map(r => `${r.artist} — ${r.title} (${r.year||'?'}, ${r.genre||'?'})`)
    .join('\n');
  const wishSummary = wishlist
    .map(r => `${r.artist} — ${r.title}`)
    .join('\n');
  const skipSummary = skipped.length
    ? `\nSkipped (don't suggest these):\n${skipped.map(s => `${s.artist} — ${s.title}`).join('\n')}`
    : '';

  const prompt = `You are a music recommendation engine for a vinyl collector. ${GENRE_CONTEXT}

Recommend ONE album not already in their collection or wishlist.

Collection:
${collSummary}

Wishlist:
${wishSummary}
${skipSummary}

Rules:
- Must NOT be in collection or wishlist above
- Must exist on vinyl
- Mostly match their taste, occasionally a curveball
- Vary the era
- Reason: 1-2 punchy sentences like a knowledgeable friend

Respond ONLY with JSON, no markdown:
{"artist":"Name","title":"Title","year":"1979","genre":"Soul / Funk","reason":"Why they'd love it"}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({ error: `Anthropic ${r.status}`, detail: errText.slice(0, 300) });
    }

    const data = await r.json();
    const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();

    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response', raw: raw.slice(0, 200) });
    }

    if (!rec.artist || !rec.title) {
      return res.status(500).json({ error: 'Incomplete response from Claude', rec });
    }

    return res.status(200).json(rec);

  } catch (err) {
    return res.status(500).json({ error: err.toString() });
  }
}
