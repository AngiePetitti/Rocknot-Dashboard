'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCallouts } from '@/src/lib/callouts';
import { cachedJson, primeCache } from '@/src/lib/clientCache';
import type { MarketingEvent } from '@/src/app/api/calendar/route';
import { Timeframe, PlatformSpend, DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, TIMEFRAME_LABELS, isLiveOverviewSource } from '@/src/lib/utils';
import type { ReturnsSummary } from '@/src/lib/returns';
import Header from '@/src/components/Header';
import MetricCard from '@/src/components/ui/MetricCard';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import RevenueChart from '@/src/components/charts/RevenueChart';
import MonthlyHistory from '@/src/components/MonthlyHistory';
import { timeframeRange as tfRange } from '@/src/lib/timeframes';
import { effectiveGoals } from '@/src/lib/client';
import CACChart from '@/src/components/charts/CACChart';
import SpendDonut from '@/src/components/charts/SpendDonut';
import { useClient } from '@/src/components/ClientProvider';
import { PLATFORMS } from '@/src/lib/client';
import NcacBreakdown from '@/src/components/NcacBreakdown';
import MyTasksBanner from '@/src/components/MyTasksBanner';
import MarketingExpenses, { type ExpensesPayload } from '@/src/components/MarketingExpenses';

// MER runs on NET sales (post-discount/returns, excl. taxes+shipping); the
// goal is the client profile's targetMer on that basis (Rocknot: 3.5x —
// Angie's call, a deliberately higher bar).

const EMPTY_METRICS: LiveMetrics = {
  totalRevenue: 0,
  totalOrders: 0,
  totalAdSpend: 0,
  aov: 0,
  mer: 0,
  returns: 0,
};

interface LineRow {
  key: string; label: string; netSales: number; totalSales: number; orders: number; shareOfNet: number;
  spend: number; spendByPlatform: Record<string, number>; mer: number | null; cpa: number | null;
  targetCpa: number; revenueShare: number;
}

interface LiveMetrics {
  totalRevenue: number;
  netSales?: number;
  returnFees?: number;
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
  pinterestSpend?: number;
  pinterestRevenue?: number;
  adCreditApplied?: number;
  netAdSpend?: number;
  newCustomers?: number;
  returningCustomers?: number;
  newCustomerRevenue?: number;
  returningCustomerRevenue?: number;
  pctNew?: number;
  pctReturning?: number;
  conversionRate?: number;
  conversionRateRaw?: number;
  humanSessions?: number;
  botSessions?: number;
  /** Marketplace channels excluded from every figure on this page (they have their own tab). */
  marketplaces?: Array<{ key: string; label: string; netSales: number; totalSales: number; orders: number; returnFees: number; inMer?: boolean; inSales?: boolean }>;
  /** MER numerator when marketplace sales count toward MER (all channels). */
  merNetSales?: number;
  merBasis?: 'net' | 'gross_less_discounts';
}

interface PriorPeriod {
  totalRevenue: number;
  totalAdSpend: number;
  totalOrders: number;
  aov: number;
  mer: number;
  metaSpend: number;
  googleSpend: number;
  newCustomers?: number;
  returningCustomers?: number;
}

export default function OverviewContent() {
  const searchParams = useSearchParams();
  const client = useClient();
  // Targets in force for the selected range (seasonal clients switch by the range's end month).
  const rangeEndForGoals = (() => { try { return tfRange((searchParams.get('tf') || '30d') as Timeframe | 'custom', searchParams.get('date_from') || '', searchParams.get('date_to') || '').to; } catch { return undefined; } })();
  const goalsNow = effectiveGoals(client, rangeEndForGoals);
  const MER_GOAL = goalsNow.targetMer;
  const MER_FLOOR = goalsNow.merFloor;
  const TARGET_CAC = goalsNow.targetCac; // New Customer CAC: green at/under target, amber up to the ceiling, red above
  const CAC_CEILING = goalsNow.cacCeiling;
  // Green at/under target, amber between target and ceiling, red above the ceiling.
  const cacTone = (v: number) => (v <= TARGET_CAC ? '#22c55e' : CAC_CEILING != null && v <= CAC_CEILING ? '#d97706' : '#ef4444');
  const runs = (k: keyof typeof PLATFORMS) => client.ads.platforms.includes(k);
  const tfRaw = searchParams.get('tf') || '30d';
  const isCustom = tfRaw === 'custom';
  const tf = (isCustom ? '30d' : tfRaw) as Timeframe;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';
  const compareTo = (['month', 'year'].includes(searchParams.get('compare_to') || '') ? searchParams.get('compare_to') : 'prior') as 'prior' | 'month' | 'year';
  const compareBasis = compareTo === 'month' ? 'same period last month' : compareTo === 'year' ? 'same period last year' : 'prior period';
  const deltaLabel = compareTo === 'month' ? 'vs last month' : compareTo === 'year' ? 'vs last year' : 'vs prior period';

  const [metrics, setMetrics] = useState<LiveMetrics>(EMPTY_METRICS);
  const [revenueData, setRevenueData] = useState<DailyRevenue[]>([]);
  const [priorPeriod, setPriorPeriod] = useState<PriorPeriod | null>(null);
  const [priorLabel, setPriorLabel] = useState<string>('');
  const [livePlatformSpend, setLivePlatformSpend] = useState<PlatformSpend[] | null>(null);
  const [liveSource, setLiveSource] = useState<string>('loading');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [dataLag, setDataLag] = useState<boolean>(false);
  const [showDefs, setShowDefs] = useState(false);
  const [latestAvailableDate, setLatestAvailableDate] = useState<string | null>(null);
  const [shopifyDataLag, setShopifyDataLag] = useState<boolean>(false);
  const [shopifyLatestDate, setShopifyLatestDate] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invSnapshot, setInvSnapshot] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [returnsSnapshot, setReturnsSnapshot] = useState<any | null>(null);
  // Per-product-line split (women's vs kids …) — only for clients whose profile defines lines.
  const [lineSplit, setLineSplit] = useState<{ lines: LineRow[]; shopifyError?: string; unmatchedProductTypes?: string[] } | null>(null);
  const [revenueSource, setRevenueSource] = useState<'shopify' | 'none' | null>(null);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [apiErrorDetail, setApiErrorDetail] = useState<string | null>(null);
  const [shopifyLiveError, setShopifyLiveError] = useState<string | null>(null);
  const [shopifySource, setShopifySource] = useState<'shopifyql' | 'shopifyql_totals' | 'bigquery' | null>(null);
  const [health, setHealth] = useState<null | {
    allOk: boolean;
    platforms: Array<{ platform: string; dashboardSpend: number; referenceSpend: number | null; referenceSource: string; diff: number | null; diffPct: number | null; status: string }>;
  }>(null);

  // ── Personal task reminder: each person's own open tasks, front and
  //    center when they log in ──
  const { data: session } = useSession();
  // Partner (agency) logins see the ads view only: no launches, tasks, calendar,
  // customer counts, product lines, forecast, briefing or marketplace notes.
  const isPartner = session?.user?.role === 'partner';
  // ── Launch readiness: any launch/sale within 7 days with unchecked
  //    playbook items past their lead time gets a loud banner ──
  const [launchAlerts, setLaunchAlerts] = useState<{ id: string; title: string; date: string; days: number; done: number; total: number; overdue: number }[]>([]);
  // Why there are no alerts, when there are none — silence was undebuggable.
  const [launchAlertNote, setLaunchAlertNote] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      fetch('/api/calendar', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/api/launch/checklist', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([cal, play]) => {
      const allEvents = ((cal?.events || []) as { id: string; title: string; date: string; type: string; description?: string; channel?: string }[]);
      // A stale TBD marker must not override a real confirmed date: TBD
      // placeholders sit on the 1st by convention, so a specific future date
      // wins even if old marker text survived in the notes.
      const todayPstStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const isTbd = (e: { description?: string; date?: string }) => {
        if (!/tbd|tbc|placeholder|to be confirmed|not confirmed|no confirmation/i.test(e.description || '')) return false;
        const day = Number((e.date || '').slice(8, 10));
        return day === 1 || !e.date || e.date < todayPstStr;
      };
      const template = (play?.template || []) as { label: string; daysBefore: number }[];
      const byEvent = (play?.byEvent || {}) as Record<string, Record<string, { done: boolean }>>;
      if (!Array.isArray(allEvents) || !allEvents.length) {
        setLaunchAlertNote(cal?.error ? `Launch alerts unavailable — calendar error: ${String(cal.error).slice(0, 120)}` : 'Launch alerts unavailable — calendar failed to load.');
        return;
      }
      if (!template.length) {
        setLaunchAlertNote('Launch alerts unavailable — playbook template failed to load.');
        return;
      }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const inWindow = allEvents
        .filter(e => (e.type === 'launch' || e.type === 'sale') && !/email|sms/i.test(e.channel || '') && !/\b(email|sms|text)\b/i.test(e.title || ''))
        .map(e => ({ e, days: Math.round((Date.parse(e.date) - Date.parse(today)) / 86400000) }))
        .filter(x => x.days >= -1 && x.days <= 7);
      const tbdCount = inWindow.filter(x => isTbd(x.e)).length;
      const alerts = inWindow
        .filter(x => !isTbd(x.e))
        .map(({ e, days }) => {
          const checks = byEvent[e.id] || {};
          const done = template.filter(t => checks[t.label]?.done).length;
          const overdue = template.filter(t => !checks[t.label]?.done && days <= t.daysBefore).length;
          return { id: e.id, title: e.title, date: e.date, days, done, total: template.length, overdue };
        })
        // Fully checked-off launches need no reminder — drop them from the
        // Overview card so only ones with real work left take up space.
        .filter(a => a.done < a.total)
        .sort((a, b) => a.days - b.days)
        .slice(0, 4);
      const readyCount = inWindow.filter(x => !isTbd(x.e)).length - alerts.length;
      setLaunchAlerts(alerts);
      setLaunchAlertNote(alerts.length > 0 ? null
        : readyCount > 0 ? `All ${readyCount > 1 ? `${readyCount} launch checklists` : 'launch checklists'} for this week are complete ✓`
        : tbdCount > 0 ? `${tbdCount} launch${tbdCount > 1 ? 'es' : ''} this week still marked "date TBD" — confirm the date on the calendar to start the checklist countdown.`
        : 'No launches or sales with confirmed dates in the next 7 days.');
    }).catch(e => setLaunchAlertNote(`Launch alerts unavailable — ${String(e).slice(0, 120)}`));
  }, []);

  const todayPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // Profitability data (admin-only; 403 for others hides the card): QB
  // actuals for booked months in the range, plus cost rates for estimating
  // only the unbooked remainder.
  const [profitBasis, setProfitBasis] = useState<null | {
    cogsPct: number | null; cogsSource?: 'quickbooks' | 'profile' | null; nonAdOpexPct: number | null; basisMonths: string[];
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

  // Marketing costs beyond ad spend (budgeting sheet) for the fully loaded
  // panel; admin-only endpoint — undefined = loading, null = none/forbidden.
  const [expenses, setExpenses] = useState<ExpensesPayload | null | undefined>(undefined);
  useEffect(() => {
    if (tfRaw === 'today') { setExpenses(null); return; }
    setExpenses(undefined);
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    fetch(`/api/expenses?${params}`, { cache: 'no-store' })
      .then(async r => (r.ok ? r.json() : null))
      .then(d => setExpenses(d && !d.error && d.range ? d : null))
      .catch(() => setExpenses(null));
  }, [tfRaw, dateFrom, dateTo]);

  // Return rate next to paid MER — MER stays on net sales; a returns spike
  // shows here against a trailing baseline instead of reading as a worse MER.
  const [returnsInfo, setReturnsInfo] = useState<ReturnsSummary | null>(null);
  useEffect(() => {
    setReturnsInfo(null);
    if (tfRaw === 'today' || tfRaw === 'yesterday') return;
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    fetch(`/api/returns?${params}`, { cache: 'no-store' })
      .then(async r => (r.ok ? r.json() : null))
      .then(d => setReturnsInfo(d && !d.error && d.range ? d : null))
      .catch(() => setReturnsInfo(null));
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

  // Platform-reported purchases and cost per purchase — the same numbers Ads
  // Manager / Google Ads / TikTok / Pinterest show, keyed by platform name.
  const [platformPurchases, setPlatformPurchases] = useState<Record<string, { purchases: number; costPerPurchase: number; attribution?: string }>>({});

  function buildLivePlatformSpend(m: LiveMetrics): PlatformSpend[] | null {
    if (!m.metaSpend && !m.googleSpend && !m.tiktokSpend && !m.snapchatSpend && !m.pinterestSpend) return null;
    const platforms: PlatformSpend[] = [];
    const push = (platform: string, spend: number, revenue: number, color: string) => {
      if (spend <= 0) return;
      platforms.push({
        platform,
        spend,
        revenue,
        roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
        ctr: 0,
        impressions: 0,
        // Purchases + cost per purchase are looked up from platformPurchases at
        // render time (the two requests race; stamping them here used a stale copy).
        purchases: null,
        cac: null,
        color,
      });
    };
    push('Meta', m.metaSpend ?? 0, m.metaRevenue ?? 0, '#818cf8');
    push('Google', m.googleSpend ?? 0, m.googleRevenue ?? 0, '#34d399');
    push('TikTok', m.tiktokSpend ?? 0, m.tiktokRevenue ?? 0, '#f472b6');
    push('Snapchat', m.snapchatSpend ?? 0, m.snapchatRevenue ?? 0, '#facc15');
    push('Pinterest', m.pinterestSpend ?? 0, m.pinterestRevenue ?? 0, PLATFORMS.pinterest.color);
    return platforms.length > 0 ? platforms : null;
  }


  // Guards against out-of-order responses: switching timeframes fast used to
  // let the PREVIOUS timeframe's slower response land last and overwrite the
  // new one (Today showing 30-day totals). Each request records its key; a
  // response only applies if its key is still the active one.
  const activeReqKey = useRef('');

  useEffect(() => {
    const reqKey = `${tfRaw}|${dateFrom}|${dateTo}|${compareOn}`;
    activeReqKey.current = reqKey;

    setMetrics(EMPTY_METRICS);
    setRevenueData([]);
    setPriorPeriod(null);
    setLivePlatformSpend(null);
    setPlatformPurchases({});
    setDataLag(false);
    setLatestAvailableDate(null);
    setShopifyDataLag(false);
    setShopifyLatestDate(null);
    setRevenueSource(null);
    setAdsError(null);
    setLiveSource('loading');

    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    // Prior-period metrics power the revenue card's always-on delta on
    // complete timeframes. Today shows no delta, so skip the extra prior
    // fetch there unless the Compare toggle is on — it nearly doubled the
    // live view's load time.
    if (compareOn || tfRaw !== 'today') params.set('compare', 'true');
    if (compareOn && compareTo !== 'prior') params.set('compare_to', compareTo);

    // Platform-reported purchases (Meta purchases, Google conversions …) for the
    // Cost / Purchase column — same endpoint the Ad Performance tab reads.
    const adsParams = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) adsParams.set('date_from', dateFrom);
    if (dateTo) adsParams.set('date_to', dateTo);
    cachedJson<{ platforms?: Array<{ platform: string; conversions?: number; costPerConversion?: number; attribution?: string }> }>(
      `/api/windsor/ads?${adsParams}`,
      d => {
        if (activeReqKey.current !== reqKey) return;
        const map: Record<string, { purchases: number; costPerPurchase: number; attribution?: string }> = {};
        for (const p of d.platforms || []) map[p.platform] = { purchases: Number(p.conversions || 0), costPerPurchase: Number(p.costPerConversion || 0), attribution: p.attribution };
        setPlatformPurchases(map);
      },
      () => {},
    );

    // Cached copies (from earlier visits this session) render instantly and
    // are refreshed in the background — switching tabs doesn't restart loads.
    cachedJson<Record<string, unknown> & { source?: string }>(
      `/api/windsor?${params}`,
      data => {
        if (activeReqKey.current !== reqKey) return; // stale response — a newer timeframe is active
        const source = data.source || 'unknown';
        if (!isLiveOverviewSource(source)) {
          setApiErrorDetail(typeof data.error === 'string' && data.error ? String(data.error).slice(0, 300) : null);
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
        setShopifySource((data.shopifySource as 'shopifyql' | 'shopifyql_totals' | 'bigquery') || null);
        setLiveSource(source as typeof liveSource);
        setLastUpdated(new Date().toLocaleTimeString());
      },
      () => {
        if (activeReqKey.current !== reqKey) return; // stale error from an abandoned timeframe
        setMetrics(EMPTY_METRICS);
        setRevenueData([]);
        setLivePlatformSpend(null);
        setDataLag(false);
        setLiveSource('error');
        setLastUpdated(new Date().toLocaleTimeString());
      },
      // Live views move fast — a cached copy more than ~45s old reads as
      // "wrong numbers flashing" when the fresh response swaps in, so only
      // insta-render genuinely recent snapshots there. Historical timeframes
      // keep the 5-minute window (their numbers barely move).
      tfRaw === 'today' || tfRaw === 'mtd' ? 45_000 : undefined
    );
  }, [tfRaw, dateFrom, dateTo, compareOn, compareTo]);

  // Inventory (current stock — same regardless of timeframe) and returns (for
  // the selected period) power the login briefing. Fetched separately so they
  // never delay the main metric cards.
  useEffect(() => {
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    fetch('/api/windsor/inventory').then(r => r.json()).then(setInvSnapshot).catch(() => setInvSnapshot(null));
    fetch(`/api/windsor/returns?${p}`).then(r => r.json()).then(setReturnsSnapshot).catch(() => setReturnsSnapshot(null));
    if (client.lines && client.lines.length > 0) {
      setLineSplit(null);
      fetch(`/api/lines?${p}`).then(r => r.json()).then(setLineSplit).catch(() => setLineSplit(null));
    }
  }, [tfRaw, dateFrom, dateTo, client.lines]);

  // ── Today's spend lag ─────────────────────────────────────────────────────
  // Meta and Snapchat are read live from their APIs; Google, TikTok and
  // Pinterest arrive through the feed, which can run hours behind intraday.
  // Compare today's reported spend with each platform's pace (last 7 complete
  // days, scaled to the hour) and treat a big shortfall as "still syncing" so
  // the MER is shown as provisional with the likely spend included.
  const [spendPace, setSpendPace] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    setSpendPace(null);
    if (tfRaw !== 'today') return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const d = (n: number) => { const t = new Date(`${today}T12:00:00`); t.setDate(t.getDate() - n); return t.toISOString().slice(0, 10); };
    cachedJson<{ metrics?: Record<string, number> }>(`/api/windsor?tf=custom&date_from=${d(7)}&date_to=${d(1)}&lite=1`, r => {
      const m = r?.metrics; if (!m) return;
      setSpendPace({ google: (m.googleSpend ?? 0) / 7, tiktok: (m.tiktokSpend ?? 0) / 7, pinterest: (m.pinterestSpend ?? 0) / 7 });
    }, () => setSpendPace(null));
  }, [tfRaw]);
  const spendLag = useMemo(() => {
    if (tfRaw !== 'today' || !spendPace) return [] as Array<{ key: string; label: string; reported: number; expected: number; gap: number }>;
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })) || 0;
    const elapsed = Math.max(0.15, Math.min(1, (hour + 0.5) / 24));
    const rows = [
      { key: 'google', label: 'Google', reported: metrics.googleSpend ?? 0 },
      { key: 'tiktok', label: 'TikTok', reported: metrics.tiktokSpend ?? 0 },
      { key: 'pinterest', label: 'Pinterest', reported: metrics.pinterestSpend ?? 0 },
    ];
    return rows.flatMap(r => {
      const expected = (spendPace[r.key] ?? 0) * elapsed;
      if (expected < 20) return [];
      if (r.reported >= expected * 0.6) return [];
      return [{ ...r, expected: Math.round(expected), gap: Math.round(expected - r.reported) }];
    });
  }, [tfRaw, spendPace, metrics.googleSpend, metrics.tiktokSpend, metrics.pinterestSpend]);
  const lagGap = spendLag.reduce((s, l) => s + l.gap, 0);
  const lagNote = spendLag.length ? spendLag.map(l => `${l.label} ${formatCurrency(l.reported)} so far, about ${formatCurrency(l.expected)} expected by now`).join('; ') : '';

  // ── Month-end forecast (MTD pace, independent of the selected timeframe) ──
  type Snap = { revenue: number; adSpend: number; byPlatform?: Record<string, number> };
  const PLATFORM_KEYS: Array<{ key: string; label: string; field: string }> = [
    { key: 'meta', label: 'Meta', field: 'metaSpend' }, { key: 'google', label: 'Google', field: 'googleSpend' },
    { key: 'tiktok', label: 'TikTok', field: 'tiktokSpend' }, { key: 'snapchat', label: 'Snapchat', field: 'snapchatSpend' },
    { key: 'pinterest', label: 'Pinterest', field: 'pinterestSpend' },
  ];
  const snapOf = (m: Record<string, number | undefined>): Snap => ({
    revenue: m.totalRevenue ?? 0, adSpend: m.totalAdSpend ?? 0,
    byPlatform: Object.fromEntries(PLATFORM_KEYS.map(p => [p.key, m[p.field] ?? 0])),
  });
  const [mtdSnap, setMtdSnap] = useState<Snap | null>(null);
  const [lastMonthSnap, setLastMonthSnap] = useState<Snap | null>(null);
  // Same days of LAST month (1st → same day-of-month as yesterday) — the
  // honest pace comparison. Comparing a projected month against last month's
  // FULL total hides being ahead day-for-day when last month finished strong.
  const [sameDaysSnap, setSameDaysSnap] = useState<{ revenue: number; adSpend: number } | null>(null);

  // The forecast loads after the headline numbers: its three requests used to
  // start at the same moment and compete with them for Shopify's rate limit.
  const forecastStarted = useRef(false);
  useEffect(() => {
    if (liveSource === 'loading' || forecastStarted.current) return;
    forecastStarted.current = true;
    // Forecast pace must come from COMPLETE days only — MTD now includes
    // today's partial data (matching Shopify), so fetch 1st→yesterday
    // explicitly for the projection.
    const [ty, tm, td] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).split('-').map(Number);
    if (td > 1) {
      const first = `${ty}-${String(tm).padStart(2, '0')}-01`;
      const yest = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
      cachedJson<{ source?: string; metrics?: Record<string, number | undefined> }>(
        `/api/windsor?tf=custom&date_from=${first}&date_to=${yest}&lite=1`,
        d => {
          if (isLiveOverviewSource(d.source) && d.metrics) setMtdSnap(snapOf(d.metrics));
        }
      );
      // Last month, same day span (capped at that month's length).
      const prevLast = new Date(ty, tm - 1, 0); // last day of previous month
      const prevY = prevLast.getFullYear();
      const prevM = prevLast.getMonth() + 1;
      const prevTo = Math.min(td - 1, prevLast.getDate());
      cachedJson<{ source?: string; metrics?: { totalRevenue?: number; totalAdSpend?: number } }>(
        `/api/windsor?tf=custom&date_from=${prevY}-${String(prevM).padStart(2, '0')}-01&date_to=${prevY}-${String(prevM).padStart(2, '0')}-${String(prevTo).padStart(2, '0')}&lite=1`,
        d => {
          if (isLiveOverviewSource(d.source) && d.metrics) {
            setSameDaysSnap({ revenue: d.metrics.totalRevenue ?? 0, adSpend: d.metrics.totalAdSpend ?? 0 });
          }
        }
      );
    }
    cachedJson<{ source?: string; metrics?: Record<string, number | undefined> }>(
      '/api/windsor?tf=last_month&lite=1',
      d => {
        if (isLiveOverviewSource(d.source) && d.metrics) setLastMonthSnap(snapOf(d.metrics));
      }
    );
  }, [liveSource]);

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
    // Per-platform projection on the same pace rule.
    const platforms = PLATFORM_KEYS
      .map(p => ({ key: p.key, label: p.label, mtd: mtdSnap.byPlatform?.[p.key] ?? 0 }))
      .filter(p => p.mtd > 0)
      .map(p => ({ ...p, projected: (p.mtd / daysElapsed) * daysInMonth }))
      .sort((a, b) => b.projected - a.projected);
    return {
      daysElapsed,
      daysInMonth,
      revPace,
      revF,
      spendF,
      platforms,
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
  const isLive = isLiveOverviewSource(liveSource);

  return (
    <div>
      <Header
        title={isPartner ? 'Marketing Performance' : 'MER Dashboard'}
        subtitle={`${isPartner ? 'Partner view · ads against company goals · ' : 'Overview · '}${isCustom && dateFrom && dateTo
          ? `${dateFrom} → ${dateTo}${compareOn && priorLabel ? ` vs ${priorLabel}` : ''}`
          : `${TIMEFRAME_LABELS[tf] || tf}${compareOn && priorLabel ? ` vs ${compareBasis}${compareTo !== 'prior' ? ` (${priorLabel})` : ''}` : ''}`}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Diagnostic line when no launch banners render — silence hid real
          failures (and TBD-parked launches) from everyone. */}
      {!isPartner && launchAlerts.length === 0 && launchAlertNote && (
        <Link href="/dashboard/calendar" className="block rounded-xl border border-gray-200 bg-white px-4 py-2 mb-4 text-xs text-gray-500">
          🚀 {launchAlertNote} <span className="text-violet-500 font-semibold">Open calendar →</span>
        </Link>
      )}

      {/* ── Launch readiness — ONE compact card, a slim row per launch.
          Multiple full-height banners buried the actual dashboard. ── */}
      {!isPartner && launchAlerts.length > 0 && (() => {
        const anyOverdue = launchAlerts.some(a => a.overdue > 0);
        return (
          <Link
            href="/dashboard/calendar"
            className={`block rounded-2xl border-2 px-4 py-2.5 mb-4 shadow-sm transition-transform active:scale-[0.99] ${anyOverdue ? 'border-red-300 bg-red-50' : 'border-pink-300 bg-pink-50'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full animate-pulse ${anyOverdue ? 'bg-red-500' : 'bg-pink-500'}`} />
              <p className={`text-xs font-bold uppercase tracking-wide ${anyOverdue ? 'text-red-700' : 'text-pink-700'}`}>
                🚀 {launchAlerts.length} launch{launchAlerts.length > 1 ? 'es' : ''} this week
              </p>
              <span className={`ml-auto text-[11px] font-semibold ${anyOverdue ? 'text-red-600' : 'text-pink-600'}`}>Open checklists →</span>
            </div>
            <div className="space-y-0.5">
              {launchAlerts.map(a => {
                const allDone = a.done === a.total;
                return (
                  <div key={a.id} className="flex items-baseline gap-2 text-xs">
                    <span className="font-semibold text-gray-700 truncate">{a.title}</span>
                    <span className="text-gray-400 whitespace-nowrap">{a.days === 0 ? 'TODAY' : a.days === 1 ? 'tomorrow' : `in ${a.days}d`}</span>
                    <span className={`ml-auto whitespace-nowrap font-semibold ${a.overdue > 0 ? 'text-red-600' : allDone ? 'text-green-600' : 'text-gray-400'}`}>
                      {a.overdue > 0 ? `⚠ ${a.overdue} due` : allDone ? '✓ ready' : 'on track'} · ☑ {a.done}/{a.total}
                    </span>
                  </div>
                );
              })}
            </div>
          </Link>
        );
      })()}

      {/* ── Loud personal task reminder (shared with the Marketing Calendar) ── */}
      {!isPartner && <MyTasksBanner />}

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400' : liveSource === 'loading' ? 'bg-yellow-400' : 'bg-red-400'}`}
        />
        <span className="text-xs text-gray-400">
          {liveSource === 'loading'
            ? 'Loading Windsor data...'
            : isLive
            ? `Live · ${liveSource === 'direct_live' ? 'Shopify + ad platforms direct' : 'Windsor.ai'} · Updated ${lastUpdated}`
            : `Data unavailable · ${lastUpdated}`}
        </span>
        <button
          onClick={() => {
            setLiveSource('loading');
            const p = new URLSearchParams({ tf: tfRaw });
            if (dateFrom) p.set('date_from', dateFrom);
            if (dateTo) p.set('date_to', dateTo);
            if (compareOn || tfRaw !== 'today') p.set('compare', 'true');
            if (compareOn && compareTo !== 'prior') p.set('compare_to', compareTo);
            // Bypass every cache layer (browser HTTP + CDN) and write the
            // fresh result back into the session cache, so one tap of
            // Refresh is enough — previously the stale cached copy could
            // resurface and it took two refreshes to see current numbers.
            // Also invalidate any in-flight background load: the slow fetch
            // kicked off at page load could resolve AFTER this manual
            // refresh and overwrite fresher numbers with older ones.
            activeReqKey.current = `manual-refresh-${Date.now()}`;
            fetch(`/api/windsor?${p}`, { cache: 'no-store' })
              .then(r => r.json())
              .then(data => {
                if (isLiveOverviewSource(data?.source)) primeCache(`/api/windsor?${p}`, data);
                const source = data.source || 'unknown';
                if (!isLiveOverviewSource(source)) {
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
          <span>
            Overview data is unavailable{apiErrorDetail ? <> — the server said: <b>{apiErrorDetail}</b></> : ' — BigQuery query failed or hasn\u2019t synced yet.'} Tap Refresh to retry; if a custom range keeps failing, note the exact dates \u2014 shorter ranges usually work while it\u2019s investigated.
          </span>
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
          <span>Ad spend data unavailable — {adsError}. Revenue and order data are unaffected.</span>
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

      {shopifySource === 'bigquery' && revenueSource === 'shopify' && isLive && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-800">
          <span>⚠️</span>
          <span>
            Shopify&apos;s report did not answer, so sales below come from the Windsor-synced order rows instead. Total sales, net sales and orders still follow Shopify&apos;s day-by-day rules, but return fees cannot be included because only Shopify reports them, so net sales and MER run slightly low here.
            {shopifyLiveError && <> Shopify said: {shopifyLiveError}.</>} Tap Refresh to retry.
          </span>
        </div>
      )}

      {/* MER Hero — two numbers, two owners: paid media MER (the agency's)
          and fully loaded MER + contribution margin (the business's). The
          definitions live behind one "How these are calculated" toggle so
          the numbers read clean, especially on a phone. */}
      {(() => {
        // MER's net sales can include marketplace channels for some clients (merNetSales).
        const netS = metrics.merNetSales ?? metrics.netSales ?? metrics.totalRevenue;
        // Contribution margin is always on net sales (after returns) — returned
        // money is gone whatever basis MER uses.
        const contribBase = metrics.netSales ?? metrics.totalRevenue;
        const gld = metrics.merBasis === 'gross_less_discounts';
        const salesLabel = gld ? 'Gross sales less discounts' : 'Net sales';
        const allChannels = Boolean(metrics.marketplaces?.some(m => m.inSales || m.inMer));
        const adS = metrics.adCreditApplied ? (metrics.netAdSpend ?? metrics.totalAdSpend) : metrics.totalAdSpend;
        const other = expenses ? expenses.range.nonAdMarketing : null;
        const cogsPct = profitBasis?.cogsPct ?? (client.finance.grossMarginPct != null ? 100 - client.finance.grossMarginPct : null);
        const totalMk = other != null ? adS + other : null;
        const flMer = totalMk && totalMk > 0 ? netS / totalMk : null;
        const contrib = cogsPct != null && totalMk != null ? contribBase - contribBase * (cogsPct / 100) - totalMk : null;
        const cmPct = contrib != null && contribBase > 0 ? (contrib / contribBase) * 100 : null;
        const flGoal = goalsNow.targetFullyLoadedMer;
        const flFloor = goalsNow.fullyLoadedFloor;
        const floor = goalsNow.contributionFloorPct;
        const showLoaded = !isPartner && expenses !== null && tfRaw !== 'today';
        const okFl = flMer != null && flGoal != null ? flMer >= flGoal : null;
        const okCm = cmPct != null && floor != null ? cmPct >= floor : null;
        // Reconcile shortfall is over a 7-day window; scale it to this view's
        // length before correcting the MER (a week's gap on one morning once
        // "estimated" 0.39x on a 4x day).
        const missing7d = health && !health.allOk ? health.platforms.reduce((s, p) => s + (p.status === 'warn' && p.diff !== null && p.diff < 0 ? -p.diff : 0), 0) : 0;
        const viewDays = tfRaw === 'today' || tfRaw === 'yesterday' ? 1 : Math.max(1, revenueData.length);
        const missingSpend = (missing7d / 7) * Math.min(viewDays, 7) * (tfRaw === 'today' ? Math.max(0.2, new Date().getHours() / 24) : 1) + lagGap;
        const correctedMer = missingSpend > 0 && adS + missingSpend > 0 ? netS / (adS + missingSpend) : null;
        // Three states when a floor exists: at goal (green), between floor and
        // goal (amber), below floor (red). Two states without one.
        const Badge = ({ value, goal, floor: fl, label }: { value: number | null; goal: number | null; floor?: number | null; label?: string | null }) => {
          if (goal == null || value == null) return null;
          const state = value >= goal ? 'ok' : fl != null && value >= fl ? 'warn' : 'bad';
          const bg = state === 'ok' ? '#dcfce7' : state === 'warn' ? '#fef3c7' : '#fee2e2';
          const fg = state === 'ok' ? '#22c55e' : state === 'warn' ? '#d97706' : '#ef4444';
          const text = state === 'ok' ? '✓ At goal' : state === 'warn' ? '◐ Above floor, below goal' : fl != null ? '✗ Below floor' : '✗ Below goal';
          return (
            <div className="pb-1.5 sm:pb-2">
              <span className="text-xs sm:text-sm font-bold px-2 py-1 rounded-lg whitespace-nowrap" style={{ backgroundColor: bg, color: fg }}>{text}</span>
              <p className="text-[11px] text-gray-400 mt-1">Goal {label || `${goal}x`}{fl != null ? ` · floor ${fl}x` : ''}{goalsNow.season ? ` · ${goalsNow.season.name}` : ''}</p>
            </div>
          );
        };
        const Stat = ({ k, v, tone }: { k: string; v: string; tone?: string }) => (
          <div className="min-w-0"><p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{k}</p><p className="text-base sm:text-lg font-bold tabular-nums truncate" style={{ color: tone || '#1e293b' }}>{v}</p></div>
        );
        return (
      <div className="mb-6">
        <Card accentColor="#c4b5fd">
          <div className={`grid gap-6 ${showLoaded ? 'lg:grid-cols-2 lg:divide-x lg:divide-gray-100' : ''}`}>
            {/* Paid media */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Paid media MER</p>
              <p className="text-[11px] text-gray-400 mb-1">{salesLabel}{allChannels ? ' (all channels)' : ''} ÷ ad spend. The agency&apos;s number.</p>
              <div className="flex items-end gap-3">
                <span className="text-5xl sm:text-6xl font-black leading-none" style={{ color: merColor }}>{formatROAS(metrics.mer)}</span>
                <Badge value={metrics.mer} goal={MER_GOAL} floor={MER_FLOOR} label={goalsNow.merLabel} />
              </div>
              <p className="text-sm text-gray-500 mt-2 tabular-nums">{salesLabel} {formatCurrency(netS)} ÷ ad spend {formatCurrency(adS)}</p>
              {correctedMer !== null && metrics.mer > 0 && (
                <p className="text-[11px] font-semibold text-amber-600 mt-1">⚠ Provisional — {lagNote ? `${lagNote}. ` : ''}About {formatCurrency(missingSpend)} of ad spend is still syncing; with it, MER is likely closer to {correctedMer.toFixed(2)}x.</p>
              )}
              {returnsInfo && returnsInfo.range.ratePct != null && (() => {
                const st = returnsInfo.status;
                const tone = st === 'high' ? '#dc2626' : st === 'elevated' ? '#d97706' : '#16a34a';
                const d = returnsInfo.deltaPts;
                return (
                  <p className="text-[11px] text-gray-500 mt-1.5 tabular-nums">
                    Returns were <span className="font-semibold" style={{ color: tone }}>{returnsInfo.range.ratePct}%</span> of gross sales
                    {returnsInfo.baseline.ratePct != null && d != null ? (
                      <>, {d === 0 ? 'the same as' : <><span className="font-semibold" style={{ color: tone }}>{Math.abs(d)} pts {d > 0 ? 'above' : 'below'}</span></>} the {returnsInfo.baseline.months}-month baseline of {returnsInfo.baseline.ratePct}%{st && st !== 'normal' && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: st === 'high' ? '#fee2e2' : '#fef3c7', color: tone }}>{st}</span>}</>
                    ) : ' (no baseline yet)'}
                    . <Link href={`/dashboard/returns?tf=${tfRaw}${dateFrom ? `&date_from=${dateFrom}` : ''}${dateTo ? `&date_to=${dateTo}` : ''}`} className="underline hover:text-gray-700">Returns tab</Link>
                  </p>
                );
              })()}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-gray-100">
                <Stat k="Revenue" v={formatCurrency(metrics.totalRevenue)} />
                <Stat k="Ad spend" v={formatCurrency(metrics.totalAdSpend)} />
                <Stat k="Orders" v={metrics.totalOrders.toLocaleString()} />
                <Stat k="AOV" v={formatCurrency(metrics.aov)} />
              </div>
            </div>

            {/* Fully loaded */}
            {showLoaded && (
              <div className="lg:pl-6 pt-5 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fully loaded MER</p>
                <p className="text-[11px] text-gray-400 mb-1">{salesLabel} ÷ total marketing. The business&apos;s number.</p>
                {expenses === undefined ? (
                  <p className="text-sm text-gray-400 py-6">Loading marketing costs…</p>
                ) : (
                  <>
                    <div className="flex items-end gap-3">
                      <span className="text-5xl sm:text-6xl font-black leading-none" style={{ color: okFl == null ? '#1e293b' : okFl ? '#22c55e' : '#ef4444' }}>{flMer != null ? formatROAS(flMer) : '—'}</span>
                      <Badge value={flMer} goal={flGoal} floor={flFloor} label={goalsNow.fullyLoadedLabel} />
                    </div>
                    <p className="text-sm text-gray-500 mt-2 tabular-nums">{salesLabel} {formatCurrency(netS)} ÷ total marketing {formatCurrency(totalMk || 0)}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">Total marketing = ad spend {formatCurrency(adS)} + other marketing {formatCurrency(other || 0)}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-gray-100">
                      <Stat k="Contribution" v={cmPct != null ? `${cmPct.toFixed(1)}%` : '—'} tone={okCm == null ? undefined : okCm ? '#16a34a' : '#dc2626'} />
                      <Stat k={floor != null ? `Floor ${floor}%` : 'Contribution $'} v={contrib != null ? formatCurrency(contrib) : '—'} />
                      <Stat k="Marketing" v={totalMk != null ? formatCurrency(totalMk) : '—'} />
                      <Stat k="Of net sales" v={contribBase > 0 && totalMk != null ? `${((totalMk / contribBase) * 100).toFixed(1)}%` : '—'} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Definitions and exclusions, out of the way until wanted */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowDefs(v => !v)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
              {showDefs ? 'Hide' : 'How these are calculated'}{!showDefs && !isPartner && metrics.marketplaces && metrics.marketplaces.length > 0 ? (metrics.marketplaces.every(m => m.inSales) ? ` (all channels, including ${metrics.marketplaces.map(m => m.label).join(', ')})` : ` (online store only; ${metrics.marketplaces.filter(m => !m.inSales).map(m => m.label).join(', ')} excluded)`) : ''}
            </button>
            {showDefs && (
              <ul className="text-[11px] text-gray-500 mt-2 space-y-1 list-disc pl-4">
                <li>Net sales = after discounts and returns, before taxes and shipping ({formatCurrency(metrics.netSales ?? metrics.totalRevenue)}; total sales {formatCurrency(metrics.totalRevenue)}){(metrics.returnFees ?? 0) > 0 ? `; includes ${formatCurrency(metrics.returnFees!)} in return fees the store keeps` : ''}.</li>
                {gld && <li>Gross sales less discounts = what was sold at the price paid, before any returns ({formatCurrency(netS)}). Both MERs on this dashboard use it, so a return processed later does not lower the agency&apos;s number; returns show on their own line and in the Returns tab.</li>}
                <li>Paid media MER = {gld ? 'gross sales less discounts' : 'net sales'} ÷ {metrics.adCreditApplied ? 'net ad spend' : 'ad spend'} on every platform{(metrics.adCreditApplied ?? 0) > 0 ? ` (${formatCurrency(metrics.adCreditApplied!)} Snapchat ad credit deducted; gross ${formatCurrency(metrics.totalAdSpend)})` : ''}. Goal {goalsNow.merLabel}{MER_FLOOR != null ? `, floor ${MER_FLOOR}x` : ''} is the agency&apos;s target.</li>
                {goalsNow.season && <li>Targets shown are for <b>{goalsNow.season.name}</b> ({goalsNow.season.months}), agreed with the client: paid MER {goalsNow.merLabel}{MER_FLOOR != null ? ` (floor ${MER_FLOOR}x)` : ''}{goalsNow.fullyLoadedLabel ? `, fully loaded MER ${goalsNow.fullyLoadedLabel}${flFloor != null ? ` (floor ${flFloor}x)` : ''}` : ''}, new-customer CAC {goalsNow.cacLabel}{CAC_CEILING != null ? ` (ceiling $${CAC_CEILING})` : ''}.{goalsNow.season.posture ? ` ${goalsNow.season.posture}` : ''} The season follows the end date of the selected range.</li>}
                {returnsInfo && <li>Return rate = refunded sales ÷ gross sales for these days ({formatCurrency(returnsInfo.range.returns)} of {formatCurrency(returnsInfo.range.gross)}){returnsInfo.baseline.ratePct != null ? `; baseline is the ${returnsInfo.baseline.months} full month${returnsInfo.baseline.months === 1 ? '' : 's'} before this period (${returnsInfo.baseline.ratePct}%)` : ''}. Shopify counts a return in the period it is processed, so recent weeks rise as returns land. Paid MER stays on net sales; a jump here is a returns conversation, not a worse MER.</li>}
                {showLoaded && <li>Fully loaded MER = {gld ? 'gross sales less discounts' : 'net sales'} ÷ (ad spend + other marketing). Other marketing is agency, content, email/SMS, tools, photoshoots, SEO and partnerships from the budgeting sheet, prorated to these days{expenses?.range.includesPlan ? '; the current month is plan until actuals are entered' : ''}. Goal {flGoal ?? '—'}x is the business&apos;s target.</li>}
                {showLoaded && <li>Contribution margin = net sales − cost of goods ({cogsPct ?? '—'}%) − all marketing, as a share of net sales. Floor {floor ?? '—'}%. Rent, non-marketing payroll and other overhead are not included.</li>}
                {!isPartner && metrics.marketplaces && metrics.marketplaces.length > 0 && metrics.marketplaces.map(m => (
                  <li key={m.key}>{m.label} ({m.orders.toLocaleString()} orders · {formatCurrency(m.netSales)} net) {m.inSales ? 'is included in sales, orders, AOV and MER, not in customers or CAC' : m.inMer ? 'is counted in MER only, not in sales, orders, AOV or customers' : 'is not in any figure on this page'} — see the <Link href={`/dashboard/channel/${m.key}?tf=${tfRaw}`} className="underline">{m.label} tab</Link>.</li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
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
                  label: tfRaw === 'yesterday' && compareTo === 'prior' ? 'vs day before' : compareOn ? deltaLabel : undefined,
                }
              : undefined
          }
        />
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(metrics.totalAdSpend)}
          subtitle={`${(metrics.netSales ?? metrics.totalRevenue) > 0 ? `${((metrics.totalAdSpend / (metrics.netSales ?? metrics.totalRevenue)) * 100).toFixed(1)}% of net sales goes to marketing · ` : ''}${metrics.metaSpend ? `Meta ${formatCurrency(metrics.metaSpend)} · Google ${formatCurrency(metrics.googleSpend ?? 0)}${metrics.tiktokSpend ? ` · TikTok ${formatCurrency(metrics.tiktokSpend)}` : ''}${metrics.snapchatSpend ? ` · Snap ${formatCurrency(metrics.snapchatSpend)}` : ''}${metrics.pinterestSpend ? ` · Pinterest ${formatCurrency(metrics.pinterestSpend)}` : ''}` : 'All ad platforms'}`}
          accentColor="#f9a8d4"
          comparison={compareOn && priorPeriod ? { current: metrics.totalAdSpend, prior: priorPeriod.totalAdSpend, label: deltaLabel } : undefined}
        />
        <MetricCard
          title="Avg Order Value"
          value={formatCurrency(metrics.aov)}
          // AOV is what customers order (net of discounts, before returns —
          // Shopify's definition). The subtitle adds what the store keeps per
          // order once returns come off, which for a high-return store is the
          // number that actually funds the ad spend.
          subtitle={(() => {
            const net = (metrics.netSales ?? 0) - (metrics.returnFees ?? 0);
            const perOrder = metrics.totalOrders > 0 && net > 0 ? net / metrics.totalOrders : 0;
            return perOrder > 0 && metrics.aov > 0 && perOrder < metrics.aov * 0.98
              ? `Per order, before returns · ${formatCurrency(perOrder)} kept per order after returns`
              : 'Per transaction';
          })()}
          accentColor="#fde68a"
          comparison={compareOn && priorPeriod ? { current: metrics.aov, prior: priorPeriod.aov, label: deltaLabel } : undefined}
        />
        {expenses && tfRaw !== 'today' ? (
          <MetricCard
            title="Total Marketing"
            value={formatCurrency((metrics.netAdSpend ?? metrics.totalAdSpend) + expenses.range.nonAdMarketing)}
            subtitle={`${formatCurrency(metrics.netAdSpend ?? metrics.totalAdSpend)} ads + ${formatCurrency(expenses.range.nonAdMarketing)} other · ${(metrics.netSales ?? metrics.totalRevenue) > 0 ? ((((metrics.netAdSpend ?? metrics.totalAdSpend) + expenses.range.nonAdMarketing) / (metrics.netSales ?? metrics.totalRevenue)) * 100).toFixed(1) : '—'}% of net sales`}
            accentColor="#a5b4fc"
          />
        ) : (
          <MetricCard
            title="Blended MER"
            value={formatROAS(metrics.mer)}
            subtitle="Across all platforms"
            accentColor={metrics.mer >= MER_GOAL ? '#86efac' : '#fca5a5'}
            valueColor={merColor}
            comparison={compareOn && priorPeriod ? { current: metrics.mer, prior: priorPeriod.mer, label: deltaLabel } : undefined}
            trend={!(compareOn && priorPeriod) ? {
              value: metrics.mer >= MER_GOAL ? `Above ${MER_GOAL}x goal` : `Below ${MER_GOAL}x goal`,
              positive: metrics.mer >= MER_GOAL,
            } : undefined}
          />
        )}
      </div>

      {/* New vs Returning Customer Cards — hidden on Today: the customer
          match hasn't settled mid-day and would misreport the split */}
      {metrics.newCustomers !== undefined && metrics.newCustomers > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {tfRaw !== 'today' && (
            <>
              {!isPartner && (<>
              <MetricCard
                title="New Customers"
                value={String(metrics.newCustomers)}
                subtitle={`${metrics.pctNew?.toFixed(1) ?? 0}% of customers${metrics.newCustomerRevenue ? ` · ${formatCurrency(metrics.newCustomerRevenue)} revenue` : ''}`}
                accentColor="#a5f3fc"
                comparison={compareOn && priorPeriod?.newCustomers ? { current: metrics.newCustomers, prior: priorPeriod.newCustomers, label: `${deltaLabel} (${priorPeriod.newCustomers.toLocaleString()} customers)` } : undefined}
              />
              <MetricCard
                title="Returning Customers"
                value={String(metrics.returningCustomers ?? 0)}
                subtitle={`${metrics.pctReturning?.toFixed(1) ?? 0}% of customers${metrics.returningCustomerRevenue ? ` · ${formatCurrency(metrics.returningCustomerRevenue)} revenue` : ''}`}
                accentColor="#bbf7d0"
                comparison={compareOn && priorPeriod?.returningCustomers ? { current: metrics.returningCustomers ?? 0, prior: priorPeriod.returningCustomers, label: `${deltaLabel} (${priorPeriod.returningCustomers.toLocaleString()} customers)` } : undefined}
              />
              </>)}
              <MetricCard
                title="New Customer CAC"
                value={metrics.newCustomers ? formatCurrency((metrics.netAdSpend ?? metrics.totalAdSpend) / metrics.newCustomers) : '—'}
                subtitle={`${metrics.adCreditApplied ? 'Net ad spend (credits deducted)' : 'Ad spend'} ÷ new customers · target ${goalsNow.cacLabel}${CAC_CEILING != null ? ` · ceiling $${CAC_CEILING}` : ''}`}
                accentColor="#c7d2fe"
                valueColor={metrics.newCustomers ? cacTone((metrics.netAdSpend ?? metrics.totalAdSpend) / metrics.newCustomers) : undefined}
              />
              <MetricCard
                title="Blended CAC"
                value={(metrics.newCustomers ?? 0) + (metrics.returningCustomers ?? 0) > 0
                  ? formatCurrency((metrics.netAdSpend ?? metrics.totalAdSpend) / ((metrics.newCustomers ?? 0) + (metrics.returningCustomers ?? 0)))
                  : '—'}
                subtitle="Ad spend ÷ all buyers"
                accentColor="#bbf7d0"
              />
            </>
          )}
          {(() => {
            // Per-platform margin after COGS + that platform's spend, on its
            // attributed revenue: rev × (1 − COGS%) − spend. COGS% comes from
            // the booked P&L months (admin-only basis endpoint) — the margin
            // line simply hides when it isn't available.
            const cogs = profitBasis?.cogsPct;
            const platSub = (spend: number, revenue: number) => {
              let s = `${spend && metrics.totalAdSpend ? ((spend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`;
              if (cogs !== null && cogs !== undefined && revenue > 0 && spend > 0) {
                const margin = revenue * (1 - cogs / 100) - spend;
                const pct = (margin / revenue) * 100;
                s += ` · margin ${margin >= 0 ? '' : '−'}${formatCurrency(Math.abs(margin), true)} (${pct.toFixed(0)}%) after COGS & spend`;
              }
              return s;
            };
            return (
              <>
                <MetricCard
                  title="Meta Spend"
                  value={formatCurrency(metrics.metaSpend ?? 0)}
                  subtitle={platSub(metrics.metaSpend ?? 0, metrics.metaRevenue ?? 0)}
                  accentColor="#c7d2fe"
                />
                <MetricCard
                  title="Google Spend"
                  value={formatCurrency(metrics.googleSpend ?? 0)}
                  subtitle={`${spendLag.find(l => l.key === 'google') ? `⏳ Still syncing — about ${formatCurrency(spendLag.find(l => l.key === 'google')!.expected)} expected by now · ` : ''}${platSub(metrics.googleSpend ?? 0, metrics.googleRevenue ?? 0)}`}
                  accentColor="#fef08a"
                  valueColor={spendLag.some(l => l.key === 'google') ? '#d97706' : undefined}
                />
                {(runs('tiktok') || (metrics.tiktokSpend ?? 0) > 0) && (
                  <MetricCard
                    title="TikTok Spend"
                    value={formatCurrency(metrics.tiktokSpend ?? 0)}
                    subtitle={`${spendLag.find(l => l.key === 'tiktok') ? `⏳ Still syncing — about ${formatCurrency(spendLag.find(l => l.key === 'tiktok')!.expected)} expected by now · ` : ''}${platSub(metrics.tiktokSpend ?? 0, metrics.tiktokRevenue ?? 0)}`}
                    valueColor={spendLag.some(l => l.key === 'tiktok') ? '#d97706' : undefined}
                    accentColor="#fbcfe8"
                  />
                )}
                {(runs('pinterest') || (metrics.pinterestSpend ?? 0) > 0) && (
                  <MetricCard
                    title="Pinterest Spend"
                    value={formatCurrency(metrics.pinterestSpend ?? 0)}
                    subtitle={`${spendLag.find(l => l.key === 'pinterest') ? `⏳ Still syncing — about ${formatCurrency(spendLag.find(l => l.key === 'pinterest')!.expected)} expected by now · ` : ''}${platSub(metrics.pinterestSpend ?? 0, metrics.pinterestRevenue ?? 0)}`}
                    valueColor={spendLag.some(l => l.key === 'pinterest') ? '#d97706' : undefined}
                    accentColor="#fecdd3"
                  />
                )}
                {(metrics.snapchatSpend ?? 0) > 0 && (
                  <MetricCard
                    title="Snapchat Spend"
                    value={formatCurrency(metrics.snapchatSpend ?? 0)}
                    subtitle={platSub(metrics.snapchatSpend ?? 0, metrics.snapchatRevenue ?? 0)}
                    accentColor="#fde047"
                  />
                )}
                {profitBasis?.cogsPct !== null && profitBasis?.cogsPct !== undefined && (metrics.netSales ?? metrics.totalRevenue) > 0 && (() => {
                  const net = metrics.netSales ?? metrics.totalRevenue;
                  const cogsDollars = net * (profitBasis.cogsPct! / 100);
                  const adSpend = metrics.netAdSpend ?? metrics.totalAdSpend;
                  const contrib = net - cogsDollars - adSpend;
                  return (
                    <>
                      <MetricCard
                        title="COGS (est.)"
                        value={formatCurrency(cogsDollars)}
                        subtitle={`${profitBasis.cogsPct}% of net sales · ${profitBasis.cogsSource === 'profile' ? 'from the stated gross margin (no books connected yet)' : 'rate from booked P&L months'}`}
                        accentColor="#fdba74"
                      />
                      <MetricCard
                        title="Contribution Margin"
                        value={formatCurrency(contrib)}
                        subtitle={`${net > 0 ? ((contrib / net) * 100).toFixed(1) : 0}% of net sales · after COGS + ad spend, before overhead`}
                        accentColor={contrib >= 0 ? '#86efac' : '#fca5a5'}
                        valueColor={contrib >= 0 ? '#16a34a' : '#dc2626'}
                      />
                    </>
                  );
                })()}
              </>
            );
          })()}
          <MetricCard
            title="Website Conversion Rate"
            value={metrics.conversionRate ? `${metrics.conversionRate.toFixed(1)}%` : '—'}
            subtitle={metrics.botSessions
              ? `Human sessions that checked out, as Shopify Analytics counts it · ${metrics.botSessions.toLocaleString()} bot sessions excluded (all sessions: ${(metrics.conversionRateRaw ?? 0).toFixed(1)}%)`
              : 'Human sessions that checked out · no bot traffic detected'}
            accentColor="#a7f3d0"
          />
        </div>
      )}
      {/* ── True profit: net sales − COGS − live ad spend − every other marketing
          cost from the budgeting sheet (admin-only; hides when no sheet). ── */}
      {!isPartner && tfRaw !== 'today' && (
        <MarketingExpenses tf={tfRaw} dateFrom={dateFrom} dateTo={dateTo} data={expenses === undefined ? undefined : expenses}
          netSales={metrics.netSales ?? metrics.totalRevenue} adSpend={metrics.netAdSpend ?? metrics.totalAdSpend}
          newCustomers={metrics.newCustomers ?? 0} cogsPct={profitBasis?.cogsPct ?? (client.finance.grossMarginPct != null ? 100 - client.finance.grossMarginPct : null)} />
      )}

      {/* ── The intelligence layer: what moved yesterday, why, and what to do.
          Below every metric card, so the numbers come first. ── */}

      {metrics.newCustomers !== undefined && metrics.newCustomers > 0 && tfRaw !== 'today' && !isPartner && (
        <NcacBreakdown tf={tfRaw} dateFrom={dateFrom} dateTo={dateTo} compare={compareOn} compareTo={compareTo} targetCac={TARGET_CAC} />
      )}

      {/* ── By product line (women's vs kids …) ── */}
      {isLive && !isPartner && client.lines && client.lines.length > 0 && (
        <Card accentColor="#f9a8d4" className="mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-sm font-bold text-gray-700">By Product Line</h2>
            {lineSplit?.lines?.length ? (
              <span className="text-[11px] text-gray-400">
                Revenue & orders from Shopify by product type · ad spend by campaign name · cost per order vs each line's target
              </span>
            ) : null}
          </div>
          {!lineSplit ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : lineSplit.shopifyError ? (
            <p className="text-xs text-amber-600">Shopify didn't answer the product-type query ({lineSplit.shopifyError}). Try Refresh.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              {lineSplit.lines.map(l => {
                const cpaOk = l.cpa === null || l.cpa <= l.targetCpa;
                const merOk = l.mer === null || l.mer >= MER_GOAL;
                const spendParts = Object.entries(l.spendByPlatform).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${formatCurrency(v)}`).join(' · ');
                return (
                  <div key={l.key} className="rounded-xl border border-gray-100 p-4">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="font-bold text-gray-800">{l.label}</span>
                      <span className="text-xs text-gray-400">{Math.round(l.shareOfNet * 100)}% of net sales · plan {Math.round(l.revenueShare * 100)}%</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-gray-400 uppercase font-semibold mb-0.5">Net Sales</p>
                        <p className="font-bold text-gray-800">{formatCurrency(l.netSales)}</p>
                        <p className="text-gray-400">{l.orders.toLocaleString()} orders</p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase font-semibold mb-0.5">Ad Spend</p>
                        <p className="font-bold text-gray-800">{formatCurrency(l.spend)}</p>
                        <p className="text-gray-400 line-clamp-2">{spendParts || '—'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase font-semibold mb-0.5">MER</p>
                        <p className="font-bold" style={{ color: merOk ? '#22c55e' : '#ef4444' }}>{l.mer !== null ? `${l.mer.toFixed(2)}x` : '—'}</p>
                        <p className="text-gray-400">goal {MER_GOAL}x</p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase font-semibold mb-0.5">Cost / Order</p>
                        <p className="font-bold" style={{ color: cpaOk ? '#22c55e' : '#ef4444' }}>{l.cpa !== null ? formatCurrency(l.cpa) : '—'}</p>
                        <p className="text-gray-400">target {formatCurrency(l.targetCpa)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {lineSplit?.unmatchedProductTypes?.length ? (
            <p className="text-[11px] text-gray-400 mt-2">Product types not assigned to a line: {lineSplit.unmatchedProductTypes.join(', ')}</p>
          ) : null}
        </Card>
      )}

      {/* ── Month-end forecast (MTD pace) ── */}
      {isLive && !isPartner && forecast && (
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
          {/* The pace truth: month-to-date vs the SAME days of last month. */}
          {mtdSnap && sameDaysSnap && sameDaysSnap.revenue > 0 && (() => {
            const pct = ((mtdSnap.revenue - sameDaysSnap.revenue) / sameDaysSnap.revenue) * 100;
            return (
              <p className={`text-sm font-bold mb-3 ${pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs the same {forecast.daysElapsed} days of last month
                <span className="text-xs text-gray-400 font-normal"> ({formatCurrency(mtdSnap.revenue)} vs {formatCurrency(sameDaysSnap.revenue)})</span>
              </p>
            );
          })()}
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
                      {delta >= 0 ? '+' : ''}{delta.toFixed(0)}% vs last month&apos;s FULL {s.isRatio ? `${s.prior!.toFixed(2)}x` : 'total'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {forecast.platforms.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Projected ad spend by platform</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {forecast.platforms.map(p => {
                  const prior = lastMonthSnap?.byPlatform?.[p.key] ?? 0;
                  const delta = prior > 0 ? ((p.projected - prior) / prior) * 100 : null;
                  const share = forecast.spendF > 0 ? (p.projected / forecast.spendF) * 100 : 0;
                  return (
                    <div key={p.key} className="bg-white border border-blue-100 rounded-xl px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-gray-500">{p.label} <span className="text-gray-400 font-normal">· {share.toFixed(0)}%</span></p>
                      <p className="text-lg font-bold text-gray-800 tabular-nums">{formatCurrency(p.projected)}</p>
                      <p className="text-[11px] text-gray-400 tabular-nums">{formatCurrency(p.mtd)} so far</p>
                      {delta !== null && (
                        <p className={`text-[11px] font-semibold ${delta <= 0 ? 'text-green-600' : 'text-red-500'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(0)}% vs last month&apos;s {formatCurrency(prior)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3">
            Simple pace projection: month-to-date ÷ days elapsed × days in month, for the total and for each platform. Doesn&apos;t account for planned launches or seasonal swings — check the calendar for what&apos;s ahead.
          </p>
        </Card>
      )}

      {/* ── This week's marketing (from the Marketing Calendar) ── */}
      {isLive && !isPartner && (marketingThisWeek.live.length > 0 || marketingThisWeek.upcoming.length > 0) && (
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
      {isLive && !isPartner && (callouts.good.length > 0 || callouts.attention.length > 0) && (
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
            Sales, ads, customers &amp; returns reflect {isCustom && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tf] || tf)}{compareOn ? ` (vs ${compareBasis})` : ''}. Inventory &amp; stock alerts are always current.
          </p>
        </div>
      )}

      {/* Charts Row */}
      {/* Month-by-month history for 3-month-and-longer ranges */}
      {isLive && (() => {
        const r = tfRange(tfRaw as Timeframe | 'custom', dateFrom, dateTo);
        const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
        if (days < 85) return null;
        return <MonthlyHistory from={r.from} to={r.to} targetMer={MER_GOAL} targetCac={TARGET_CAC} defaultYoY={compareOn && compareTo === 'year'} />;
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {(tfRaw === 'today' || tfRaw === 'yesterday') && !isPartner ? (
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
                <h2 className="text-sm font-bold text-gray-700">Revenue, Ad Spend & MER Trend</h2>
                <p className="text-xs text-gray-400">Purple = Revenue · Pink = Ad Spend · Indigo = MER (own panel below)</p>
              </div>
            </div>
            <RevenueChart data={revenueData} merGoal={MER_GOAL} />
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
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Purchases</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Cost / Purchase</th>
              </tr>
            </thead>
            <tbody>
              {(livePlatformSpend ?? []).map((raw) => {
                // Cost per purchase exactly as the platform reports it: its spend ÷ its
                // own purchase count. Not de-duplicated — each platform claims its own.
                const pp = platformPurchases[raw.platform];
                const p = { ...raw, purchases: pp ? pp.purchases : null, cac: pp && pp.purchases > 0 ? pp.costPerPurchase : null };
                return (
                <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold text-gray-700">{p.platform}</span>
                    </div>
                    {pp?.attribution && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{pp.attribution}</p>}
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
                  <td className="py-3 px-4 text-right text-gray-600">{p.purchases != null ? p.purchases.toLocaleString() : '—'}</td>
                  <td className="py-3 pl-4 text-right font-semibold" style={{ color: p.cac ? (p.cac > TARGET_CAC ? '#ef4444' : '#22c55e') : undefined }}>
                    {p.cac ? formatCurrency(p.cac) : '—'}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          {`Cost / Purchase = this platform's spend ÷ the purchases it reports — the same cost per purchase (Meta), cost per conversion (Google) or cost per complete payment (TikTok) shown inside each ads manager, coloured against the $${TARGET_CAC} target. Purchases and ROAS are each platform's own attribution, so they overlap and add up to more than the store's orders. Neither is a new-customer CAC; that's the New Customer CAC card above.`}
        </p>
      </Card>
    </div>
  );
}
