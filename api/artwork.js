export default async function handler(req, res) {
  const { artist, title, releaseId } = req.query;

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ url: null });

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Method 1: Direct release ID lookup — exact image every time
    if (releaseId) {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        const img = d.images?.find(i => i.type === 'primary') || d.images?.[0];
        if (img?.uri) return res.status(200).json({ url: img.uri });
      }
    }

    // Method 2: Search by artist + title (for wishlist items without a release ID)
    if (artist && title) {
      const q = encodeURIComponent(`${artist} ${title}`);
      const r = await fetch(
        `https://api.discogs.com/database/search?q=${q}&type=release&per_page=5&format=vinyl`,
        { headers }
      );
      if (r.ok) {
        const d = await r.json();
        const results = d.results || [];
        const al = artist.toLowerCase();
        const tl = title.toLowerCase();
        const best = results.find(x => {
          const parts = (x.title || '').toLowerCase().split(' - ');
          const ra = parts[0] || '';
          const rt = parts.slice(1).join(' - ') || '';
          return ra.includes(al.split(' ')[0]) && rt.includes(tl.split(' ')[0]);
        }) || results[0];
        const url = best?.cover_image && !best.cover_image.includes('spacer')
          ? best.cover_image : null;
        return res.status(200).json({ url });
      }
    }

    return res.status(200).json({ url: null });
  } catch {
    return res.status(200).json({ url: null });
  }
}
