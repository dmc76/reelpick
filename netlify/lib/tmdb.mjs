// Shared TMDB helpers. Accepts either a v3 API key or a v4 read access token.
export async function tmdb(path, key) {
  const bearer = key.length > 40; // v4 tokens are long JWTs, v3 keys are 32 chars
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${bearer ? '' : `${sep}api_key=${encodeURIComponent(key)}`}`;
  const res = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? 'TMDB rejected the API key. Check TMDB_API_KEY in Netlify.' : `TMDB returned ${res.status}.`);
  }
  return res.json();
}

// mediaType is 'movie' or 'tv', matching TMDB's own naming
export const brief = (m, mediaType) => {
  const date = m.release_date || m.first_air_date || '';
  return {
    tmdbId: m.id,
    mediaType,
    title: m.title || m.name,
    year: date ? Number(date.slice(0, 4)) : null,
    poster: m.poster_path || null,
    overview: m.overview || '',
  };
};

// Prefer an official YouTube trailer, then any trailer, then a teaser
const pickTrailer = (videos) => {
  const yt = ((videos && videos.results) || []).filter((v) => v.site === 'YouTube');
  const t = yt.find((v) => v.type === 'Trailer' && v.official) || yt.find((v) => v.type === 'Trailer') || yt.find((v) => v.type === 'Teaser');
  return t ? t.key : null;
};

export const detail = (m, mediaType) => ({
  ...brief(m, mediaType),
  runtime: mediaType === 'movie' ? m.runtime || null : null,
  seasons: mediaType === 'tv' ? m.number_of_seasons || null : null,
  genres: (m.genres || []).map((g) => g.name),
  trailerKey: pickTrailer(m.videos),
  releaseDate: m.release_date || m.first_air_date || null,
  // Film series (e.g. The Godfather Collection) so sequels can wait their turn
  collectionId: (m.belongs_to_collection && m.belongs_to_collection.id) || null,
  collectionName: (m.belongs_to_collection && m.belongs_to_collection.name) || null,
  collectionChecked: mediaType === 'movie',
});

export const detailsPath = (id, mediaType) =>
  `/${mediaType === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(id)}?language=en-GB&append_to_response=videos&include_video_language=en,null`;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
