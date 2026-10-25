// POST /.netlify/functions/scan
// body: { image: { media_type: 'image/jpeg', data: '<base64>' } }  (one screenshot per request)
// -> { results: [film/series matched on TMDB], unmatched: ['Title the AI saw but TMDB could not find'] }
import { tmdb, brief, json } from '../lib/tmdb.mjs';

// A fast model keeps each screenshot well inside Netlify's 10-second function limit
const MODEL = process.env.SCAN_MODEL || 'claude-haiku-5-5';

const PROMPT = `This is a screenshot, probably from Instagram or another social app. It may show one or more films or TV series: posters, title cards, stills with captions, "films to watch" lists, or a grid of saved posts.

List every film or TV series it clearly identifies. Read titles from text, posters and captions. Only include titles you are confident about, and skip actors, directors, streaming services and other things that are not a film or series.

Respond with only a JSON array, no other text:
[{"title": "Title", "year": 1999, "type": "film"}]
Use "type": "series" for TV series. Use null for the year if you can't tell. If there are none, respond with [].`;

async function match(key, item) {
  const mediaType = item.type === 'series' ? 'tv' : 'movie';
  const q = encodeURIComponent(item.title);
  const yearParam = item.year ? (mediaType === 'tv' ? `&first_air_date_year=${item.year}` : `&year=${item.year}`) : '';
  let r = await tmdb(`/search/${mediaType}?query=${q}${yearParam}&include_adult=false&language=en-GB`, key);
  if (!(r.results || []).length && yearParam) r = await tmdb(`/search/${mediaType}?query=${q}&include_adult=false&language=en-GB`, key);
  // The AI sometimes guesses film vs series wrongly, so fall back to a combined search
  if (!(r.results || []).length) {
    const m = await tmdb(`/search/multi?query=${q}&include_adult=false&language=en-GB`, key);
    const hit = (m.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv');
    return hit ? brief(hit, hit.media_type) : null;
  }
  return brief(r.results[0], mediaType);
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const akey = process.env.ANTHROPIC_API_KEY;
  const tkey = process.env.TMDB_API_KEY;
  if (!akey) return json({ error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables.' }, 500);
  if (!tkey) return json({ error: 'TMDB_API_KEY is not set in Netlify environment variables.' }, 500);

  const { image } = await req.json().catch(() => ({}));
  const mediaType = image && /^image\/(jpeg|png|webp|gif)$/.test(image.media_type) ? image.media_type : null;
  if (!mediaType || !image.data) return json({ error: 'Send one screenshot as a JPEG, PNG or WebP.' }, 400);

  let found;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': akey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.data } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
    });
    if (!res.ok) return json({ error: `Claude API returned ${res.status}.`, detail: (await res.text()).slice(0, 300) }, 502);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    found = (Array.isArray(parsed) ? parsed : [])
      .map((x) => ({ title: String((x && x.title) || '').trim(), year: Number(x && x.year) || null, type: x && x.type === 'series' ? 'series' : 'film' }))
      .filter((x) => x.title)
      .slice(0, 20);
  } catch {
    return json({ error: "Couldn't read that screenshot. Try again." }, 502);
  }

  const results = [];
  const unmatched = [];
  const seen = new Set();
  await Promise.all(found.map(async (item) => {
    try {
      const hit = await match(tkey, item);
      if (!hit) { unmatched.push(item.title); return; }
      const k = `${hit.mediaType}-${hit.tmdbId}`;
      if (!seen.has(k)) { seen.add(k); results.push(hit); }
    } catch { unmatched.push(item.title); }
  }));

  return json({ results, unmatched });
};
