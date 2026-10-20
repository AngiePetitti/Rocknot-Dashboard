'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TIMEFRAME_LABELS } from '@/src/lib/utils';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import type { SubscriptionData, SubTotals, Direction } from '@/src/lib/subscriptions';

interface Resp extends Partial<SubscriptionData> { source?: string; error?: string }

const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const n = (v: number) => Math.round(v).toLocaleString();
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

// Direction chip: arrow + word, so state never rests on colour alone.
function Trend({ dir, pct, label }: { dir: Direction; pct: number | null; label: string }) {
  const s = dir === 'up' ? { c: 'text-emerald-700 bg-emerald-50', a: '▲', w: 'Growing' }
    : dir === 'down' ? { c: 'text-red-700 bg-red-50', a: '▼', w: 'Shrinking' }
    : dir === 'flat' ? { c: 'text-gray-700 bg-gray-100', a: '▬', w: 'Flat' }
    : { c: 'text-gray-500 bg-gray-50', a: '·', w: 'Not enough history' };
  return (
    <div className={`rounded-xl px-4 py-3 ${s.c}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-lg font-bold">{s.a} {s.w}{pct !== null ? ` · ${pct > 0 ? '+' : ''}${pct}%` : ''}</p>
      <p className="text-[11px] opacity-80">last 3 full months vs the 3 before</p>
    </div>
  );
}

const TONE: Record<string, { icon: string; cls: string }> = {
  good: { icon: '✅', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  warn: { icon: '⚠️', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  bad: { icon: '🔻', cls: 'border-red-200 bg-red-50 text-red-900' },
  info: { icon: 'ℹ️', cls: 'border-blue-100 bg-blue-50 text-blue-900' },
};

export default function SubscriptionsContent() {
  const sp = useSearchParams();
  const tfRaw = sp.get('tf') || '30d';
  const dateFrom = sp.get('date_from') || '';
  const dateTo = sp.get('date_to') || '';
  const compareTo = sp.get('compare_to') || '';
  const rangeLabel = tfRaw === 'custom' && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tfRaw] || 'Last 30 Days');
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (compareTo === 'month' || compareTo === 'year') p.set('compare_to', compareTo);
    fetch(`/api/subscriptions?${p}`, { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ source: 'error', error: 'Failed to load' }));
  }, [tfRaw, dateFrom, dateTo, compareTo]);

  const t = data?.totals;
  const prior = data?.prior?.totals;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const chart = useMemo(() => (data?.monthly || []).map(m => ({ ...m, label: monthLabel(m.month), partial: m.month === thisMonth })), [data, thisMonth]);
  const cmp = (k: keyof SubTotals) => (t && prior ? { current: t[k], prior: prior[k] } : undefined);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header title="Subscriptions" subtitle={`Loop renewals from Shopify · ${rangeLabel}`} />
      <TimeframeSelector />
      {!data && <p className="text-xs text-gray-400 mb-4">Loading subscription renewals…</p>}
      {data?.error && <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>}

      {data && !data.error && t && data.trend && (
        <>
          {/* Direction first: is the subscription business growing? */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mt-4 mb-4">
            <Trend dir={data.trend.revenue} pct={data.trend.revenuePct} label="Renewal revenue" />
            <Trend dir={data.trend.subscribers} pct={data.trend.subscribersPct} label="Subscribers renewing each month" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <MetricCard title="Renewal Revenue" value={$(t.renewalRevenue)} subtitle="net sales of Loop renewal orders" accentColor="#818cf8" comparison={cmp('renewalRevenue')} />
            <MetricCard title="Renewal Orders" value={n(t.renewalOrders)} subtitle={`${$(t.avgRenewalValue)} average renewal`} accentColor="#a78bfa" comparison={cmp('renewalOrders')} />
            <MetricCard title="Subscribers Renewing" value={n(t.subscribersRenewing)} subtitle="customers with a renewal in the period" accentColor="#34d399" comparison={cmp('subscribersRenewing')} />
            <MetricCard title="Share of Store Sales" value={`${Math.round(t.shareOfStoreNet * 1000) / 10}%`} subtitle="renewal net ÷ web store net sales" accentColor="#f9a8d4" comparison={cmp('shareOfStoreNet')} />
          </div>

          {/* What to look at */}
          <Card className="mb-6" accentColor="#c4b5fd">
            <h3 className="text-sm font-bold text-gray-800 mb-3">What to look at</h3>
            <div className="flex flex-col gap-2">
              {(data.signals || []).map((s, i) => (
                <div key={i} className={`rounded-xl border px-4 py-2.5 text-sm ${TONE[s.tone].cls}`}>
                  <p className="font-semibold">{TONE[s.tone].icon} {s.title}</p>
                  <p className="text-xs opacity-90 mt-0.5">{s.detail}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Monthly renewal revenue — one series, one axis */}
          {chart.length > 0 && (
            <Card className="mb-6">
              <h3 className="text-sm font-bold text-gray-800">Renewal Revenue by Month</h3>
              <p className="text-xs text-gray-400 mb-3">Last 12 months · the lighter bar is the current, unfinished month</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : v}`} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                    formatter={(v, _k, item) => [`${$(Number(v) || 0)} · ${n((item?.payload as { renewalOrders?: number })?.renewalOrders ?? 0)} orders · ${n((item?.payload as { subscribers?: number })?.subscribers ?? 0)} subscribers`, 'Renewals']} />
                  <Bar dataKey="renewalRevenue" radius={[4, 4, 0, 0]}>
                    {chart.map((m, i) => <Cell key={i} fill={m.partial ? '#c7d2fe' : '#818cf8'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm min-w-[420px]">
                  <thead><tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase">
                    <th className="text-left pb-2">Month</th><th className="text-right pb-2">Renewal revenue</th><th className="text-right pb-2">Orders</th><th className="text-right pb-2">Subscribers</th><th className="text-right pb-2">Avg renewal</th>
                  </tr></thead>
                  <tbody>
                    {[...chart].reverse().map(m => (
                      <tr key={m.month} className="border-b border-gray-50">
                        <td className="py-1.5 text-gray-700">{m.label}{m.partial ? ' (so far)' : ''}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-gray-800">{$(m.renewalRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{n(m.renewalOrders)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{n(m.subscribers)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{m.renewalOrders > 0 ? $(m.renewalRevenue / m.renewalOrders) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Loop-only metrics */}
          <Card className="mb-6" accentColor={data.loopConnected ? '#34d399' : '#fbbf24'}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">{data.loopConnected ? 'Loop connected' : 'Coming with the Loop connection'}</h3>
            <p className="text-xs text-gray-500 mb-3">
              {data.loopConnected
                ? 'Loop is connected — active subscribers, cancellations and churn are being added to this tab.'
                : 'Shopify only sees renewal orders. These need Loop’s own data (add LOOP_API_TOKEN in Vercel):'}
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700 list-disc pl-5">
              <li>Active and paused subscribers, and MRR</li>
              <li>New subscriptions vs cancellations each month</li>
              <li>Monthly churn rate and top cancellation reasons</li>
              <li>Retention by sign-up month (still active after 1, 3, 6 months)</li>
              <li>Failed and skipped renewals</li>
              <li>Pauses vs cancellations</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
