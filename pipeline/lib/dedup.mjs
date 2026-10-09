// Title normalisation + same-event clustering (token Jaccard / containment).
const STOP = new Set('a an the of to in on for and or with at by from as is are was were be been after over amid into its it this that their they he she new says said will may can up down news latest today live update updates gujarat india indian'.split(' '));

export function normTokens(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && t.length > 1);
}

export function similarity(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jacc = inter / (A.size + B.size - inter);
  const contain = inter / Math.min(A.size, B.size);
  return Math.max(jacc, contain >= 0.8 && Math.min(A.size, B.size) >= 4 ? contain * 0.75 : 0);
}

/** Groups items describing the same event. Keeps the earliest-published item as primary, records other sources. */
// Capitalised (proper-noun) tokens in English titles, minus very common cluster words: used for same-event clustering
const COMMON = new Set('surat morbi gujarat india textile textiles market markets fire diamond diamonds ceramic ceramics industry workers weavers embroidery news latest video the a in at of and to for after over massive breaks out city crore lakh rs govt state'.split(' '));
const COMMON_INDIC = new Set('સુરત સુરતના સુરતની સુરતમાં મોરબી મોરબીના કાપડ માર્કેટ માર્કેટમાં ભીષણ ઉદ્યોગ ઉદ્યોગમાં હીરા વેપારી વેપારીઓ સિરામિક सूरत कपड़ा बाजार उद्योग हीरा'.split(' '));
export function properTokens(title) {
  const en = (String(title).match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) || []).map((t) => t.toLowerCase()).filter((t) => !COMMON.has(t));
  const indic = (String(title).match(/[\u0900-\u0DFF]{4,}/g) || []).filter((t) => !COMMON_INDIC.has(t));
  return [...en, ...indic];
}
// Incident-type anchors: same cluster + same industry + same anchor within 2 days => same event
const ANCHORS = [/\bfire\b|\bblaze\b|આગ|आग/i, /\bstrike\b|હડતાળ|हड़ताल/i];
const anchorOf = (t) => ANCHORS.findIndex((re) => re.test(t));

export function dedupe(items, threshold = 0.55, eventKey = () => '') {
  const sorted = [...items].sort((x, y) => new Date(x.published) - new Date(y.published));
  const groups = [];
  for (const it of sorted) {
    const toks = normTokens(it.title);
    let hit = null;
    for (const g of groups) {
      if (g.cluster !== it.cluster) continue;
      if (Math.abs(new Date(g.published) - new Date(it.published)) > 4 * 864e5) continue;
      if (g.tokens.some((t) => similarity(t, toks) >= threshold)) { hit = g; break; }
      const a = anchorOf(it.title);
      if (a >= 0 && a === g.anchor && g.industries.some((x) => it.industries.includes(x)) && Math.abs(new Date(g.published) - new Date(it.published)) <= 2 * 864e5) { hit = g; break; }
      // same event type + shared distinctive proper noun within 3 days (e.g. the same named market fire)
      const ek = eventKey(it);
      if (ek && ek === g.ek && Math.abs(new Date(g.published) - new Date(it.published)) <= 3 * 864e5) {
        const pt = properTokens(it.title);
        if (pt.some((t) => g.proper.has(t))) { hit = g; break; }
      }
    }
    if (hit) {
      hit.tokens.push(toks);
      for (const t of properTokens(it.title)) hit.proper.add(t);
      if (!hit.also.some((s) => s.source === it.source)) hit.also.push({ source: it.source, link: it.link });
      for (const ind of it.industries) if (!hit.industries.includes(ind)) hit.industries.push(ind);
    } else {
      groups.push({ ...it, tokens: [toks], also: [], ek: eventKey(it), anchor: anchorOf(it.title), proper: new Set(properTokens(it.title)) });
    }
  }
  return groups.map(({ tokens, ek, anchor, proper, ...g }) => g);
}
