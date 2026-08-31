'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { buildCallouts } from '@/src/lib/callouts';
import { cachedJson } from '@/src/lib/clientCache';
import type { MarketingEvent } from '@/src/app/api/calendar/route';
import { Timeframe, PlatformSpend, DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import MetricCard from '@/src/components/ui/MetricCard';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import RevenueChart from '@/src/components/charts/RevenueChart';
import CACChart from '@/src/components/charts/CACChart';
import SpendDonut from '@/src/components/charts/SpendDonut';

// MER runs on NET sales (post-discount/returns, excl. taxes+shipping); the
// goal stays 3.5x on that basis — Angie's call, a deliberately higher bar.
const MER_GOAL = 3.5;
const TARGET_CAC = 100; // target New Customer CAC — flagged when exceeded

const EMPTY_METRICS: LiveMetrics = {
  totalRevenue: 0,
  totalOrders: 0,
  totalAdSpend: 0,
  aov: 0,
  mer: 0,
  returns: 0,
};

interface LiveMetrics {
  totalRevenue: number;
  netSales?: number;
  totalOrders: number;
  totalAdSpend: number;
  aov: number;
  mer: number;
  returns: number;
  metaSpend?: number;
  googleSpend?: number;
  tiktokSpend?: number;
  metaRevenue?: number;
  googleRevenue?: number;
  tiktokRevenue?: number;
  snapchatSpend?: number;
  snapchatRevenue?: number;
  adCreditApplied?: number;
  netAdSpend?: number;
  newCustomers?: number;
  returningCustomers?: number;
  newCustomerRevenue?: number;
  returningCustomerRevenue?: number;
  pctNew?: number;
  pctReturning?: number;
  conversionRate?: number;
}

interface PriorPeriod {
  totalRevenue: number;
  totalAdSpend: number;
  totalOrders: number;
  aov: number;
  mer: number;
  metaSpend: number;
  googleSpend: number;
}

export default function OverviewContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const isCustom = tfRaw === 'custom';
  const tf = (isCustom ? '30d' : tfRaw) as Timeframe;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';

  const [metrics, setMetrics] = useState<LiveMetrics>(EMPTY_METRICS);
  const [revenueData, setRevenueData] = useState<DailyRevenue[]>([]);
  const [priorPeriod, setPriorPeriod] = useState<PriorPeriod | null>(null);
  const [priorLabel, setPriorLabel] = useState<string>('');
  const [livePlatformSpend, setLivePlatformSpend] = useState<PlatformSpend[] | null>(null);
  const [liveSource, setLiveSource] = useState<string>('loading');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [dataLag, setDataLag] = useState<boolean>(false);
  const [latestAvailableDate, setLatestAvailableDate] = useState<string | null>(null);
  const [shopifyDataLag, setShopifyDataLag] = useState<boolean>(false);
  const [shopifyLatestDate, setShopifyLatestDate] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invSnapshot, setInvSnapshot] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [returnsSnapshot, setReturnsSnapshot] = useState<any | null>(null);
  const [revenueSource, setRevenueSource] = useState<'shopify' | 'none' | null>(null);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [shopifyLiveError, setShopifyLiveError] = useState<string | null>(null);
  const [health, setHealth] = useState<null | {
    allOk: boolean;
    platforms: Array<{ platform: string; dashboardSpend: number; referenceSpend: number | null; referenceSource: string; diff: number | null; diffPct: number | null; status: string }>;
  }>(null);

  // ── Personal task reminder: each person's own open tasks, front and
  //    center when they log in ──
  const { data: session } = useSession();
  const [allTasks, setAllTasks] = useState<{ title: string; status: string; assignee?: string; dueDate?: string; priority: string }[]>([]);
  useEffect(() => {
    fetch('/api/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.tasks)) setAllTasks(d.tasks); })
      .catch(() => {});
  }, []);

  const myTasks = useMemo(() => {
    const user = session?.user;
    if (!user) return [];
    // Assignees are casual first names ("Angie") while logins are emails —
    // match on the first 3 letters of the first token of each identity so
    // "Angie" still finds "Angely" / "angie@…".
    const idents = [user.name || '', (user.email || '').split('@')[0]]
      .map(s => s.trim().toLowerCase().split(/[\s._-]+/)[0])
      .filter(s => s.length >= 3)
      .map(s => s.slice(0, 3));
    if (!idents.length) return [];
    const open = allTasks.filter(t => t.status !== 'done' && t.assignee);
    return open.filter(t => {
      const a = t.assignee!.trim().toLowerCase().split(/[\s._-]+/)[0].slice(0, 3);
      return a.length >= 3 && idents.includes(a);
    });
  }, [allTasks, session]);

  const myOverdue = myTasks.filter(t => t.dueDate && t.dueDate < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
  const todayPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const myDueToday = myTasks.filter(t => t.dueDate === todayPst);

  // Profitability data (admin-only; 403 for others hides the card): QB
  // actuals for booked months in the range, plus cost rates for estimating
  // only the unbooked remainder.
  const [profitBasis, setProfitBasis] = useState<null | {
    cogsPct: number | null; nonAdOpexPct: number | null; basisMonths: string[];
    actual: { net: number; revenue: number; adSpend: number; months: string[] };
    unbookedPastMonths?: Array<{ month: string; qbIncome: number; shopifySales: number }>;
  }>(null);
  useEffect(() => {
    setProfitBasis(null);
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    // Basis endpoint wants explicit dates; derive the same range the metrics use.
    fetch(`/api/financials/basis?${params}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && d.actual) setProfitBasis(d); })
      .catch(() => {});
  }, [tfRaw, dateFrom, dateTo]);

  const [calEvents, setCalEvents] = useState<MarketingEvent[]>([]);
  useEffect(() => {
    fetch('/api/calendar').then(r => r.json()).then(d => { if (Array.isArray(d?.events)) setCalEvents(d.events); }).catch(() => {});
  }, []);

  // "This week's marketing" — campaigns live right now, plus what launches in
  // the next 7 days. Pulled from the Marketing Calendar.
  const marketingThisWeek = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const to = in7.toISOString().split('T')[0];
    const live = calEvents.filter(e => e.date <= today && (e.endDate || e.date) >= today);
    const upcoming = calEvents.filter(e => e.date > today && e.date <= to);
    const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
    return {
      live: [...live].sort((a, b) => a.date.localeCompare(b.date)),
      upcoming: [...upcoming].sort((a, b) => a.date.localeCompare(b.date)),
      daysUntil,
    };
  }, [calEvents]);

  // Ad-data health check (reconciliation) — runs on mount so the Overview flags
  // when a platform's spend is stale/behind (a broken/deactivated connector or a
  // sync still catching up) instead of silently showing low numbers.
  useEffect(() => {
    fetch('/api/windsor/reconcile?days=7')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.platforms)) setHealth(d); })
      .catch(() => {});
  }, []);

  function buildLivePlatformSpend(m: LiveMetrics): PlatformSpend[] | null {
    if (!m.metaSpend && !m.googleSpend && !m.tiktokSpend) return null;
    const platforms: PlatformSpend[] = [];
    const push = (platform: string, spend: number, revenue: number, color: string) => {
      if (spend <= 0) return;
      // CAC = spend ÷ attributed purchases, with purchases estimated from the
      // platform's attributed revenue at the store's blended AOV (= AOV ÷ ROAS).
      const estOrders = m.aov > 0 ? revenue / m.aov : 0;
      platforms.push({
        platform,
        spend,
        revenue,
        roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
        ctr: 0,
        impressions: 0,
        cac: estOrders > 0 ? Math.round(spend / estOrders) : null,
        color,
      });
    };
    push('Meta', m.metaSpend ?? 0, m.metaRevenue ?? 0, '#818cf8');
    push('Google', m.googleSpend ?? 0, m.googleRevenue ?? 0, '#34d399');
    push('TikTok', m.tiktokSpend ?? 0, m.tiktokRevenue ?? 0, '#f472b6');
    push('Snapchat', m.snapchatSpend ?? 0, m.snapchatRevenue ?? 0, '#facc15');
    return platforms.length > 0 ? platforms : null;
  }

  useEffect(() => {
    setMetrics(EMPTY_METRICS);
    setRevenueData([]);
    setPriorPeriod(null);
    setLivePlatformSpend(null);
    setDataLag(false);
    setLatestAvailableDate(null);
    setShopifyDataLag(false);
    setShopifyLatestDate(null);
    setRevenueSource(null);
    setAdsError(null);
    setLiveSource('loading');

    setPriorPeriod(null);

    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    // Prior-period metrics are always fetched — the revenue card shows its
    // vs-prior delta permanently; the other cards only show theirs when the
    // Compare toggle is on.
    params.set('compare', 'true');

    // Cached copies (from earlier visits this session) render instantly and
    // are refreshed in the background — switching tabs doesn't restart loads.
    cachedJson<Record<string, unknown> & { source?: string }>(
      `/api/windsor?${params}`,
      data => {
        const source = data.source || 'unknown';
        if (source !== 'windsor_live' && source !== 'bigquery_live') {
          setMetrics(EMPTY_METRICS);
          setRevenueData([]);
          setLivePlatformSpend(null);
          setLiveSource('error');
          setLastUpdated(new Date().toLocaleTimeString());
          return;
        }
        const m: LiveMetrics = { ...{ returns: 0 }, ...(data.metrics as LiveMetrics) };
        setMetrics(m);
        setRevenueData((data.revenueData as typeof revenueData) || []);
        if (data.priorPeriod) { setPriorPeriod(data.priorPeriod as typeof priorPeriod); setPriorLabel((data.priorLabel as string) || ''); }
        setLivePlatformSpend(buildLivePlatformSpend(m));
        setAdsError((data.adsError as string) || null);
        setDataLag(!!data.dataLag);
        setLatestAvailableDate((data.latestAvailableDate as string) || null);
        setShopifyDataLag(!!data.shopifyDataLag);
        setShopifyLatestDate((data.shopifyLatestDate as string) || null);
        setRevenueSource((data.revenueSource as 'shopify' | 'none') || null);
        setShopifyLiveError((data.shopifyLiveError as string) || null);
        setLiveSource(source as typeof liveSource);
        setLastUpdated(new Date().toLocaleTimeString());
      },
      () => {
        setMetrics(EMPTY_METRICS);
        setRevenueData([]);
        setLivePlatformSpend(null);
        setDataLag(false);
        setLiveSource('error');
        setLastUpdated(new Date().toLocaleTimeString());
      }
    );
  }, [tfRaw, dateFrom, dateTo, compareOn]);

  // Inventory (current stock — same regardless of timeframe) and returns (for
  // the selected period) power the login briefing. Fetched separately so they
  // never delay the main metric cards.
  useEffect(() => {
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    fetch('/api/windsor/inventory').then(r => r.json()).then(setInvSnapshot).catch(() => setInvSnapshot(null));
    fetch(`/api/windsor/returns?${p}`).then(r => r.json()).then(setReturnsSnapshot).catch(() => setReturnsSnapshot(null));
  }, [tfRaw, dateFrom, dateTo]);

  // ── Month-end forecast (MTD pace, independent of the selected timeframe) ──
  const [mtdSnap, setMtdSnap] = useState<{ revenue: number; adSpend: number } | null>(null);
  const [lastMonthSnap, setLastMonthSnap] = useState<{ revenue: number; adSpend: number } | null>(null);

  useEffect(() => {
    // Forecast pace must come from COMPLETE days only — MTD now includes
    // today's partial data (matching Shopify), so fetch 1st→yesterday
    // explicitly for the projection.
    const [ty, tm, td] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).split('-').map(Number);
    if (td > 1) {
      const first = `${ty}-${String(tm).padStart(2, '0')}-01`;
      const yest = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
      cachedJson<{ source?: string; metrics?: { totalRevenue?: number; totalAdSpend?: number } }>(
        `/api/windsor?tf=custom&date_from=${first}&date_to=${yest}`,
        d => {
          if ((d.source === 'windsor_live' || d.source === 'bigquery_live') && d.metrics) {
            setMtdSnap({ revenue: d.metrics.totalRevenue ?? 0, adSpend: d.metrics.totalAdSpend ?? 0 });
          }
        }
      );
    }
    cachedJson<{ source?: string; metrics?: { totalRevenue?: number; totalAdSpend?: number } }>(
      '/api/windsor?tf=last_month',
      d => {
        if ((d.source === 'windsor_live' || d.source === 'bigquery_live') && d.metrics) {
          setLastMonthSnap({ revenue: d.metrics.totalRevenue ?? 0, adSpend: d.metrics.totalAdSpend ?? 0 });
        }
      }
    );
  }, []);

  const forecast = useMemo(() => {
    if (!mtdSnap) return null;
    // Store-time (PST) date math: MTD covers the 1st through yesterday.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const [y, m, d] = todayStr.split('-').map(Number);
    const daysElapsed = d - 1; // complete days so far
    if (daysElapsed < 1) return null; // nothing complete yet (the 1st)
    const daysInMonth = new Date(y, m, 0).getDate();
    const revPace = mtdSnap.revenue / daysElapsed;
    const spendPace = mtdSnap.adSpend / daysElapsed;
    const revF = revPace * daysInMonth;
    const spendF = spendPace * daysInMonth;
    return {
      daysElapsed,
      daysInMonth,
      revPace,
      revF,
      spendF,
      merF: spendF > 0 ? revF / spendF : 0,
      monthName: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' }),
    };
  }, [mtdSnap]);

  const callouts = useMemo(() => buildCallouts({
    metrics,
    prior: compareOn ? priorPeriod : null,
    inventory: invSnapshot && invSnapshot.source === 'shopify_live' ? invSnapshot : null,
    returns: returnsSnapshot && returnsSnapshot.source === 'shopify_live' ? returnsSnapshot : null,
    merGoal: MER_GOAL,
    targetCac: TARGET_CAC,
    comparing: compareOn,
  }), [metrics, priorPeriod, invSnapshot, returnsSnapshot, compareOn]);

  const merColor = metrics.mer >= MER_GOAL ? '#22c55e' : '#ef4444';
  const merLabel = metrics.mer >= MER_GOAL ? '✓ Above Goal' : '✗ Below Goal';
  const isLive = liveSource === 'windsor_live' || liveSource === 'bigquery_live';

  return (
    <div>
      <Header
        title="MER Dashboard"
        subtitle={isCustom && dateFrom && dateTo
          ? `Overview · ${dateFrom} → ${dateTo}${compareOn && priorLabel ? ` vs ${priorLabel}` : ''}`
          : `Overview · ${TIMEFRAME_LABELS[tf] || tf}${compareOn && priorLabel ? ` vs prior period` : ''}`}
      >
        <TimeframeSelector />
      </Header>

      {/* ── Loud personal task reminder ── */}
      {myTasks.length > 0 && (
        <Link
          href="/dashboard/tasks"
          className={`block rounded-2xl border-2 px-4 py-3 mb-4 shadow-sm transition-transform active:scale-[0.99] ${
            myOverdue.length ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${myOverdue.length ? 'bg-red-500' : 'bg-amber-500'}`} />
            <p className={`text-sm font-bold ${myOverdue.length ? 'text-red-700' : 'text-amber-700'}`}>
              {myOverdue.length
                ? `🔔 You have ${myOverdue.length} OVERDUE task${myOverdue.length > 1 ? 's' : ''}${myDueToday.length ? ` + ${myDueToday.length} due today` : ''}`
                : myDueToday.length
                ? `🔔 You have ${myDueToday.length} task${myDueToday.length > 1 ? 's' : ''} due TODAY`
                : `🔔 You have ${myTasks.length} open task${myTasks.length > 1 ? 's' : ''} on the board`}
            </p>
            <span className={`ml-auto text-xs font-semibold ${myOverdue.length ? 'text-red-600' : 'text-amber-600'}`}>Open board →</span>
          </div>
          <ul className="mt-1.5 space-y-0.5 pl-4">
            {[...myOverdue, ...myDueToday, ...myTasks.filter(t => !myOverdue.includes(t) && !myDueToday.includes(t))].slice(0, 4).map((t, i) => (
              <li key={i} className="text-xs text-gray-600 list-disc">
                {t.title}
                {t.dueDate && <span className={t.dueDate < todayPst ? 'text-red-600 font-semibold' : 'text-gray-400'}> · due {t.dueDate.slice(5)}</span>}
              </li>
            ))}
            {myTasks.length > 4 && <li className="text-xs text-gray-400 list-disc">+{myTasks.length - 4} more…</li>}
          </ul>
        </Link>
      )}

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400' : liveSource === 'loading' ? 'bg-yellow-400' : 'bg-red-400'}`}
        />
        <span className="text-xs text-gray-400">
          {liveSource === 'loading'
            ? 'Loading Windsor data...'
            : isLive
            ? `Live · Windsor.ai · Updated ${lastUpdated}`
            : `Data unavailable · ${lastUpdated}`}
        </span>
        <button
          onClick={() => {
            setLiveSource('loading');
            const p = new URLSearchParams({ tf: tfRaw });
            if (dateFrom) p.set('date_from', dateFrom);
            if (dateTo) p.set('date_to', dateTo);
            p.set('compare', 'true');
            fetch(`/api/windsor?${p}`)
              .then(r => r.json())
              .then(data => {
                const source = data.source || 'unknown';
                if (source !== 'windsor_live' && source !== 'bigquery_live') {
                  setMetrics(EMPTY_METRICS);
                  setRevenueData([]);
                  setLivePlatformSpend(null);
                  setLiveSource('error');
                  setLastUpdated(new Date().toLocaleTimeString());
                  return;
                }
                const m: LiveMetrics = { returns: 0, ...data.metrics };
                setMetrics(m);
                setRevenueData(data.revenueData || []);
                if (data.priorPeriod) { setPriorPeriod(data.priorPeriod); setPriorLabel(data.priorLabel || ''); }
                setLivePlatformSpend(buildLivePlatformSpend(m));
                setRevenueSource(data.revenueSource || null);
                setLiveSource(source);
                setLastUpdated(new Date().toLocaleTimeString());
              })
              .catch(() => {
                setMetrics(EMPTY_METRICS);
                setRevenueData([]);
                setLivePlatformSpend(null);
                setLiveSource('error');
                setLastUpdated(new Date().toLocaleTimeString());
              });
          }}
          className="text-xs text-purple-500 hover:text-purple-700 font-medium ml-1"
        >
          ↻ Refresh
        </button>
      </div>

      {liveSource === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Overview data is unavailable — BigQuery query failed or hasn&apos;t synced yet.</span>
        </div>
      )}

      {/* Data lag notice */}
      {dataLag && latestAvailableDate && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠️</span>
          <span>
            Windsor hasn&apos;t synced {tf === 'today' ? "today's" : "yesterday's"} data yet — showing most recent available:{' '}
            <strong>{latestAvailableDate}</strong>. Windsor typically syncs ad platform data within 24–48 hours.
          </span>
        </div>
      )}

      {shopifyDataLag && shopifyLatestDate && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠️</span>
          <span>
            Shopify data hasn&apos;t synced for {tf === 'today' ? "today" : "yesterday"} yet — showing revenue/orders from the most recent available day:{' '}
            <strong>{shopifyLatestDate}</strong>. Ad spend above reflects the actual selected period.
          </span>
        </div>
      )}

      {adsError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠</span>
          <span>Ad spend data unavailable — BigQuery query failed. Revenue and order data are unaffected. Check the API logs for details.</span>
        </div>
      )}

      {/* Ad-data health: flags a platform whose dashboard (BigQuery) spend is
          behind its source — a stale/deactivated connector or a sync still
          backfilling. Self-clears once syncing catches up. */}
      {health && !health.allOk && health.platforms.some(p => p.status === 'warn') && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-800">
          <p className="font-semibold mb-0.5">⚠️ Ad-spend data may be catching up</p>
          {health.platforms.filter(p => p.status === 'warn').map(p => (
            <p key={p.platform} className="text-amber-700">
              {p.platform}: dashboard {formatCurrency(p.dashboardSpend)} vs {p.referenceSource} {formatCurrency(p.referenceSpend ?? 0)}
              {p.diffPct !== null && <> ({p.diffPct}%)</>} — clears automatically once syncing catches up.
            </p>
          ))}
        </div>
      )}

      {revenueSource === 'none' && isLive && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-blue-700">
          <span>ℹ️</span>
          <span>
            Shopify hasn&apos;t synced revenue for this period yet — revenue and orders will show as 0 until Shopify syncs. Platform-attributed revenue is shown in the platform table below.
            {shopifyLiveError && <> Shopify&apos;s live query also failed: {shopifyLiveError} — tap Refresh to retry.</>}
          </span>
        </div>
      )}

      {/* MER Hero */}
      <div className="mb-6">
        <Card accentColor="#c4b5fd" className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              MER — Marketing Efficiency Ratio
            </p>
            <div className="flex items-end gap-3">
              <span
                className="text-6xl font-black"
                style={{ color: merColor }}
              >
                {formatROAS(metrics.mer)}
              </span>
              <div className="pb-2">
                <span
                  className="text-sm font-bold px-2 py-1 rounded-lg"
                  style={{
                    backgroundColor: metrics.mer >= MER_GOAL ? '#dcfce7' : '#fee2e2',
                    color: merColor,
                  }}
                >
                  {merLabel}
                </span>
                <p className="text-xs text-gray-400 mt-1">Goal: {MER_GOAL}x</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              Net Sales ÷ {metrics.adCreditApplied ? 'Net Ad Spend' : 'Total Ad Spend'} ={' '}
              <span className="font-semibold text-gray-600">
                {formatCurrency(metrics.netSales ?? metrics.totalRevenue)} ÷ {formatCurrency(metrics.adCreditApplied ? (metrics.netAdSpend ?? metrics.totalAdSpend) : metrics.totalAdSpend)}
              </span>
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Net sales = after discounts &amp; returns, excl. taxes/shipping (total sales {formatCurrency(metrics.totalRevenue)})
            </p>
            {(metrics.adCreditApplied ?? 0) > 0 && (
              <p className="text-[11px] text-emerald-600 mt-0.5">
                🎁 {formatCurrency(metrics.adCreditApplied!)} Snapchat ad credit deducted (gross spend {formatCurrency(metrics.totalAdSpend)})
              </p>
            )}
          </div>
          <div className="hidden sm:block w-px h-20 bg-gray-100" />
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-4 sm:gap-8">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Revenue</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Ad Spend</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalAdSpend)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Orders</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{metrics.totalOrders.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">AOV</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.aov)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Net profit — admin-only (basis endpoint 403s for others). Booked
          months show QuickBooks ACTUALS; only the unbooked remainder is
          estimated at the booked months' cost rates. */}
      {profitBasis && metrics.totalRevenue > 0 && (() => {
        const rev = metrics.totalRevenue;
        const adSpend = metrics.netAdSpend ?? metrics.totalAdSpend;
        const a = profitBasis.actual;
        const remRev = Math.max(0, rev - a.revenue);
        const remAd = Math.max(0, adSpend - a.adSpend);
        const canEstimate = profitBasis.cogsPct !== null && profitBasis.nonAdOpexPct !== null;
        const remNet = canEstimate
          ? remRev - remRev * ((profitBasis.cogsPct! + profitBasis.nonAdOpexPct!) / 100) - remAd
          : 0;
        const hasActual = a.months.length > 0 && a.revenue > 0;
        const hasRemainder = remRev > rev * 0.01;
        if (!hasActual && !canEstimate) return null;
        const total = (hasActual ? a.net : 0) + (hasRemainder && canEstimate ? remNet : 0);
        const margin = (total / rev) * 100;
        const title = hasActual && !hasRemainder ? '💰 Net Profit (actual)'
          : hasActual ? '💰 Net Profit (actual + est.)'
          : '💰 Est. Net Profit';
        return (
          <Card accentColor="#6ee7b7" className="mb-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">{title}</p>
                <p className="text-2xl font-bold" style={{ color: total >= 0 ? '#16a34a' : '#dc2626' }}>
                  {formatCurrency(total)}
                  <span className="text-sm font-semibold text-gray-400 ml-2">{margin.toFixed(1)}% margin</span>
                </p>
              </div>
              <div className="text-xs text-gray-500 leading-relaxed">
                {hasActual && <>Booked ({a.months.join(', ')}): {formatCurrency(a.net)} actual from QuickBooks</>}
                {hasActual && hasRemainder && <br />}
                {hasRemainder && canEstimate && (
                  <>Unbooked remainder: est. {formatCurrency(remNet)} — {formatCurrency(remRev)} revenue − COGS {profitBasis.cogsPct}% − overhead {profitBasis.nonAdOpexPct}% − {formatCurrency(remAd)} ad spend (rates from {profitBasis.basisMonths.join(', ')})</>
                )}
                {(profitBasis.unbookedPastMonths?.length ?? 0) > 0 && (
                  <>
                    <br />
                    <span className="text-amber-600">
                      ⏳ {profitBasis.unbookedPastMonths!.map(u => `${u.month}: QuickBooks has ${formatCurrency(u.qbIncome)} of ${formatCurrency(u.shopifySales)} booked`).join(' · ')} — actuals replace the estimate automatically once bookkeeping is done
                    </span>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Shopify Total Sales"
          value={formatCurrency(metrics.totalRevenue)}
          subtitle={`${metrics.totalOrders} orders`}
          accentColor="#c4b5fd"
          comparison={
            // No intraday delta on the Today view — a partial day has no
            // trustworthy baseline (the hourly analytics table lags live
            // sales). Complete periods compare like-for-like.
            tfRaw === 'today'
              ? undefined
              : priorPeriod
              ? {
                  current: metrics.totalRevenue,
                  prior: priorPeriod.totalRevenue,
                  label: tfRaw === 'yesterday' ? 'vs day before' : undefined,
                }
              : undefined
          }
        />
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(metrics.totalAdSpend)}
          subtitle={metrics.metaSpend ? `Meta ${formatCurrency(metrics.metaSpend)} · Google ${formatCurrency(metrics.googleSpend ?? 0)}${metrics.tiktokSpend ? ` · TikTok ${formatCurrency(metrics.tiktokSpend)}` : ''}${metrics.snapchatSpend ? ` · Snap ${formatCurrency(metrics.snapchatSpend)}` : ''}` : 'All ad platforms'}
          accentColor="#f9a8d4"
          comparison={compareOn && priorPeriod ? { current: metrics.totalAdSpend, prior: priorPeriod.totalAdSpend } : undefined}
        />
        <MetricCard
          title="Avg Order Value"
          value={formatCurrency(metrics.aov)}
          subtitle="Per transaction"
          accentColor="#fde68a"
          comparison={compareOn && priorPeriod ? { current: metrics.aov, prior: priorPeriod.aov } : undefined}
        />
        <MetricCard
          title="Blended MER"
          value={formatROAS(metrics.mer)}
          subtitle="Across all platforms"
          accentColor={metrics.mer >= MER_GOAL ? '#86efac' : '#fca5a5'}
          valueColor={merColor}
          comparison={compareOn && priorPeriod ? { current: metrics.mer, prior: priorPeriod.mer } : undefined}
          trend={!(compareOn && priorPeriod) ? {
            value: metrics.mer >= MER_GOAL ? `Above ${MER_GOAL}x goal` : `Below ${MER_GOAL}x goal`,
            positive: metrics.mer >= MER_GOAL,
          } : undefined}
        />
      </div>

      {/* New vs Returning Customer Cards — hidden on Today: the customer
          match hasn't settled mid-day and would misreport the split */}
      {metrics.newCustomers !== undefined && metrics.newCustomers > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {tfRaw !== 'today' && (
            <>
              <MetricCard
                title="New Customers"
                value={String(metrics.newCustomers)}
                subtitle={`${metrics.pctNew?.toFixed(1) ?? 0}% of customers`}
                accentColor="#a5f3fc"
                trend={metrics.newCustomerRevenue ? { value: formatCurrency(metrics.newCustomerRevenue) + ' revenue', positive: true } : undefined}
              />
              <MetricCard
                title="Returning Customers"
                value={String(metrics.returningCustomers ?? 0)}
                subtitle={`${metrics.pctReturning?.toFixed(1) ?? 0}% of customers`}
                accentColor="#bbf7d0"
                trend={metrics.returningCustomerRevenue ? { value: formatCurrency(metrics.returningCustomerRevenue) + ' revenue', positive: true } : undefined}
              />
              <MetricCard
                title="New Customer CAC"
                value={metrics.newCustomers ? formatCurrency(metrics.totalAdSpend / metrics.newCustomers) : '—'}
                subtitle={`Ad spend ÷ new customers · target $${TARGET_CAC}`}
                accentColor="#c7d2fe"
                valueColor={metrics.newCustomers
                  ? (metrics.totalAdSpend / metrics.newCustomers > TARGET_CAC ? '#ef4444' : '#22c55e')
                  : undefined}
              />
              <MetricCard
                title="Blended CAC"
                value={(metrics.newCustomers ?? 0) + (metrics.returningCustomers ?? 0) > 0
                  ? formatCurrency(metrics.totalAdSpend / ((metrics.newCustomers ?? 0) + (metrics.returningCustomers ?? 0)))
                  : '—'}
                subtitle="Ad spend ÷ all buyers"
                accentColor="#bbf7d0"
              />
            </>
          )}
          <MetricCard
            title="Meta Spend"
            value={formatCurrency(metrics.metaSpend ?? 0)}
            subtitle={`${metrics.metaSpend && metrics.totalAdSpend ? ((metrics.metaSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
            accentColor="#c7d2fe"
          />
          <MetricCard
            title="Google Spend"
            value={formatCurrency(metrics.googleSpend ?? 0)}
            subtitle={`${metrics.googleSpend && metrics.totalAdSpend ? ((metrics.googleSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
            accentColor="#fef08a"
          />
          <MetricCard
            title="TikTok Spend"
            value={formatCurrency(metrics.tiktokSpend ?? 0)}
            subtitle={`${metrics.tiktokSpend && metrics.totalAdSpend ? ((metrics.tiktokSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
            accentColor="#fbcfe8"
          />
          {(metrics.snapchatSpend ?? 0) > 0 && (
            <MetricCard
              title="Snapchat Spend"
              value={formatCurrency(metrics.snapchatSpend ?? 0)}
              subtitle={`${metrics.snapchatSpend && metrics.totalAdSpend ? ((metrics.snapchatSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
              accentColor="#fde047"
            />
          )}
          <MetricCard
            title="Website Conversion Rate"
            value={metrics.conversionRate ? `${metrics.conversionRate.toFixed(1)}%` : '—'}
            subtitle="Sessions that checked out"
            accentColor="#a7f3d0"
          />
        </div>
      )}

      {/* ── Month-end forecast (MTD pace) ── */}
      {isLive && forecast && (
        <Card accentColor="#93c5fd" className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">📈</span>
            <div>
              <h2 className="text-sm font-bold text-gray-700">{forecast.monthName} Forecast</h2>
              <p className="text-xs text-gray-400">
                Projected month-end at your current pace — {formatCurrency(forecast.revPace)}/day through {forecast.daysElapsed} of {forecast.daysInMonth} days (today excluded)
                {forecast.daysElapsed < 4 && <span className="text-amber-600 font-semibold"> · early in the month, low confidence</span>}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              {
                label: 'Projected Revenue',
                value: formatCurrency(forecast.revF),
                prior: lastMonthSnap?.revenue,
                higherIsGood: true,
              },
              {
                label: 'Projected Ad Spend',
                value: formatCurrency(forecast.spendF),
                prior: lastMonthSnap?.adSpend,
                higherIsGood: false,
              },
              {
                label: 'Projected MER',
                value: forecast.merF ? `${forecast.merF.toFixed(2)}x` : '—',
                prior: lastMonthSnap && lastMonthSnap.adSpend > 0 ? lastMonthSnap.revenue / lastMonthSnap.adSpend : undefined,
                higherIsGood: true,
                isRatio: true,
              },
            ] as { label: string; value: string; prior?: number; higherIsGood: boolean; isRatio?: boolean }[]).map(s => {
              const current = s.isRatio ? forecast.merF : s.label === 'Projected Revenue' ? forecast.revF : forecast.spendF;
              const delta = s.prior && s.prior > 0 ? ((current - s.prior) / s.prior) * 100 : null;
              const good = delta !== null && (s.higherIsGood ? delta >= 0 : delta <= 0);
              return (
                <div key={s.label} className="bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-0.5">{s.value}</p>
                  {delta !== null && (
                    <p className={`text-xs font-semibold mt-0.5 ${good ? 'text-green-600' : 'text-red-500'}`}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(0)}% vs last month{s.isRatio ? `'s ${s.prior!.toFixed(2)}x` : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Simple pace projection: month-to-date ÷ days elapsed × days in month. Doesn&apos;t account for planned launches or seasonal swings — check the calendar for what&apos;s ahead.
          </p>
        </Card>
      )}

      {/* ── This week's marketing (from the Marketing Calendar) ── */}
      {isLive && (marketingThisWeek.live.length > 0 || marketingThisWeek.upcoming.length > 0) && (
        <Card accentColor="#8b5cf6" className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">📣</span>
            <h2 className="text-sm font-bold text-gray-700">This Week&apos;s Marketing</h2>
            <a href="/dashboard/calendar" className="ml-auto text-xs text-violet-500 hover:text-violet-700 font-medium">Open calendar →</a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Live now</p>
              {marketingThisWeek.live.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing running right now.</p>
              ) : (
                <ul className="space-y-2">
                  {marketingThisWeek.live.map(e => (
                    <li key={e.id} className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: e.color }} />
                      <div>
                        <p className="text-sm font-semibold text-gray-800 leading-tight">{e.title}</p>
                        <p className="text-xs text-gray-400">{e.type.replace('_', ' ')}{e.channel ? ` · ${e.channel}` : ''}{e.endDate && e.endDate !== e.date ? ' · ends ' + e.endDate.slice(5) : ''}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Launching next 7 days</p>
              {marketingThisWeek.upcoming.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing scheduled to launch.</p>
              ) : (
                <ul className="space-y-2">
                  {marketingThisWeek.upcoming.map(e => {
                    const d = marketingThisWeek.daysUntil(e.date);
                    return (
                      <li key={e.id} className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: e.color }} />
                        <div>
                          <p className="text-sm font-semibold text-gray-800 leading-tight">{e.title}</p>
                          <p className="text-xs text-gray-400">{d === 1 ? 'tomorrow' : `in ${d} days`}{e.channel ? ` · ${e.channel}` : ''}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Briefing: what's going well / what needs attention ── */}
      {isLive && (callouts.good.length > 0 || callouts.attention.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card accentColor="#86efac">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">✅</span>
              <h2 className="text-sm font-bold text-gray-700">What&apos;s going well</h2>
            </div>
            {callouts.good.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Nothing standout to highlight for this period.</p>
            ) : (
              <ul className="space-y-2.5">
                {callouts.good.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-400 mt-0.5 text-xs">●</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{c.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card accentColor="#fca5a5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">⚠️</span>
              <h2 className="text-sm font-bold text-gray-700">Needs attention</h2>
            </div>
            {callouts.attention.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No issues flagged — looking clean.</p>
            ) : (
              <ul className="space-y-2.5">
                {callouts.attention.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-red-400 mt-0.5 text-xs">●</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{c.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="lg:col-span-2 text-[11px] text-gray-400 -mt-1">
            Sales, ads, customers &amp; returns reflect {isCustom && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tf] || tf)}{compareOn ? ' (vs prior period)' : ''}. Inventory &amp; stock alerts are always current.
          </p>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {(tfRaw === 'today' || tfRaw === 'yesterday') ? (
          /* Single-day view: New vs Returning customer revenue breakdown */
          <Card accentColor="#c4b5fd" className="lg:col-span-2">
            <h2 className="text-sm font-bold text-gray-700 mb-1">Customer Revenue Breakdown</h2>
            <p className="text-xs text-gray-400 mb-5">New vs returning customers · {tfRaw === 'today' ? 'Today' : 'Yesterday'}</p>
            <div className="space-y-4">
              {/* New customers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400 shrink-0" />
                    <span className="text-sm font-semibold text-gray-700">New Customers</span>
                    <span className="text-xs text-gray-400">({metrics.newCustomers ?? 0})</span>
                  </div>
                  <span className="text-sm font-bold text-gray-800">{formatCurrency(metrics.newCustomerRevenue ?? 0)}</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-400"
                    style={{ width: metrics.totalRevenue > 0 ? `${Math.min(100, ((metrics.newCustomerRevenue ?? 0) / metrics.totalRevenue) * 100)}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {metrics.totalRevenue > 0 ? (((metrics.newCustomerRevenue ?? 0) / metrics.totalRevenue) * 100).toFixed(0) : 0}% of revenue · avg {metrics.newCustomers ? formatCurrency((metrics.newCustomerRevenue ?? 0) / metrics.newCustomers) : '—'}/order
                </p>
              </div>
              {/* Returning customers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-400 shrink-0" />
                    <span className="text-sm font-semibold text-gray-700">Returning Customers</span>
                    <span className="text-xs text-gray-400">({metrics.returningCustomers ?? 0})</span>
                  </div>
                  <span className="text-sm font-bold text-gray-800">{formatCurrency(metrics.returningCustomerRevenue ?? 0)}</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-pink-400"
                    style={{ width: metrics.totalRevenue > 0 ? `${Math.min(100, ((metrics.returningCustomerRevenue ?? 0) / metrics.totalRevenue) * 100)}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {metrics.totalRevenue > 0 ? (((metrics.returningCustomerRevenue ?? 0) / metrics.totalRevenue) * 100).toFixed(0) : 0}% of revenue · avg {metrics.returningCustomers ? formatCurrency((metrics.returningCustomerRevenue ?? 0) / metrics.returningCustomers) : '—'}/order
                </p>
              </div>
              {/* Totals row */}
              <div className="pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                <span>{(metrics.newCustomers ?? 0) + (metrics.returningCustomers ?? 0)} total customers</span>
                <span>{formatCurrency(metrics.totalRevenue)} total revenue</span>
              </div>
            </div>
          </Card>
        ) : (
          <Card accentColor="#c4b5fd" className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-700">Revenue & Ad Spend Trend</h2>
                <p className="text-xs text-gray-400">Purple = Revenue · Pink = Ad Spend</p>
              </div>
            </div>
            <RevenueChart data={revenueData} />
          </Card>
        )}

        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Ad Spend by Platform</h2>
          <p className="text-xs text-gray-400 mb-3">
            Total: {formatCurrency(metrics.totalAdSpend)}
          </p>
          <SpendDonut data={livePlatformSpend ?? []} />
        </Card>
      </div>

      {/* CAC over time — how acquisition cost moves with spend */}
      {tfRaw !== 'today' && tfRaw !== 'yesterday' && revenueData.some(d => (d.newCustomers ?? 0) > 0 || (d.totalCustomers ?? 0) > 0) && (
        <Card accentColor="#818cf8" className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-gray-700">Customer Acquisition Cost Trend</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Indigo = New CAC (spend ÷ new customers) · Green = Blended CAC (spend ÷ all buyers) · Red dashes = ${TARGET_CAC} target.
            {revenueData.length > 45 ? ' Long ranges roll up to monthly CAC so month-over-month movement is readable.' : ' Watch New CAC move as spend scales.'}
          </p>
          <CACChart data={revenueData} target={TARGET_CAC} />
        </Card>
      )}

      {/* Platform Performance Table */}
      <Card accentColor="#86efac">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Platform Performance Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Platform</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Spend</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Revenue</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">ROAS</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">CTR</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">CAC</th>
              </tr>
            </thead>
            <tbody>
              {(livePlatformSpend ?? []).map((p) => (
                <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold text-gray-700">{p.platform}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.spend)}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.revenue)}</td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className="font-bold"
                      style={{ color: p.roas >= MER_GOAL ? '#22c55e' : '#ef4444' }}
                    >
                      {formatROAS(p.roas)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatPercent(p.ctr)}</td>
                  <td className="py-3 pl-4 text-right font-semibold text-gray-700">
                    {p.cac ? formatCurrency(p.cac) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          CAC = spend ÷ attributed purchases (platform-attributed revenue at store AOV).
        </p>
      </Card>
    </div>
  );
}
