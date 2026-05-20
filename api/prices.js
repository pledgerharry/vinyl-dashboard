let _cachedToken = null;
let _tokenExpiry = 0;

async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return process.env.EBAY_API_KEY || null;
  if (_cachedToken && Date.now() < _tokenExpiry - 300000) return _cachedToken;
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    if (!r.ok) return process.env.EBAY_API_KEY || null;
    const d = await r.json();
    _cachedToken = d.access_token;
    _tokenExpiry = Date.now() + (d.expires_in * 1000);
    return _cachedToken;
  } catch { return process.env.EBAY_API_KEY || null; }
}

async function getEbayPrice(artist, title, ebayToken) {
  if (!ebayToken) return null;
  try {
    const query = encodeURIComponent(`${artist} ${title} vinyl`);
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${query}&filter=buyingOptions:{AUCTION|FIXED_PRICE},conditions:{USED},itemLocationCountry:GB` +
      `&category_ids=176985&sort=endDateDesc&limit=20`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ebayToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country%3DGB'
      }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const artistLower = artist.toLowerCase();
    const titleLower  = title.toLowerCase();
    const prices = (d.itemSummaries || [])
      .filter(item => {
        const t = (item.title || '').toLowerCase();
        return t.includes(artistLower.split(' ')[0]) &&
               t.includes(titleLower.split(' ')[0]) &&
               !t.includes('cd') && !t.includes('box set') && !t.includes('cassette');
      })
      .map(item => parseFloat(item.price?.value || 0))
      .filter(p => p > 0 && p < 200)
      .sort((a, b) => a - b);
    if (!prices.length) return null;
    const mid = Math.floor(prices.length / 2);
    return Math.round(prices.length % 2 === 0 ? (prices[mid-1]+prices[mid])/2 : prices[mid]);
  } catch { return null; }
}

function toGBP(value, currency) {
  if (!value || value <= 0) return 0;
  const rates = { GBP:1, USD:0.79, EUR:0.85, CAD:0.58, AUD:0.51, JPY:0.0053 };
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

async function getStatsMedian(releaseId, discogsHeaders) {
  try {
    const r = await fetch(`https://api.discogs.com/marketplace/stats/${releaseId}`, { headers: discogsHeaders });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.blocked_from_sale) return null;
    const currency = d.median?.currency || 'USD';
    const median = toGBP(d.median?.value || 0, currency);
    if (median >= 1) return Math.round(median);
  } catch {}
  return null;
}

async function getMasterMedian(masterId, excludeId, discogsHeaders) {
  try {
    const r = await fetch(`https://api.discogs.com/masters/${masterId}/versions?per_page=10&sort=released`, { headers: discogsHeaders });
    if (!r.ok) return null;
    const d = await r.json();
    const versions = (d.versions || [])
      .sort((a, b) => (b.stats?.community?.in_collection||0) - (a.stats?.community?.in_collection||0))
      .slice(0, 5).filter(v => String(v.id) !== String(excludeId));
    for (const v of versions) {
      const median = await getStatsMedian(v.id, discogsHeaders);
      if (median) return median;
    }
  } catch {}
  return null;
}

async function getDiscogsPrice(releaseId, year, discogsHeaders) {
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
  const priceB = await getStatsMedian(releaseId, discogsHeaders);
  const priceC = masterId ? await getMasterMedian(masterId, releaseId, discogsHeaders) : null;
  return weightedAverage(priceA, priceB, priceC);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Belt-and-braces body parsing
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

  const discogsToken = process.env.DISCOGS_TOKEN;
  const discogsHeaders = discogsToken ? {
    'Authorization': `Discogs token=${discogsToken}`,
    'User-Agent': 'VinylDashboard/1.0'
  } : null;

  const ebayToken = await getEbayToken();

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      // 1. eBay completed UK listings — most accurate
      const ebayPrice = await getEbayPrice(artist, title, ebayToken);
      if (ebayPrice) return { releaseId, artist, title, price: ebayPrice };

      // 2. Discogs weighted average fallback
      if (releaseId && discogsHeaders) {
        const discogsPrice = await getDiscogsPrice(releaseId, year, discogsHeaders);
        if (discogsPrice) return { releaseId, artist, title, price: discogsPrice };
      }

      // 3. Decade fallback
      const yr = parseInt(year) || 0;
      const price = yr < 1970 ? 18 : yr < 1980 ? 14 : yr < 1990 ? 12 : yr < 2000 ? 10 : 12;
      return { releaseId, artist, title, price };
    })
  );

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    prices: results.filter(r => r.status === 'fulfilled').map(r => r.value)
  });
}
