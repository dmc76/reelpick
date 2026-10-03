# ReelPick

Film and series picker: watchlists per profile, a random pick with optional filters, and AI suggestions.

## Files
- `public/index.html` – the app (React + Tailwind from CDN, no build step)
- `netlify/functions/tmdb.mjs` – search by title, actor/director or genre, plus details and trailers
- `netlify/functions/recommend.mjs` – AI suggestions via the Claude API, enriched with TMDB posters
- `netlify/lib/tmdb.mjs` – shared helpers
- `netlify.toml` – tells Netlify where the site and functions live

## Deploy
1. Push this folder to a GitHub repo and connect it in Netlify (or use `netlify deploy` from the CLI).
   Use Git or the CLI rather than drag-and-drop so the functions get deployed.
2. In Netlify: Site configuration > Environment variables, add:
   - `TMDB_API_KEY` – your TMDB v3 API key or v4 read access token (either works)
   - `ANTHROPIC_API_KEY` – your Anthropic API key
   - `ANTHROPIC_MODEL` (optional) – defaults to `claude-sonnet-5-5`
3. Redeploy so the functions pick up the variables.

## Notes
- Data is saved in the browser (localStorage) through the `store` object at the top of the script.
  Swap that object for Supabase when you want sync across devices.
- AI suggestions run automatically once 3 new films have been added since the last batch
  (`AUTO_SUGGEST_AFTER`), or on demand from the Suggested tab.
- TMDB's terms ask for their logo alongside the attribution line in the footer; add it before sharing publicly.
