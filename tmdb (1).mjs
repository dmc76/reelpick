// GET /.netlify/functions/tmdb
//   ?q=title                               -> films and series matching a title
//   ?id=123&type=movie|tv                  -> full details incl. trailer
//   ?mode=person&q=name                    -> people matching a name
//   ?mode=credits&id=123&role=cast|crew    -> a person's films and series (crew = as director)
//   ?mode=genres&type=movie|tv             -> genre list
//   ?mode=discover&type=movie|tv&genres=27,35&sort=popular|top|newest&page=1
import { tmdb, brief, detail, detailsPath, json } from '../lib/tmdb.mjs';

const TV_JUNK = new Set([10763, 10764, 10767]); // news, reality, talk shows
const isSelf = (c) => /\b(self|himself|herself|themselves)\b/i.test(c.character || '');

export default async (req) => {
  const key = process.env.TMDB_API_KEY;
  if (!key) return json({ error: 'TMDB_API_KEY is not set in Netlify environment variables.' }, 500);

  const url = new URL(req.url);
  const p = (k) => url.searchParams.get(k);
  const mode = p('mode') || (p('id') ? 'details' : 'search');
  const type = p('type') === 'tv' ? 'tv' : 'movie';

  try {
    if (mode === 'details' && p('id')) return json(detail(await tmdb(detailsPath(p('id'), type), key), type));

    if (mode === 'search' && p('q')) {
      const r = await tmdb(`/search/multi?query=${encodeURIComponent(p('q'))}&include_adult=false&language=en-GB`, key);
      const results = (r.results || [])
        .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
        .slice(0, 12)
        .map((m) => brief(m, m.media_type));
      return json({ results });
    }

    if (mode === 'person' && p('q')) {
      const r = await tmdb(`/search/person?query=${encodeURIComponent(p('q'))}&include_adult=false&language=en-GB`, key);
      return json({
        results: (r.results || []).slice(0, 8).map((x) => ({
          id: x.id,
          name: x.name,
          photo: x.profile_path || null,
          dept: x.known_for_department || '',
          knownFor: (x.known_for || []).map((k) => k.title || k.name).filter(Boolean).slice(0, 3),
        })),
      });
    }

    if (mode === 'credits' && p('id')) {
      const role = p('role') === 'crew' ? 'crew' : 'cast';
      const r = await tmdb(`/person/${encodeURIComponent(p('id'))}/combined_credits?language=en-GB`, key);
      const source = role === 'crew' ? (r.crew || []).filter((c) => c.job === 'Director') : (r.cast || []).filter((c) => !isSelf(c));
      const seen = new Set();
      const results = source
        .filter((c) => c.media_type === 'movie' || c.media_type === 'tv')
        .filter((c) => !(c.genre_ids || []).some((g) => TV_JUNK.has(g)))
        .filter((c) => c.media_type === 'movie' || role === 'crew' || (c.episode_count || 0) >= 3) // skip one-off TV guest spots
        .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
        .filter((c) => { const k = `${c.media_type}-${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 150)
        .map((c) => ({ ...brief(c, c.media_type), role: role === 'crew' ? 'Director' : c.character ? `as ${c.character}` : '' }));
      return json({ results });
    }

    if (mode === 'genres') {
      const r = await tmdb(`/genre/${type}/list?language=en-GB`, key);
      return json({ results: r.genres || [] });
    }

    if (mode === 'discover') {
      const genres = (p('genres') || '').replace(/[^0-9,]/g, '');
      if (!genres) return json({ error: 'Choose at least one genre.' }, 400);
      const page = Math.max(1, Math.min(20, Number(p('page')) || 1));
      const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';
      const today = new Date().toISOString().slice(0, 10);
      const sorts = {
        popular: 'sort_by=popularity.desc&vote_count.gte=50',
        top: `sort_by=vote_average.desc&vote_count.gte=${type === 'tv' ? 150 : 500}`,
        newest: `sort_by=${dateField}.desc&${dateField}.lte=${today}&vote_count.gte=20`,
      };
      // Comma-separated genres mean "all of these", so 27,35 = horror comedies
      const r = await tmdb(`/discover/${type}?with_genres=${genres}&include_adult=false&language=en-GB&page=${page}&${sorts[p('sort')] || sorts.popular}`, key);
      return json({ results: (r.results || []).map((m) => brief(m, type)), page: r.page || page, totalPages: Math.min(r.total_pages || 1, 20) });
    }

    return json({ error: 'Unrecognised request.' }, 400);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
