#!/usr/bin/env node
// Cluster Credit Pulse pipeline: RSS -> filter -> dedupe -> (LLM | heuristic) cards -> weekly briefs -> public/data/*.json
// Usage: node pipeline/run.mjs   (env: OPENROUTER_API_KEY | GEMINI_API_KEY optional, MAX_LLM_ITEMS, LLM_DELAY_MS)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fetchFeed, googleNewsUrl } from './lib/rss.mjs';
import { dedupe, normTokens, similarity } from './lib/dedup.mjs';
import { anyKw, heuristicCard, classify, EVENT_TYPES } from './lib/heuristic.mjs';
import { llmMode, completeJson, usage, rateLimits } from './lib/llm.mjs';
import { CARD_SYSTEM, cardPrompt, BRIEF_SYSTEM, briefPrompt } from './lib/prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const log = (...a) => console.log('[pipeline]', ...a);

const config = readJson(P('config/clusters.json'));
const hidden = new Set(readJson(P('config/hidden_ids.json'), { hidden_ids: [] }).hidden_ids || []);
const cache = readJson(P('data-cache/llm-cache.json'), {});
const prevFeed = readJson(P('public/data/feed.json'), { items: [] });
const MAX_AGE = (config.settings?.max_age_days ?? 30) * 864e5;
const BRIEF_WINDOW = (config.settings?.brief_window_days ?? 7) * 864e5;
const MAX_LLM = Number(process.env.MAX_LLM_ITEMS || 40);
const mode = llmMode();
const now = Date.now();
const clusterById = Object.fromEntries(config.clusters.map((c) => [c.id, c]));
const stats = { feeds_ok: 0, feeds_failed: [], raw_items: 0, after_filter: 0, after_dedupe: 0, llm_calls: 0, llm_failures: 0, cache_hits: 0 };

function matchIndustries(cluster, text) {
  return cluster.industries.filter((i) => anyKw(text, i.keywords));
}

async function collect() {
  const jobs = [];
  for (const c of config.clusters) for (const q of c.queries) jobs.push({ kind: 'gn', cluster: c, q, url: googleNewsUrl(q.q, q.lang, config.settings?.google_news_window) });
  for (const f of config.publisher_feeds || []) jobs.push({ kind: 'pub', feed: f, url: f.url });
  const out = [];
  for (const j of jobs) {
    try {
      const items = await fetchFeed(j.url);
      stats.feeds_ok++;
      for (const it of items) {
        const published = new Date(it.pubDate || now);
        if (isNaN(published) || now - published > MAX_AGE) continue;
        const snippet = it.snippet && !it.snippet.startsWith(it.title.slice(0, 30)) ? it.snippet : '';
        const text = `${it.title} ${snippet}`;
        let clusters = [];
        if (j.kind === 'gn') clusters = [j.cluster];
        else clusters = config.clusters.filter((c) => anyKw(text, c.aliases));
        for (const c of clusters) {
          stats.raw_items++;
          const inds = matchIndustries(c, text);
          if (!inds.length) continue; // not about the cluster's industries
          out.push({
            id: sha(it.link).slice(0, 12),
            title: it.title,
            link: it.link,
            source: it.sourceName || j.feed?.name || 'Unknown',
            source_home: it.sourceUrl || '',
            published: published.toISOString(),
            snippet,
            lang: j.q?.lang || j.feed?.lang || 'en',
            via: j.kind === 'gn' ? 'Google News RSS' : 'Publisher RSS',
            cluster: c.id,
            industries: inds.map((i) => i.id),
          });
        }
      }
      await new Promise((r) => setTimeout(r, 400)); // be polite to Google News
    } catch (e) {
      stats.feeds_failed.push(`${j.url} :: ${e.message}`);
    }
  }
  return out;
}

async function buildCard(raw, budget) {
  const cluster = clusterById[raw.cluster];
  const key = sha(raw.link);
  if (cache[key]) { stats.cache_hits++; return { ...cache[key].card, mode: 'ai', model: cache[key].model }; }
  if (mode !== 'none' && budget.left > 0) {
    budget.left--;
    try {
      stats.llm_calls++;
      const { json, model } = await completeJson(CARD_SYSTEM, cardPrompt(raw, cluster));
      const card = sanitizeCard(json, raw, cluster);
      cache[key] = { card, model, at: new Date().toISOString(), url: raw.link };
      if (stats.llm_calls % 10 === 0) { writeJson(P('data-cache/llm-cache.json'), cache); log(`LLM progress: ${stats.llm_calls} calls`); } // checkpoint
      return { ...card, mode: 'ai', model };
    } catch (e) {
      stats.llm_failures++;
      log('LLM failed, heuristic fallback:', e.message.slice(0, 160));
    }
  }
  const inds = cluster.industries.filter((i) => raw.industries.includes(i.id));
  return heuristicCard(raw, cluster, inds);
}

function sanitizeCard(j, raw, cluster) {
  const ids = cluster.industries.map((i) => i.id);
  const et = EVENT_TYPES.includes(j.event_type) ? j.event_type : 'not credit-relevant';
  const sig = ['positive', 'watch', 'negative'].includes(j.credit_signal) ? j.credit_signal : 'watch';
  const inds = (Array.isArray(j.industries) ? j.industries : []).filter((x) => ids.includes(x));
  return {
    headline: String(j.headline || raw.title).split(/\s+/).slice(0, 14).join(' '),
    summary: String(j.summary || ''),
    cluster: cluster.id,
    industries: inds.length ? inds : raw.industries,
    event_type: et,
    credit_signal: sig,
    why_it_matters: String(j.why_it_matters || ''),
    credit_note: j.credit_note || {},
  };
}

function heuristicBrief(cluster, cards) {
  const cnt = (s) => cards.filter((c) => c.credit_signal === s).length;
  const byType = {};
  for (const c of cards) byType[c.event_type] = (byType[c.event_type] || 0) + 1;
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const pick = (s) => cards.filter((c) => c.credit_signal === s).slice(0, 4).map((c) => `${c.headline} (${c.source}, ${c.published.slice(0, 10)}) [${c.id}]`);
  return {
    headline: cards.length
      ? `${cards.length} credit-relevant reports: ${cnt('negative')} negative, ${cnt('watch')} watch, ${cnt('positive')} positive`
      : 'No credit-relevant reports picked up in the last 7 days',
    what_changed: types.slice(0, 4).map(([t, n]) => `${n} report(s) tagged “${t}”`),
    stress_signals: pick('negative'),
    improvement_signals: pick('positive'),
    what_to_watch: [...new Set(cards.map((c) => c.credit_note?.confirm_or_disprove?.confirm).filter(Boolean))].slice(0, 3),
    mode: 'heuristic',
  };
}

async function buildBrief(cluster, cards) {
  if (mode !== 'none' && cards.length) {
    const key = 'brief:' + sha(cluster.id + cards.map((c) => c.id).sort().join(','));
    if (cache[key]) return { ...cache[key].brief, mode: 'ai', model: cache[key].model };
    try {
      stats.llm_calls++;
      const { json, model } = await completeJson(BRIEF_SYSTEM, briefPrompt(cluster, cards.slice(0, 30)));
      const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
      const brief = { headline: String(json.headline || ''), what_changed: arr(json.what_changed), stress_signals: arr(json.stress_signals), improvement_signals: arr(json.improvement_signals), what_to_watch: arr(json.what_to_watch) };
      cache[key] = { brief, model, at: new Date().toISOString() };
      return { ...brief, mode: 'ai', model };
    } catch (e) { stats.llm_failures++; log('Brief LLM failed:', e.message.slice(0, 160)); }
  }
  return heuristicBrief(cluster, cards);
}

async function main() {
  log(`LLM mode: ${mode}`);
  const fresh = await collect();
  stats.after_filter = fresh.length;
  // Carry forward previously seen raw items (still inside the age window) so history persists between runs.
  const prevRaw = (prevFeed.items || []).map((c) => c.raw).filter((r) => r && now - new Date(r.published) <= MAX_AGE);
  const seen = new Set();
  const all = [...prevRaw, ...fresh].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const groups = dedupe(all, 0.55, (r) => classify(`${r.title} ${r.snippet || ''}`).event_type);
  stats.after_dedupe = groups.length;
  log(`raw ${stats.raw_items} -> industry-matched ${fresh.length} (+${prevRaw.length} carried) -> deduped ${groups.length}`);

  groups.sort((a, b) => new Date(b.published) - new Date(a.published)); // newest first get the LLM budget
  const budget = { left: MAX_LLM };
  const items = [];
  for (const raw of groups) {
    if (hidden.has(raw.id)) continue;
    const card = await buildCard(raw, budget);
    if (!card || card.event_type === 'not credit-relevant') continue;
    items.push({
      id: raw.id,
      ...card,
      source: raw.source,
      link: raw.link,
      published: raw.published,
      lang: raw.lang,
      via: raw.via,
      also_reported_by: raw.also.map((a) => a.source),
      raw,
    });
  }

  const briefs = {};
  for (const c of config.clusters) {
    const cards = items.filter((i) => i.cluster === c.id && now - new Date(i.published) <= BRIEF_WINDOW);
    briefs[c.id] = { cluster: c.id, window_days: BRIEF_WINDOW / 864e5, item_count: cards.length, generated_at: new Date().toISOString(), ...(await buildBrief(c, cards)) };
  }

  const per = Object.fromEntries(config.clusters.map((c) => [c.id, items.filter((i) => i.cluster === c.id).length]));
  const effective = items.some((i) => i.mode === 'ai') ? mode : 'none'; // 'none' if every LLM call failed
  stats.model_usage = usage; stats.rate_limits = rateLimits;
  const meta = { generated_at: new Date().toISOString(), llm_mode: effective, llm_configured: mode, counts: per, total: items.length, stats };
  writeJson(P('public/data/feed.json'), { generated_at: meta.generated_at, llm_mode: effective, items });
  writeJson(P('public/data/briefs.json'), briefs);
  writeJson(P('public/data/meta.json'), meta);
  writeJson(P('public/data/clusters.json'), { clusters: config.clusters.map(({ queries, aliases, ...c }) => ({ ...c, industries: c.industries.map(({ keywords, ...i }) => i) })) });
  writeJson(P('public/data/hidden_ids.json'), { hidden_ids: [...hidden] });
  writeJson(P('data-cache/llm-cache.json'), cache);
  log('done', JSON.stringify({ usage, rate_limits: rateLimits.count, counts: per, llm_calls: stats.llm_calls, llm_failures: stats.llm_failures, cache_hits: stats.cache_hits, feeds_ok: stats.feeds_ok, feeds_failed: stats.feeds_failed.length }));
  if (stats.feeds_failed.length) log('failed feeds:\n  ' + stats.feeds_failed.join('\n  '));
}

main().catch((e) => { console.error(e); process.exit(1); });
