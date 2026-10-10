import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IndustryArt } from './icons.jsx';
import { Poll, PollSheet, PulseBlock, FieldTag, RoleSetting, flushQueue, isDone, backendReady } from './pulse.jsx';

const LS_KEY = 'ccp.selection.v1';
const FILTER_KEY = 'ccp.filter.v1';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const ago = (iso) => {
  const h = Math.round((Date.now() - new Date(iso)) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
};
const SIGNAL = { negative: { label: 'Negative', cls: 'neg' }, watch: { label: 'Watch', cls: 'watch' }, positive: { label: 'Positive', cls: 'pos' } };
const EFFECT_LABELS = { volumes: 'Volumes', realisations: 'Realisations', input_costs: 'Input costs', margins: 'Margins', receivable_days: 'Receivable days', inventory: 'Inventory', creditors: 'Creditors', working_capital: 'Working capital', dscr: 'DSCR' };

// Card text: drop the model's "the snippet does not state…" caveat sentences, keep 1–2 substantive ones.
const CAVEAT = /(snippet|input|provides? no|contains? no|gives? no|not (?:stated|provided|specified|mentioned|disclosed)|no (?:further|additional|other|specific)|does not|do not|did not|remains? (?:unclear|unverified))/i;
export function cardText(item) {
  if (item.mode !== 'ai') return item.why_it_matters || '';
  const sents = String(item.summary || '').split(/(?<=[.!?])\s+/).filter((x) => x && !CAVEAT.test(x))
    .map((x) => x.replace(/^According to [^,]{2,70}?(?: on [^,]{3,25}(?:, \d{4})?)?, /i, '').replace(/^(?:The )?[A-Z][\w.&' -]{1,40}? (?:reports?|reported|states?|stated)(?: on [^,]{3,25}(?:, \d{4})?)?,? that /, '').replace(/^\w/, (c) => c.toUpperCase()));
  let t = sents.slice(0, 2).join(' ');
  if (t.length < 110 && item.why_it_matters) t = `${t} ${item.why_it_matters}`.trim();
  return t || item.why_it_matters || item.summary;
}

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => { const f = () => setHash(window.location.hash || '#/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return hash.replace(/^#/, '') || '/';
}
const go = (p) => { window.location.hash = p; };

function useData() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const opt = (f, d) => fetch(`./data/${f}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : d)).catch(() => d);
    Promise.all([...['feed', 'briefs', 'clusters', 'hidden_ids'].map((f) => fetch(`./data/${f}.json`, { cache: 'no-cache' }).then((r) => r.json())), opt('polls', { polls: {} }), opt('pulse', { cards: {} }), opt('feedback', { adapter: 'none' })])
      .then(([feed, briefs, clusters, hidden, polls, pulse, fb]) => {
        const hid = new Set(hidden.hidden_ids || []);
        flushQueue(fb);
        setState({ loading: false, feed: { ...feed, aliases: feed.aliases || {}, items: feed.items.filter((i) => !hid.has(i.id)) }, briefs, clusters: clusters.clusters, polls: polls.polls || {}, pulse, fb });
      })
      .catch((e) => setState({ loading: false, error: e.message }));
  }, []);
  return state;
}

function loadSelection() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function loadFilter() { try { return { cluster: 'all', signal: 'all', ...JSON.parse(sessionStorage.getItem(FILTER_KEY)) }; } catch { return { cluster: 'all', signal: 'all' }; } }

export default function App() {
  const route = useHashRoute();
  const data = useData();
  const [sel, setSel] = useState(loadSelection);
  const [filter, setFilterState] = useState(loadFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const setFilter = (f) => { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); setFilterState(f); };
  const saveSel = useCallback((s) => { localStorage.setItem(LS_KEY, JSON.stringify(s)); setSel(s); }, []);

  if (data.loading) return <div className="center muted">Loading cluster news…</div>;
  if (data.error) return <div className="center muted">Could not load data: {data.error}</div>;

  const { feed, briefs, clusters } = data;
  const fp = { polls: data.polls, pulse: data.pulse, cfg: data.fb };
  const allInd = clusters.flatMap((c) => c.industries.map((i) => `${c.id}:${i.id}`));
  const selection = sel || { industries: allInd, skipped: false };
  const firstVisit = !sel;
  const onFeed = !(firstVisit || route === '/setup') && !route.startsWith('/item/') && !route.startsWith('/brief');
  const followed = clusters.filter((c) => c.industries.some((i) => selection.industries.includes(`${c.id}:${i.id}`)));

  let page;
  if (firstVisit || route === '/setup') page = <Picker clusters={clusters} selection={selection} onSave={(s) => { saveSel(s); go('/'); }} firstVisit={firstVisit} />;
  else if (route.startsWith('/item/')) {
    const [rid, q] = route.slice(6).split('?');
    const id = feed.items.some((i) => i.id === rid) ? rid : feed.aliases[rid];
    page = <Detail key={`${id || rid}${q || ""}`} item={feed.items.find((i) => i.id === id)} clusters={clusters} fp={fp} feed={feed} openPoll={q === 'poll'} />;
  }
  else if (route.startsWith('/brief/')) page = <Brief brief={briefs[route.slice(7)]} cluster={clusters.find((c) => c.id === route.slice(7))} items={feed.items} pulse={data.pulse} />;
  else if (route === '/briefs') page = <BriefList briefs={briefs} clusters={clusters} />;
  else page = <Feed feed={feed} clusters={clusters} selection={selection} fp={fp} filter={filter} />;

  const fLabel = [filter.cluster === 'all' ? 'All clusters' : clusters.find((c) => c.id === filter.cluster)?.name, filter.signal === 'all' ? null : SIGNAL[filter.signal].label].filter(Boolean).join(' · ');
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('/')}><span className="dotmark" />Cluster Credit Pulse</div>
        {onFeed && <button className={`filterbtn ${filter.cluster !== 'all' || filter.signal !== 'all' ? 'active' : ''}`} onClick={() => setFilterOpen(true)} aria-label="Filter feed">{fLabel}<span className="caret">▾</span></button>}
      </header>
      <main className="main">{page}</main>
      {filterOpen && <FilterSheet clusters={followed} filter={filter} onChange={setFilter} onClose={() => setFilterOpen(false)} />}
      {!(firstVisit || route === '/setup') && (
        <nav className="bottomnav">
          <button className={route === '/' ? 'on' : ''} onClick={() => go('/')}>Feed</button>
          <button className={route.startsWith('/brief') ? 'on' : ''} onClick={() => go('/briefs')}>Weekly briefs</button>
          <button onClick={() => go('/setup')}>My clusters</button>
        </nav>
      )}
    </div>
  );
}

function FilterSheet({ clusters, filter, onChange, onClose }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, []);
  const Seg = ({ value, options, onPick }) => (
    <div className="seg" role="radiogroup">{options.map(([k, label]) => <button key={k} role="radio" aria-checked={value === k} className={`${value === k ? 'on' : ''} ${k}`} onClick={() => onPick(k)}>{label}</button>)}</div>
  );
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet filter-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top"><h2>Filter</h2><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="flabel">Cluster</div>
        <Seg value={filter.cluster} options={[['all', 'All'], ...clusters.map((c) => [c.id, c.name])]} onPick={(k) => onChange({ ...filter, cluster: k })} />
        <div className="flabel">Credit signal</div>
        <Seg value={filter.signal} options={[['all', 'All'], ['negative', 'Negative'], ['watch', 'Watch'], ['positive', 'Positive']]} onPick={(k) => onChange({ ...filter, signal: k })} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => onChange({ cluster: 'all', signal: 'all' })}>Reset</button>
          <button className="primary" onClick={onClose}>Show cards</button>
        </div>
      </div>
    </div>
  );
}

function Picker({ clusters, selection, onSave, firstVisit }) {
  const [picked, setPicked] = useState(new Set(selection.industries));
  const toggle = (k) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const all = clusters.flatMap((c) => c.industries.map((i) => `${c.id}:${i.id}`));
  return (
    <div className="picker">
      <h1>{firstVisit ? 'Which clusters do you lend to?' : 'My clusters & industries'}</h1>
      <p className="muted">Pick what you follow. Saved on this device only, no sign-in.</p>
      {clusters.map((c) => (
        <section key={c.id} className="pick-cluster">
          <div className="pick-head"><strong>{c.name}</strong><span className="muted"> · {c.district}, {c.state}</span><div className="muted small">{c.tagline}</div></div>
          <div className="pick-grid">
            {c.industries.map((i) => {
              const k = `${c.id}:${i.id}`;
              return (
                <button key={k} className={`pick ${picked.has(k) ? 'on' : ''}`} onClick={() => toggle(k)} style={{ '--c1': i.colors[0], '--c2': i.colors[1] }}>
                  <IndustryArt icon={i.icon} size={28} /><span>{i.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!firstVisit && <RoleSetting />}
      <div className="picker-actions">
        {firstVisit && <button className="ghost" onClick={() => onSave({ industries: all, skipped: true })}>Skip — show everything</button>}
        <button className="primary" disabled={!picked.size} onClick={() => onSave({ industries: [...picked], skipped: false })}>Show my feed</button>
      </div>
    </div>
  );
}

function Feed({ feed, clusters, selection, fp, filter }) {
  const [sheet, setSheet] = useState(null);
  const sel = new Set(selection.industries);
  const items = useMemo(() => feed.items.filter((i) =>
    i.industries.some((ind) => sel.has(`${i.cluster}:${ind}`)) &&
    (filter.cluster === 'all' || i.cluster === filter.cluster) && (filter.signal === 'all' || i.credit_signal === filter.signal)), [feed, filter, selection]);
  const ai = feed.items.filter((i) => i.mode === 'ai').length;
  return (
    <div className="feed-wrap">
      <div className="feed">
        {items.length === 0 && <div className="center muted">No cards for this filter.</div>}
        {items.map((it) => <Card key={it.id} item={it} clusters={clusters} fp={fp} onPoll={() => setSheet(it)} />)}
        {items.length > 0 && (
          <div className="feed-end">
            <p>You're up to date · {items.length} cards</p>
            <p className="footnote">Updated {ago(feed.generated_at)} · {feed.llm_mode === 'none' ? 'rule-based notes (no AI key)' : `AI notes on ${ai}/${feed.items.length} cards`} · verify before acting</p>
          </div>
        )}
      </div>
      {sheet && <PollSheet item={sheet} poll={fp.polls[sheet.id]} cfg={fp.cfg} onClose={() => setSheet(null)} />}
    </div>
  );
}

function industryMeta(clusters, item) {
  const c = clusters.find((x) => x.id === item.cluster);
  const inds = (c?.industries || []).filter((i) => item.industries.includes(i.id));
  return { c, inds, main: inds[0] || c?.industries[0] };
}

function shareText(item) {
  const app = `${window.location.origin}${window.location.pathname}#/item/${item.id}`;
  return { title: item.headline, text: `${item.headline}\n\nCredit view (${SIGNAL[item.credit_signal].label}): ${item.why_it_matters}\n\nSource: ${item.link}`, url: app };
}
function shareUrl(item) {
  const s = shareText(item);
  return `https://wa.me/?text=${encodeURIComponent(`${s.text}\nVia Cluster Credit Pulse: ${s.url}`)}`;
}
async function share(item) {
  const s = shareText(item);
  if (navigator.share) { try { await navigator.share(s); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  window.open(shareUrl(item), '_blank', 'noopener');
}

const Pill = ({ signal }) => <span className={`pill ${SIGNAL[signal].cls}`}>{SIGNAL[signal].label}</span>;

function Card({ item, clusters, fp, onPoll }) {
  const poll = fp.polls[item.id];
  const { c, main } = industryMeta(clusters, item);
  const n = item.also_reported_by?.length || 0;
  const updated = item.latest_at && new Date(item.latest_at) - new Date(item.published) > 864e5;
  const open = () => go(`/item/${item.id}`);
  return (
    <article className="card">
      <div className="art" style={{ '--c1': main.colors[0], '--c2': main.colors[1] }} onClick={open} aria-hidden="true">
        <IndustryArt icon={main.icon} size={64} />
      </div>
      <div className="card-body">
        <Pill signal={item.credit_signal} />
        <h2 onClick={open}>{item.headline}</h2>
        <p className="summary">{cardText(item)}</p>
        <div className="card-foot">
        <div className="meta">
          {item.source} · {fmtShort(updated ? item.latest_at : item.published)}{updated ? ' (updated)' : ''} · {c.name}
          {n > 0 && <span className="also"> · +{n} source{n > 1 ? 's' : ''}</span>}
        </div>
        {poll && !poll.no_poll && (isDone(item.id)
          ? <div className="polllink done">✓ You answered — thanks</div>
          : <button className="polllink" onClick={onPoll}>Are you seeing this? Answer in 10 sec →</button>)}
        <div className="actions">
          <button className="primary" onClick={open}>Read analysis</button>
          <button className="btn" onClick={() => share(item)}>Share</button>
        </div>
        </div>
      </div>
    </article>
  );
}

function Acc({ title, meta, open, id, children }) {
  return (
    <details className="acc" open={open} id={id}>
      <summary><span>{title}</span>{meta != null && <span className="acc-meta">{meta}</span>}</summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}

function Detail({ item, clusters, fp, openPoll }) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (openPoll) setTimeout(() => document.getElementById('poll')?.scrollIntoView({ block: 'start' }), 80);
    else window.scrollTo(0, 0);
  }, []);
  if (!item) return <div className="center muted">Card not found (it may have aged out or been hidden). <button className="ghost" onClick={() => go('/')}>Back to feed</button></div>;
  const { c, inds } = industryMeta(clusters, item);
  const n = item.credit_note || {};
  const fx = n.financial_effects || {};
  const poll = fp.polls[item.id];
  const pulseN = fp.pulse?.cards?.[item.id]?.n || 0;
  const cov = item.coverage || (item.also_reported_by || []).map((s) => ({ source: s }));
  const sources = item.also_reported_by || [];
  const day = (iso) => (iso ? Math.floor(new Date(iso) / 864e5) : null);
  return (
    <div className="detail">
      <button className="back" onClick={() => (history.length > 1 ? history.back() : go('/'))}>← Back</button>
      <div className="d-top"><Pill signal={item.credit_signal} /><FieldTag item={item} pulse={fp.pulse} /></div>
      <h1>{item.headline}</h1>
      <div className="meta">{item.source} · {fmtDate(item.published)} · {c.name}{sources.length > 0 && <> · <a href="#also" onClick={(e) => { e.preventDefault(); const d = document.getElementById('also'); d.open = true; d.scrollIntoView({ behavior: 'smooth' }); }}>+{sources.length} source{sources.length > 1 ? 's' : ''}</a></>}</div>
      {item.mode === 'ai' && <p className="lead">{cardText(item)}</p>}
      <div className="why"><span>Why it matters</span>{item.why_it_matters}</div>
      <div className="actions inline">
        <a className="btn primary" href={item.link} target="_blank" rel="noopener noreferrer">Original report ↗</a>
        <button className="btn" onClick={() => share(item)}>Share</button>
      </div>

      <Acc title="Credit note" open>
        <Section title="What happened">{n.what_happened}</Section>
        <Section title="Confirmed vs alleged">{n.confirmed_vs_alleged}</Section>
        <Section title="Exposed sub-sectors">{n.exposed_subsectors}</Section>
        {Object.keys(EFFECT_LABELS).some((k) => fx[k]) && (
          <section className="sec">
            <h3>Likely effect on borrower financials</h3>
            <table className="fx"><tbody>{Object.keys(EFFECT_LABELS).filter((k) => fx[k]).map((k) => <tr key={k}><td>{EFFECT_LABELS[k]}</td><td>{fx[k]}</td></tr>)}</tbody></table>
          </section>
        )}
        <Section title="Temporary or structural?">{n.temporary_or_structural}</Section>
        {(n.confirm_or_disprove?.confirm || n.confirm_or_disprove?.disprove) && (
          <section className="sec two">
            <div><h3>Would confirm</h3><p>{n.confirm_or_disprove?.confirm}</p></div>
            <div><h3>Would disprove</h3><p>{n.confirm_or_disprove?.disprove}</p></div>
          </section>
        )}
      </Acc>

      {n.what_to_check?.length > 0 && (
        <Acc title="Checklist for the credit officer" meta={n.what_to_check.length}>
          <ul className="checklist">{n.what_to_check.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Acc>
      )}

      {cov.length > 0 && (
        <Acc id="also" title={sources.length ? 'Also reported by' : 'More coverage'} meta={sources.length ? `${sources.length} source${sources.length > 1 ? 's' : ''}` : `${cov.length} report${cov.length > 1 ? 's' : ''}`} open>
          {sources.length > 0
            ? <p className="also-line">Also reported by: {sources.slice(0, 4).join(', ')}{sources.length > 4 ? ` +${sources.length - 4} more` : ''} ({sources.length} source{sources.length > 1 ? 's' : ''})</p>
            : <p className="also-line">{item.source} also covered this in {cov.length} more report{cov.length > 1 ? 's' : ''}, merged here.</p>}
          <ul className="coverage">
            {cov.map((x, i) => {
              const dd = x.published ? day(x.published) - day(item.published) : 0;
              return (
                <li key={i}>
                  {x.link ? <a href={x.link} target="_blank" rel="noopener noreferrer">{x.source} ↗</a> : <span>{x.source}</span>}
                  {x.published && <span className="muted"> · {fmtShort(x.published)}{dd >= 1 ? ' · follow-up' : dd <= -1 ? ' · earlier report' : ''}</span>}
                  {x.headline && <div className="cov-h">{x.headline}</div>}
                </li>
              );
            })}
          </ul>
        </Acc>
      )}

      {poll && !poll.no_poll && (
        <Acc id="poll" title="Field pulse: are you seeing this?" meta={`${pulseN}/${fp.pulse?.min_responses || 5}`} open={openPoll || pulseN >= (fp.pulse?.min_responses || 5)}>
          <Poll item={item} poll={poll} cfg={fp.cfg} onDone={() => bump((x) => x + 1)} />
          <PulseBlock item={item} poll={poll} pulse={fp.pulse} cfg={fp.cfg} />
        </Acc>
      )}

      <Acc title="Tags & details">
        <dl className="kv">
          <dt>Event type</dt><dd>{item.event_type}</dd>
          <dt>Cluster</dt><dd>{c.name}</dd>
          <dt>Industries</dt><dd>{inds.map((i) => i.name).join(', ')}</dd>
          {item.raw?.title && item.raw.title !== item.headline && <><dt>Original headline</dt><dd>{item.raw.title}</dd></>}
          <dt>Language</dt><dd>{item.lang === 'gu' ? 'Gujarati' : item.lang === 'hi' ? 'Hindi' : 'English'}</dd>
          <dt>Via</dt><dd>{item.via}</dd>
          <dt>Card id</dt><dd><code>{item.id}</code></dd>
        </dl>
      </Acc>

      <p className="footnote">{item.mode === 'ai' ? `AI analysis${item.model ? ` (${item.model.replace(/^gemini:/, '')})` : ''}` : 'Rule-based checklist (no AI key)'} — verify before acting. Not a basis for any classification, sanction or borrower-specific decision on its own.</p>
    </div>
  );
}

const Section = ({ title, children }) => (children ? <section className="sec"><h3>{title}</h3><p>{children}</p></section> : null);

function BriefList({ briefs, clusters }) {
  return (
    <div className="brieflist">
      <h1>Weekly cluster briefs</h1>
      <p className="muted">Synthesis of the last 7 days of cards per cluster.</p>
      {clusters.map((c) => {
        const b = briefs[c.id];
        const main = c.industries[0];
        return (
          <button key={c.id} className="brief-tile" onClick={() => go(`/brief/${c.id}`)} style={{ '--c1': main.colors[0], '--c2': main.colors[1] }}>
            <IndustryArt icon={main.icon} size={36} />
            <div><strong>{c.name}</strong><div className="small">{b?.headline}</div><div className="small dim">{b?.item_count ?? 0} cards · {c.tagline}</div></div>
          </button>
        );
      })}
    </div>
  );
}

function Brief({ brief, cluster, items, pulse }) {
  if (!brief || !cluster) return <div className="center muted">No brief.</div>;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const linkify = (s) => {
    const parts = String(s).split(/\[([0-9a-f]{12}(?:\s*,\s*[0-9a-f]{12})*)\]/g);
    return parts.map((p, i) => (i % 2
      ? p.split(/\s*,\s*/).map((id, k) => (byId[id] ? <a key={`${i}-${k}`} className="ref" href={`#/item/${id}`}>card</a> : null))
      : p));
  };
  const List = ({ title, xs, cls }) => (
    <section className={`sec ${cls || ''}`}><h3>{title}</h3>{xs?.length ? <ul>{xs.map((x, i) => <li key={i}>{linkify(x)}</li>)}</ul> : <p className="muted">None this week.</p>}</section>
  );
  return (
    <div className="detail">
      <button className="back" onClick={() => go('/briefs')}>← Briefs</button>
      <div className="etype">Weekly brief · {cluster.name} · last {brief.window_days} days · {brief.item_count} cards</div>
      <h1>{brief.headline}</h1>
      <div className={`ai-label ${brief.mode}`}>{brief.mode === 'ai' ? 'AI synthesis — verify before acting' : 'Rule-based roll-up (no AI key configured) — verify before acting'}</div>
      <List title="What changed" xs={brief.what_changed} />
      <List title="Stress signals" xs={brief.stress_signals} cls="stress" />
      <List title="Improvement signals" xs={brief.improvement_signals} cls="improve" />
      <List title="What to watch" xs={brief.what_to_watch} />
      {brief.field_pulse && (() => { const f = brief.field_pulse; const c = f.counts || {}; return (
        <section className="sec pulseblock">
          <h3>Field pulse {f.status === 'insufficient' ? '· insufficient data' : ''}</h3>
          <p className="small muted">{c.responses || 0} valid responses · {c.cards_with_responses || 0} cards with responses · {c.cards_meeting_threshold || 0} cards at ≥{c.min_responses || 5} · {c.cards_with_polls || 0} polled cards this week</p>
          {f.status !== 'insufficient' && <>
            <List title="Field confirms" xs={f.confirms} cls="improve" />
            <List title="Field contradicts" xs={f.contradicts} cls="stress" />
          </>}
          <List title={f.status === 'insufficient' ? 'Status' : 'Still unknown'} xs={f.unknown} />
          <p className="pulse-label">Crowd field signal — anonymous, self-reported, unverified; not borrower-level evidence.</p>
        </section>); })()}
      <p className="muted small">Generated {fmtDate(brief.generated_at)}.</p>
    </div>
  );
}
