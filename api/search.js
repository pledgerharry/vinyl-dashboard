const GENRE_MAP = {
  'soul': 'Soul / Funk', 'funk': 'Soul / Funk', 'rhythm & blues': 'Soul / Funk',
  'r&b': 'Soul / Funk', 'disco': 'Disco / Pop', 'motown': 'Motown',
  'hip hop': 'Hip-Hop', 'hip-hop': 'Hip-Hop', 'rap': 'Hip-Hop',
  'neo soul': 'Neo-Soul / Leftfield', 'neo-soul': 'Neo-Soul / Leftfield',
  'contemporary r&b': 'Neo-Soul / Leftfield', 'indie r&b': 'Neo-Soul / Leftfield',
  'afrobeat': 'Neo-Soul / Leftfield', 'leftfield': 'Neo-Soul / Leftfield',
  'jazz': 'Jazz', 'jazz-funk': 'Jazz', 'jazz funk': 'Jazz', 'bossa nova': 'Jazz',
  'reggae': 'Reggae', 'dub': 'Reggae', 'ska': 'Reggae', 'rocksteady': 'Reggae',
  'electronic': 'Electronic', 'house': 'Electronic', 'techno': 'Electronic',
  'synth-pop': 'Electronic', 'new wave': 'Rock / New Wave', 'post-punk': 'Rock / New Wave',
  'rock': 'Rock / New Wave', 'punk': 'Rock / New Wave', 'indie rock': 'Rock / New Wave',
  'pop rock': 'Rock / New Wave', 'classic rock': 'Rock / New Wave',
  'pop': 'R&B / Pop',
};

function inferGenre(styles = [], genres = []) {
  const all = [...styles, ...genres].map(s => s.toLowerCase());
  for (const tag of all) {
    for (const [key, val] of Object.entries(GENRE_MAP)) {
      if (tag.includes(key)) return val;
    }
  }
  return null;
}

function inferTier(price, year) {
  const yr = parseInt(year) || 0;
  if (yr >= 2014 && price >= 18 && price <= 26) return { tier: 'hmv', hmvNote: 'deal' };
  if (price >= 35) return { tier: 'patience', hmvNote: 'nothmv' };
  if (price <= 14 || yr < 1990) return { tier: 'sh', hmvNote: 'nothmv' };
  return { tier: 'store', hmvNote: 'nothmv' };
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

function iqrFilter(sorted) {
  if (sorted.length < 4) return sorted;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const filtered = sorted.filter(p => p >= q1 - 1.5*iqr && p <= q3 + 1.5*iqr);
  return filtered.length > 0 ? filtered : sorted;
}

async function getEbayPrice(artist, title, year, ebayToken) {
  if (!ebayToken) return null;
  try {
    const yr = parseInt(year) || 0;
    const yearStr = yr > 1900 ? ` ${yr}` : '';
    const cleanArtist = artist.replace(/&.*$/, '').trim();
    const query = encodeURIComponent(`${cleanArtist} ${title}${yearStr} vinyl`);
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${query}` +
      `&filter=buyingOptions:{AUCTION|FIXED_PRICE},conditions:{USED},` +
      `itemLocationCountry:GB` +
      `&category_ids=176985&sort=endDateDesc&limit=20`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ebayToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
      }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const ceiling = yr < 1960 ? 80 : yr < 1970 ? 60 : yr < 1980 ? 50
                  : yr < 1990 ? 45 : yr < 2000 ? 40 : 60;
    const a0 = cleanArtist.toLowerCase().split(' ')[0];
    const t0 = title.toLowerCase().split(' ')[0];
    const prices = (d.itemSummaries || [])
      .filter(item => {
        const t = (item.title || '').toLowerCase();
        return t.includes(a0) && t.includes(t0) &&
               !t.includes(' cd') && !t.includes('box set') && !t.includes('cassette');
      })
      .map(item => parseFloat(item.price?.value || 0))
      .filter(p => p > 1 && p <= ceiling)
      .sort((a, b) => a - b);
    if (!prices.length) return null;
    const filtered = iqrFilter(prices);
    if (!filtered.length) return null;
    const mid = Math.floor(filtered.length / 2);
    return Math.round(filtered.length % 2 === 0
      ? (filtered[mid - 1] + filtered[mid]) / 2
      : filtered[mid]);
  } catch { return null; }
}

async function getMarketPrice(releaseId, headers) {
  // Fetch release for heuristic + master_id
  let have = 0, want = 0, masterId = null, year = null;
  try {
    const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
    if (r.ok) {
      const d = await r.json();
      have = d.community?.have || 0;
      want = d.community?.want || 0;
      masterId = d.master_id || null;
      year = d.year || null;
    }
  } catch {}

  // Price A — heuristic (weight ×1)
  const priceA = heuristicPrice(have, want, year);

  // Price B — specific release median (weight ×2)
  // No curr_abbr — get whatever currency has most data, convert to GBP ourselves
  function toGBP(value, currency) {
    if (!value || value <= 0) return 0;
    const rates = { GBP: 1, USD: 0.79, EUR: 0.85, CAD: 0.58, AUD: 0.51, JPY: 0.0053 };
    return value * (rates[currency] || 0.79);
  }
  let priceB = null;
  try {
    const r = await fetch(
      `https://api.discogs.com/marketplace/stats/${releaseId}`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      if (!d.blocked_from_sale) {
        const currency = d.median?.currency || d.lowest_price?.currency || 'USD';
        const median = toGBP(d.median?.value || 0, currency);
        if (median >= 1) priceB = Math.round(median);
      }
    }
  } catch {}

  // Price C — master version median (weight ×2)
  let priceC = null;
  if (masterId) {
    try {
      const r = await fetch(
        `https://api.discogs.com/masters/${masterId}/versions?per_page=10&sort=released`,
        { headers }
      );
      if (r.ok) {
        const d = await r.json();
        const versions = (d.versions || [])
          .sort((a, b) => (b.stats?.community?.in_collection||0) - (a.stats?.community?.in_collection||0))
          .slice(0, 5)
          .filter(v => String(v.id) !== String(releaseId));
        for (const v of versions) {
          try {
            const sr = await fetch(
              `https://api.discogs.com/marketplace/stats/${v.id}`,
              { headers }
            );
            if (sr.ok) {
              const sd = await sr.json();
              if (!sd.blocked_from_sale) {
                const cur = sd.median?.currency || sd.lowest_price?.currency || 'USD';
                const med = toGBP(sd.median?.value || 0, cur);
                if (med >= 1) { priceC = Math.round(med); break; }
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return weightedAverage(priceA, priceB, priceC);
}

function priceFromCommunity(r) {
  return heuristicPrice(r.community?.have || 0, r.community?.want || 0, r.year);
}

export default async function handler(req, res) {
  const { artist, title, catalog, releaseId } = req.query;

  if (!artist && !title && !catalog && !releaseId) {
    return res.status(400).json({ error: 'Provide at least one search field' });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ results: [] });

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  try {
    let raw = [];

    if (releaseId) {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        raw = [{ ...d, id: d.id, title: `${d.artists?.[0]?.name || ''} - ${d.title}`, catno: d.labels?.[0]?.catno || '' }];
      }
    } else {
      let url;
      if (catalog) {
        const q = encodeURIComponent(catalog + (artist ? ' ' + artist : ''));
        url = `https://api.discogs.com/database/search?q=${q}&catno=${encodeURIComponent(catalog)}&type=release&per_page=8&format=vinyl`;
      } else {
        const q = encodeURIComponent(`${artist || ''} ${title || ''}`.trim());
        url = `https://api.discogs.com/database/search?q=${q}&type=release&per_page=8&format=vinyl`;
      }
      const r = await fetch(url, { headers });
      if (!r.ok) return res.status(200).json({ results: [] });
      const d = await r.json();
      raw = d.results || [];
    }

    const results = await Promise.allSettled(
      raw.slice(0, 4).map(async r => {
        // Try real marketplace price first, fall back to community estimate
        let price = await getMarketPrice(r.id, headers);
        if (!price) price = priceFromCommunity(r);

        const genreList = r.genre || [];
        const styleList = r.style || r.styles || [];
        const genre = inferGenre(styleList, genreList);

        const parts = (r.title || '').split(' - ');
        const dt = parts.length > 1 ? parts.slice(1).join(' - ') : r.title;
        const da = parts[0] || artist || '';
        const year = r.year || r.released_formatted?.split('-')[0] || '';
        const inferredTier = inferTier(price, year);

        // eBay primary, Discogs fallback
        const ebayToken = await (async () => {
          const cid = process.env.EBAY_CLIENT_ID, cs = process.env.EBAY_CLIENT_SECRET;
          if (!cid || !cs) return process.env.EBAY_API_KEY || null;
          try {
            const creds = Buffer.from(`${cid}:${cs}`).toString('base64');
            const tr = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
              method: 'POST',
              headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
            });
            if (!tr.ok) return process.env.EBAY_API_KEY || null;
            const td = await tr.json();
            return td.access_token || null;
          } catch { return process.env.EBAY_API_KEY || null; }
        })();
        const ebayPrice = await getEbayPrice(da, dt, year, ebayToken);
        const finalPrice = ebayPrice || price;
        const inferredTierFinal = inferTier(finalPrice || 12, year);

        const priceSource = ebayPrice ? 'eBay UK median' : 'Discogs estimate';

        return {
          title: r.title || '',
          displayArtist: da,
          displayTitle: dt,
          year: String(year),
          label: (r.label || r.labels)?.[0]?.name || (r.label || [])?.[0] || '',
          catno: r.catno || r.labels?.[0]?.catno || '',
          image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image
               : r.images?.find(i => i.type === 'primary')?.uri || null,
          price: finalPrice,
          priceSource,
          genre,
          tier: inferredTierFinal.tier,
          hmvNote: inferredTierFinal.hmvNote,
          id: r.id,
        };
      })
    );

    const final = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    res.setHeader('Cache-Control', 's-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ results: final });

  } catch (err) {
    return res.status(200).json({ results: [] });
  }
}
