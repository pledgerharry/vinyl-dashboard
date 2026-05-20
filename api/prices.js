export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse body
  let records;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    records = body.records;
  } catch { return res.status(400).json({ error: 'Invalid body' }); }

  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const discogsToken = process.env.DISCOGS_TOKEN;
  const dHeaders = discogsToken ? {
    'Authorization': `Discogs token=${discogsToken}`,
    'User-Agent': 'VinylDashboard/1.0'
  } : null;

  const ebayToken = await getEbayToken();

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      const ebayPrice = await getEbayPrice(artist, title, year, ebayToken);
      if (ebayPrice) return { releaseId, artist, title, price: ebayPrice };
      if (releaseId && dHeaders) {
        const dp = await getDiscogsPrice(releaseId, year, dHeaders);
        if (dp) return { releaseId, artist, title, price: dp };
      }
      const yr = parseInt(year) || 0;
      return { releaseId, artist, title, price: yr<1970?18:yr<1980?14:yr<1990?12:yr<2000?10:12 };
    })
  );

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    prices: results.filter(r => r.status === 'fulfilled').map(r => r.value)
  });
}

// Remove outliers: keep values within 1.5x IQR of Q1/Q3
function iqrFilter(sorted) {
  if (sorted.length < 4) return sorted;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo  = q1 - 1.5 * iqr;
  const hi  = q3 + 1.5 * iqr;
  const filtered = sorted.filter(p => p >= lo && p <= hi);
  return filtered.length > 0 ? filtered : sorted; // fall back if filter removes everything
}

// ── eBay ──────────────────────────────────────────────────────
async function getEbayToken() {
  const cid = process.env.EBAY_CLIENT_ID;
  const cs  = process.env.EBAY_CLIENT_SECRET;
  if (!cid || !cs) return process.env.EBAY_API_KEY || null;
  try {
    const creds = Buffer.from(`${cid}:${cs}`).toString('base64');
    const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    if (!r.ok) return process.env.EBAY_API_KEY || null;
    const d = await r.json();
    return d.access_token || null;
  } catch { return process.env.EBAY_API_KEY || null; }
}

async function getEbayPrice(artist, title, year, token) {
  if (!token) return null;
  try {
    const yr = parseInt(year) || 0;
    // Include year in query to target the right pressing, not rare originals
    const yearStr = yr > 1900 ? ` ${yr}` : '';
    // Simplify artist name — remove "& The X" etc for better matching
    const cleanArtist = artist.replace(/&.*$/, '').replace(/\s+/g,' ').trim();
    const q = encodeURIComponent(`${cleanArtist} ${title}${yearStr} vinyl`);
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${q}` +
      `&filter=buyingOptions:{AUCTION|FIXED_PRICE},conditions:{USED},itemLocationCountry:GB` +
      `&category_ids=176985&sort=endDateDesc&limit=20`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' }
    });
    if (!r.ok) return null;
    const d = await r.json();

    // Decade-based price ceiling — filters out expensive original pressings
    // that aren't what we have
    const ceiling = yr < 1960 ? 80 : yr < 1970 ? 60 : yr < 1980 ? 50
                  : yr < 1990 ? 45 : yr < 2000 ? 40 : 60;

    const a0 = cleanArtist.toLowerCase().split(' ')[0];
    const t0 = title.toLowerCase().split(' ')[0];
    const prices = (d.itemSummaries || [])
      .filter(i => {
        const t = (i.title||'').toLowerCase();
        return t.includes(a0) && t.includes(t0) &&
               !t.includes(' cd') && !t.includes('box set') &&
               !t.includes('cassette') && !t.includes('dvd');
      })
      .map(i => parseFloat(i.price?.value||0))
      .filter(p => p > 1 && p <= ceiling)
      .sort((a,b) => a-b);

    if (!prices.length) return null;
    // IQR filter then median
    const filtered = iqrFilter(prices);
    if (!filtered.length) return null;
    const mid = Math.floor(filtered.length/2);
    return Math.round(filtered.length%2===0 ? (filtered[mid-1]+filtered[mid])/2 : filtered[mid]);
  } catch { return null; }
}

// ── Discogs ───────────────────────────────────────────────────
function toGBP(v, cur) {
  const rates = {GBP:1,USD:0.79,EUR:0.85,CAD:0.58,AUD:0.51,JPY:0.0053};
  return (v||0) * (rates[cur]||0.79);
}

function wavg(a, b, c) {
  let t=0,w=0;
  if(a!==null){t+=a*1;w+=1;} if(b!==null){t+=b*2;w+=2;} if(c!==null){t+=c*2;w+=2;}
  return w>0 ? Math.round(t/w) : null;
}

function heuristic(have, want, year) {
  const yr=parseInt(year)||1985, ratio=have>0?want/have:0.5;
  let base = ratio>5?50:ratio>3?35:ratio>1.5?22:ratio>0.8?16:ratio>0.3?12:9;
  if(have>50000) base=Math.max(base,14); else if(have>10000) base=Math.max(base,11);
  const age = yr<1970?1.3:yr<1980?1.1:1.0;
  return Math.round(Math.min(base*age,70));
}

async function statsMedian(rid, h) {
  try {
    const r=await fetch(`https://api.discogs.com/marketplace/stats/${rid}`,{headers:h});
    if(!r.ok) return null;
    const d=await r.json();
    if(d.blocked_from_sale) return null;
    const m=toGBP(d.median?.value||0, d.median?.currency||'USD');
    return m>=1 ? Math.round(m) : null;
  } catch { return null; }
}

async function masterMedian(mid, excl, h) {
  try {
    const r=await fetch(`https://api.discogs.com/masters/${mid}/versions?per_page=10&sort=released`,{headers:h});
    if(!r.ok) return null;
    const vs=(await r.json()).versions||[];
    const sorted=vs.sort((a,b)=>(b.stats?.community?.in_collection||0)-(a.stats?.community?.in_collection||0))
                   .slice(0,5).filter(v=>String(v.id)!==String(excl));
    for(const v of sorted){ const m=await statsMedian(v.id,h); if(m) return m; }
  } catch {}
  return null;
}

async function getDiscogsPrice(rid, year, h) {
  let have=0,want=0,mid=null,yr=year;
  try {
    const r=await fetch(`https://api.discogs.com/releases/${rid}`,{headers:h});
    if(r.ok){const d=await r.json();have=d.community?.have||0;want=d.community?.want||0;mid=d.master_id||null;yr=d.year||year;}
  } catch {}
  const a=heuristic(have,want,yr);
  const b=await statsMedian(rid,h);
  const c=mid?await masterMedian(mid,rid,h):null;
  return wavg(a,b,c);
}
