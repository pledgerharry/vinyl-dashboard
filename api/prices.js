import { getEbayToken } from './ebay-token.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const discogsToken = process.env.DISCOGS_TOKEN;
  const ebayToken = await getEbayToken(); // auto-manages OAuth

  // Belt-and-braces body parsing — handles both parsed and raw stream
  let parsedBody = req.body;
  if (!parsedBody || !parsedBody.records) {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      parsedBody = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
  }
  const { records } = parsedBody || {};
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const discogsHeaders = {
    'Authorization': `Discogs token=${discogsToken}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  // ── eBay completed UK listings ─────────────────────────────────
  // Returns median sale price in GBP from last 10 completed UK vinyl sales
  async function getEbayPrice(artist, title) {
    if (!ebayToken) return null;
    try {
      const query = encodeURIComponent(`${artist} ${title} vinyl`);
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
        `?q=${query}` +
        `&filter=buyingOptions:{AUCTION|FIXED_PRICE},conditions:{USED},` +
        `itemLocationCountry:GB,` +
        `itemEndDate:[${new Date(Date.now()-90*24*60*60*1000).toISOString().split('.')[0]}Z..]` +
        `&category_ids=176985` + // Vinyl Records category
        `&sort=endDateDesc` +
        `&limit=20`;

      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${ebayToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
          'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country%3DGB',
          'Content-Type': 'application/json'
        }
      });

      if (!r.ok) return null;
      const d = await r.json();
      const items = (d.itemSummaries || []);

      // Filter to items that look like the right record (not box sets, not CDs)
      const titleLower = title.toLowerCase();
      const artistLower = artist.toLowerCase();
      const filtered = items.filter(item => {
        const t = (item.title || '').toLowerCase();
        return t.includes(artistLower.split(' ')[0]) &&
               (t.includes(titleLower.split(' ')[0]) || t.includes(titleLower.split(' ')[1] || '')) &&
               !t.includes('cd') && !t.includes('box set') && !t.includes('cassette');
      });

      const prices = filtered
        .map(item => parseFloat(item.price?.value || 0))
        .filter(p => p > 0 && p < 200) // exclude obvious outliers
        .sort((a, b) => a - b);

      if (!prices.length) return null;

      // Return median
      const mid = Math.floor(prices.length / 2);
      return Math.round(prices.length % 2 === 0
        ? (prices[mid - 1] + prices[mid]) / 2
        : prices[mid]);
    } catch { return null; }
  }

  // ── Discogs weighted average (fallback) ───────────────────────
  function toGBP(value, currency) {
    if (!value || value <= 0) return 0;
    const rates = { GBP: 1, USD: 0.79, EUR: 0.85, CAD: 0.58, AUD: 0.51, JPY: 0.0053 };
    return value * (rates[currency] || 0.79);
  }

  function weightedAverage(a, b, c) {
    let total = 0, weights = 0;
    if (a !== null) { total += a * 1; weights += 1; }
    if (b !== null) { total += b * 2; weights += 2; }
    if (c !== null) { total += c * 2; weights += 2; }
    return weights > 0 ? Math.round(total / weights) : null;
  }

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
    if (have > 50000) base = Math.max(base, 14);
    else if (have > 10000) base = Math.max(base, 11);
    const ageMult = yr < 1970 ? 1.3 : yr < 1980 ? 1.1 : 1.0;
    return Math.round(Math.min(base * ageMult, 70));
  }

  async function getStatsMedian(releaseId) {
    if (!discogsToken) return null;
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}`,
        { headers: discogsHeaders }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (d.blocked_from_sale) return null;
      const currency = d.median?.currency || 'USD';
      const median = toGBP(d.median?.value || 0, currency);
      if (median >= 1) return Math.round(median);
    } catch {}
    return null;
  }

  async function getMasterMedian(masterId, excludeId) {
    if (!discogsToken) return null;
    try {
      const r = await fetch(
        `https://api.discogs.com/masters/${masterId}/versions?per_page=10&sort=released`,
        { headers: discogsHeaders }
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

  async function getDiscogsPrice(releaseId, year) {
    if (!discogsToken) return null;
    let have = 0, want = 0, masterId = null, releaseYear = year;
    try {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers: discogsHeaders });
      if (r.ok) {
        const d = await r.json();
        have = d.community?.have || 0;
        want = d.community?.want || 0;
        masterId = d.master_id || null;
        releaseYear = d.year || year;
      }
    } catch {}
    const priceA = heuristicPrice(have, want, releaseYear);
    const priceB = await getStatsMedian(releaseId);
    const priceC = masterId ? await getMasterMedian(masterId, releaseId) : null;
    return weightedAverage(priceA, priceB, priceC);
  }

  // ── Main pricing logic ─────────────────────────────────────────
  // eBay is primary (real UK sale prices), Discogs is fallback
  async function getPriceForRelease(releaseId, artist, title, year) {
    // 1. Try eBay completed UK listings first
    const ebayPrice = await getEbayPrice(artist, title);
    if (ebayPrice) return ebayPrice;

    // 2. Fall back to Discogs weighted average
    if (releaseId) {
      const discogsPrice = await getDiscogsPrice(releaseId, year);
      if (discogsPrice) return discogsPrice;
    }

    // 3. Absolute fallback by decade
    const yr = parseInt(year) || 0;
    return yr < 1970 ? 18 : yr < 1980 ? 14 : yr < 1990 ? 12 : yr < 2000 ? 10 : 12;
  }

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      const price = await getPriceForRelease(releaseId, artist, title, year);
      return { releaseId, artist, title, price };
    })
  );

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    prices: results.filter(r => r.status === 'fulfilled').map(r => r.value)
  });
}
