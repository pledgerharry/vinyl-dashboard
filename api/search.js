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

async function getMarketPrice(releaseId, headers, year) {
  // Step 1: get master_id from release for broader stats
  let masterId = null;
  let communityHave = 0;
  let communityWant = 0;
  try {
    const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
    if (r.ok) {
      const d = await r.json();
      masterId = d.master_id || null;
      communityHave = d.community?.have || 0;
      communityWant = d.community?.want || 0;
    }
  } catch {}

  // Step 2: marketplace stats on release
  try {
    const r = await fetch(
      `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      if (!d.blocked_from_sale && d.median?.value > 0) {
        let price = d.median.value;
        const numSales = d.num_for_sale || 0;
        if (numSales > 20 && d.lowest_price?.value > 0) {
          const blend = numSales > 50 ? 0.3 : 0.5;
          price = price * (1 - blend) + d.lowest_price.value * blend;
        }
        return Math.round(price);
      }
      if (!d.blocked_from_sale && d.lowest_price?.value > 0) {
        return Math.round(d.lowest_price.value * 1.3);
      }
    }
  } catch {}

  // Step 3: master release lowest price
  if (masterId) {
    try {
      const r = await fetch(`https://api.discogs.com/masters/${masterId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        if (d.lowest_price > 0) return Math.round(d.lowest_price * 1.35);
      }
    } catch {}
  }

  // Step 4: price suggestions
  try {
    const r = await fetch(
      `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      const vgp = d['Very Good Plus (VG+)'];
      const vg  = d['Very Good (VG)'];
      if (vgp?.value > 0) return Math.round(vgp.value);
      if (vg?.value  > 0) return Math.round(vg.value * 1.25);
    }
  } catch {}

  return null;
}

function priceFromCommunity(r) {
  const have = r.community?.have || 0;
  const want = r.community?.want || 0;
  const year = parseInt(r.year) || 1985;
  if (have === 0) return 13;

  const ratio = want / have;
  let base;
  if (ratio > 5)        base = 55;
  else if (ratio > 3)   base = 38;
  else if (ratio > 2)   base = 28;
  else if (ratio > 1)   base = 20;
  else if (ratio > 0.5) base = 15;
  else if (ratio > 0.2) base = 12;
  else                  base = 10;

  // Popular records floor
  if (have > 10000) base = Math.max(base, 14);
  if (have > 50000) base = Math.max(base, 16);

  const ageMult = year < 1965 ? 1.6 : year < 1970 ? 1.4 : year < 1975 ? 1.25
                : year < 1980 ? 1.15 : year < 1990 ? 1.05 : 1.0;

  return Math.round(Math.min(base * ageMult, 80));
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

        return {
          title: r.title || '',
          displayArtist: da,
          displayTitle: dt,
          year: String(year),
          label: (r.label || r.labels)?.[0]?.name || (r.label || [])?.[0] || '',
          catno: r.catno || r.labels?.[0]?.catno || '',
          image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image
               : r.images?.find(i => i.type === 'primary')?.uri || null,
          price,
          genre,
          tier: inferredTier.tier,
          hmvNote: inferredTier.hmvNote,
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
