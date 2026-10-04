// POST /.netlify/functions/recommend
// body: { profileName, films: [{ title, year, mediaType, watched, rating }], exclude: [title] }
import { tmdb, detail, detailsPath, json } from '../lib/tmdb.mjs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const COUNT = 6;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const akey = process.env.ANTHROPIC_API_KEY;
  if (!akey) return json({ error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables.' }, 500);

  const { profileName = '', films = [], exclude = [] } = await req.json().catch(() => ({}));
  if (!films.length) return json({ error: 'Add a few titles first so suggestions have something to go on.' }, 400);

  const list = films
    .slice(0, 80)
    .map((f) => {
      const kind = f.mediaType === 'tv' ? ' [series]' : '';
      const seen = f.watched ? (f.rating ? ` [watched, rated ${f.rating}/5]` : ' [already watched]') : '';
      return `- ${f.title}${f.year ? ` (${f.year})` : ''}${kind}${seen}`;
    })
    .join('\n');
  const skip = exclude.slice(0, 100).join('; ') || 'none';

  const prompt = `This is a watchlist of films and TV series for a viewing profile called "${profileName}" (for example a family, a couple, or a parent and child watching together).

On their list:
${list}

Suggest ${COUNT} films or TV series they have not listed and may not have thought of. Match the balance of their list: if it is mostly films, suggest mostly films; if it includes series, include some series. Mix well-loved picks with a couple of lesser-known ones. Where titles have ratings, lean towards what they rated 4 or 5 and steer away from what they rated 1 or 2. Match the audience the profile name implies: if it suggests children are watching, keep every suggestion age-appropriate. Do not suggest anything already on the list or any of these earlier suggestions: ${skip}.

Respond with only a JSON array, no other text, in this shape:
[{"title": "Title", "year": 1999, "type": "film", "reason": "One sentence linking it to titles on their list."}]
Use "type": "series" for TV series. For series, year is the year it first aired.`;

  let picks;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': akey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: `Claude API returned ${res.status}.`, detail: t.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    picks = Array.isArray(parsed) ? parsed : parsed.films || [];
  } catch (e) {
    return json({ error: 'Suggestions came back in an unreadable format. Try again.' }, 502);
  }

  // Enrich each suggestion with TMDB poster, details and trailer where possible.
  const tkey = process.env.TMDB_API_KEY;
  const out = await Promise.all(
    picks.slice(0, COUNT).map(async (p) => {
      const mediaType = p.type === 'series' ? 'tv' : 'movie';
      const base = { title: String(p.title || '').trim(), year: Number(p.year) || null, mediaType, reason: String(p.reason || '').trim() };
      if (!tkey || !base.title) return base;
      try {
        const yearParam = base.year ? (mediaType === 'tv' ? `&first_air_date_year=${base.year}` : `&year=${base.year}`) : '';
        const s = await tmdb(`/search/${mediaType}?query=${encodeURIComponent(base.title)}${yearParam}&include_adult=false`, tkey);
        const hit = s.results && s.results[0];
        if (!hit) return base;
        return { ...detail(await tmdb(detailsPath(hit.id, mediaType), tkey), mediaType), reason: base.reason };
      } catch {
        return base;
      }
    })
  );

  return json({ films: out.filter((f) => f.title) });
};
