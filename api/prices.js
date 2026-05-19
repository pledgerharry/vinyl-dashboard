export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ error: 'No token' });

  const { records } = req.body || {};
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  // 80% of highest available price — removes cheap/damaged outliers
  function eightyPct(vals) {
    const highest = Math.max(...vals.filter(v => v > 0));
    return highest > 0 ? Math.round(highest * 0.8) : null;
  }

  async function tryStats(releaseId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (d.blocked_from_sale) return null;
      const p = eightyPct([d.lowest_price?.value || 0, d.median?.value || 0]);
      return p;
    } catch { return null; }
  }

  async function trySuggestions(releaseId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const vals = Object.values(d).map(v => v?.value || 0);
      return eightyPct(vals);
    } catch { return null; }
  }

  async function getMasterVersionIds(masterId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/masters/${masterId}/versions?per_page=10&sort=released`,
        { headers }
      );
      if (!r.ok) return [];
      const d = await r.json();
      return (d.versions || [])
        .sort((a, b) => (b.stats?.community?.in_collection || 0) - (a.stats?.community?.in_collection || 0))
        .slice(0, 5)
        .map(v => v.id);
    } catch { return []; }
  }

  function heuristicPrice(have, want, year) {
    const yr = parseInt(year) || 1985;
    const ratio = have > 0 ? want / have : 0.5;
    let base;
    if (ratio > 5)        base = 45;
    else if (ratio > 3)   base = 30;
    else if (ratio > 1.5) base = 20;
    else if (ratio > 0.8) base = 15;
    else if (ratio > 0.3) base = 12;
    else                  base = 9;
    if (have > 50000) base = Math.max(base, 14);
    else if (have > 10000) base = Math.max(base, 11);
    const ageMult = yr < 1970 ? 1.3 : yr < 1980 ? 1.1 : 1.0;
    return Math.round(Math.min(base * ageMult, 70));
  }

  async function getPriceForRelease(releaseId, year) {
    // Step 1: stats on the specific release
    let price = await tryStats(releaseId);
    if (price) return price;

    // Step 2: price suggestions on specific release
    price = await trySuggestions(releaseId);
    if (price) return price;

    // Step 3: fetch release to get master_id + community data
    let masterId = null, have = 0, want = 0, releaseYear = year;
    try {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        masterId = d.master_id || null;
        have = d.community?.have || 0;
        want = d.community?.want || 0;
        releaseYear = d.year || year;
      }
    } catch {}

    // Step 4: try stats + suggestions across top master versions
    if (masterId) {
      const versionIds = await getMasterVersionIds(masterId);
      for (const vid of versionIds) {
        if (String(vid) === String(releaseId)) continue;
        price = await tryStats(vid);
        if (price) return price;
      }
      for (const vid of versionIds) {
        if (String(vid) === String(releaseId)) continue;
        price = await trySuggestions(vid);
        if (price) return price;
      }
    }

    // Step 5: community heuristic — only when no market data exists at all
    if (have > 0) return heuristicPrice(have, want, releaseYear);

    // Absolute fallback by decade
    const yr = parseInt(year) || 0;
    return yr < 1970 ? 18 : yr < 1980 ? 14 : yr < 1990 ? 12 : yr < 2000 ? 10 : 12;
  }

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      const price = releaseId
        ? await getPriceForRelease(releaseId, year)
        : (() => { const yr=parseInt(year)||0; return yr<1970?18:yr<1980?14:yr<1990?12:yr<2000?10:12; })();
      return { releaseId, artist, title, price };
    })
  );

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    prices: results.filter(r => r.status === 'fulfilled').map(r => r.value)
  });
}
