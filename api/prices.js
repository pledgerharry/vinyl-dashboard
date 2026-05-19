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

  // Try marketplace stats for a single release ID — returns median or null
  async function tryStats(releaseId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (d.blocked_from_sale) return null;
      if (d.median?.value >= 3) return Math.round(d.median.value);
    } catch {}
    return null;
  }

  // Try price suggestions for a release — returns VG+ estimate or null
  async function trySuggestions(releaseId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const vgp = d['Very Good Plus (VG+)'];
      const vg  = d['Very Good (VG)'];
      if (vgp?.value >= 3) return Math.round(vgp.value);
      if (vg?.value  >= 3) return Math.round(vg.value * 1.2);
    } catch {}
    return null;
  }

  // Get the top version IDs from a master release, sorted by most-owned (best data)
  async function getMasterVersionIds(masterId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/masters/${masterId}/versions?per_page=10&format=Vinyl&sort=released`,
        { headers }
      );
      if (!r.ok) return [];
      const d = await r.json();
      return (d.versions || [])
        .sort((a, b) => (b.stats?.community?.in_collection || 0) - (a.stats?.community?.in_collection || 0))
        .slice(0, 5)
        .map(v => v.id);
    } catch {}
    return [];
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
    // Step 1: try stats on the specific release first
    let price = await tryStats(releaseId);
    if (price) return price;

    // Step 2: try price suggestions on specific release
    price = await trySuggestions(releaseId);
    if (price) return price;

    // Step 3: get master ID, then try stats across top versions
    let masterId = null;
    let have = 0;
    let want = 0;
    let releaseYear = year;

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

    if (masterId) {
      const versionIds = await getMasterVersionIds(masterId);
      // Try each version's stats — stop at first useful result
      for (const vid of versionIds) {
        if (String(vid) === String(releaseId)) continue; // already tried
        price = await tryStats(vid);
        if (price) return price;
      }
      // Try suggestions on top versions too
      for (const vid of versionIds) {
        if (String(vid) === String(releaseId)) continue;
        price = await trySuggestions(vid);
        if (price) return price;
      }
    }

    // Step 4: community heuristic as last resort
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

  const prices = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ prices });
}
