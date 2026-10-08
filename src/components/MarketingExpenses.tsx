'use client';

import { useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';
import { formatCurrency } from '@/src/lib/utils';
import type { RangeExpenses, ExpenseMonth } from '@/src/lib/expenses';

interface Props {
  tf: string; dateFrom?: string; dateTo?: string;
  /** Overview figures for the same range. */
  netSales: number; adSpend: number; newCustomers: number; cogsPct: number | null;
}

/**
 * True profit and fully loaded marketing efficiency: the Overview's net
 * sales and live ad spend, plus every other marketing cost from the team's
 * budgeting sheet (prorated to the range). Admin-only (the API 403s otherwise).
 */
export default function MarketingExpenses({ tf, dateFrom, dateTo, netSales, adSpend, newCustomers, cogsPct }: Props) {
  const [data, setData] = useState<{ range: RangeExpenses; sheet: { title: string; months: ExpenseMonth[] } } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setData(null); setFailed(null);
    const p = new URLSearchParams({ tf });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    fetch(`/api/expenses?${p}`, { cache: 'no-store' })
      .then(async r => { if (r.status === 403 || r.status === 404) { setHidden(true); return null; } return r.json(); })
      .then(d => { if (!d) return; if (d.error) setFailed(String(d.error)); else setData(d); })
      .catch(e => setFailed(String(e)));
  }, [tf, dateFrom, dateTo]);

  if (hidden) return null;
  if (failed) return <Card className="mb-4"><p className="text-xs text-gray-400">Marketing expenses sheet unavailable: {failed}</p></Card>;
  if (!data || netSales <= 0) return null;
  const r = data.range;
  const other = r.nonAdMarketing;
  const totalMarketing = adSpend + other;
  const cogs = cogsPct != null ? netSales * (cogsPct / 100) : null;
  const contribution = cogs != null ? netSales - cogs - totalMarketing : null;
  const margin = contribution != null && netSales > 0 ? (contribution / netSales) * 100 : null;
  const merAds = adSpend > 0 ? netSales / adSpend : null;
  const merAll = totalMarketing > 0 ? netSales / totalMarketing : null;
  const cacAds = newCustomers > 0 && adSpend > 0 ? adSpend / newCustomers : null;
  const cacAll = newCustomers > 0 && totalMarketing > 0 ? totalMarketing / newCustomers : null;
  const budgetPct = r.budget > 0 ? (totalMarketing / r.budget) * 100 : null;
  const sheetVsLive = r.sheetAdSpend > 0 && adSpend > 0 ? ((adSpend - r.sheetAdSpend) / r.sheetAdSpend) * 100 : null;
  const monthsLabel = r.monthsCovered.map(m => `${m.month}${m.days < m.daysInMonth ? ` (${m.days}/${m.daysInMonth} days)` : ''}`).join(', ');
  const $ = (v: number) => formatCurrency(v);
  const Row = ({ label, value, sub, strong, neg }: { label: string; value: string; sub?: string; strong?: boolean; neg?: boolean }) => (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-gray-100 pt-2 mt-1' : ''}`}>
      <div className="min-w-0"><span className={`text-sm ${strong ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</span>{sub && <span className="block text-[11px] text-gray-400">{sub}</span>}</div>
      <span className={`text-sm tabular-nums shrink-0 ${strong ? 'font-bold' : ''} ${neg ? 'text-gray-500' : strong ? (contribution != null && contribution >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-800'}`}>{value}</span>
    </div>
  );
  return (
    <Card accentColor="#a5b4fc" className="mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-gray-800">💼 True Profit After All Marketing</h3>
        <p className="text-[11px] text-gray-400">Ad spend live from the platforms · other marketing from the budgeting sheet · {monthsLabel}{r.includesPlan ? ' · current/future months are plan figures until actuals are entered' : ''}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Row label="Net sales" value={$(netSales)} />
          {cogs != null && <Row label={`Cost of goods (${cogsPct}%)`} value={`− ${$(cogs)}`} neg />}
          <Row label="Ad spend (live)" value={`− ${$(adSpend)}`} neg sub={sheetVsLive != null ? `sheet has ${$(r.sheetAdSpend)} for ads · live is ${sheetVsLive >= 0 ? '+' : '−'}${Math.abs(sheetVsLive).toFixed(0)}%` : undefined} />
          <div>
            <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left">
              <Row label={`Other marketing ${open ? '▾' : '▸'}`} value={`− ${$(other)}`} neg sub="agency, influencer/PR, tools, email/SMS, content, photoshoots, SEO — from the sheet, prorated by day" />
            </button>
            {open && (
              <ul className="mt-1 ml-3 pl-3 border-l border-gray-100 space-y-0.5">
                {r.lines.filter(l => !l.adPlatform).sort((a, b) => b.amount - a.amount).map(l => (
                  <li key={l.label} className="flex justify-between text-xs text-gray-500"><span>{l.label} <span className="text-gray-300">· {l.section}</span></span><span className="tabular-nums">{$(l.amount)}</span></li>
                ))}
              </ul>
            )}
          </div>
          {contribution != null
            ? <Row label="Net contribution after all marketing" value={`${$(contribution)}${margin != null ? ` · ${margin.toFixed(1)}%` : ''}`} strong sub="before rent, payroll outside marketing, and other overhead" />
            : <Row label="Net contribution" value="needs a gross margin on file" strong />}
        </div>
        <div className="grid grid-cols-2 gap-3 content-start">
          <Tile label="Fully loaded MER" value={merAll != null ? `${merAll.toFixed(2)}x` : '—'} sub={merAds != null ? `${merAds.toFixed(2)}x on ad spend alone` : 'net sales ÷ all marketing'} />
          <Tile label="Fully loaded CAC" value={cacAll != null ? $(cacAll) : '—'} sub={cacAds != null ? `${$(cacAds)} on ad spend alone · ${newCustomers.toLocaleString()} new customers` : 'all marketing ÷ new customers'} />
          <Tile label="Total marketing" value={$(totalMarketing)} sub={`${((totalMarketing / Math.max(netSales, 1)) * 100).toFixed(1)}% of net sales`} />
          <Tile label="Vs budget" value={budgetPct != null ? `${budgetPct.toFixed(0)}%` : '—'} sub={r.budget > 0 ? `${$(r.budget)} budgeted for these days` : 'no monthly budget row'} tone={budgetPct == null ? undefined : budgetPct > 105 ? 'bad' : budgetPct < 90 ? 'good' : undefined} />
        </div>
      </div>
    </Card>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === 'good' ? 'text-green-600' : tone === 'bad' ? 'text-red-500' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
