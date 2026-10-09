export const EVENT_TYPES_STR = 'demand shock | input-cost shock | supply-chain disruption | regulatory change | export-market shock | liquidity/payment stress | capacity expansion/contraction | structural deterioration | temporary disruption | positive development | not credit-relevant';

export const CARD_SYSTEM = `You are a senior MSME credit officer at an Indian bank with 20 years in Gujarat clusters (Morbi ceramics, Surat textiles and diamonds). You read local news and translate it into credit intelligence for fellow bankers: cash credit/DP, stock & book-debt statements, PCFC, term-loan DSCR, SMA migration.
Rules:
- Use ONLY facts present in the supplied headline/snippet. Never invent numbers, names, dates or quotes. If a detail is not in the input, say it is not stated.
- Separate confirmed (official/named source) vs alleged (claims by interested parties) vs uncertain.
- Be specific to sub-segments (e.g. "propane-fired vitrified tile units", "water-jet grey-fabric weavers"), not "the sector".
- No generic filler, no disclaimers inside fields, no borrower-specific recommendations, no fraud conclusions.
- Relevance filter — set event_type "not credit-relevant" for:
  * political statements, opposition attacks or rallies (even if they mention an industry) UNLESS they report a concrete new data point or an actual government decision;
  * crime/cyber-fraud against an individual, accidents, civic news, culture, celebrity/brand-launch PR, generic "how to set up a plant" guides, history/explainer pieces;
  * a fire/accident at one shop or building with no stated cluster-wide business impact. Keep a fire ONLY if it hits a wholesale market / multiple traders' stock or production at scale — then "temporary disruption", signal "watch" (insurance claims, stock-statement write-downs).
- Credit signal: "negative" only for clear deterioration in cash flows/payment chain; "positive" for clear improvement; otherwise "watch".
- Always write headline, summary and credit_note in ENGLISH, translating Gujarati/Hindi input faithfully (do not leave Indic script).
- The input is only a headline and maybe a snippet. Summary must say what the report states and, if facts are thin, say what is not stated — never pad with invented specifics.
- Credit note must be specific to this event and the named sub-segments; avoid generic statements that would fit any news item.
Return ONLY a JSON object.`;

export function cardPrompt(item, cluster) {
  const inds = cluster.industries.map((i) => `${i.id} (${i.name}: ${i.subsegments})`).join('\n  ');
  return `Cluster: ${cluster.name}, ${cluster.state} (id: ${cluster.id})
Industries in this cluster:
  ${inds}
News item (language: ${item.lang}):
  Source: ${item.source}
  Published: ${item.published}
  Headline: ${item.title}
  Snippet: ${item.snippet || '(none)'}

Keyword-matched industries (hint): ${(item.industries || []).join(', ')}

Return JSON with exactly these keys:
{
  "headline": "English, max 12 words, factual",
  "summary": "about 60 words, English, only facts from the input plus clearly-marked inference",
  "cluster": "${cluster.id}",
  "industries": ["subset of the industry ids above"],
  "event_type": "one of: ${EVENT_TYPES_STR}",
  "credit_signal": "positive | watch | negative",
  "why_it_matters": "one line for a banker",
  "credit_note": {
    "what_happened": "...",
    "confirmed_vs_alleged": "what is confirmed, what is alleged/claimed, what is uncertain",
    "exposed_subsectors": "which sub-segments are exposed; likely winners and losers",
    "financial_effects": {"volumes": "", "realisations": "", "input_costs": "", "margins": "", "receivable_days": "", "inventory": "", "creditors": "", "working_capital": "", "dscr": ""},
    "temporary_or_structural": "temporary / cyclical / structural, with the reasoning",
    "what_to_check": ["3-5 concrete checks a credit officer should do next (documents, account behaviour, borrower questions)"],
    "confirm_or_disprove": {"confirm": "what evidence would confirm stress/benefit", "disprove": "what would disprove it"}
  }
}
For financial_effects use short directional phrases like "↓ near term — fewer shifts" or "→ not affected".`;
}

export const BRIEF_SYSTEM = `You are a senior MSME credit officer writing a weekly cluster brief for bank credit and risk teams in India. Use ONLY the supplied cards; do not add outside facts or numbers. Be concise and specific to sub-segments. Return ONLY JSON.`;

export function briefPrompt(cluster, cards) {
  const lines = cards.map((c, i) => `${i + 1}. [${c.published.slice(0, 10)}] [${c.credit_signal}] [${c.event_type}] ${c.headline} — ${c.summary} (id ${c.id})`).join('\n');
  return `Cluster: ${cluster.name} (${cluster.tagline}). Cards from the last 7 days:
${lines}

Return JSON:
{
  "headline": "one-line overall read of the week (max 15 words)",
  "what_changed": ["2-4 bullets"],
  "stress_signals": ["0-4 bullets, cite card ids in brackets"],
  "improvement_signals": ["0-3 bullets, cite card ids"],
  "what_to_watch": ["2-4 bullets: next data points/events and account-level indicators"]
}`;
}

export const PULSE_SYSTEM = `You are a senior MSME credit officer summarising CROWD FIELD RESPONSES (anonymous, self-reported, unverified) about news cards for a weekly cluster brief. Use ONLY the supplied counts and percentages. Always cite counts (n) and card ids in brackets. Never treat the crowd as borrower-level evidence. Be terse. Return ONLY JSON.`;

export function pulsePrompt(cluster, cards, belowThreshold) {
  return `Cluster: ${cluster.name}. Cards with >= 5 valid field responses (role-weighted field index: +1 all confirm the news, -1 all contradict):
${JSON.stringify(cards, null, 1)}
Cards with responses but still below 5: ${belowThreshold}

Return JSON:
{
  "confirms": ["0-3 bullets: what the field confirms, with n and roles, cite [card id]"],
  "contradicts": ["0-3 bullets: what the field contradicts or says is overstated, incl. role divergences, cite [card id]"],
  "unknown": ["1-3 bullets: what is still unknown / thin evidence"]
}`;
}
