# Cluster Credit Pulse

Inshorts-style news feed for Indian MSME credit bankers, covering local industrial clusters, with a credit interpretation on every card.
No sign-in, no database, no paid services. It's a static web app (PWA) that reads JSON files, which a scheduled pipeline regenerates.

**v1 clusters:** Morbi (ceramic tiles, sanitaryware, kraft/packaging paper) and Surat (MMF textiles & trading, weaving & yarn, embroidery, diamonds).

```
RSS (Google News search in English/Gujarati/Hindi + publisher feeds)
  → filter to cluster industries → dedupe (title similarity + same-event grouping)
  → card: free LLM (OpenRouter → Gemini) or rule-based fallback
  → weekly brief per cluster → public/data/*.json → static app (Vite + React)
```

## Screens
1. **First-visit picker**: choose clusters and industries (stored in `localStorage`). You can skip it to see everything.
2. **Feed**: vertical snap-scroll cards, cluster and signal filter chips, and a Negative/Watch/Positive badge.
3. **Card detail**: the credit note (what happened, confirmed vs alleged, exposed sub-sectors, effects on volumes/realisations/costs/margins/receivables/inventory/creditors/WC/DSCR, temporary vs structural, what to check, what would confirm or disprove), plus the source link.
4. **Weekly brief** per cluster: what changed, stress signals, improvement signals and what to watch.
5. **WhatsApp share**: a `wa.me` link with the headline, the credit view, the original source URL and a deep link to the card.
6. **Hidden admin**: `config/hidden_ids.json` (see below).

## File structure
```
config/clusters.json        clusters, industries, keywords, Google News queries, publisher feeds  ← edit to add clusters
config/hidden_ids.json      admin suppression list
pipeline/run.mjs            pipeline entry point
pipeline/lib/rss.mjs        RSS fetch/parse (headline, link, date, source only; no article bodies)
pipeline/lib/dedup.mjs      title normalisation + same-event clustering
pipeline/lib/heuristic.mjs  no-key mode: keyword event typing, signal, rule-based credit checklist
pipeline/lib/llm.mjs        OpenRouter / Gemini free-tier clients (keys from env only), retries, rate-limit backoff
pipeline/lib/prompts.mjs    card + weekly-brief prompts (credit-officer voice, JSON output)
data-cache/llm-cache.json   LLM results cached by sha1(article URL), so items are never re-processed
public/data/*.json          generated: feed.json, briefs.json, clusters.json, hidden_ids.json, meta.json
public/manifest.webmanifest, public/sw.js, public/icons/   PWA
src/                        React app (hash routing, works on any static host)
scripts/screenshots.mjs     headless 390×844 screenshots
.github/workflows/pipeline-and-deploy.yml   cron every 5h → pipeline → commit data → build → GitHub Pages
```

## Run locally
Requires Node 20+.
```bash
npm install
npm run pipeline          # fetch live RSS → public/data/*.json (no-key mode unless env keys are set)
npm run build && npm run preview   # http://localhost:4173/cluster-credit-pulse/
# or: npm run dev        # hot-reload dev server
```
With keys: `export OPENROUTER_API_KEY=...` (and/or `GEMINI_API_KEY=...`), then run `npm run pipeline`. Or copy `.env.example` to `.env` and run `npm run pipeline:env`.

Useful env vars: `MAX_LLM_ITEMS` (default 40 new items per run), `LLM_DELAY_MS` (default 4000 ms between calls), `OPENROUTER_MODELS`, `GEMINI_MODELS` (comma-separated, tried in order).

## LLM modes (all free)
| Mode | When | What you get |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` set | Tries `OPENROUTER_MODELS` in order (default: `moonshotai/kimi-k2.6:free`, `moonshotai/kimi-k2:free`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free`). |
| Gemini | `GEMINI_API_KEY` set (also used as a fallback after OpenRouter) | `gemini-3.8-flash` → `gemini-3.5-flash` → `gemini-3.5-flash-lite` (free-tier daily caps on the two flash models are small, so most calls end up on flash-lite) |
| No-key | No key, or all calls failed | Rule-based tags and a credit checklist. Cards are clearly labelled "Rule-based", the headline stays in its original language, and there's no AI summary. |

**Kimi K2 availability (checked 9 Oct 2026):** OpenRouter's public model list still has `moonshotai/kimi-k2.6:free` and `moonshotai/kimi-k2:free`, but both show **0 live endpoints**, so they will probably fail. The paid Kimi models (`moonshotai/kimi-k2.6` and others) work but cost money. That's why the default list falls back to other free models and then to Gemini. A model that returns a 4xx error is skipped for the rest of the run.

### Get free keys
- **OpenRouter:** sign up at https://openrouter.ai, go to *Keys*, then *Create key*. `:free` models cost nothing, but they have daily request caps (low unless you've bought credits once) and per-minute limits. Check the current list of free models at https://openrouter.ai/models?max_price=0.
- **Gemini:** go to https://aistudio.google.com, choose *Get API key*, then *Create API key* (no billing needed). AI Studio shows your free-tier limits for each project. Note that Google may use free-tier prompts to improve its products. This is fine for public news, but don't send confidential data.

Each run makes at most `MAX_LLM_ITEMS` card calls plus one brief call per cluster. Results are cached by URL, so steady-state usage is only the handful of new articles each run.

## Deploy free (GitHub Pages)
1. Create a free GitHub account, then a new **public** repository (Pages is free for public repos), e.g. `cluster-credit-pulse`.
2. Push this folder:
   ```bash
   git init && git add . && git commit -m "Cluster Credit Pulse v1"
   git branch -M main && git remote add origin https://github.com/<you>/cluster-credit-pulse.git && git push -u origin main
   ```
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Optional: in **Settings → Secrets and variables → Actions**, add `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY`.
5. **Actions** tab → *pipeline-and-deploy* → **Run workflow**. After that it runs every 5 hours and the site goes live at `https://<you>.github.io/cluster-credit-pulse/`.
   (GitHub pauses scheduled workflows after 60 days with no repo activity, but the data commits count as activity.)

Alternatives: Cloudflare Pages or Vercel (build command `npm run build`, output `dist`). Keep the GitHub Action for the data refresh either way.

## Add a cluster
Add an object to `config/clusters.json` → `clusters[]`:
```json
{
  "id": "tiruppur", "name": "Tiruppur", "state": "Tamil Nadu", "district": "Tiruppur",
  "tagline": "Knitwear export hub",
  "aliases": ["Tiruppur", "Tirupur", "திருப்பூர்"],
  "industries": [{
    "id": "knitwear", "name": "Knitwear exports", "icon": "textile", "colors": ["#0f766e", "#5eead4"],
    "keywords": ["knitwear", "garment", "hosiery", "apparel", "export"],
    "subsegments": "Knitwear exporters, job-work units, dyeing units",
    "credit_checks": ["US/EU buyer concentration", "PCFC ageing"]
  }],
  "queries": [{ "q": "Tiruppur knitwear", "lang": "en" }, { "q": "Tiruppur exporters", "lang": "en" }]
}
```
`icon` is one of: `tiles, sanitary, paper, textile, loom, embroidery, diamond`. Query `lang` is `en`, `gu` or `hi`. Add another entry to `HL` in `pipeline/lib/rss.mjs` for other languages, e.g. `ta: ['ta-IN','IN:ta']`. Then run `npm run pipeline`.

## Hide a bad card (admin)
Open the card. Its id is shown at the bottom (e.g. `Card id: 1a2b3c4d5e6f`). Add it to `config/hidden_ids.json`:
```json
{ "hidden_ids": ["1a2b3c4d5e6f"] }
```
Commit. The next pipeline run drops it, and the app also filters ids listed in `public/data/hidden_ids.json` at runtime. To hide a card straight away, edit both files.

## Content and legal guardrails
- The app stores and shows only the **headline, its own summary/notes, the source name, the date and a link to the original**. It never fetches article bodies or publisher images. Card art is a generated gradient and icon for each industry.
- Google News RSS links go through `news.google.com`, which redirects the browser to the publisher. Google's feed terms describe the RSS as being for *personal, non-commercial* feed-reader use. That's fine for a free pilot, but before any commercial launch, switch to publisher RSS or licensed feeds (see the venture report §IX).
- Every card is labelled **"AI analysis — verify before acting"** or, in no-key mode, **"Rule-based checklist"**. Neither is a basis for classification, sanction or borrower-specific decisions.
