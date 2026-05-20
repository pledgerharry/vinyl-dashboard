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
    if (releaseId) {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        const img = d.images?.find(i => i.type === 'primary') || d.images?.[0];
        const url = img?.uri || null;

        // Always fetch master to get original year — don't skip this
        let originalYear = null;
        if (d.master_id) {
          const mr = await fetch(`https://api.discogs.com/masters/${d.master_id}`, { headers });
          if (mr.ok) {
            const md = await mr.json();
            if (md.year) originalYear = String(md.year);
          }
        }
        // If no master (e.g. one-off pressing), use the release's own year
        if (!originalYear && d.year) originalYear = String(d.year);

        return res.status(200).json({ url, originalYear });
      }
    }

    // Search fallback for wishlist items
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
        return res.status(200).json({ url, originalYear: best?.year ? String(best.year) : null });
      }
    }

    return res.status(200).json({ url: null, originalYear: null });
  } catch(e) {
    return res.status(200).json({ url: null, originalYear: null, error: e.toString() });
  }
}
