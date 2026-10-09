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
export default function NcacBreakdown({ tf, dateFrom, dateTo, compare, compareTo, targetCac }: { tf: string; dateFrom?: string; dateTo?: string; compare?: boolean; compareTo?: 'prior' | 'month' | 'year'; targetCac: number }) {
  const [data, setData] = useState<NcacData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setFailed(null);
    const p = new URLSearchParams({ tf });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (compare) p.set('compare', 'true');
    if (compare && compareTo && compareTo !== 'prior') p.set('compare_to', compareTo);
    fetch(`/api/windsor/ncac?${p}`, { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.error) setFailed(String(d.error)); else setData(d); }).catch(e => setFailed(String(e)));
  }, [tf, dateFrom, dateTo, compare, compareTo]);

  if (failed) return <Card className="mb-6"><p className="text-xs text-gray-400">New-customer CAC by platform unavailable: {failed}</p></Card>;
  if (!data) return <Card className="mb-6"><p className="text-xs text-gray-400">Loading new-customer CAC by platform…</p></Card>;
  const rows = data.platforms.filter(p => p.spend > 0 || p.purchases > 0);
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
  const pctNew = Math.round(data.newShare * 100);
  return (
    <Card className="mb-6">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-gray-800">New-Customer CAC by Platform</h3>
        <p className="text-[11px] text-gray-400">Platform-reported purchases × {pctNew}% first-time share · target ${targetCac}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-2">Platform</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Spend</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Purchases</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Est. new customers</th>
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">New-cust. CAC</th>
            {data.prior && <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Prior</th>}
            <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Shopify recorded</th>
          </tr></thead>
          <tbody>
            {rows.map(p => {
              const prev = priorOf(p.key);
              return (
                <tr key={p.key} className="border-b border-gray-50">
                  <td className="py-2 pr-2"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: p.color }} /><span className="font-medium text-gray-800">{p.label}</span></td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(p.spend)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{p.purchases.toLocaleString()}{p.clickOnly && <span className="text-[10px] text-gray-400 ml-1" title="View-through purchases excluded">click</span>}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">~{p.newCustomers.toLocaleString()}</td>
                  <td className={`py-2 pl-2 text-right tabular-nums font-bold ${tone(p.ncac)}`}>{$(p.ncac)}<Delta cur={p.ncac} prev={prev?.ncac} /></td>
                  {data.prior && <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{prev ? `${$(prev.ncac)} · ~${prev.newCustomers}` : '—'}</td>}
                  <td className="py-2 pl-2 text-right tabular-nums text-gray-400 text-xs" title="First-time buyers whose order itself carried this platform's tag or referrer">{p.shopify.newCustomers} · {$(p.shopify.ncac)}</td>
                </tr>
              );
            })}
            <tr className="bg-gray-50/60">
              <td className="py-2 pr-2 font-semibold text-gray-800">Blended (exact)</td>
              <td className="py-2 pl-2 text-right tabular-nums font-semibold">{formatCurrency(data.blended.spend)}</td>
              <td className="py-2 pl-2 text-right tabular-nums text-gray-500">—</td>
              <td className="py-2 pl-2 text-right tabular-nums font-semibold">{data.blended.newCustomers.toLocaleString()}</td>
              <td className={`py-2 pl-2 text-right tabular-nums font-bold ${tone(data.blended.ncac)}`}>{$(data.blended.ncac)}<Delta cur={data.blended.ncac} prev={data.prior?.blended.ncac} /></td>
              {data.prior && <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{`${$(data.prior.blended.ncac)} · ${data.prior.blended.newCustomers}`}</td>}
              <td className="py-2 pl-2 text-right tabular-nums text-gray-400 text-xs">all first-time buyers</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3 leading-snug">
        Platform rows are an estimate: each platform&apos;s own purchase count (the figure Ads Manager / Google Ads show; Pinterest click-only) × the store&apos;s {pctNew}% first-time share of buyers this period. Platforms over-claim relative to one another, so read a platform&apos;s CAC against its own prior months, not against the other rows. The blended row is exact: all spend ÷ all first-time buyers in Shopify. &quot;Shopify recorded&quot; is the floor: first-time buyers whose order itself carried the platform&apos;s tag or referrer, which under-credits Instagram and Pinterest because in-app clicks often arrive as direct.
      </p>
    </Card>
  );
}
