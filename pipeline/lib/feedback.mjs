// Field Pulse: harvest crowd responses from the relay, decrypt, validate, aggregate.
// Relay = ntfy.sh topic (free, no account; keeps messages ~12h) -> harvested every 2h into
// data-cache/feedback/inbox.jsonl (still encrypted) which is the durable store in this repo.
// Alternative adapter: Google Apps Script web app (see feedback/apps-script/Code.gs).
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto as wc } from 'node:crypto';
import { ROLES } from './polls.mjs';

const NOT_SEEN = new Set(['Not seen', 'Not seeing it']);

export async function harvest(cfg, inboxFile, log) {
  const inbox = fs.existsSync(inboxFile) ? fs.readFileSync(inboxFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const have = new Set(inbox.map((m) => m.id));
  let fresh = [];
  try {
    if (cfg.adapter === 'ntfy' && cfg.ntfy?.topic) {
      const res = await fetch(`${cfg.ntfy.base || 'https://ntfy.sh'}/${cfg.ntfy.topic}/json?poll=1&since=all`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`ntfy ${res.status}`);
      fresh = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === 'message').map((e) => ({ id: e.id, time: e.time, message: e.message }));
    } else if (cfg.adapter === 'apps_script' && cfg.apps_script?.url) {
      const tok = process.env.FEEDBACK_EXPORT_TOKEN || '';
      const res = await fetch(`${cfg.apps_script.url}?action=export&token=${encodeURIComponent(tok)}`, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
      const j = await res.json();
      fresh = (j.rows || []).map((r) => ({ id: 'gs-' + r.id, time: r.time, message: r.payload }));
    }
  } catch (e) { log('feedback harvest failed:', e.message); return { inbox, added: 0, error: e.message }; }
  const add = fresh.filter((m) => m.id && !have.has(m.id));
  if (add.length) { fs.mkdirSync(path.dirname(inboxFile), { recursive: true }); fs.appendFileSync(inboxFile, add.map((m) => JSON.stringify(m)).join('\n') + '\n'); }
  return { inbox: [...inbox, ...add], added: add.length };
}

const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
let privKey = null;
async function decrypt(msg) {
  let env;
  try { env = JSON.parse(msg); } catch { return null; }
  if (!env || env.enc !== 'ecdh-p256-aesgcm') return env && env.v ? env : null; // plaintext (apps_script adapter)
  if (!privKey) {
    const raw = process.env.FEEDBACK_PRIVATE_KEY;
    if (!raw) throw new Error('FEEDBACK_PRIVATE_KEY not set');
    privKey = await wc.subtle.importKey('jwk', JSON.parse(Buffer.from(raw, 'base64').toString()), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  }
  try {
    const eph = await wc.subtle.importKey('raw', b64(env.k), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const key = await wc.subtle.deriveKey({ name: 'ECDH', public: eph }, privKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await wc.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct));
    return JSON.parse(Buffer.from(pt).toString('utf8'));
  } catch { return null; }
}

export const scrub = (s) => String(s || '').slice(0, 280)
  .replace(/https?:\/\/\S+/gi, '[link]').replace(/\S+@\S+\.\S+/g, '[email]')
  .replace(/(\+?\d[\d\s-]{5,}\d)/g, '[number]').replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[id]').trim();

/** Returns { pulse, summary } where pulse is the public per-card aggregate object. */
// aliases: { mergedCardId: primaryCardId } from same-event merging. A response given on a card that was later
// merged is validated against the poll it was answered on (aliasPolls) and then counted on the primary card.
export async function aggregate({ inbox, polls, feedItems, minN = 5, now = Date.now(), aliases = {}, aliasPolls = {} }) {
  const pollById = polls.polls || {};
  const answeredPoll = (id) => pollById[id] || aliasPolls[id];
  const qIndexOf = (poll) => Object.fromEntries(poll.roles.flatMap((ro) => ro.questions.map((q) => [q.id, q])));
  const cardById = Object.fromEntries(feedItems.map((i) => [i.id, i]));
  const stats = { messages: inbox.length, undecryptable: 0, invalid: 0, test_excluded: 0, duplicates_replaced: 0, dropped: { too_fast: 0, all_not_seen: 0, straight_line: 0, device_flood: 0 }, valid: 0 };
  const latest = new Map(); // did|card -> record
  const perDeviceDay = {};
  for (const m of inbox) {
    const r = await decrypt(m.message);
    if (!r) { stats.undecryptable++; continue; }
    if (r.test) { stats.test_excluded++; continue; }
    const poll = answeredPoll(r.card);
    if (!poll || poll.no_poll || !ROLES[r.role] || typeof r.answers !== 'object' || !r.did) { stats.invalid++; continue; }
    const qIndex = qIndexOf(poll);
    const answers = {};
    for (const [qid, v] of Object.entries(r.answers)) if (qIndex[qid] && qIndex[qid].options.includes(v)) answers[qid] = v;
    if (!Object.keys(answers).length) { stats.invalid++; continue; }
    const target = aliases[r.card] && pollById[aliases[r.card]] && !pollById[aliases[r.card]].no_poll ? aliases[r.card] : r.card;
    if (target !== r.card) stats.carried_from_merged = (stats.carried_from_merged || 0) + 1;
    if (!pollById[target]) { stats.invalid++; continue; }
    const rec = { card: target, answeredOn: r.card, qIndex, role: r.role, answers, text: scrub(r.text), did: String(r.did).slice(0, 40), ts: Number(r.ts) || m.time * 1000, dt: Number(r.dt) || 0, msgTime: m.time * 1000 };
    const day = `${rec.did}|${new Date(rec.msgTime).toISOString().slice(0, 10)}`;
    perDeviceDay[day] = (perDeviceDay[day] || 0) + 1;
    if (perDeviceDay[day] > 40) { stats.dropped.device_flood++; continue; }
    const k = `${rec.did}|${rec.card}`;
    if (latest.has(k)) stats.duplicates_replaced++;
    latest.set(k, rec);
  }
  // straight-lining (same option position on >=3 questions with different option sets) is only treated as
  // spam when the same device does it on >=3 cards — a single straight answer can be honest.
  const isStraight = (rec, qIndex) => {
    const vals = Object.entries(rec.answers); if (vals.length < 3) return false;
    const idx = vals.map(([q, v]) => qIndex[q].options.indexOf(v));
    return new Set(idx).size === 1 && new Set(vals.map(([q]) => qIndex[q].options.join('|'))).size >= 2;
  };
  const slCount = {};
  for (const rec of latest.values()) { if (isStraight(rec, rec.qIndex)) slCount[rec.did] = (slCount[rec.did] || 0) + 1; }
  const slDevices = new Set(Object.keys(slCount).filter((d) => slCount[d] >= 3));
  const byCard = {};
  for (const rec of latest.values()) {
    const qIndex = rec.qIndex;
    const vals = Object.entries(rec.answers);
    const n = vals.length;
    if (rec.dt && rec.dt < 600 * n + 600) { stats.dropped.too_fast++; continue; }
    if (n >= 2 && vals.every(([, v]) => NOT_SEEN.has(v))) { stats.dropped.all_not_seen++; continue; }
    if (slDevices.has(rec.did) && isStraight(rec, qIndex)) { stats.dropped.straight_line++; continue; }
    let score = 0; const mech = [];
    for (const [q, v] of vals) {
      const Q = qIndex[q];
      const s = Q.supports.includes(v) ? 1 : Q.contradicts.includes(v) ? -1 : 0;
      score += s; mech.push([Q.mechanism, s, Q.type === 'accuracy' ? v : null]);
    }
    const { qIndex: _q, ...keep } = rec;
    (byCard[rec.card] ||= []).push({ ...keep, net: score / n, mech });
    stats.valid++;
  }

  const pulse = {};
  for (const [cardId, poll] of Object.entries(pollById)) {
    if (poll.no_poll) continue;
    const recs = byCard[cardId] || [];
    const prox = Object.fromEntries(poll.roles.map((r) => [r.role, r.proximity]));
    const labels = Object.fromEntries(poll.roles.map((r) => [r.role, r.label]));
    const roles = {};
    for (const r of recs) {
      const R = (roles[r.role] ||= { n: 0, confirm: 0, contradict: 0, neutral: 0, accuracy: {}, weight: prox[r.role] || 1, label: labels[r.role] || ROLES[r.role] });
      R.n++; r.net > 0 ? R.confirm++ : r.net < 0 ? R.contradict++ : R.neutral++;
      for (const [, , acc] of r.mech) if (acc) R.accuracy[acc] = (R.accuracy[acc] || 0) + 1;
    }
    const n = recs.length;
    const entry = { n, min: minN, by_role_counts: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.n])), last_response_at: n ? new Date(Math.max(...recs.map((r) => r.msgTime))).toISOString() : null };
    if (n >= minN) {
      let num = 0, den = 0;
      for (const R of Object.values(roles)) { num += R.weight * (R.confirm - R.contradict); den += R.weight * R.n; R.pct_confirm = Math.round((100 * R.confirm) / R.n); R.pct_contradict = Math.round((100 * R.contradict) / R.n); }
      const index = den ? num / den : 0;
      const mechanisms = {};
      for (const r of recs) for (const [m, s] of r.mech) { const M = (mechanisms[m] ||= { supports: 0, contradicts: 0, neutral: 0 }); s > 0 ? M.supports++ : s < 0 ? M.contradicts++ : M.neutral++; }
      const divergences = [];
      const rs = Object.entries(roles).filter(([, R]) => R.n >= 2).map(([k, R]) => [k, R, (R.confirm - R.contradict) / R.n]);
      for (const [a, A, ra] of rs) for (const [b, B, rb] of rs) if (ra >= 0.34 && rb <= -0.34) divergences.push(`${A.label} respondents mostly confirm (${A.pct_confirm}%) but ${B.label} respondents mostly contradict (${B.pct_contradict}%)`);
      const closest = rs.sort((x, y) => y[1].weight - x[1].weight || y[1].n - x[1].n)[0];
      if (closest) { const acc = closest[1].accuracy; const tot = Object.values(acc).reduce((s, x) => s + x, 0); const off = (acc['Overstated'] || 0) + (acc['Not seeing it'] || 0); if (tot >= 2 && off / tot > 0.5) divergences.push(`${closest[1].label} (closest to the event) say the report is overstated or not visible (${off}/${tot})`); }
      const card = cardById[cardId];
      if (card && card.credit_signal !== 'positive' && index <= -0.25) divergences.push(`Field responses do not show the stress the news implies (field index ${index.toFixed(2)})`);
      if (card && card.credit_signal === 'positive' && index <= -0.25) divergences.push(`Field responses do not show the improvement the news implies (field index ${index.toFixed(2)})`);
      Object.assign(entry, {
        roles, index: Math.round(index * 100) / 100,
        field_signal: index >= 0.25 ? 'confirms' : index <= -0.25 ? 'contradicts' : 'mixed',
        mechanisms, divergences,
        notes: recs.filter((r) => r.text).sort((a, b) => b.msgTime - a.msgTime).slice(0, 5).map((r) => ({ role: r.role, text: r.text })),
      });
    }
    pulse[cardId] = entry;
  }
  return { pulse, stats };
}
