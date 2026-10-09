// Field Pulse: poll generation prompt + strict sanitiser.
export const POLL_PROMPT_VERSION = 'poll-v1';

export const ROLES = {
  banker: 'Banker / lender (bank, NBFC, co-op)',
  operator: 'Manufacturer / promoter / operator',
  supplier: 'Input supplier / trader',
  buyer: 'Buyer / dealer / distributor / exporter',
  logistics: 'Logistics / transporter / CHA',
  labour: 'Labour contractor',
  consultant: 'CA / consultant / association member',
  other: 'Other',
};
export const MECHANISMS = ['volume', 'realisation', 'input_cost', 'margin', 'receivables', 'inventory', 'creditors', 'wc_utilisation', 'repayment'];
export const ACCURACY_OPTIONS = ['Accurate', 'Overstated', 'Understated', 'Not seeing it'];
const YNS = ['Yes', 'No', 'Not seen'];
const GU_FIXED = { accuracy: ['સાચું છે', 'વધારે પડતું કહ્યું છે', 'ઓછું આંક્યું છે', 'મને દેખાતું નથી'], yes_no_notseen: ['હા', 'ના', 'જોયું નથી'] };

export const POLL_SYSTEM = `You are a senior Indian MSME credit officer designing a 10-second, one-tap field-validation poll for a news card. Readers are bankers and value-chain participants in the named industrial cluster (Gujarat). The poll must cross-check whether the news is real and material on the ground and how it is transmitting into working capital and credit behaviour.
Rules:
- Ask about OBSERVABLE behaviour the respondent has seen first-hand in the last 2-4 weeks, never opinions about the news.
- Pick 3-5 value-chain roles that can see THIS event first-hand. Allowed role ids: banker, operator, supplier, buyer, logistics, labour, consultant. Include banker for any credit-relevant event. Give each role a specific label for this event (e.g. "Coal / propane trader", "Tile dealer / exporter") and a proximity 1-3 (3 = sees the event directly, e.g. a coal trader on a coal price move; 1 = indirect).
- 2-3 questions per role (the accuracy question + 1-2 behavioural questions; prefer 3 for the closest roles). Question types: "yes_no_notseen" (options exactly Yes, No, Not seen), "scale5" (5 ordered options, e.g. "Much lower".."Much higher"), "choice" (3-5 options).
- Each role MUST include exactly one accuracy question, type "accuracy": "Is the reported <specific event> accurate in your experience?" — options are fixed by the system.
- Each question is tied to one mechanism: ${MECHANISMS.join(', ')}.
- For each question give "supports": the option(s) that confirm the hypothesis, and "contradicts": the option(s) that refute it (exact option strings; neutral options in neither).
- Banker questions: ad-hoc / enhancement requests, CC/OD utilisation near limit, stock-statement delays, cheque/ECS returns, SMA-0/1 slippage, restructuring requests, LC/PCFC usage.
- Operator questions: whether the price move is real, order book vs last month, capacity utilisation / shutdown days, inventory build-up or aggressive stocking, buyer payment delays, supplier credit tightening, pass-through to customers.
- Supplier/trader questions: offtake vs last month, credit days demanded vs advance, whether the move is supply- or demand-driven.
- Buyer/dealer questions: price acceptance, offtake. Logistics: freight rates / vehicle or container availability. Labour: availability, wages, migration.
- Neutral, non-leading wording; plain English, <= 20 words per question. NEVER ask for names, firms, account numbers, amounts of a specific borrower, or any confidential or personal data.
- If the item is vague, not about the cluster's businesses, or has no observable ground effect, return {"no_poll": true, "reason": "..."}.
- Also give a faithful Gujarati translation of role labels, questions and options.
Return ONLY JSON.`;

export function pollPrompt(card, cluster) {
  const n = card.credit_note || {};
  return `Cluster: ${cluster.name}, ${cluster.state}. Industries: ${cluster.industries.map((i) => `${i.id} (${i.subsegments})`).join('; ')}
Card id: ${card.id}
Headline: ${card.headline}
Summary: ${card.summary}
Event type: ${card.event_type} · Credit signal: ${card.credit_signal} · Industries: ${card.industries.join(', ')}
Why it matters: ${card.why_it_matters}
Exposed sub-sectors: ${n.exposed_subsectors || ''}
Would confirm: ${n.confirm_or_disprove?.confirm || ''} · Would disprove: ${n.confirm_or_disprove?.disprove || ''}

Return JSON:
{
  "no_poll": false,
  "hypothesis": "one line: what the news implies should be observable on the ground",
  "event_phrase": "short noun phrase for the accuracy question, e.g. 'rise in propane prices'",
  "roles": [
    {"role": "supplier", "label": "Coal / propane trader", "proximity": 3,
     "questions": [
       {"id": "q1", "type": "accuracy", "text": "Is the reported rise in propane prices accurate in your experience?", "mechanism": "input_cost"},
       {"id": "q2", "type": "scale5", "text": "...", "options": ["Much lower","Lower","Same","Higher","Much higher"], "mechanism": "volume", "supports": ["..."], "contradicts": ["..."], "supports_if": "...", "contradicts_if": "..."}
     ]}
  ],
  "translation": {"lang": "gu", "roles": {"supplier": {"label": "...", "questions": [{"id": "q1", "text": "...", "options": ["..."]}]}}}
}
Accuracy-question options are fixed: ${ACCURACY_OPTIONS.join(' / ')} (translate them too).`;
}

const BAD = /\b(name of|names of|account (no|number)|a\/c|pan\b|aadhaar|mobile number|phone number|which (bank|borrower|firm|company)|your (bank|firm)'?s name)/i;
const str = (x, n = 240) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function sanitizePoll(j, card) {
  if (!j || j.no_poll) return { no_poll: true, reason: str(j?.reason || 'model returned no_poll') };
  const seenRoles = new Set();
  const roles = [];
  for (const r of Array.isArray(j.roles) ? j.roles : []) {
    if (!ROLES[r.role] || r.role === 'other' || seenRoles.has(r.role)) continue;
    const qs = [];
    let hasAcc = false;
    for (const q of Array.isArray(r.questions) ? r.questions : []) {
      const text = str(q.text, 200);
      if (!text || BAD.test(text)) continue;
      let type = q.type, options;
      if (type === 'accuracy') { if (hasAcc) continue; hasAcc = true; options = ACCURACY_OPTIONS; }
      else if (type === 'yes_no_notseen') options = YNS;
      else if (type === 'scale5') { options = (q.options || []).map((o) => str(o, 40)).filter(Boolean); if (options.length !== 5) continue; }
      else if (type === 'choice') { options = [...new Set((q.options || []).map((o) => str(o, 60)).filter(Boolean))]; if (options.length < 3 || options.length > 5) continue; }
      else continue;
      let supports = (q.supports || []).map((o) => str(o, 60)).filter((o) => options.includes(o));
      let contradicts = (q.contradicts || []).map((o) => str(o, 60)).filter((o) => options.includes(o) && !supports.includes(o));
      if (type === 'accuracy') { supports = ['Accurate', 'Understated']; contradicts = ['Overstated', 'Not seeing it']; }
      if (!supports.length && !contradicts.length) continue;
      qs.push({ id: '', type, text, options, mechanism: MECHANISMS.includes(q.mechanism) ? q.mechanism : 'volume', supports, contradicts, supports_if: str(q.supports_if, 160), contradicts_if: str(q.contradicts_if, 160), _src: q.id });
    }
    if (!hasAcc) {
      const ph = str(j.event_phrase || card.headline, 90);
      qs.unshift({ id: '', type: 'accuracy', text: `Is the reported ${ph} accurate in your experience?`, options: ACCURACY_OPTIONS, mechanism: 'volume', supports: ['Accurate', 'Understated'], contradicts: ['Overstated', 'Not seeing it'], supports_if: 'Accurate or Understated', contradicts_if: 'Overstated or Not seeing it', _src: '_acc' });
    }
    // accuracy first, max 3
    qs.sort((a, b) => (a.type === 'accuracy' ? -1 : 0) - (b.type === 'accuracy' ? -1 : 0));
    const keep = qs.slice(0, 3);
    seenRoles.add(r.role);
    const rid = r.role[0];
    keep.forEach((q, i) => { q.id = `${r.role}.q${i + 1}`; });
    roles.push({ role: r.role, label: str(r.label || ROLES[r.role], 60), proximity: Math.min(3, Math.max(1, Number(r.proximity) || 2)), questions: keep });
    if (roles.length === 5) break;
  }
  if (roles.length < 2) return { no_poll: true, reason: 'too few valid roles after validation' };
  // translation (Gujarati) — keep only if it lines up with sanitised questions
  let translation = null;
  const t = j.translation;
  if (t && t.roles && typeof t.roles === 'object') {
    const out = {};
    for (const r of roles) {
      const tr = t.roles[r.role];
      if (!tr || !Array.isArray(tr.questions)) continue;
      const byId = Object.fromEntries(tr.questions.map((q) => [q.id, q]));
      const qs = {};
      for (const q of r.questions) {
        const tq = byId[q._src];
        if (!tq || !tq.text) continue;
        let opts = Array.isArray(tq.options) && tq.options.length === q.options.length ? tq.options.map((o) => str(o, 60)) : null;
        if ((t.lang || 'gu') === 'gu' && GU_FIXED[q.type]) opts = GU_FIXED[q.type];
        qs[q.id] = { text: str(tq.text, 240), options: opts };
      }
      out[r.role] = { label: str(tr.label, 80), questions: qs };
    }
    if (Object.keys(out).length) translation = { lang: str(t.lang || 'gu', 4), roles: out };
  }
  for (const r of roles) for (const q of r.questions) delete q._src;
  return { no_poll: false, hypothesis: str(j.hypothesis, 240), event_phrase: str(j.event_phrase, 90), roles, translation };
}

/** Enforce the standard accuracy wording ("Is the reported X accurate in your experience?"). Idempotent. */
export function finalizePoll(p) {
  if (!p || p.no_poll) return p;
  const ph = (p.event_phrase || '').replace(/[?.]+$/, '');
  for (const r of p.roles) for (const q of r.questions) {
    if (q.type !== 'accuracy' || /^Is the reported .+ accurate in your experience\?$/i.test(q.text) || !ph) continue;
    q.text = `Is the reported ${ph.replace(/^(the|a|an) /i, '')} accurate in your experience?`;
  }
  return p;
}
