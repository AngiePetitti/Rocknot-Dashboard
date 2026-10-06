'use client';

import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import type { GaData, GaDimRow, GaPageRow } from '@/src/lib/ga4';

const n = (v: number) => Math.round(v).toLocaleString();
const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');
const share = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

type DimSort = 'sessions' | 'engaged' | 'addToCarts' | 'purchases' | 'cvr' | 'revenue';
type PageSort = 'pageViews' | 'sessions' | 'engaged' | 'users';
type Sort<K extends string> = { key: K; dir: 'asc' | 'desc' };

function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<Sort<K>>({ key: initial, dir: 'desc' });
  const toggle = (k: K) => setSort(s => (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' }));
  return { sort, toggle };
}
function SortTH<K extends string>({ k, label, sort, onToggle }: { k: K; label: string; sort: Sort<K>; onToggle: (k: K) => void }) {
  return (
    <th className="text-right text-xs font-semibold uppercase pb-2 pl-2 whitespace-nowrap">
      <button onClick={() => onToggle(k)} className={`inline-flex items-center gap-1 ${sort.key === k ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}>
        {label}<span className="text-[9px]">{sort.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  );
}
const TH = ({ children }: { children: React.ReactNode }) => <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-2">{children}</th>;
const TD = ({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`py-2 align-top ${right ? 'text-right pl-2 tabular-nums' : 'pr-2'} ${className}`}>{children}</td>
);

function dimValue(r: GaDimRow, k: DimSort): number {
  if (k === 'engaged') return r.sessions > 0 ? r.engagedSessions / r.sessions : -1;
  if (k === 'cvr') return r.sessions > 0 ? r.purchases / r.sessions : -1;
  return r[k];
}
function sortDims(rows: GaDimRow[], s: Sort<DimSort>): GaDimRow[] {
  return [...rows].sort((a, b) => (s.dir === 'desc' ? dimValue(b, s.key) - dimValue(a, s.key) : dimValue(a, s.key) - dimValue(b, s.key)));
}

/** Sortable source / landing-page table with CVR colouring against the site average. */
function DimTable({ rows, siteCvr, firstCol, mono, initial = 'sessions', limit = 15, totalSessions }: { rows: GaDimRow[]; siteCvr: number; firstCol: string; mono?: boolean; initial?: DimSort; limit?: number; totalSessions: number }) {
  const { sort, toggle } = useSort<DimSort>(initial);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => sortDims(rows, sort), [rows, sort]);
  const shown = showAll ? sorted : sorted.slice(0, limit);
  if (!rows.length) return <p className="text-xs text-gray-400 py-3">No data in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead><tr className="border-b border-gray-100">
          <TH>{firstCol}</TH>
          <SortTH k="sessions" label="Sessions" sort={sort} onToggle={toggle} />
          <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Share</th>
          <SortTH k="engaged" label="Engaged" sort={sort} onToggle={toggle} />
          <SortTH k="addToCarts" label="Add to cart" sort={sort} onToggle={toggle} />
          <SortTH k="purchases" label="Purchases" sort={sort} onToggle={toggle} />
          <SortTH k="cvr" label="CVR" sort={sort} onToggle={toggle} />
          <SortTH k="revenue" label="Revenue" sort={sort} onToggle={toggle} />
        </tr></thead>
        <tbody>
          {shown.map(r => {
            const cvr = r.sessions > 0 ? r.purchases / r.sessions : 0;
            const tone = r.sessions < 50 ? 'text-gray-500' : cvr >= siteCvr * 1.25 ? 'text-green-600 font-semibold' : cvr <= siteCvr * 0.5 ? 'text-red-500 font-semibold' : 'text-gray-600';
            return (
              <tr key={r.key} className="border-b border-gray-50">
                <TD className={mono ? 'font-mono text-xs break-all text-gray-700' : ''}>
                  <span className={mono ? '' : 'font-medium text-gray-800'}>{r.label}</span>
                  {r.secondary && <span className="text-[11px] text-gray-400"> / {r.secondary}</span>}
                </TD>
                <TD right>{n(r.sessions)}</TD>
                <TD right className="text-gray-500">{share(r.sessions, totalSessions)}</TD>
                <TD right className="text-gray-600">{pct(r.engagedSessions, r.sessions)}</TD>
                <TD right className="text-gray-600">{n(r.addToCarts)}</TD>
                <TD right>{n(r.purchases)}</TD>
                <TD right className={tone}>{pct(r.purchases, r.sessions)}</TD>
                <TD right className="text-gray-600">{$(r.revenue)}</TD>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > limit && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs text-violet-600 font-medium mt-2">{showAll ? 'Show fewer' : `Show all ${sorted.length}`}</button>
      )}
    </div>
  );
}

function PagesTable({ rows }: { rows: GaPageRow[] }) {
  const { sort, toggle } = useSort<PageSort>('pageViews');
  const [showAll, setShowAll] = useState(false);
  const val = (r: GaPageRow, k: PageSort) => (k === 'engaged' ? (r.sessions > 0 ? r.engagedSessions / r.sessions : -1) : r[k]);
  const sorted = useMemo(() => [...rows].sort((a, b) => (sort.dir === 'desc' ? val(b, sort.key) - val(a, sort.key) : val(a, sort.key) - val(b, sort.key))), [rows, sort]);
  const shown = showAll ? sorted : sorted.slice(0, 15);
  if (!rows.length) return <p className="text-xs text-gray-400 py-3">No page data in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead><tr className="border-b border-gray-100">
          <TH>Page</TH>
          <SortTH k="pageViews" label="Views" sort={sort} onToggle={toggle} />
          <SortTH k="sessions" label="Sessions" sort={sort} onToggle={toggle} />
          <SortTH k="users" label="Users" sort={sort} onToggle={toggle} />
          <SortTH k="engaged" label="Engaged" sort={sort} onToggle={toggle} />
        </tr></thead>
        <tbody>
          {shown.map(p => (
            <tr key={p.path} className="border-b border-gray-50">
              <TD>
                <p className="font-medium text-gray-800 text-xs md:text-sm break-words">{p.title || p.path}</p>
                {p.title && <p className="font-mono text-[11px] text-gray-400 break-all">{p.path}</p>}
              </TD>
              <TD right>{n(p.pageViews)}</TD>
              <TD right>{n(p.sessions)}</TD>
              <TD right className="text-gray-600">{n(p.users)}</TD>
              <TD right className="text-gray-600">{pct(p.engagedSessions, p.sessions)}</TD>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 15 && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs text-violet-600 font-medium mt-2">{showAll ? 'Show fewer' : `Show all ${sorted.length}`}</button>
      )}
    </div>
  );
}

export default function GaTraffic({ data, rangeLabel }: { data: GaData | null; rangeLabel: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!data) { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); } }, [data]);
  if (!data) return <p className="text-xs text-gray-400 mb-4">Loading Google Analytics for {rangeLabel}… {tick > 8 ? `(${tick}s — Windsor is pulling four reports)` : ''}</p>;
  if (data.status === 'error') return <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">Google Analytics didn&apos;t answer: {data.error}</p><p className="text-xs text-gray-400 mt-1">Admins: /api/debug/ga4 shows which fields Windsor rejected.</p></Card>;
  const t = data.totals;
  const siteCvr = t.sessions > 0 ? t.purchases / t.sessions : 0;
  const chart = data.daily.map(d => ({ date: d.date.slice(5), Sessions: d.sessions, Purchases: d.purchases }));
  const tickInterval = Math.max(0, Math.floor(chart.length / 6) - 1);
  const landingTotal = data.landingPages.reduce((s, r) => s + r.sessions, 0);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mt-4 mb-6">
        <MetricCard title="GA4 Sessions" value={n(t.sessions)} subtitle={`${n(t.users)} users · ${n(t.newUsers)} new`} accentColor="#818cf8" />
        <MetricCard title="Engagement" value={pct(t.engagedSessions, t.sessions)} subtitle={`${n(t.engagedSessions)} engaged sessions`} accentColor="#f9a8d4" />
        <MetricCard title="Add to Cart" value={pct(t.addToCarts, t.sessions)} subtitle={`${n(t.addToCarts)} add-to-cart events`} accentColor="#fbbf24" />
        <MetricCard title="Purchases" value={n(t.purchases)} subtitle={`${pct(t.purchases, t.sessions)} of sessions · ${$(t.revenue)} GA4 revenue`} accentColor="#34d399" />
        <div className="col-span-2 lg:col-span-1">
          <MetricCard title="Page Views" value={n(t.pageViews)} subtitle={t.sessions > 0 ? `${(Math.round((t.pageViews / t.sessions) * 10) / 10).toFixed(1)} per session` : ''} accentColor="#22d3ee" />
        </div>
      </div>
      {data.status === 'partial' && (
        <Card className="mb-6 border-amber-100"><p className="text-xs text-amber-700">Some Google Analytics blocks didn&apos;t load: {data.error}</p></Card>
      )}
      {t.purchases === 0 && t.sessions > 0 && (
        <Card className="mb-6 border-amber-100"><p className="text-xs text-amber-700">GA4 recorded no purchases in this period, so conversion columns read zero. Orders exist in Shopify — check that the Shopify Google &amp; YouTube app is sending purchase events to property {data.account}.</p></Card>
      )}

      {chart.length > 1 && (
        <Card className="mb-6">
          <h3 className="text-sm font-bold text-gray-800 mb-3">GA4 Sessions by Day</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gaSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={tickInterval} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} formatter={(v) => n(Number(v) || 0)} />
              <Area type="monotone" dataKey="Sessions" stroke="#8b5cf6" strokeWidth={2} fill="url(#gaSessions)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-gray-800">Landing Pages — which pages convert</h3>
          <p className="text-[11px] text-gray-400">First page of the session · green = CVR 25%+ above site average, red = under half of it</p>
        </div>
        <DimTable rows={data.landingPages} siteCvr={siteCvr} firstCol="Landing page" mono totalSessions={landingTotal || t.sessions} />
        <p className="text-[11px] text-gray-400 mt-3">Purchases are credited to the page the buyer landed on. Pages with fewer than 50 sessions are shown in grey — too little traffic to judge. Click any column header to sort.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
        <Card>
          <div className="flex items-baseline justify-between mb-3 gap-3">
            <h3 className="text-sm font-bold text-gray-800">Channel Groups</h3>
            <p className="text-[11px] text-gray-400">GA4 default channel grouping</p>
          </div>
          {data.channels.length === 0 ? <p className="text-xs text-gray-400 py-3">No data in this period.</p> : (
            <>
              <div className="flex h-3 rounded-full overflow-hidden mb-4 bg-gray-100">
                {data.channels.map((c, i) => (
                  <div key={c.key} title={`${c.label}: ${n(c.sessions)} sessions`} style={{ width: `${(c.sessions / Math.max(1, t.sessions)) * 100}%`, background: ['#818cf8', '#f9a8d4', '#fbbf24', '#34d399', '#a78bfa', '#22d3ee', '#fb923c', '#94a3b8', '#cbd5e1'][i % 9] }} />
                ))}
              </div>
              <DimTable rows={data.channels} siteCvr={siteCvr} firstCol="Channel" limit={12} totalSessions={t.sessions} />
            </>
          )}
        </Card>
        <Card>
          <div className="flex items-baseline justify-between mb-3 gap-3">
            <h3 className="text-sm font-bold text-gray-800">Sources</h3>
            <p className="text-[11px] text-gray-400">session source / medium</p>
          </div>
          <DimTable rows={data.sources} siteCvr={siteCvr} firstCol="Source / medium" totalSessions={t.sessions} />
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-gray-800">All Pages — what people look at</h3>
          <p className="text-[11px] text-gray-400">Every page viewed in the period, including product, collection and blog pages</p>
        </div>
        <PagesTable rows={data.pages} />
      </Card>

      <p className="text-[11px] text-gray-400 mb-6">Source: Google Analytics 4 property {data.account} via Windsor, refreshed every 15 minutes. GA4 counts fewer sessions than Shopify (visitors who block tracking or decline cookies are missing) and credits purchases by its own model, so compare GA4 rows with each other, not with the Shopify view.</p>
    </>
  );
}
