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

## Field Pulse (anonymous crowd feedback)
Readers (bankers and value-chain participants) answer a short, one-tap poll on a card, telling us whether they are seeing the event on the ground. The aggregates cross-check the news against what's happening in the field.

**How it works for the reader**
- The first time someone opens a poll, the app asks **"What best describes you?"**: Banker/lender, Manufacturer/promoter/operator, Input supplier/trader, Buyer/dealer/distributor/exporter, Logistics/transporter/CHA, Labour contractor, CA/consultant/association member, Other, or *Skip — just browsing*. The answer is saved in `localStorage`. There's no login, and the role can be changed under **My clusters**.
- Feed cards have a button, **"Are you seeing this? Tell us in 10 sec"** (it opens a bottom sheet). The card detail page shows the poll inline, plus a **Field pulse** block.
- Each poll shows 2–3 one-tap questions for the reader's role: an accuracy check and 1–2 behavioural questions. There's an optional free-text box (280 characters), a ગુજરાતી/English toggle, an *Answer as another role* option, and a thank-you state. Each device can answer once per card (random anonymous device id plus `localStorage`).
- Field pulse shows **"Collecting field signals (n/5)"** until a card has at least 5 valid responses. After that it shows confirm% and contradict% for each role, a role-weighted field index, divergence flags and the latest free-text notes. It always carries the label *"Crowd field signal — anonymous, self-reported, unverified; not borrower-level evidence."*
- A **"Field: confirms / contradicts / mixed"** tag appears next to the credit badge once n ≥ 5. The AI `credit_signal` itself is never changed.

**Pipeline**
- `pipeline/lib/polls.mjs` uses Gemini to generate polls for credit-relevant AI cards. Negative and watch cards go first, newest first, up to `MAX_POLL_ITEMS` per run (default 20). Polls are cached in `data-cache/llm-cache.json` under `poll:<prompt_version>:<card id>`, so reruns cost nothing. Each poll picks 3–5 roles, each with a proximity weight from 1 to 3. Every question has a type (`accuracy`, `yes_no_notseen`, `scale5`, `choice`), a mechanism (volume, realisation, input_cost, margin, receivables, inventory, creditors, wc_utilisation, repayment), and `supports`/`contradicts` option lists. The sanitiser enforces the fixed accuracy options, drops anything asking for names, accounts or IDs, and returns `no_poll` for vague items. The output goes to `public/data/polls.json`.
- `pipeline/lib/feedback.mjs` harvests responses from the relay into `data-cache/feedback/inbox.jsonl`, which stays encrypted and is the durable store. It then decrypts and validates them (card, role and option must exist) and aggregates them into `public/data/pulse.json`. Responses are dropped if they are test submissions, faster than 0.6 s per answer + 0.6 s, all "Not seen/Not seeing it", straight-lined (same option position across different option sets), or from a device sending more than 40 a day. Only the latest answer per device per card is kept. Free text is scrubbed of links, emails, numbers and PAN-like IDs.
- A divergence is flagged when one role mostly confirms and another mostly contradicts, when the closest role says the report is overstated or not visible, or when the field index is ≤ −0.25 against the news direction.
- Each weekly brief gets a `field_pulse` section with what the field confirms, contradicts and what is still unknown, with counts. Gemini writes it only when at least one card has n ≥ 5. Otherwise it is marked *insufficient data* and no LLM call is made.
- In the GitHub Action, the full run (every 5 hours) does news, polls and pulse. A feedback-only run every 2 hours (`FEEDBACK_ONLY=1`, cron `45 */2 * * *`) harvests and aggregates, and deploys only if new responses arrived. You can also trigger it manually: *Actions → pipeline-and-deploy → Run workflow → feedback_only*.

**Storage: ntfy.sh relay + end-to-end encryption + repo as the store (free, no new account)**
- The browser encrypts each response (ECDH P-256 + AES-GCM) with the **public** key in `config/feedback.json` and POSTs it to a random ntfy.sh topic. ntfy.sh is free, needs no account and supports CORS. Anyone can read that topic, but they only see ciphertext.
- The private key exists only in `.env` and the repo secret `FEEDBACK_PRIVATE_KEY`. The static site holds no secret.
- ntfy.sh keeps messages for about 12 hours, so the 2-hourly harvest copies them into the repo. If the Action stops for more than about 12 hours, responses from that gap are lost.
- Limits: ntfy.sh anonymous rate limits apply per IP (a few hundred messages a day). That's fine for a pilot, but many users behind one bank NAT could hit it. It's a third-party free service with no SLA. Anyone can post junk to the topic, but the aggregator only accepts decryptable payloads that pass validation.

**Switch to Google Sheet (Apps Script) instead**: use this if you'd rather own the data in your Drive.
1. Create a Google Sheet → *Extensions → Apps Script*, then paste in `feedback/apps-script/Code.gs`.
2. *Project Settings → Script properties*: add `EXPORT_TOKEN` = a long random string.
3. *Deploy → New deployment → Web app*, with *Execute as: Me* and *Who has access: Anyone*. Authorise it and copy the `/exec` URL.
4. `config/feedback.json`: set `"adapter": "apps_script"` and `"apps_script": {"url": "<exec url>"}`. Run `gh secret set FEEDBACK_EXPORT_TOKEN`, then commit and push.
   Responses are sent as plaintext to your private Sheet. `doGet?action=aggregates` returns public counts, and `doGet?action=export&token=…` returns the rows to the Action.
If `adapter` is `none`, the app shows *"Field pulse coming soon"* and queues answers in `localStorage`. They're sent automatically once a backend is configured.

**Admin**
- To rotate the key, generate a new P-256 pair, put the public JWK in `config/feedback.json` and the base64 private JWK in `.env` and `gh secret set FEEDBACK_PRIVATE_KEY`. Old inbox lines then become undecryptable and are counted as `undecryptable`. Keep the old key if you need the history.
- Test mode: in the browser console run `localStorage.setItem('ccp.fp.test','true')`. Submissions are then flagged `test` and excluded from aggregates (counted in `pulse.json → stats.test_excluded`).
- If someone submits a poisoned card, add its id to `hidden_ids`, or delete lines from `data-cache/feedback/inbox.jsonl`.
- Screenshots: `node scripts/pulse-screenshots.mjs <url>` (uses test mode).
- Privacy: no names, accounts or borrower data are asked for. Free text is scrubbed, and only the 5 latest notes per card are published, and only once n ≥ 5. Because the repo is public, the encrypted inbox is public too, but it can't be read without the private key.

## File structure
```
config/clusters.json        clusters, industries, keywords, Google News queries, publisher feeds  ← edit to add clusters
config/hidden_ids.json      admin suppression list
pipeline/run.mjs            pipeline entry point
pipeline/lib/rss.mjs        RSS fetch/parse (headline, link, date, source only; no article bodies)
pipeline/lib/dedup.mjs      title normalisation + same-event clustering
pipeline/lib/heuristic.mjs  no-key mode: keyword event typing, signal, rule-based credit checklist
pipeline/lib/llm.mjs        OpenRouter / Gemini free-tier clients (keys from env only), retries, rate-limit backoff
pipeline/lib/prompts.mjs    card + weekly-brief (+ brief field-pulse) prompts (credit-officer voice, JSON output)
pipeline/lib/polls.mjs      Field Pulse poll prompt + sanitiser
pipeline/lib/feedback.mjs   Field Pulse harvest (ntfy / Apps Script), decrypt, validate, aggregate
config/feedback.json        Field Pulse backend adapter + public encryption key
feedback/apps-script/Code.gs  optional Google Sheet backend
data-cache/feedback/inbox.jsonl  encrypted raw responses (durable store)
data-cache/llm-cache.json   LLM results cached by sha1(article URL), so items are never re-processed
public/data/*.json          generated: feed.json, briefs.json, clusters.json, hidden_ids.json, meta.json, polls.json, pulse.json, feedback.json
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
