import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IndustryArt } from './icons.jsx';

const LS_KEY = 'ccp.selection.v1';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const ago = (iso) => {
  const h = Math.round((Date.now() - new Date(iso)) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
};
const SIGNAL = { negative: { label: 'Negative', cls: 'neg' }, watch: { label: 'Watch', cls: 'watch' }, positive: { label: 'Positive', cls: 'pos' } };
const EFFECT_LABELS = { volumes: 'Volumes', realisations: 'Realisations', input_costs: 'Input costs', margins: 'Margins', receivable_days: 'Receivable days', inventory: 'Inventory', creditors: 'Creditors', working_capital: 'Working capital', dscr: 'DSCR' };

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => { const f = () => setHash(window.location.hash || '#/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return hash.replace(/^#/, '') || '/';
}
const go = (p) => { window.location.hash = p; };

function useData() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    Promise.all(['feed', 'briefs', 'clusters', 'hidden_ids'].map((f) => fetch(`./data/${f}.json`, { cache: 'no-cache' }).then((r) => r.json())))
      .then(([feed, briefs, clusters, hidden]) => {
        const hid = new Set(hidden.hidden_ids || []);
        setState({ loading: false, feed: { ...feed, items: feed.items.filter((i) => !hid.has(i.id)) }, briefs, clusters: clusters.clusters });
      })
      .catch((e) => setState({ loading: false, error: e.message }));
  }, []);
  return state;
}

function loadSelection() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }

export default function App() {
  const route = useHashRoute();
  const data = useData();
  const [sel, setSel] = useState(loadSelection);
  const saveSel = useCallback((s) => { localStorage.setItem(LS_KEY, JSON.stringify(s)); setSel(s); }, []);

  if (data.loading) return <div className="center muted">Loading cluster news…</div>;
  if (data.error) return <div className="center muted">Could not load data: {data.error}</div>;

  const { feed, briefs, clusters } = data;
  const allInd = clusters.flatMap((c) => c.industries.map((i) => `${c.id}:${i.id}`));
  const selection = sel || { industries: allInd, skipped: false };
  const firstVisit = !sel;

  let page;
  if (firstVisit || route === '/setup') page = <Picker clusters={clusters} selection={selection} onSave={(s) => { saveSel(s); go('/'); }} firstVisit={firstVisit} />;
  else if (route.startsWith('/item/')) page = <Detail item={feed.items.find((i) => i.id === route.slice(6))} clusters={clusters} />;
  else if (route.startsWith('/brief/')) page = <Brief brief={briefs[route.slice(7)]} cluster={clusters.find((c) => c.id === route.slice(7))} items={feed.items} />;
  else if (route === '/briefs') page = <BriefList briefs={briefs} clusters={clusters} />;
  else page = <Feed feed={feed} clusters={clusters} selection={selection} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('/')}><span className="pulse" />Cluster Credit Pulse</div>
        <div className="updated">Updated {ago(feed.generated_at)}</div>
      </header>
      <main className="main">{page}</main>
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
      <div className="picker-actions">
        {firstVisit && <button className="ghost" onClick={() => onSave({ industries: all, skipped: true })}>Skip — show everything</button>}
        <button className="primary" disabled={!picked.size} onClick={() => onSave({ industries: [...picked], skipped: false })}>Show my feed</button>
      </div>
    </div>
  );
}

function Feed({ feed, clusters, selection }) {
  const [cluster, setCluster] = useState('all');
  const [signal, setSignal] = useState('all');
  const sel = new Set(selection.industries);
  const items = useMemo(() => feed.items.filter((i) =>
    i.industries.some((ind) => sel.has(`${i.cluster}:${ind}`)) &&
    (cluster === 'all' || i.cluster === cluster) && (signal === 'all' || i.credit_signal === signal)), [feed, cluster, signal, selection]);
  const followed = clusters.filter((c) => c.industries.some((i) => sel.has(`${c.id}:${i.id}`)));
  return (
    <div className="feed-wrap">
      <div className="chips">
        {[{ id: 'all', name: 'All clusters' }, ...followed].map((c) => <button key={c.id} className={`chip ${cluster === c.id ? 'on' : ''}`} onClick={() => setCluster(c.id)}>{c.name}</button>)}
        <span className="sep" />
        {['all', 'negative', 'watch', 'positive'].map((s) => <button key={s} className={`chip sig-${s} ${signal === s ? 'on' : ''}`} onClick={() => setSignal(s)}>{s === 'all' ? 'All signals' : SIGNAL[s].label}</button>)}
      </div>
      {feed.llm_mode === 'none'
        ? <div className="modebar">No-key mode: tags and notes are rule-based, not AI. Add a free API key to switch on AI summaries.</div>
        : (() => { const ai = feed.items.filter((i) => i.mode === 'ai').length; const t = feed.generated_at ? new Date(feed.generated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
            return <div className="modebar ai">AI credit notes (Gemini) on {ai}/{feed.items.length} cards{ai < feed.items.length ? ' · rest rule-based' : ''} · updated {t} · verify before acting</div>; })()}
      <div className="feed">
        {items.length === 0 && <div className="center muted">No items for this filter.</div>}
        {items.map((it) => <Card key={it.id} item={it} clusters={clusters} />)}
        {items.length > 0 && <div className="feed-end muted">You're up to date · {items.length} cards</div>}
      </div>
    </div>
  );
}

function industryMeta(clusters, item) {
  const c = clusters.find((x) => x.id === item.cluster);
  const inds = (c?.industries || []).filter((i) => item.industries.includes(i.id));
  return { c, inds, main: inds[0] || c?.industries[0] };
}

function shareUrl(item) {
  const app = `${window.location.origin}${window.location.pathname}#/item/${item.id}`;
  const text = `${item.headline}\n\nCredit view (${SIGNAL[item.credit_signal].label}): ${item.why_it_matters}\n\nSource: ${item.link}\nVia Cluster Credit Pulse: ${app}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function Card({ item, clusters }) {
  const { c, inds, main } = industryMeta(clusters, item);
  const sig = SIGNAL[item.credit_signal];
  return (
    <article className="card">
      <div className="art" style={{ '--c1': main.colors[0], '--c2': main.colors[1] }} onClick={() => go(`/item/${item.id}`)}>
        <IndustryArt icon={main.icon} />
        <div className="art-tags"><span className="tag">{c.name}</span>{inds.map((i) => <span key={i.id} className="tag">{i.name}</span>)}</div>
        <span className={`badge ${sig.cls}`}>{sig.label}</span>
      </div>
      <div className="card-body">
        <div className="etype">{item.event_type}</div>
        <h2 onClick={() => go(`/item/${item.id}`)}>{item.headline}</h2>
        {item.mode === 'ai' && <p className="summary">{item.summary}</p>}
        <div className="why"><span>Why it matters</span>{item.why_it_matters}</div>
        {item.credit_note?.what_to_check?.length > 0 && (
          <div className="checks"><span>Check first</span><ul>{item.credit_note.what_to_check.slice(0, 2).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        )}
        <div className="meta">
          <span>{item.source}</span> · <span>{fmtDate(item.published)}</span>
          {item.also_reported_by?.length > 0 && <span className="also"> · +{item.also_reported_by.length} sources</span>}
          {item.lang !== 'en' && <span className="lang">{item.lang === 'gu' ? 'ગુજરાતી' : 'हिन्दी'}</span>}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => go(`/item/${item.id}`)}>Credit note</button>
          <a className="btn wa" href={shareUrl(item)} target="_blank" rel="noopener">WhatsApp</a>
          <a className="btn" href={item.link} target="_blank" rel="noopener noreferrer">Source ↗</a>
        </div>
      </div>
    </article>
  );
}

function Detail({ item, clusters }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  if (!item) return <div className="center muted">Card not found (it may have aged out or been hidden). <button className="ghost" onClick={() => go('/')}>Back to feed</button></div>;
  const { c, inds, main } = industryMeta(clusters, item);
  const n = item.credit_note || {};
  const sig = SIGNAL[item.credit_signal];
  const fx = n.financial_effects || {};
  return (
    <div className="detail">
      <button className="back" onClick={() => history.length > 1 ? history.back() : go('/')}>← Back</button>
      <div className="art small" style={{ '--c1': main.colors[0], '--c2': main.colors[1] }}>
        <IndustryArt icon={main.icon} size={56} />
        <div className="art-tags"><span className="tag">{c.name}</span>{inds.map((i) => <span key={i.id} className="tag">{i.name}</span>)}</div>
        <span className={`badge ${sig.cls}`}>{sig.label}</span>
      </div>
      <div className="etype">{item.event_type}</div>
      <h1>{item.headline}</h1>
      {item.raw?.title && item.raw.title !== item.headline && <div className="orig">Original headline: {item.raw.title}</div>}
      <div className="meta"><span>{item.source}</span> · Published {fmtDate(item.published)}{item.also_reported_by?.length > 0 && <> · also: {item.also_reported_by.join(', ')}</>}</div>
      <div className={`ai-label ${item.mode}`}>
        {item.mode === 'ai' ? 'AI analysis — verify before acting' : 'Rule-based checklist (no AI key configured) — verify before acting'}
        {item.model && <span className="muted small"> · {item.model}</span>}
      </div>
      {item.mode === 'ai' && <p className="summary">{item.summary}</p>}
      <div className="why"><span>Why it matters</span>{item.why_it_matters}</div>
      <div className="actions inline">
        <a className="btn primary" href={item.link} target="_blank" rel="noopener noreferrer">Original report ↗</a>
        <a className="btn wa" href={shareUrl(item)} target="_blank" rel="noopener">Share on WhatsApp</a>
      </div>

      <Section title="What happened">{n.what_happened}</Section>
      <Section title="Confirmed vs alleged vs uncertain">{n.confirmed_vs_alleged}</Section>
      <Section title="Exposed sub-sectors · winners & losers">{n.exposed_subsectors}</Section>
      <section className="sec">
        <h3>Likely effect on borrower financials</h3>
        <table className="fx"><tbody>
          {Object.keys(EFFECT_LABELS).filter((k) => fx[k]).map((k) => <tr key={k}><td>{EFFECT_LABELS[k]}</td><td>{fx[k]}</td></tr>)}
        </tbody></table>
      </section>
      <Section title="Temporary, cyclical or structural?">{n.temporary_or_structural}</Section>
      <section className="sec">
        <h3>What a credit officer should check next</h3>
        <ul>{(n.what_to_check || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
      </section>
      <section className="sec two">
        <div><h3>Would confirm</h3><p>{n.confirm_or_disprove?.confirm}</p></div>
        <div><h3>Would disprove</h3><p>{n.confirm_or_disprove?.disprove}</p></div>
      </section>
      <p className="muted small">Not a basis for any classification, sanction or borrower-specific decision on its own.</p>
      <p className="muted small">Card id: <code>{item.id}</code> · via {item.via}</p>
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

function Brief({ brief, cluster, items }) {
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
      <p className="muted small">Generated {fmtDate(brief.generated_at)}.</p>
    </div>
  );
}
