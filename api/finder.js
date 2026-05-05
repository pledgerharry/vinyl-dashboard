export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const { mode, collection = [], answers = [], questionsSoFar = [] } = req.body || {};

  const collSummary = collection
    .map(r => `${r.artist} — ${r.title} (${r.year}, ${r.genre})`)
    .join('\n');

  // ── Mode: get next question ─────────────────────────────────
  if (mode === 'question') {
    const questionPool = [
      { id: 'vibe', q: "What's the vibe right now?", opts: ["Cooking and having a glass of wine", "Pre-drinks, getting the energy up", "Sunday morning, nowhere to be", "Deep in my feelings"] },
      { id: 'decade', q: "Pick a decade:", opts: ["The one where everything was cooler (70s/80s)", "When hip-hop changed everything (90s)", "Before I was born but I get it (60s/70s)", "Keep it current (2000s+)"] },
      { id: 'word', q: "Pick a word:", opts: ["Smooth", "Raw", "Euphoric", "Soulful"] },
      { id: 'attention', q: "How's your attention span right now?", opts: ["Hit me with a classic album, I'm all in", "Bangers only, no filler", "Whatever, I'll vibe with anything", "Something to zone out to"] },
      { id: 'saturday', q: "Your ideal Saturday looks like:", opts: ["Market, coffee, record shop", "Park, drinks, good people", "Sofa, do not disturb", "Out until 3am, no plans"] },
      { id: 'film', q: "Pick a film:", opts: ["Do The Right Thing", "The Big Lebowski", "Moonlight", "Saturday Night Fever"] },
      { id: 'energy', q: "What's your energy level?", opts: ["Zero — horizontal is the goal", "Simmering — one drink in", "Building — night's just starting", "Peaked — nothing can stop me"] },
      { id: 'listen', q: "How do you want to feel?", opts: ["Nostalgic", "Inspired", "Loose", "Emotional"] },
      { id: 'food', q: "What are you eating?", opts: ["Nothing yet, stomach's empty", "Snacks and grazing", "Proper meal, long table", "We're past food, onto drinks"] },
      { id: 'weather', q: "What's it doing outside?", opts: ["Sunny — windows open", "Grey and rainy", "Dark already", "Don't know, haven't looked"] },
    ];

    // Pick questions not yet asked, randomise order each session
    const asked = questionsSoFar.map(q => q.id);
    const remaining = questionPool.filter(q => !asked.includes(q.id));

    // After 2 answers, adapt: pick a question Claude thinks is most useful
    // given what we know, by using a lightweight heuristic
    let next;
    if (answers.length >= 2 && remaining.length > 1) {
      // Use Claude to pick the most differentiating next question
      const pickPrompt = `A user is taking a quiz to find a record to play from this collection:
${collSummary}

Their answers so far:
${answers.map(a => `- ${a.q}: "${a.a}"`).join('\n')}

Remaining question options:
${remaining.map((q,i) => `${i}: ${q.q} (${q.opts.join(' / ')})`).join('\n')}

Which question index (just the number) would best narrow down the right record recommendation given their answers so far? Reply with only the number.`;

      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 10, messages: [{ role: 'user', content: pickPrompt }] })
        });
        if (r.ok) {
          const d = await r.json();
          const idx = parseInt((d.content?.[0]?.text || '0').trim());
          next = remaining[isNaN(idx) || idx >= remaining.length ? 0 : idx];
        }
      } catch {}
    }

    if (!next) {
      // Random pick from remaining for first 2 questions
      next = remaining[Math.floor(Math.random() * remaining.length)];
    }

    return res.status(200).json({ question: next, total: 3 + Math.min(answers.length, 0) });
  }

  // ── Mode: get recommendations ───────────────────────────────
  if (mode === 'recommend') {
    const answerSummary = answers.map(a => `${a.q}: "${a.a}"`).join('\n');

    const prompt = `You are matching someone to records from a vinyl collection based on their personality and vibe.

Collection:
${collSummary}

Their quiz answers:
${answerSummary}

Pick exactly 3 records from the collection above that best match this person's vibe. Rank them 1 (best match) to 3. For each, write a short punchy tagline — 4 to 8 words, fun and specific, like "a great disco album to bust a move to" or "soul music for rainy Sunday mornings". Don't be generic.

Respond ONLY with JSON, no markdown:
{"picks":[
  {"rank":1,"artist":"Artist","title":"Title","year":"1979","tagline":"short punchy tagline here"},
  {"rank":2,"artist":"Artist","title":"Title","year":"1979","tagline":"short punchy tagline here"},
  {"rank":3,"artist":"Artist","title":"Title","year":"1979","tagline":"short punchy tagline here"}
]}`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
      });
      if (!r.ok) return res.status(500).json({ error: `Anthropic ${r.status}` });
      const data = await r.json();
      const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const result = JSON.parse(raw);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.toString() });
    }
  }

  return res.status(400).json({ error: 'Unknown mode' });
}
