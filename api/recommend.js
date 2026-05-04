export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const GENRE_CONTEXT = `Their taste is heavily weighted towards soul, funk, Motown, hip-hop, neo-soul and leftfield R&B. They occasionally enjoy reggae, jazz, electronic and rock/new wave. They collect on vinyl.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const body = req.body || {};
  const { mode, collection=[], wishlist=[], skipped=[] } = body;

  // ── Price check mode ────────────────────────────────────────
  if (mode === 'price_check') {
    const { record, seenPrice, avgPrice } = body;
    if (!record) return res.status(400).json({ error: 'No record data' });

    const collSummary = collection
      .map(r => `${r.artist} — ${r.title} (${r.genre})`)
      .slice(0, 60).join('\n'); // trim to keep prompt manageable

    const priceContext = avgPrice
      ? `Discogs average price: £${avgPrice}. Seen for: £${seenPrice}. That's ${Math.round(((seenPrice-avgPrice)/avgPrice)*100)}% ${seenPrice>avgPrice?'above':'below'} average.`
      : `No Discogs price data available. Seen for: £${seenPrice}.`;

    const prompt = `You are advising a vinyl collector on whether to buy a record. One sentence only — direct, like a knowledgeable friend texting you.

Record: ${record.artist} — ${record.title} (${record.year}, ${record.genre})
${priceContext}

Taste: ${GENRE_CONTEXT}

One sentence verdict. Don't repeat price numbers. Just your honest take on whether it's worth it.

Respond ONLY with JSON: {"verdict": "One sentence here"}`;

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
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!r.ok) return res.status(500).json({ error: `Anthropic ${r.status}` });
      const data = await r.json();
      const raw = (data.content?.[0]?.text || '').replace(/```json|```/g,'').trim();
      return res.status(200).json(JSON.parse(raw));
    } catch(err) {
      return res.status(500).json({ error: err.toString() });
    }
  }

  // ── Recommendation mode ─────────────────────────────────────
  if (!collection.length) return res.status(400).json({ error: 'No collection data' });

  const collSummary = collection.map(r => `${r.artist} — ${r.title} (${r.year||'?'}, ${r.genre||'?'})`).join('\n');
  const wishSummary = wishlist.map(r => `${r.artist} — ${r.title}`).join('\n');
  const skipSummary = skipped.length
    ? `\nSkipped (don't suggest): ${skipped.map(s=>`${s.artist} — ${s.title}`).join(', ')}`
    : '';

  const prompt = `You are a music recommendation engine for a vinyl collector. ${GENRE_CONTEXT}

Recommend ONE album not in their collection or wishlist.

Collection:\n${collSummary}

Wishlist:\n${wishSummary}${skipSummary}

Rules: must not be in collection/wishlist, must exist on vinyl, mostly match taste with occasional curveballs, vary the era, 1-2 sentence reason like a knowledgeable friend.

Respond ONLY with JSON: {"artist":"Name","title":"Title","year":"1979","genre":"Soul / Funk","reason":"Why they'd love it"}`;

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
      return res.status(500).json({ error: `Anthropic ${r.status}`, detail: errText.slice(0,300) });
    }
    const data = await r.json();
    const raw = (data.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
    let rec;
    try { rec = JSON.parse(raw); } catch {
      return res.status(500).json({ error: 'Bad JSON from Claude', raw: raw.slice(0,200) });
    }
    if (!rec.artist||!rec.title) return res.status(500).json({ error: 'Incomplete response', rec });
    return res.status(200).json(rec);
  } catch(err) {
    return res.status(500).json({ error: err.toString() });
  }
}
