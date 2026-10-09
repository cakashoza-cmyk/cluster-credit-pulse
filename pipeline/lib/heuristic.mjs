// No-key fallback: keyword rules to tag event type / credit signal and a rule-based credit checklist.
// Everything produced here is clearly labelled as rule-based (mode: "heuristic"); no facts are invented —
// "what happened" only restates the source headline.

const isIndic = (s) => /[\u0900-\u0DFF]/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function kwMatch(text, kw) {
  if (isIndic(kw)) return text.includes(kw);
  return new RegExp(`(^|[^\\p{L}])${esc(kw.toLowerCase())}(?=$|[^\\p{L}])`, 'u').test(text.toLowerCase());
}
export const anyKw = (text, kws) => kws.some((k) => kwMatch(text, k));

export const EVENT_TYPES = [
  'demand shock', 'input-cost shock', 'supply-chain disruption', 'regulatory change', 'export-market shock',
  'liquidity/payment stress', 'capacity expansion/contraction', 'structural deterioration', 'temporary disruption',
  'positive development', 'not credit-relevant',
];

// Ordered: first match wins.
const RULES = [
  ['liquidity/payment stress', ['payment', 'payments', 'dues', 'default', 'defaults', 'npa', 'insolvency', 'bankrupt', 'bankruptcy', 'cheque bounce', 'uthamnu', 'absconded', 'absconding', 'fled', 'credit crunch', 'liquidity', 'outstanding', 'stuck', 'fraud', 'cheated', 'ઉઠમણું', 'ઉઠમણા', 'ઉઘરાણી', 'પેમેન્ટ', 'છેતરપિંડી', 'ઠગાઈ', 'દેવાળું', 'भुगतान', 'धोखाधड़ी']],
  ['export-market shock', ['tariff', 'tariffs', 'export', 'exports', 'exporters', 'anti-dumping', 'countervailing', 'trump', 'us duty', 'gulf demand', 'ટેરિફ', 'નિકાસ', 'એક્સપોર્ટ', 'निर्यात', 'टैरिफ']],
  ['input-cost shock', ['gas price', 'gas prices', 'png', 'propane', 'lpg', 'lng', 'natural gas', 'coal price', 'coal', 'yarn price', 'yarn prices', 'raw material', 'input cost', 'fuel', 'power tariff', 'electricity', 'price hike', 'costlier', 'ગેસ', 'ગેસના ભાવ', 'કોલસા', 'ભાવ વધારો', 'ભાવવધારો', 'કાચા માલ', 'गैस', 'कच्चे माल']],
  ['supply-chain disruption', ['shortage', 'supply', 'shipping', 'freight', 'container', 'containers', 'logistics', 'port', 'hormuz', 'red sea', 'transporters', 'અછત', 'સપ્લાય', 'કન્ટેનર', 'किल्लत', 'कमी']],
  ['regulatory change', ['gst', 'gpcb', 'ngt', 'pollution', 'ban', 'banned', 'notification', 'policy', 'bis', 'qco', 'quality control order', 'dgft', 'rbi', 'regulation', 'compliance', 'sealed', 'closure notice', 'subsidy', 'scheme', 'જીએસટી', 'પ્રદૂષણ', 'પ્રતિબંધ', 'નીતિ', 'જીપીસીબી', 'प्रदूषण', 'जीएसटी']],
  ['structural deterioration', ['lab-grown', 'lab grown', 'lgd', 'synthetic', 'structural', 'decline', 'losing', 'shift to', 'લેબગ્રોન', 'લેબ ગ્રોન']],
  ['capacity expansion/contraction', ['shut', 'shutdown', 'shut down', 'closure', 'closed', 'units closed', 'plant', 'expansion', 'new unit', 'capacity', 'layoff', 'layoffs', 'job loss', 'jobs', 'unemployed', 'production cut', 'બંધ', 'ઉત્પાદન', 'બેરોજગાર', 'રોજગારી', 'ક્ષમતા', 'बंद', 'उत्पादन', 'बेरोजगार']],
  ['demand shock', ['demand', 'slowdown', 'orders', 'order', 'sales', 'slump', 'recession', 'mandi', 'downturn', 'મંદી', 'માંગ', 'ઓર્ડર', 'ઘરાકી', 'मंदी', 'मांग']],
  ['temporary disruption', ['flood', 'rain', 'rains', 'fire', 'strike', 'vacation', 'holiday', 'diwali', 'heatwave', 'migrant', 'migrants', 'exodus', 'labour', 'workers', 'વેકેશન', 'હડતાળ', 'આગ', 'વરસાદ', 'કારીગરો', 'હિજરત', 'हड़ताल', 'छुट्टी', 'मजदूर']],
  ['positive development', ['boost', 'record', 'growth', 'rises', 'surge', 'revival', 'recovery', 'investment', 'mou', 'expo', 'fair', 'export hub', 'zone', 'park', 'incentive', 'relief', 'cut in', 'તેજી', 'રાહત', 'ઉછાળો', 'રોકાણ', 'राहत', 'तेजी']],
];

const NEG = ['crisis', 'hit', 'hits', 'plunge', 'plunges', 'fall', 'falls', 'fell', 'drop', 'drops', 'slump', 'loss', 'losses', 'shut', 'shutdown', 'closure', 'closed', 'cut', 'cuts', 'decline', 'declines', 'weak', 'worsen', 'worsens', 'stress', 'struggle', 'struggles', 'struggling', 'default', 'fraud', 'shortage', 'jobless', 'layoff', 'layoffs', 'unemployed', 'distress', 'hike', 'costlier', 'tariff', 'tariffs', 'slowdown', 'mandi', 'halt', 'halted', 'protest', 'strike', 'stuck', 'blow', 'woes', 'pain', 'મંદી', 'બંધ', 'ઘટાડો', 'સંકટ', 'નુકસાન', 'ઉઠમણું', 'બેરોજગાર', 'મુશ્કેલી', 'ફટકો', 'ઘટ્યો', 'ઘટી', 'मंदी', 'संकट', 'नुकसान', 'बंद', 'गिरावट'];
const POS = ['boost', 'record', 'growth', 'rise in exports', 'surge', 'revival', 'recovery', 'relief', 'investment', 'expansion', 'new unit', 'demand rises', 'orders pick up', 'gains', 'incentive', 'subsidy', 'approved', 'તેજી', 'રાહત', 'ઉછાળો', 'રોકાણ', 'વધારો થયો', 'राहत', 'तेजी', 'बढ़ोतरी'];

// Items that are clearly not about the business environment.
const EXCLUDE = ['murder', 'murdered', 'suicide', 'rape', 'accident', 'killed', 'dies', 'died', 'death', 'cricket', 'ipl', 'election', 'bjp', 'congress', 'aap', 'horoscope', 'bollywood', 'film', 'wedding', 'navratri', 'garba', 'bridge collapse', 'હત્યા', 'આત્મહત્યા', 'અકસ્માત', 'મોત', 'ચૂંટણી', 'ગરબા', 'हत्या', 'आत्महत्या', 'हादसा', 'मौत'];
const CREDIT_ANCHORS = ['gst', 'fraud', 'bank', 'loan', 'payment', 'dues', 'export', 'tariff', 'units', 'industry', 'ઉદ્યોગ', 'જીએસટી', 'उद्योग'];

export function classify(text) {
  const t = text;
  if (anyKw(t, EXCLUDE) && !anyKw(t, CREDIT_ANCHORS)) return { event_type: 'not credit-relevant', credit_signal: 'watch' };
  let event_type = 'not credit-relevant';
  for (const [type, kws] of RULES) if (anyKw(t, kws)) { event_type = type; break; }
  const neg = NEG.filter((k) => kwMatch(t, k)).length;
  const pos = POS.filter((k) => kwMatch(t, k)).length;
  let credit_signal = 'watch';
  if (event_type === 'positive development') credit_signal = neg > pos ? 'watch' : 'positive';
  else if (neg > pos) credit_signal = 'negative';
  else if (pos > neg) credit_signal = 'positive';
  if (event_type === 'capacity expansion/contraction' && anyKw(t, ['expansion', 'capacity hike', 'debottlenecking', 'new unit', 'new plant', 'capacity addition', 'commissioned']) && !anyKw(t, ['shut', 'shutdown', 'closure', 'closed', 'બંધ', 'बंद'])) credit_signal = 'positive';
  if (credit_signal === 'positive' && ['liquidity/payment stress', 'structural deterioration'].includes(event_type)) credit_signal = 'watch';
  return { event_type, credit_signal };
}

const NOTE = {
  'demand shock': {
    why: 'Weaker offtake shows up first as slower CC turnover and rising inventory in stock statements.',
    effects: { volumes: '↓ likely', realisations: '↓ / discounting risk', input_costs: '→', margins: '↓ (fixed-cost under-absorption)', receivable_days: '↑ as dealers stretch', inventory: '↑ finished goods', creditors: '↑ stretch to suppliers', working_capital: 'gap ↑', dscr: '↓ for leveraged units' },
    nature: 'Usually cyclical; structural only if a market or product is permanently lost.',
    checks: ['Month-on-month GST sales vs last year', 'Finished-goods inventory days in the latest stock statement', 'CC credit summations vs declared sales'],
    confirm: 'Two consecutive stock statements with rising FG inventory and falling credit summations.',
    disprove: 'Order books/GST returns stable; association reports pickup within 4–6 weeks.',
  },
  'input-cost shock': {
    why: 'Input-cost jumps compress margins within one or two stock-statement cycles unless passed through.',
    effects: { volumes: '↓ if units cut shifts', realisations: '↑ attempted pass-through', input_costs: '↑', margins: '↓', receivable_days: '→ / ↑', inventory: '↑ value per unit', creditors: 'tighter terms from fuel/raw-material suppliers', working_capital: 'need ↑', dscr: '↓' },
    nature: 'Temporary if market-driven and reversing; persistent if an administered tariff or contract reset.',
    checks: ['Share of the affected input in cost of production', 'Contracted vs spot purchase and old-rate inventory', 'Ability to pass through to buyers (brand, buyer concentration)'],
    confirm: 'Price hike sticks for a full quarter and borrower margins in monthly MIS fall.',
    disprove: 'Price rollback / supply normalises within weeks; buyers accept higher prices.',
  },
  'supply-chain disruption': {
    why: 'Supply or logistics breaks stretch the cash cycle and can halt production outright.',
    effects: { volumes: '↓ during disruption', realisations: '→', input_costs: '↑ freight/expediting', margins: '↓', receivable_days: '↑ (transit time for exports)', inventory: '↑ goods in transit', creditors: '→', working_capital: 'need ↑', dscr: '↓ temporarily' },
    nature: 'Usually temporary; check whether the route or supplier dependence is recurring.',
    checks: ['Dependence on the affected route/input', 'Export receivables in transit and PCFC due dates', 'Days of raw-material cover in hand'],
    confirm: 'Disruption persists beyond 4–6 weeks; overdue PCFC or LC devolvement.',
    disprove: 'Route/supply restored; freight rates normalise.',
  },
  'regulatory change': {
    why: 'Rule changes can force compliance capex, closures or alter tax/working-capital flows.',
    effects: { volumes: '↓ if closure orders; → otherwise', realisations: '→', input_costs: '↑ compliance cost', margins: '↓ / ↑ depending on rule', receivable_days: '→ (↑ if GST credit flow disrupted)', inventory: '→', creditors: '→', working_capital: '↑ if input-tax credit blocked', dscr: '↓ if unplanned capex' },
    nature: 'Often structural (permanent rule) — confirm the primary notification and effective date.',
    checks: ['Is there a primary order/notification and are named units covered?', 'Borrower compliance status (consents, GPCB, BIS/QCO)', 'Capex needed and funding source'],
    confirm: 'Primary notification issued; borrower named or non-compliant.',
    disprove: 'Rule withdrawn/stayed; borrower already compliant.',
  },
  'export-market shock': {
    why: 'Export orders and receivables are the first casualties; PCFC/PSCFC limits can go overdue.',
    effects: { volumes: '↓ export volumes', realisations: '↓ (absorbing duty/discount)', input_costs: '→', margins: '↓', receivable_days: '↑ export realisation delays', inventory: '↑ unsold export stock', creditors: '→', working_capital: 'need ↑, PCFC rollover risk', dscr: '↓ for export-heavy units' },
    nature: 'Cyclical-to-structural: depends on whether the tariff/market loss persists beyond 2–3 quarters.',
    checks: ['Export share by destination market', 'PCFC/EPC liquidation track and overdue bills', 'Order cancellations vs deferrals; ability to divert to domestic market'],
    confirm: 'Orders cancelled (not deferred); export bills overdue >30 days.',
    disprove: 'Duty rolled back or trade deal; buyers absorb cost; diversion to other markets.',
  },
  'liquidity/payment stress': {
    why: 'Payment chain stress in a cluster travels quickly from defaulting buyers to their suppliers\' book debts.',
    effects: { volumes: '↓ as sellers turn cautious', realisations: '→', input_costs: '→', margins: '↓ (bad debts)', receivable_days: '↑ sharply', inventory: '→ / ↑', creditors: '↑ stretch', working_capital: 'gap ↑; DP erosion as debtors age >90 days', dscr: '↓' },
    nature: 'Can be one-off (single default) or cluster-wide; allegations need FIR/court confirmation.',
    checks: ['Debtor ageing and concentration on the named/affected buyers', 'Cheque returns and inward returns in the account', 'Any related GST/fraud mention — treat as allegation until confirmed'],
    confirm: 'Rising cheque returns; debtors >90 days up; more defaults reported in the same market.',
    disprove: 'Isolated incident; dues settled; no exposure to the affected buyers.',
  },
  'capacity expansion/contraction': {
    why: 'Unit closures or expansions change cluster capacity, pricing power and borrowers\' utilisation.',
    effects: { volumes: '↓ (closures) / ↑ (expansion)', realisations: 'depends on supply balance', input_costs: '→', margins: '↓ under-utilisation / ↑ scale', receivable_days: '→', inventory: '→', creditors: '→', working_capital: '→ / ↑ for expansion', dscr: '↓ during ramp-up or shutdown' },
    nature: 'Shutdowns may be temporary (maintenance, fuel) or permanent; expansions are structural.',
    checks: ['Borrower\'s own utilisation and shift pattern', 'Recent capex and DCCO/ramp-up status', 'Whether closures are concentrated in the borrower\'s sub-segment'],
    confirm: 'Closures extend beyond announced period; association data shows falling unit count.',
    disprove: 'Units restart on schedule; demand absorbs new capacity.',
  },
  'structural deterioration': {
    why: 'A technology or market shift can permanently impair business models and collateral values.',
    effects: { volumes: '↓ trend', realisations: '↓ trend', input_costs: '→', margins: '↓ persistent', receivable_days: '↑', inventory: 'valuation risk on old stock', creditors: '→', working_capital: 'stock-statement values overstated', dscr: '↓ persistent' },
    nature: 'Structural — multi-year; review sector exposure limits, not just individual accounts.',
    checks: ['Borrower\'s product mix exposure to the declining segment', 'Inventory valuation vs current market prices', 'Plan to pivot and its funding'],
    confirm: 'Multi-quarter price/volume divergence continues.',
    disprove: 'Prices stabilise; borrower has already pivoted.',
  },
  'temporary disruption': {
    why: 'Short disruptions (labour, weather, holidays) dent one month\'s turnover but rarely solvency.',
    effects: { volumes: '↓ short-term', realisations: '→', input_costs: '→', margins: '↓ slightly', receivable_days: '→', inventory: '→', creditors: '→', working_capital: 'brief ↑ in utilisation', dscr: '→' },
    nature: 'Temporary/seasonal — check if longer than the usual seasonal pattern.',
    checks: ['Compare with the same period last year', 'Labour availability and restart date', 'Any request for ad-hoc limits'],
    confirm: 'Disruption extends well beyond seasonal norm.',
    disprove: 'Restart on schedule; turnover recovers next month.',
  },
  'positive development': {
    why: 'Improving demand, policy support or investment can ease working-capital pressure and support renewals.',
    effects: { volumes: '↑ possible', realisations: '↑ / →', input_costs: '→', margins: '↑ possible', receivable_days: '→ / ↓', inventory: '→', creditors: '→', working_capital: 'eases', dscr: '↑' },
    nature: 'Check if it is announced vs implemented; benefits often lag announcements.',
    checks: ['Is the benefit implemented or only announced?', 'Which sub-segments actually benefit', 'Borrower eligibility for any scheme/subsidy'],
    confirm: 'Visible in GST sales/credit summations within 1–2 quarters.',
    disprove: 'Announcement not implemented; benefits accrue only to large players.',
  },
};

export function heuristicCard(item, cluster, industries) {
  const { event_type, credit_signal } = classify(`${item.title} ${item.snippet || ''}`);
  if (event_type === 'not credit-relevant') return { event_type };
  const n = NOTE[event_type];
  const indNames = industries.map((i) => i.name).join(', ');
  const summary = `${item.source} reports: “${item.title}”. Rule-based tagging places this under ${event_type} for ${indNames} in ${cluster.name}. No AI summary in no-key mode — open the original report for facts.`;
  return {
    headline: item.title,
    summary,
    cluster: cluster.id,
    industries: industries.map((i) => i.id),
    event_type,
    credit_signal,
    why_it_matters: n.why,
    credit_note: {
      what_happened: `Headline as reported by ${item.source}: “${item.title}”. Details not extracted (no-key mode reads only the headline/snippet).`,
      confirmed_vs_alleged: 'Not assessed automatically. Treat as reported by a single source until corroborated or confirmed by an official notice/association statement.',
      exposed_subsectors: industries.map((i) => `${i.name}: ${i.subsegments}`).join(' | '),
      financial_effects: n.effects,
      temporary_or_structural: n.nature,
      what_to_check: [...n.checks, ...industries.flatMap((i) => i.credit_checks.slice(0, 2))],
      confirm_or_disprove: { confirm: n.confirm, disprove: n.disprove },
    },
    mode: 'heuristic',
  };
}
