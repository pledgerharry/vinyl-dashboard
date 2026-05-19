export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ error: 'No token' });

  // Parse body — Vercel sometimes doesn't auto-parse for new endpoints
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }

  const { records } = body || {};
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  // Weighted average: marketplace medians count double, heuristic counts once
  // (A×1 + B×2 + C×2) / total_weights
  function weightedAverage(a, b, c) {
    let total = 0, weights = 0;
    if (a !== null) { total += a * 1; weights += 1; }
    if (b !== null) { total += b * 2; weights += 2; }
    if (c !== null) { total += c * 2; weights += 2; }
    return weights > 0 ? Math.round(total / weights) : null;
  }

  // Price A: community heuristic from have/want ratio + year
  function heuristicPrice(have, want, year) {
    const yr = parseInt(year) || 1985;
    const ratio = have > 0 ? want / have : 0.5;
    let base;
    if (ratio > 5)        base = 50;
    else if (ratio > 3)   base = 35;
    else if (ratio > 1.5) base = 22;
    else if (ratio > 0.8) base = 16;
    else if (ratio > 0.3) base = 12;
    else                  base = 9;
    // Popularity floor — well-known records held up by demand even with low ratio
    if (have > 50000) base = Math.max(base, 14);
    else if (have > 10000) base = Math.max(base, 11);
    const ageMult = yr < 1970 ? 1.3 : yr < 1980 ? 1.1 : 1.0;
    return Math.round(Math.min(base * ageMult, 70));
  }

  // Approximate GBP conversion — drop curr_abbr so we get whatever currency
  // Discogs has most data in, then convert ourselves
  function toGBP(value, currency) {
    if (!value || value <= 0) return 0;
    const rates = { GBP: 1, USD: 0.79, EUR: 0.85, CAD: 0.58, AUD: 0.51, JPY: 0.0053 };
    return value * (rates[currency] || 0.79);
  }

  // Price B: marketplace stats median for specific release
  async function getStatsMedian(releaseId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (d.blocked_from_sale) return null;
      const currency = d.median?.currency || d.lowest_price?.currency || 'USD';
      const median = toGBP(d.median?.value || 0, currency);
      if (median >= 1) return Math.round(median);
    } catch {}
    return null;
  }

  // Price C: marketplace stats median across top master versions
  async function getMasterMedian(masterId, excludeId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/masters/${masterId}/versions?per_page=10&sort=released`,
        { headers }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const versions = (d.versions || [])
        .sort((a, b) => (b.stats?.community?.in_collection || 0) - (a.stats?.community?.in_collection || 0))
        .slice(0, 5)
        .filter(v => String(v.id) !== String(excludeId));

      for (const v of versions) {
        const median = await getStatsMedian(v.id);
        if (median) return median;
      }
    } catch {}
    return null;
  }

  async function getPriceForRelease(releaseId, year) {
    // Always fetch release for heuristic data + master_id
    let have = 0, want = 0, masterId = null, releaseYear = year;
    try {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        have = d.community?.have || 0;
        want = d.community?.want || 0;
        masterId = d.master_id || null;
        releaseYear = d.year || year;
      }
    } catch {}

    // Price A — heuristic (weight ×1)
    const priceA = heuristicPrice(have, want, releaseYear);

    // Price B — specific release median (weight ×2)
    const priceB = await getStatsMedian(releaseId);

    // Price C — master version median (weight ×2)
    const priceC = masterId ? await getMasterMedian(masterId, releaseId) : null;

    // Weighted average: B and C count double, A is tiebreaker
    const price = weightedAverage(priceA, priceB, priceC);

    // Absolute fallback by decade if everything failed
    if (!price) {
      const yr = parseInt(year) || 0;
      return yr < 1970 ? 18 : yr < 1980 ? 14 : yr < 1990 ? 12 : yr < 2000 ? 10 : 12;
    }

    return price;
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
