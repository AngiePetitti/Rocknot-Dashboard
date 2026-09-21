'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TIMEFRAME_LABELS } from '@/src/lib/utils';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import { useClient } from '@/src/components/ClientProvider';
import type { ChannelData, ChannelTotals, ChannelBreakdownRow } from '@/src/lib/channel';

interface ChannelResponse extends Partial<ChannelData> { source?: string; error?: string }

const n = (v: number) => Math.round(v).toLocaleString();
const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const rate = (returns: number, gross: number) => (gross > 0 ? returns / gross : 0);
const rateColor = (r: number) => (r >= 0.5 ? '#ef4444' : r >= 0.35 ? '#f59e0b' : '#22c55e');

const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`text-xs font-semibold text-gray-400 uppercase pb-2 ${right ? 'text-right pl-2' : 'text-left pr-2'}`}>{children}</th>
);
const TD = ({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`py-2 align-top ${right ? 'text-right pl-2 tabular-nums' : 'pr-2'} ${className}`}>{children}</td>
);

function BreakdownTable({ rows, label, limit = 12 }: { rows: ChannelBreakdownRow[]; label: string; limit?: number }) {
  if (!rows.length) return <p className="text-xs text-gray-400 py-3">Nothing sold through this channel in the period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[520px]">
        <thead><tr className="border-b border-gray-100"><TH>{label}</TH><TH right>Orders</TH><TH right>Gross</TH><TH right>Returned</TH><TH right>Return rate</TH><TH right>Net</TH></tr></thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => {
            const rr = rate(r.returns, r.gross);
            return (
              <tr key={i} className="border-b border-gray-50">
                <TD className="font-medium text-gray-800 text-xs md:text-sm break-words">{r.label}</TD>
                <TD right>{n(r.orders)}</TD>
                <TD right className="text-gray-600">{$(r.gross)}</TD>
                <TD right className="text-gray-600">{$(r.returns)}</TD>
                <TD right><span className="font-semibold" style={{ color: rateColor(rr) }}>{r.gross > 0 ? `${Math.round(rr * 100)}%` : '—'}</span></TD>
                <TD right className="font-semibold text-gray-800">{$(r.net)}</TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ChannelContent({ channelKey }: { channelKey: string }) {
  const searchParams = useSearchParams();
  const client = useClient();
  const channel = (client.marketplaces || []).find(m => m.key === channelKey);
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';
  const rangeLabel = tfRaw === 'custom' && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tfRaw] || 'Last 30 Days');
  const [data, setData] = useState<ChannelResponse | null>(null);

  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (compareOn) p.set('compare', 'true');
    fetch(`/api/channel/${channelKey}?${p}`, { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ source: 'error', error: 'Failed to load' }));
  }, [channelKey, tfRaw, dateFrom, dateTo, compareOn]);

  const t = data?.totals;
  const s = data?.store;
  const prior = data?.prior?.totals || undefined;
  const chartData = useMemo(() => (data?.daily || []).map(d => ({ date: d.date.slice(5), Gross: Math.round(d.gross), Returned: Math.round(d.returns), Net: Math.round(d.net) })), [data]);
  const tickInterval = Math.max(0, Math.floor(chartData.length / 6) - 1);
  const label = channel?.label || 'Channel';

  const cmp = (cur: ChannelTotals, pri: ChannelTotals | undefined, k: keyof ChannelTotals) => (pri ? { current: cur[k], prior: pri[k] } : undefined);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header title={label} subtitle={channel?.description || 'Marketplace channel'} />
      <TimeframeSelector />
      {!data && <p className="text-xs text-gray-400 mb-4">Loading Shopify for {rangeLabel}…</p>}
      {data?.error && <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>}

      {data && !data.error && t && s && (
        <>
          {/* ── Headline cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mt-4 mb-6">
            <MetricCard title="Gross Sales" value={$(t.gross)} subtitle={`${n(t.orders)} orders · ${$(t.orders > 0 ? t.gross / t.orders : 0)} per order at retail`} accentColor="#818cf8" comparison={cmp(t, prior, 'gross')} />
            <MetricCard title="Returned" value={$(t.returns)} subtitle={`${pct(t.returns, t.gross)} of gross · store ${pct(s.returns, s.gross)}`} accentColor="#f87171" valueColor={rateColor(rate(t.returns, t.gross))} comparison={cmp(t, prior, 'returns')} />
            <MetricCard title="Net Sales" value={$(t.net)} subtitle={`after returns · ${$(t.orders > 0 ? t.net / t.orders : 0)} kept per order`} accentColor="#34d399" comparison={cmp(t, prior, 'net')} />
            <MetricCard title={`Share of ${client.wordmark}`} value={pct(t.net, data.allNet || 0)} subtitle={`of ${$(data.allNet || 0)} net sales, all channels`} accentColor="#a78bfa" />
          </div>

          {/* ── Return window warning ── */}
          {data.openWindow && channel && (
            <Card className="mb-6" accentColor="#f59e0b">
              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                <div>
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Still inside the {channel.returnWindowDays}-day return window</p>
                  <p className="text-2xl font-bold text-gray-800">{$(data.openWindow.gross)} <span className="text-sm font-medium text-gray-500">across {n(data.openWindow.orders)} orders since {data.openWindow.from}</span></p>
                </div>
                <p className="text-xs text-gray-500 md:max-w-md">{label} customers can return for {channel.returnWindowDays} days, so the return rate for any recent period is a floor, not a final number. At this channel&apos;s rate, roughly {$(data.openWindow.gross * rate(t.returns, t.gross))} of this could still come back.</p>
              </div>
            </Card>
          )}

          {/* ── Gross vs returned vs net ── */}
          {chartData.length > 1 && (
            <Card className="mb-6">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Gross, Returned and Net by Day</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="chGross" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} /><stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} /></linearGradient>
                    <linearGradient id="chNet" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#34d399" stopOpacity={0.3} /><stop offset="95%" stopColor="#34d399" stopOpacity={0.02} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={tickInterval} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : v}`} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} formatter={(v) => $(Number(v) || 0)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="Gross" stroke="#818cf8" strokeWidth={2} fill="url(#chGross)" />
                  <Area type="monotone" dataKey="Returned" stroke="#f87171" strokeWidth={2} fill="none" strokeDasharray="4 3" />
                  <Area type="monotone" dataKey="Net" stroke="#34d399" strokeWidth={2} fill="url(#chNet)" />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-gray-400 mt-2">Returns are counted on the day they are processed, so a day can net below zero when refunds of older orders outweigh new sales.</p>
            </Card>
          )}

          {/* ── Side by side with the store + economics ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">{label} vs Online Store</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead><tr className="border-b border-gray-100"><TH>Metric</TH><TH right>{label}</TH><TH right>Online Store</TH></tr></thead>
                  <tbody>
                    {([
                      ['Orders', n(t.orders), n(s.orders)],
                      ['Gross sales', $(t.gross), $(s.gross)],
                      ['Discounts', $(t.discounts), $(s.discounts)],
                      ['Returned', $(t.returns), $(s.returns)],
                      ['Return rate', pct(t.returns, t.gross), pct(s.returns, s.gross)],
                      ['Net sales', $(t.net), $(s.net)],
                      ['Net per order', $(t.orders > 0 ? t.net / t.orders : 0), $(s.orders > 0 ? s.net / s.orders : 0)],
                      ['AOV (before returns)', $(t.aov), $(s.aov)],
                      // Marketplace orders usually carry no customer record — skip the rows rather than show zeros.
                      ...(t.customers > 0 ? [
                        ['Customers', n(t.customers), n(s.customers)],
                        ['Returning customers', pct(t.returningCustomers, t.customers), pct(s.returningCustomers, s.customers)],
                      ] : []),
                    ] as [string, string, string][]).map(([k, a, b]) => (
                      <tr key={k} className="border-b border-gray-50">
                        <TD className="text-gray-600">{k}</TD><TD right className="font-semibold text-gray-800">{a}</TD><TD right className="text-gray-600">{b}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">{label} orders are recorded at full retail in Shopify; the store&apos;s return fees do not apply to {label} customers.{t.customers === 0 ? ` ${label} orders carry no customer record, so customer counts are not available for this channel.` : ''}</p>
            </Card>

            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">What {label} Keeps for {client.wordmark}</h3>
              {data.economics && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Net sales after returns</span><span className="font-semibold tabular-nums">{$(t.net)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">{label} commission {data.economics.commissionPct != null ? `(${data.economics.commissionPct}%)` : ''}</span>
                    <span className="tabular-nums text-gray-600">{data.economics.commission != null ? `− ${$(data.economics.commission)}` : 'rate not set yet'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cost of goods {data.economics.cogsPct != null ? `(${data.economics.cogsPct}% of net)` : ''}</span>
                    <span className="tabular-nums text-gray-600">{data.economics.cogs != null ? `− ${$(data.economics.cogs)}` : 'no margin on file'}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2">
                    <span className="font-semibold text-gray-800">Contribution{data.economics.commission == null ? ' (before commission)' : ''}</span>
                    <span className="font-bold tabular-nums text-gray-800">{data.economics.contribution != null ? `${$(data.economics.contribution)} · ${data.economics.contributionPct}%` : '—'}</span>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-3">
                Cost of goods uses the {client.finance.grossMarginPct ?? '—'}% gross margin on file. Production and customization labour is shared across channels and is not allocated here yet.
                {data.economics?.commissionPct == null && ` Add ${label}'s commission rate and this becomes a true contribution figure.`}
              </p>
            </Card>
          </div>

          {/* ── Breakdowns ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">By Product Line</h3>
              <BreakdownTable rows={data.byLine || []} label="Product type" />
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">By Size</h3>
              <BreakdownTable rows={data.bySize || []} label="Size" limit={14} />
              <p className="text-[11px] text-gray-400 mt-3">A size that returns far above the channel average points at a fit or sizing-chart problem on {label}&apos;s listing.</p>
            </Card>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">Top Products on {label}</h3>
              <BreakdownTable rows={data.byProduct || []} label="Product" limit={15} />
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-gray-800 mb-3">By State</h3>
              <BreakdownTable rows={data.byRegion || []} label="Ship-to state" limit={10} />
            </Card>
          </div>

          {(data.errors || []).length > 0 && <p className="text-[11px] text-amber-600 mb-4">Some sections could not load: {data.errors!.join(' · ')}</p>}
          <p className="text-[11px] text-gray-400">Source: Shopify Analytics, sales report filtered to the &quot;{channel?.shopifyChannel}&quot; sales channel, live. Return rate = returned ÷ gross for the same period; returns are dated when processed.</p>
        </>
      )}
    </div>
  );
}
