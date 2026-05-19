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

  async function getPriceForRelease(releaseId, year) {
    // Strategy 1: marketplace/stats — uses actual completed sale prices (most accurate)
    // This only returns useful data when there have been real GBP sales
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
        { headers }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.blocked_from_sale) return null; // skip to heuristic
        if (d.median?.value >= 3) return Math.round(d.median.value);
      }
    } catch {}

    // Strategy 2: price_suggestions — Discogs' own estimate at VG+ condition
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
        { headers }
      );
      if (r.ok) {
        const d = await r.json();
        const vgp = d['Very Good Plus (VG+)'];
        const vg  = d['Very Good (VG)'];
        if (vgp?.value >= 3) return Math.round(vgp.value);
        if (vg?.value  >= 3) return Math.round(vg.value * 1.2);
      }
    } catch {}

    // No market data — return null so caller uses heuristic
    return null;
  }

  function heuristicPrice(have, want, year) {
    // Only used when Discogs has no market data for a release
    const yr = parseInt(year) || 1985;
    const ratio = have > 0 ? want / have : 0.5;

    let base;
    if (ratio > 5)        base = 45;
    else if (ratio > 3)   base = 30;
    else if (ratio > 1.5) base = 20;
    else if (ratio > 0.8) base = 15;
    else if (ratio > 0.3) base = 12;
    else                  base = 9;

    // Well-known records (large ownership) have a floor even if ratio is low
    if (have > 50000) base = Math.max(base, 14);
    else if (have > 10000) base = Math.max(base, 11);

    // Modest age premium only for genuinely old records
    const ageMult = yr < 1970 ? 1.3 : yr < 1980 ? 1.1 : 1.0;

    return Math.round(Math.min(base * ageMult, 70));
  }

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      let price = null;

      if (releaseId) {
        price = await getPriceForRelease(releaseId, year);

        // If market data failed, fetch community stats for heuristic
        if (price === null) {
          try {
            const r = await fetch(
              `https://api.discogs.com/releases/${releaseId}`,
              { headers }
            );
            if (r.ok) {
              const d = await r.json();
              const have = d.community?.have || 0;
              const want = d.community?.want || 0;
              const yr = d.year || year;
              price = heuristicPrice(have, want, yr);
            }
          } catch {}
        }
      }

      // Absolute fallback by decade
      if (!price) {
        const yr = parseInt(year) || 0;
        price = yr < 1970 ? 18 : yr < 1980 ? 14 : yr < 1990 ? 12 : yr < 2000 ? 10 : 12;
      }

      return { releaseId, artist, title, price };
    })
  );

  const prices = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ prices });
}
