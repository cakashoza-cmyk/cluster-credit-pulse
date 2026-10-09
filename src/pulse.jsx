// Field Pulse — anonymous one-tap crowd feedback on news cards.
import React, { useEffect, useMemo, useState } from 'react';

export const ROLE_LABELS = {
  banker: 'Banker / lender (bank, NBFC, co-op)',
  operator: 'Manufacturer / promoter / operator',
  supplier: 'Input supplier / trader (coal, gas, clay, yarn, chemicals, rough diamonds…)',
  buyer: 'Buyer / dealer / distributor / exporter',
  logistics: 'Logistics / transporter / CHA',
  labour: 'Labour contractor',
  consultant: 'CA / consultant / association member',
  other: 'Other',
};
const SHORT = { banker: 'Bankers', operator: 'Operators', supplier: 'Suppliers/traders', buyer: 'Buyers/dealers', logistics: 'Transporters', labour: 'Labour contractors', consultant: 'CAs/consultants', other: 'Other' };
export const PULSE_LABEL = 'Crowd field signal — anonymous, self-reported, unverified; not borrower-level evidence.';

const K = { role: 'ccp.fp.role', did: 'ccp.fp.did', done: 'ccp.fp.done', queue: 'ccp.fp.queue', lang: 'ccp.fp.lang', test: 'ccp.fp.test' };
const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
export const getRole = () => ls.get(K.role, null); // null = never asked; 'skip' = just browsing
export const setRole = (r) => ls.set(K.role, r);
function deviceId() {
  let d = ls.get(K.did, null);
  if (!d) { const a = new Uint8Array(12); crypto.getRandomValues(a); d = 'd' + [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); ls.set(K.did, d); }
  return d;
}
export const isDone = (id) => !!ls.get(K.done, {})[id];
const markDone = (id) => { const d = ls.get(K.done, {}); d[id] = Date.now(); ls.set(K.done, d); };

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function encrypt(jwk, obj) {
  const pub = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ enc: 'ecdh-p256-aesgcm', k: b64(await crypto.subtle.exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) });
}
export const backendReady = (cfg) => !!cfg && ((cfg.adapter === 'ntfy' && cfg.ntfy?.topic && cfg.public_key_jwk) || (cfg.adapter === 'apps_script' && cfg.apps_script?.url));
async function send(cfg, payload) {
  if (cfg.adapter === 'ntfy') {
    const r = await fetch(`${cfg.ntfy.base || 'https://ntfy.sh'}/${cfg.ntfy.topic}`, { method: 'POST', body: await encrypt(cfg.public_key_jwk, payload) });
    if (!r.ok) throw new Error('relay ' + r.status);
  } else {
    await fetch(cfg.apps_script.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
  }
}
export async function flushQueue(cfg) {
  if (!backendReady(cfg)) return;
  const q = ls.get(K.queue, []);
  if (!q.length) return;
  const left = [];
  for (const p of q) { try { await send(cfg, p); } catch { left.push(p); } }
  ls.set(K.queue, left);
}

export function RolePicker({ onPick, onClose, title }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{title || 'What best describes you?'}</h2>
        <p className="muted small">Asked once, saved on this device only. No sign-in, no name. It lets us ask you questions you can answer first-hand.</p>
        <div className="role-list">
          {Object.entries(ROLE_LABELS).map(([k, v]) => <button key={k} className="role-opt" onClick={() => onPick(k)}>{v}</button>)}
        </div>
        <button className="ghost full" onClick={() => onPick('skip')}>Skip — just browsing</button>
      </div>
    </div>
  );
}

export function Poll({ item, poll, cfg, onDone }) {
  const [role, setR] = useState(getRole());
  const [asRole, setAsRole] = useState(null);
  const [picking, setPicking] = useState(role == null);
  const [ans, setAns] = useState({});
  const [text, setText] = useState('');
  const [lang, setLang] = useState(ls.get(K.lang, 'en'));
  const [state, setState] = useState(isDone(item.id) ? 'done' : 'open');
  const [opened] = useState(Date.now());
  const [showOther, setShowOther] = useState(false);
  const test = ls.get(K.test, false);
  if (!poll || poll.no_poll) return <p className="muted small">No field poll for this card (too vague to verify on the ground).</p>;
  if (state === 'done' || state === 'queued') return (
    <div className="poll thanks">
      <div className="tick">✓</div>
      <strong>Thank you — your field signal is recorded.</strong>
      <p className="muted small">{state === 'queued' ? 'Saved on this device; it will be sent automatically once the feedback service is live.' : 'One response per card per device. Field pulse refreshes about every 2 hours.'}</p>
    </div>
  );
  if (picking) return <RolePicker onPick={(r) => { setRole(r); setR(r); setPicking(false); }} onClose={() => setPicking(false)} />;
  if (role === 'skip' && !asRole) return (
    <div className="poll"><p className="small muted">You chose “just browsing”.</p><button className="btn full" onClick={() => setPicking(true)}>I can answer — pick my role</button></div>
  );
  const eff = asRole || role;
  const own = poll.roles.find((r) => r.role === eff);
  // roles not covered by this poll get the accuracy question of the closest role
  const closest = [...poll.roles].sort((a, b) => b.proximity - a.proximity)[0];
  const block = own || { role: eff, label: ROLE_LABELS[eff], questions: closest.questions.filter((q) => q.type === 'accuracy') };
  const tr = lang === 'gu' && poll.translation?.roles?.[block.role === eff && own ? eff : closest.role];
  const qText = (q) => (tr?.questions?.[q.id]?.text) || q.text;
  const qOpt = (q, i) => (tr?.questions?.[q.id]?.options?.[i]) || q.options[i];
  const complete = block.questions.every((q) => ans[q.id]);
  const submit = async () => {
    const payload = { v: 1, card: item.id, cluster: item.cluster, role: eff, answers: ans, text: text.trim().slice(0, 280), did: deviceId(), pv: poll.prompt_version, ts: Date.now(), dt: Date.now() - opened, lang, ...(test ? { test: true } : {}) };
    setState('sending');
    let st = 'done';
    if (!backendReady(cfg)) { ls.set(K.queue, [...ls.get(K.queue, []), payload]); st = 'queued'; }
    else { try { await send(cfg, payload); } catch { ls.set(K.queue, [...ls.get(K.queue, []), payload]); } }
    markDone(item.id); setState(st); onDone && onDone(st);
  };
  return (
    <div className="poll">
      {test && <div className="testbar">TEST MODE — responses are flagged test and excluded from aggregates</div>}
      <div className="poll-head">
        <div><div className="small muted">Answering as</div><strong>{own ? block.label : ROLE_LABELS[eff]}</strong></div>
        {poll.translation && <button className="chip on-sm" onClick={() => { const l = lang === 'gu' ? 'en' : 'gu'; setLang(l); ls.set(K.lang, l); }}>{lang === 'gu' ? 'English' : 'ગુજરાતી'}</button>}
      </div>
      {!own && <p className="small muted">No role-specific questions for you on this card — just the accuracy check.</p>}
      {block.questions.map((q) => (
        <div key={q.id} className="q">
          <div className="q-text">{qText(q)}</div>
          <div className={`opts n${q.options.length}`}>
            {q.options.map((o, i) => <button key={o} className={`opt ${ans[q.id] === o ? 'on' : ''}`} onClick={() => setAns({ ...ans, [q.id]: o })}>{qOpt(q, i)}</button>)}
          </div>
        </div>
      ))}
      <textarea maxLength={280} placeholder="Optional: what are you seeing on the ground? (no names, firms or account details)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="small muted right">{text.length}/280</div>
      <button className="primary full" disabled={!complete || state === 'sending'} onClick={submit}>{state === 'sending' ? 'Sending…' : 'Submit anonymously'}</button>
      <div className="poll-foot small">
        <button className="linkish" onClick={() => setShowOther(!showOther)}>Answer as another role</button>
        <span className="muted"> · </span>
        <button className="linkish" onClick={() => setPicking(true)}>Change my role</button>
      </div>
      {showOther && <div className="other-roles">{poll.roles.map((r) => <button key={r.role} className={`chip ${eff === r.role ? 'on' : ''}`} onClick={() => { setAsRole(r.role); setAns({}); setShowOther(false); }}>{r.label}</button>)}</div>}
    </div>
  );
}

export function PulseBlock({ item, poll, pulse, cfg }) {
  const p = pulse?.cards?.[item.id];
  const min = pulse?.min_responses || cfg?.min_responses || 5;
  const mine = isDone(item.id) ? 1 : 0;
  let body;
  if (!backendReady(cfg)) body = <p className="muted">Field pulse coming soon — your answers are saved on this device and will be sent once the feedback service is switched on.</p>;
  else if (!poll || poll.no_poll) body = <p className="muted">No poll on this card.</p>;
  else if (!p || p.n < min) {
    const n = p?.n || 0;
    body = <>
      <div className="collect"><div className="bar"><i style={{ width: `${Math.min(100, (100 * n) / min)}%` }} /></div><span>Collecting field signals ({n}/{min})</span></div>
      {mine && !n ? <p className="muted small">Your response is in the queue; counts refresh about every 2 hours.</p> : null}
    </>;
  } else {
    body = <>
      <div className={`fsig ${p.field_signal}`}>Field {p.field_signal === 'mixed' ? 'is mixed' : p.field_signal} the news · n={p.n} · weighted index {p.index > 0 ? '+' : ''}{p.index}</div>
      {Object.entries(p.roles).sort((a, b) => b[1].weight - a[1].weight).map(([k, R]) => (
        <div key={k} className="rrow">
          <div className="rlab"><span>{R.label || SHORT[k]}</span><span className="muted">n={R.n}{R.weight >= 3 ? ' · closest' : ''}</span></div>
          <div className="split"><i className="c" style={{ width: `${R.pct_confirm}%` }} /><i className="x" style={{ width: `${R.pct_contradict}%` }} /></div>
          <div className="small muted">{R.pct_confirm}% confirm · {R.pct_contradict}% contradict</div>
        </div>
      ))}
      {p.divergences?.length > 0 && <div className="diverge"><strong>⚠ Divergence</strong><ul>{p.divergences.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
      {p.notes?.length > 0 && <div className="notes"><h4>On the ground</h4>{p.notes.map((n, i) => <p key={i}>“{n.text}” <span className="muted">— {SHORT[n.role]}</span></p>)}</div>}
    </>;
  }
  return (
    <section className="sec pulseblock">
      <h3>Field pulse</h3>
      {poll && !poll.no_poll && poll.hypothesis && <p className="small muted">Testing: {poll.hypothesis}</p>}
      {body}
      <p className="pulse-label">{PULSE_LABEL}</p>
    </section>
  );
}

export function FieldTag({ item, pulse }) {
  const p = pulse?.cards?.[item.id];
  if (!p || p.n < (pulse.min_responses || 5)) return null;
  return <span className={`ftag ${p.field_signal}`} title="Field-adjusted indicator — the AI credit signal is unchanged">Field: {p.field_signal} · n={p.n}</span>;
}

export function PollSheet({ item, poll, cfg, onClose }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, []);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top"><span className="small muted">Are you seeing this?</span><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <h2 className="sheet-h">{item.headline}</h2>
        <Poll item={item} poll={poll} cfg={cfg} />
      </div>
    </div>
  );
}

export function RoleSetting() {
  const [r, setR] = useState(getRole());
  return (
    <section className="pick-cluster">
      <div className="pick-head"><strong>My role (for Field Pulse polls)</strong><div className="muted small">Self-declared, anonymous, stored on this device only.</div></div>
      <select className="sel" value={r || ''} onChange={(e) => { setRole(e.target.value || null); setR(e.target.value || null); }}>
        <option value="">Ask me when I open a poll</option>
        {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        <option value="skip">Just browsing (don't ask)</option>
      </select>
    </section>
  );
}
