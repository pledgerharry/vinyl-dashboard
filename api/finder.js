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
      { id: 'energy', q: "What's your energy level?", opts: ["Zero — horizontal is the goal", "Simmering — one drink in", "Building — night's just starting", "Peaked — nothing can stop me"] },
      { id: 'feel', q: "How do you want to feel?", opts: ["Nostalgic", "Inspired", "Loose", "Emotional"] },
      { id: 'mood2', q: "Pick a mood:", opts: ["Warm and fuzzy", "Cool and detached", "Chaotic and free", "Reflective and quiet"] },
      { id: 'mood3', q: "Tonight is:", opts: ["A slow burn", "A controlled chaos", "Unexpectedly perfect", "Still figuring itself out"] },
      { id: 'mood4', q: "Right now you are:", opts: ["The life of the party", "The observer in the corner", "Somewhere between the two", "Pretending to be one of the above"] },
      { id: 'decade', q: "Pick a decade:", opts: ["The one where everything was cooler (70s/80s)", "When hip-hop changed everything (90s)", "Before I was born but I get it (60s/70s)", "Keep it current (2000s+)"] },
      { id: 'era', q: "You want something that sounds:", opts: ["Like it was made in a sun-drenched studio in 1973", "Like a basement in New York in 1994", "Like right now, fresh off the press", "Like it exists outside of time entirely"] },
      { id: 'saturday', q: "Your ideal Saturday looks like:", opts: ["Market, coffee, record shop", "Park, drinks, good people", "Sofa, do not disturb", "Out until 3am, no plans"] },
      { id: 'film', q: "Pick a film:", opts: ["Do The Right Thing", "The Big Lebowski", "Moonlight", "Saturday Night Fever"] },
      { id: 'film2', q: "Pick another film:", opts: ["Goodfellas", "Lost in Translation", "Purple Rain", "Boogie Nights"] },
      { id: 'film3', q: "One more film:", opts: ["Jackie Brown", "Her", "High Fidelity", "The Harder They Come"] },
      { id: 'weather', q: "What's it doing outside?", opts: ["Sunny — windows open", "Grey and rainy", "Dark already", "Don't know, haven't looked"] },
      { id: 'food', q: "What are you eating?", opts: ["Nothing yet, stomach's empty", "Snacks and grazing", "Proper meal, long table", "We're past food, onto drinks"] },
      { id: 'listen', q: "Pick a word:", opts: ["Smooth", "Raw", "Euphoric", "Soulful"] },
      { id: 'word2', q: "One more word:", opts: ["Gritty", "Lush", "Hypnotic", "Electric"] },
      { id: 'word3', q: "Last one:", opts: ["Tender", "Defiant", "Cinematic", "Understated"] },
      { id: 'attention', q: "How's your attention span right now?", opts: ["Hit me with a classic album, I'm all in", "Bangers only, no filler", "Whatever, I'll vibe with anything", "Something to zone out to"] },
      { id: 'journey', q: "Where are you in the night?", opts: ["Just arrived, feeling fresh", "Few drinks in, loosening up", "Peak hour, this is it", "On the way out, final track"] },
      { id: 'city', q: "Pick a city:", opts: ["Detroit — raw, industrial, soulful", "Lagos — rhythmic, vibrant, alive", "New York — sharp, layered, relentless", "Kingston — deep roots, total conviction"] },
      { id: 'animal', q: "Pick an animal:", opts: ["Panther — sleek and effortless", "Golden retriever — warm and loveable", "Magpie — chaotic and unpredictable", "Owl — wise and a bit mysterious"] },
      { id: 'colour', q: "Pick a colour:", opts: ["Deep red", "Electric blue", "Warm gold", "Midnight black"] },
      { id: 'temperature', q: "What temperature is this moment?", opts: ["Ice cold — cool, controlled, minimal", "Room temp — easy, no drama", "Warm — cosy and comfortable", "Scalding — intense, full volume"] },
      { id: 'texture', q: "Pick a texture:", opts: ["Silk — smooth, effortless, sensual", "Denim — dependable, worn in, classic", "Velvet — rich, warm, indulgent", "Concrete — raw, urban, honest"] },
      { id: 'kitchen', q: "You open the fridge. What do you want?", opts: ["Cold beer, something simple", "Leftover pasta at midnight", "Nothing — I'm already sorted", "I'm looking for something I can't name"] },
      { id: 'phone', q: "Someone puts their phone on aux. Your reaction?", opts: ["Immediately anxious", "Curious — could go anywhere", "Relieved — someone else's problem now", "I had a better idea but fine"] },
      { id: 'walk', q: "Pick a walk:", opts: ["Along the seafront, wind in your face", "Through a park on a golden evening", "Down a rainy city street at night", "Up a hill with a view at the top"] },
      { id: 'superpower', q: "Your superpower tonight:", opts: ["Teleport anywhere instantly", "Make everyone around you feel amazing", "Know exactly what song to play next", "Stop time and just exist in this moment"] },
      { id: 'smell', q: "Pick a smell:", opts: ["Vinyl and old wood", "Petrichor — rain on dry ground", "Coconut and sunscreen", "Coffee and cigarettes at 2am"] },
      { id: 'window', q: "You look out the window. What do you see?", opts: ["City lights stretching to the horizon", "A quiet street with one lamp on", "Trees moving in the dark", "Nothing — the curtains are closed, obviously"] },
      { id: 'shoes', q: "What are you wearing on your feet?", opts: ["Trainers — comfortable, ready for anything", "Barefoot — fully at home", "Boots — committed to the look", "Socks — we're indoors, be real"] },
      { id: 'plant', q: "Pick a plant:", opts: ["Bird of paradise — dramatic, tropical, bold", "Spider plant — unpretentious, always there for you", "Cactus — low maintenance, surprisingly beautiful", "Monstera — lush, a bit extra, very 2020"] },
      { id: 'drink', q: "What's in your glass?", opts: ["Red wine — settled and warm", "Beer — easy, no fuss", "Something with ice and a lot going on", "Water, I'm being responsible"] },
      { id: 'season', q: "This feels like:", opts: ["Late summer — golden, slightly melancholy", "Deep winter — dark, intimate, honest", "Early spring — tentative and hopeful", "Autumn — beautiful and inevitable"] },
      { id: 'crowd', q: "The room you're in is:", opts: ["Just you", "A small group who all get it", "A proper gathering, buzzing", "More people than I expected"] },
      { id: 'silence', q: "How do you feel about silence?", opts: ["Essential — silence is the canvas", "Uncomfortable — fill it immediately", "Depends entirely on who's in the room", "What silence? There isn't any"] },
      { id: 'intro', q: "The track comes on. You:", opts: ["Nod slowly — yes, this is it", "Turn it up immediately", "Say nothing, just close your eyes", "Look at whoever put it on with respect"] },
      { id: 'midnight', q: "It's midnight. You are:", opts: ["Just getting started", "Exactly where I want to be", "Starting to think about leaving", "Already wondering about the morning"] },
      { id: 'sofa', q: "Where are you sitting?", opts: ["Deep in the best sofa spot", "Perched on the edge, still deciding", "On the floor by choice", "Somewhere I probably shouldn't be"] },
      { id: 'compliment', q: "The best compliment you could get right now:", opts: ["You've got great taste", "You're the most interesting person here", "You seem completely comfortable in yourself", "I don't know who you are but I like your energy"] },
      { id: 'secret', q: "Secretly you want the music to:", opts: ["Make someone fall in love with it", "Make everyone stop talking and just listen", "Get people moving without them realising", "Just hold the room together perfectly"] },
      { id: 'yesterday', q: "What were you doing yesterday?", opts: ["Nothing interesting — today is the reset", "Something exhausting I'm recovering from", "Something good I'm still riding", "Something I can't really explain"] },
      { id: 'decision', q: "How did you end up here tonight?", opts: ["Very much on purpose", "One thing led to another", "Honestly I'm still not sure", "Someone else made the plan and I said yes"] },
      { id: 'record', q: "Your relationship with music is:", opts: ["It's the main thing, everything else is context", "Important but I don't think about it this hard", "I know what I like, that's enough", "Complicated — but aren't all the good ones?"] },
      { id: 'speed', q: "Pick a speed:", opts: ["Slow — we have all night", "Steady — building somewhere good", "Fast — we're not waiting around", "Inconsistent — that's kind of the point"] },
      { id: 'light', q: "The lighting in here is:", opts: ["Perfect — dim and atmospheric", "A bit bright but we're managing", "We've dealt with it — some things are off", "Whatever, I stopped noticing"] },
      { id: 'wrong', q: "The last record someone put on was:", opts: ["Genuinely perfect — no notes", "Good but not quite right for the moment", "Bold choice, I respect it", "We don't need to talk about it"] },
      { id: 'playlist', q: "The last thing you listened to was:", opts: ["Something nostalgic you haven't played in years", "Whatever was already on", "Something you put on very deliberately", "I honestly can't remember"] },
      { id: 'book', q: "Pick a book:", opts: ["One you've read twice and would read again", "One everyone says you should read", "One you've never finished but keep trying", "One you judge entirely by its cover"] },
      { id: 'chaos', q: "On a scale of controlled to chaos, tonight is:", opts: ["Extremely controlled — everything is considered", "Loosely planned — roughly in the right direction", "Happily unpredictable — anything could happen", "Pure chaos — beautiful, irreversible chaos"] },
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
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [{ role: 'user', content: pickPrompt }] })
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
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
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
