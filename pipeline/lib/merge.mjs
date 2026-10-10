// Card-level same-event merging (runs AFTER cards exist, so it works across languages on the
// AI-translated English headline + summary). Free and embedding-free:
//   1) TF-IDF cosine on cleaned English headline (x2) + summary, within cluster, ±3 days
//   2) key-entity overlap: numbers (45%, Rs 24 crore, 10,000) and distinctive proper nouns
//   3) optional LLM pass: ONE batched call per cluster with "id | date | headline" lines, returns groups
// Groups are union-find components. Primary = previous primary (stability) > most informative > earliest.

const DAY = 864e5;
const STOP = new Set(`a an the of to in on for and or with at by from as is are was were be been being after over amid into its it this that these those their they he she his her
has have had not no nor but if than then so such also only just more most less very can could will would may might should must do does did done says said say report reports reported
according per via while during before ahead about against among between within without under up down out off new latest today news update updates further details detail specific
snippet input source text headline brief provided provide provides stated state states mention mentions mentioned regarding exact exactly figures figure data information indicates
indicate indicating however additionally reportedly unspecified other any some each which who whom what when where why how there here been being one two three`.split(/\s+/));
// words that appear on almost every card of a cluster carry no event identity
const DOMAIN = new Set(`surat morbi gujarat india indian textile textiles industry industries sector sectors market markets city cluster unit units local hub business businesses
ceramic ceramics tile tiles diamond diamonds weaver weavers weaving yarn fabric trade trader traders`.split(/\s+/));
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const BOILER = /(snippet|input|provides? no|contains? no|gives? no|not (?:stated|provided|specified|mentioned|disclosed)|no (?:further|additional|other|specific)|does not|do not|did not|is not stated|are not stated|remain(?:s)? unclear|unverified|truncated)/i;

/** Cleaned English text of a card: headline + non-boilerplate summary sentences, without source/date phrases. */
export function cleanSummary(card) {
  const s = String(card.summary || '')
    .replace(new RegExp(`\\b(?:on\\s+)?(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s*\\d{4}|\\d{4}-\\d{2}-\\d{2})`, 'gi'), ' ')
    .replace(/\baccording to [^,.]{0,60}[,.]/gi, ' ')
    .replace(/\b(?:the )?[A-Z][\w.&-]*(?: [A-Z][\w.&-]*){0,3} (?:reports?|reported|states?|stated)(?: that)?\b/g, ' ');
  return s.split(/(?<=[.!?])\s+/).filter((x) => x && !BOILER.test(x)).join(' ');
}

// light plural stemming + event-verb synonyms so "two days off" ~ "two-day holiday", "blaze" ~ "fire", "hike" ~ "surge"
const SYN = {};
for (const [canon, words] of Object.entries({
  fire: 'fire fires blaze blazes torch torches torched burn burns burning burned burnt arson gutted guts gut ablaze',
  rise: 'hike hikes hiked surge surges surged jump jumps jumped rise rises rising rose raise raises raised increase increases increased soar soars soaring spike costlier',
  fall: 'fall falls fell drop drops dropped plunge plunges plunged decline declines declined slump crash dip cut cuts',
  shut: 'shut shuts shutdown shutdowns closure closures closed close halt halts halted holiday holidays off vacation',
  protest: 'protest protests protesting agitation agitations agitate agitating strike strikes stir movement andolan demonstration',
  worker: 'worker workers labour labor labourers laborers artisans artisan karigar employees',
  price: 'price prices pricing rate rates cost costs',
  arrest: 'arrest arrests arrested nabbed held detained',
  layoff: 'layoff layoffs fired sacked jobless',
  week: 'week weekly weeks',
  day: 'day days daily',
  ipo: 'ipo drhp',
  conflict: 'war wars conflict conflicts tension tensions geopolitical',
})) for (const w of words.split(' ')) SYN[w] = canon;
const stem = (w) => SYN[w] || (w.length > 4 ? (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('ss') ? w : w.replace(/s$/, '')) : w);
export function tokens(text) {
  return String(text).toLowerCase().normalize('NFKC')
    .replace(/[\u2018\u2019'`]/g, '').replace(/₹/g, ' rs ')
    .replace(/[^a-z0-9%.\s-]/g, ' ').replace(/(\d),(\d)/g, '$1$2')
    .split(/[\s-]+/).map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && t.length > 1 && !STOP.has(t) && !DOMAIN.has(t) && !/^\d{4}$/.test(t) && !/^\d+$/.test(t))
    .map(stem);
}

const WORDNUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12, fifteen: 15, twenty: 20, fifty: 50, hundred: 100 };
/** Salient numbers: percentages, money, counts. Drops years and day-of-month noise. */
export function numbers(text) {
  const t = String(text).replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b(two|three|four|five|six|seven|eight|ten|twelve|fifteen|twenty|fifty|hundred)\b/gi, (m) => String(WORDNUM[m.toLowerCase()]));
  const out = new Set();
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)[\s-]*(%|percent|per cent|crore|cr|lakh|million|billion|mn|bn|k\b|days?|shops?|units?|hours?|meters?|metres?|workers?|weavers?|msm)?/gi)) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(v) || (v >= 1900 && v <= 2100 && !m[2])) continue;
    if (v <= 1) continue;
    let unit = (m[2] || '').toLowerCase();
    if (/^(?:percent|per cent)$/.test(unit)) unit = '%';
    if (unit === 'k') { out.add(String(v * 1000)); continue; }
    if (/^(?:cr)$/.test(unit)) unit = 'crore';
    unit = unit.replace(/s$/, '').replace('metre', 'meter');
    out.add(unit ? `${v}${unit}` : String(v));
  }
  return out;
}

const COMMON_PROPER = new Set('surat morbi gujarat india indian the a in at of and on for to with union minister prime chamber police government state centre central gst diwali rs crore lakh english hindi gujarati times express bhaskar samachar divya sandesh news'.split(' '));
const acronyms = (t) => [...String(t).matchAll(/\b([A-Z]{3,}[A-Za-z-]*)\b/g)].map((m) => m[1].toLowerCase()).filter((l) => !COMMON_PROPER.has(l));
export function properNouns(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:^|[^.!?]\s)([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]{2,})*)/g)) {
    for (const w of m[1].split(/\s+/)) { const l = w.toLowerCase(); if (!COMMON_PROPER.has(l) && !DOMAIN.has(l) && !STOP.has(l)) out.add(l); }
  }
  for (const m of String(text).matchAll(/\b([A-Z]{3,}[A-Za-z-]*)\b/g)) { const l = m[1].toLowerCase(); if (!COMMON_PROPER.has(l)) out.add(l); }
  return out;
}

function tfidfVectors(docs) {
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  return docs.map((d) => {
    const tf = new Map(); for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map(); let norm = 0;
    for (const [t, c] of tf) { const w = (1 + Math.log(c)) * Math.log(1 + N / (df.get(t) || 1)); v.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1; for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
}
const cosine = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) { const z = y.get(t); if (z) s += w * z; } return s; };
const inter = (a, b) => [...a].filter((x) => b.has(x));

export function features(cards) {
  const docs = cards.map((c) => { const h = tokens(c.headline); return [...h, ...h, ...tokens(cleanSummary(c))]; });
  const vecs = tfidfVectors(docs);
  return cards.map((c, i) => ({
    id: c.id, cluster: c.cluster, t: new Date(c.published).getTime(), vec: vecs[i],
    outlet: String(c.source || '').toLowerCase().replace(/\b(english|hindi|gujarati|online|news|\(.*?\))\b/g, '').replace(/[^a-z]/g, ''),
    nums: numbers(`${c.headline}. ${cleanSummary(c)}`),
    names: new Set([...properNouns(cleanSummary(c)), ...acronyms(c.headline)]),
    incidents: incidentOf(`${c.headline}. ${c.summary || ''} ${c.raw?.title || ''}`),
  }));
}

// Rare, specific incident types: two cards in the same cluster with the same incident anchor within 14 days are
// almost always one incident and its follow-ups (report -> police suspect -> arrest), so they are threaded together.
const INCIDENTS = { arson: /\barson|\btorch(?:ed|es|ing)?\b|set (?:on )?fire|setting fire|foul play|revenge|deliberately (?:set|started)/i };
const incidentOf = (text) => Object.keys(INCIDENTS).filter((k) => INCIDENTS[k].test(text));

/** Pairwise heuristic score -> { same: bool, strong: bool, why } */
export function pairDecision(A, B, windowDays = 3) {
  if (A.cluster !== B.cluster) return { same: false };
  const shared = (A.incidents || []).filter((x) => (B.incidents || []).includes(x));
  if (shared.length && Math.abs(A.t - B.t) <= 14 * DAY) return { same: true, strong: true, why: `incident thread: ${shared}` };
  if (Math.abs(A.t - B.t) > windowDays * DAY) return { same: false };
  const cos = cosine(A.vec, B.vec);
  const nums = inter(A.nums, B.nums).filter((n) => !/^\d+$/.test(n) || Number(n) >= 13); // bare small ints are noise
  const names = inter(A.names, B.names);
  const ent = nums.length + names.length;
  const why = `cos=${cos.toFixed(2)} nums=[${nums}] names=[${names}]`;
  const near = Math.abs(A.t - B.t) <= 1.5 * DAY; // same-day/next-day reports are far more likely to be one event
  if (cos >= 0.55) return { same: true, strong: true, why };
  if (cos >= 0.32 && ent >= 1) return { same: true, strong: ent >= 2 || cos >= 0.45, why };
  if (cos >= 0.2 && nums.length >= 2) return { same: true, strong: true, why };
  if (near && cos >= 0.33) return { same: true, strong: false, why };
  // the same publisher's language editions (e.g. "Gujarat Samachar" / "GujaratSamachar English") on the same day
  if (near && A.outlet && A.outlet === B.outlet && cos >= 0.2) return { same: true, strong: false, why: why + ' same-outlet' };
  if (near && cos >= 0.24 && ent >= 1) return { same: true, strong: false, why };
  return { same: false, why };
}

export function unionFind(ids) {
  const p = Object.fromEntries(ids.map((i) => [i, i]));
  const find = (x) => (p[x] === x ? x : (p[x] = find(p[x])));
  return { find, union: (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p[rb] = ra; }, groups: () => { const g = {}; for (const i of ids) (g[find(i)] ||= []).push(i); return Object.values(g); } };
}

export const MERGE_PROMPT_VERSION = 'm2';
export const MERGE_SYSTEM = `You de-duplicate a news feed for bank credit officers. You receive one line per news card: "id | YYYY-MM-DD | headline". Headlines were machine-translated from English, Gujarati and Hindi sources, so the same story can be worded very differently.
Group ids that report the SAME specific real-world event: the same incident, announcement, decision, data point or protest action, reported by different outlets/languages or re-reported a day or two later. Also group a direct follow-up of that same specific incident (e.g. a fire at a market -> police suspect arson in that fire -> the arsonist is arrested; a strike call -> the same strike called off).
Do NOT group:
- different incidents of the same type (separate fires at different markets or on different dates, different companies' IPOs);
- separate reports on the same ongoing condition (high gas prices, weak demand, rising yarn prices, labour unrest) unless they report the same specific fact, figure, decision or action;
- reports more than ~10 days apart unless one is an explicit follow-up of the other.
When unsure, do not group.
Output JSON only: {"groups": [{"event": "<5-8 word label>", "ids": ["id1","id2"]}]} with only groups of 2 or more ids, each id at most once.`;
export const mergePrompt = (lines) => `Cards:\n${lines.join('\n')}\n\nReturn {"groups": [...]} now.`;

/** Builds merged card objects. llmGroupsByCluster: { clusterId: [[id,...]] | null } (null = LLM unavailable) */
export function mergeCards(cards, { llmGroupsByCluster = {}, prevPrimaries = new Set(), log = () => {} } = {}) {
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const uf = unionFind(cards.map((c) => c.id));
  const edges = [];
  for (const cl of new Set(cards.map((c) => c.cluster))) {
    const cs = cards.filter((c) => c.cluster === cl);
    const F = features(cs);
    const llm = llmGroupsByCluster[cl];
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
      const d = pairDecision(F[i], F[j]);
      // when the LLM pass succeeded, only high-confidence heuristic edges are added on top of it
      if (d.same) { uf.union(F[i].id, F[j].id); edges.push({ a: F[i].id, b: F[j].id, by: 'heuristic', why: d.why }); }
    }
    // LLM groups are only trusted pairwise where the pair is plausible on its own: reported within 4 days of each other,
    // or within 10 days with some textual/entity support. Members are then joined by connected components, so a
    // theme-level group (e.g. every yarn-price story over three weeks) falls apart into its real events.
    const fi = Object.fromEntries(F.map((f) => [f.id, f]));
    for (const g of llm || []) {
      const ok = g.filter((id) => fi[id]);
      if (ok.length < 2) continue;
      const kept = [];
      for (let a = 0; a < ok.length; a++) for (let b = a + 1; b < ok.length; b++) {
        const A = fi[ok[a]], B = fi[ok[b]];
        const dt = Math.abs(A.t - B.t) / DAY;
        const cos = cosine(A.vec, B.vec);
        const ent = inter(A.nums, B.nums).filter((n) => !/^\d+$/.test(n) || Number(n) >= 13).length + inter(A.names, B.names).length;
        if ((dt <= 4 && cos >= 0.12) || (dt <= 10 && ((cos >= 0.25 && ent >= 1) || cos >= 0.45))) { kept.push([A.id, B.id]); uf.union(A.id, B.id); edges.push({ a: A.id, b: B.id, by: 'llm', why: `dt=${dt.toFixed(1)} cos=${cos.toFixed(2)} ent=${ent}` }); }
      }
      if (kept.length < (ok.length * (ok.length - 1)) / 2) log(`merge: LLM group of ${ok.length} kept ${kept.length} plausible pair(s)`);
    }
  }
  const out = [];
  const aliases = {};
  for (const ids of uf.groups()) {
    const members = ids.map((id) => byId[id]);
    const primary = pickPrimary(members, prevPrimaries);
    const others = members.filter((m) => m !== primary).sort((a, b) => new Date(a.published) - new Date(b.published));
    if (!others.length) { out.push(primary); continue; }
    const coverage = [];
    const seenLink = new Set([primary.link]);
    const add = (o) => { if (!o.link || seenLink.has(o.link)) return; seenLink.add(o.link); coverage.push(o); };
    for (const a of primary.raw?.also || []) add({ source: a.source, link: a.link });
    for (const m of others) {
      add({ id: m.id, source: m.source, link: m.link, headline: m.headline, published: m.published, lang: m.lang });
      for (const a of m.raw?.also || []) add({ source: a.source, link: a.link });
    }
    for (const m of others) aliases[m.id] = primary.id;
    const sources = [...new Set(coverage.map((c) => c.source).filter((s) => s && s !== primary.source))];
    const latest = Math.max(...members.map((m) => new Date(m.published).getTime()));
    out.push({
      ...primary,
      industries: [...new Set(members.flatMap((m) => m.industries))],
      also_reported_by: sources,
      coverage,
      merged_ids: others.map((m) => m.id),
      merged_raws: others.flatMap((m) => [m.raw, ...(m.merged_raws || [])]).filter(Boolean),
      latest_at: new Date(latest).toISOString(),
    });
  }
  return { items: out, aliases, edges };
}

const infoScore = (c) => numbers(`${c.headline}. ${cleanSummary(c)}`).size * 2 + properNouns(cleanSummary(c)).size + cleanSummary(c).length / 150 + (c.mode === 'ai' ? 3 : 0) + (c.lang === 'en' ? 0.5 : 0);
function pickPrimary(members, prevPrimaries) {
  const prev = members.filter((m) => prevPrimaries.has(m.id));
  const pool = prev.length ? prev : members;
  return [...pool].sort((a, b) => infoScore(b) - infoScore(a) || new Date(a.published) - new Date(b.published))[0];
}
