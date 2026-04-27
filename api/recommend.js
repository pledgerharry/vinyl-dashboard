const GENRE_CONTEXT = `Their taste is heavily weighted towards soul, funk, Motown, hip-hop, neo-soul and leftfield R&B. They occasionally enjoy reggae, jazz, electronic and rock/new wave. They collect on vinyl so recommend albums with good pressings.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { collection, wishlist, skipped } = req.body || {};
  if (!collection?.length) return res.status(400).json({ error: 'No collection data' });

  const collSummary = collection.map(r => `${r.artist} — ${r.title} (${r.year}, ${r.genre})`).join('\n');
  const wishSummary = (wishlist||[]).map(r => `${r.artist} — ${r.title} (${r.genre})`).join('\n');
  const skipSummary = skipped?.length
    ? `\nPreviously rejected — don't recommend these but factor them into your thinking:\n${skipped.map(s=>`${s.artist} — ${s.title}`).join('\n')}`
    : '';

  const prompt = `You are a music recommendation engine for a vinyl collector. ${GENRE_CONTEXT}

Analyse their collection and wishlist and recommend ONE vinyl album they don't own and haven't wishlisted.

Collection:
${collSummary}

Wishlist:
${wishSummary}
${skipSummary}

Rules:
- Must NOT already be in their collection or wishlist
- Should be a real album that exists on vinyl
- Mostly match their taste but occasionally suggest a curveball from an adjacent genre
- Vary the era — don't always pick obvious classics
- Reason: one or two punchy sentences written like a knowledgeable friend, not a press release. Be specific about why THIS person would love it.

Respond ONLY with valid JSON, no markdown fences, no explanation outside the JSON:
{"artist":"Artist name","title":"Album title","year":"1979","genre":"Soul / Funk","reason":"Your reason here"}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `Anthropic error: ${r.status}`, detail: err });
    }

    const data = await r.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const rec = JSON.parse(clean);
    return res.status(200).json(rec);

  } catch (err) {
    return res.status(500).json({ error: err.toString() });
  }
}
