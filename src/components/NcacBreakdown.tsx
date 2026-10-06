'use client';

import { useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';
import { formatCurrency } from '@/src/lib/utils';
import type { NcacData, NcacPlatform } from '@/src/lib/ncac';

/**
 * New-customer CAC by ad platform (Overview + Ad Performance). Spend is the
 * platform's de-duplicated spend; new customers are Shopify first-time buyers
 * whose order carried that platform's UTM tag or came from its site.
 */
export default function NcacBreakdown({ tf, dateFrom, dateTo, compare, targetCac }: { tf: string; dateFrom?: string; dateTo?: string; compare?: boolean; targetCac: number }) {
  const [data, setData] = useState<NcacData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setFailed(null);
    const p = new URLSearchParams({ tf });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (compare) p.set('compare', 'true');
    fetch(`/api/windsor/ncac?${p}`, { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.error) setFailed(String(d.error)); else setData(d); }).catch(e => setFailed(String(e)));
  }, [tf, dateFrom, dateTo, compare]);

  if (failed) return <Card className="mb-6"><p className="text-xs text-gray-400">New-customer CAC by platform unavailable: {failed}</p></Card>;
  if (!data) return <Card className="mb-6"><p className="text-xs text-gray-400">Loading new-customer CAC by platform…</p></Card>;
  const rows = data.platforms.filter(p => p.spend > 0 || p.newCustomers > 0);
  if (!rows.length) return null;
  const priorOf = (key: string): NcacPlatform | undefined => data.prior?.platforms.find(p => p.key === key);
  const $ = (v: number | null) => (v == null ? '—' : formatCurrency(v));
  const tone = (v: number | null) => (v == null ? 'text-gray-400' : v > targetCac ? 'text-red-500' : 'text-green-600');
  const Delta = ({ cur, prev }: { cur: number | null; prev: number | null | undefined }) => {
    if (cur == null || prev == null || prev === 0) return null;
    const d = ((cur - prev) / prev) * 100;
    // Lower CAC is better: a drop reads green.
    return <span className={`text-[11px] font-semibold ml-1 ${d <= 0 ? 'text-green-500' : 'text-red-500'}`}>{d <= 0 ? '▼' : '▲'} {Math.abs(d).toFixed(0)}%</span>;
  };
  const coverage = data.blended.newCustomers > 0 ? Math.round((data.attributedNewCustomers / data.blended.newCustomers) * 100) : 0;
  return (
    <Card className="mb-6">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-gray-800">New-Customer CAC by Platform</h3>
        <p className="text-[11px] text-gray-400">Platform spend ÷ first-time buyers whose order came from that platform · target ${targetCac}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead><tr className="border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-2">Platform</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Spend</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">New customers</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Orders</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">New-cust. CAC</th>
            {data.prior && <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Prior</th>}
          </tr></thead>
          <tbody>
            {rows.map(p => {
              const prev = priorOf(p.key);
              return (
                <tr key={p.key} className="border-b border-gray-50">
                  <td className="py-2 pr-2"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: p.color }} /><span className="font-medium text-gray-800">{p.label}</span></td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(p.spend)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{p.newCustomers.toLocaleString()}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{p.orders.toLocaleString()}</td>
                  <td className={`py-2 pl-2 text-right tabular-nums font-bold ${tone(p.ncac)}`}>{$(p.ncac)}<Delta cur={p.ncac} prev={prev?.ncac} /></td>
                  {data.prior && <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{prev ? `${$(prev.ncac)} · ${prev.newCustomers}` : '—'}</td>}
                </tr>
              );
            })}
            <tr className="bg-gray-50/60">
              <td className="py-2 pr-2 font-semibold text-gray-800">Blended (all platforms)</td>
              <td className="py-2 pl-2 text-right tabular-nums font-semibold">{formatCurrency(data.blended.spend)}</td>
              <td className="py-2 pl-2 text-right tabular-nums font-semibold">{data.blended.newCustomers.toLocaleString()}</td>
              <td className="py-2 pl-2 text-right tabular-nums text-gray-500">—</td>
              <td className={`py-2 pl-2 text-right tabular-nums font-bold ${tone(data.blended.ncac)}`}>{$(data.blended.ncac)}<Delta cur={data.blended.ncac} prev={data.prior?.blended.ncac} /></td>
              {data.prior && <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{data.prior ? `${$(data.prior.blended.ncac)} · ${data.prior.blended.newCustomers}` : '—'}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3 leading-snug">
        Shopify last-click: a first-time buyer is credited to the platform on the order&apos;s UTM tag, or failing that the site that referred them. {coverage}% of new customers were traceable to a platform; {data.unattributed.newCustomers.toLocaleString()} came in direct or untracked and are only in the blended row.
        {data.otherSources.length > 0 && <> Largest untracked sources: {data.otherSources.slice(0, 4).map(s => `${s.source} (${s.newCustomers})`).join(', ')}.</>}
        {' '}This differs from a pixel model like TripleWhale, which credits view-through and multi-touch, so platform rows will read higher CAC than TripleWhale and the blended row is the like-for-like comparison.
      </p>
    </Card>
  );
}
