// Klaviyo email/SMS data via their REST API (private key in KLAVIYO_API_KEY).
// Defensive like the other connectors: every call surfaces its real error so
// a wrong scope or schema shows up on the tab instead of silent zeros.

const KEY = (process.env.KLAVIYO_API_KEY || '').trim();
const REVISION = '2024-10-15';

export function klaviyoConfigured(): boolean {
  return Boolean(KEY);
}

// Klaviyo's reporting API takes a custom timeframe as ISO datetimes with an
// offset. Both stores report in Pacific time, so a dashboard day runs from
// 00:00:00 to 23:59:59 America/Los_Angeles (DST-aware).
function laOffset(dateStr: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const v = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-]\d{2}:\d{2})/.exec(v);
    if (m) return m[1];
  } catch { /* fall through */ }
  const month = Number(dateStr.slice(5, 7));
  return month >= 4 && month <= 10 ? '-07:00' : '-08:00';
}
function klaviyoTimeframe(from: string, to: string): { start: string; end: string } {
  return { start: `${from}T00:00:00${laOffset(from)}`, end: `${to}T23:59:59${laOffset(to)}` };
}

async function kfetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    ...(init?.method === 'POST' ? {} : { next: { revalidate: 300 } }),
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${KEY}`,
      revision: REVISION,
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json as { errors?: Array<{ detail?: string }> }).errors?.[0]?.detail || `HTTP ${res.status}`;
    throw new Error(`Klaviyo ${path.split('?')[0]}: ${detail}`);
  }
  return json as Record<string, unknown>;
}

export interface KlaviyoCampaign {
  id: string;
  name: string;
  channel: 'email' | 'sms';
  status: string;
  sendTime: string | null;
  // Stats filled from the values report when available
  recipients?: number;
  openRate?: number;
  clickRate?: number;
  revenue?: number;
}

interface CampaignData { id: string; attributes?: { name?: string; status?: string; send_time?: string; scheduled_at?: string; created_at?: string } }

async function listCampaigns(channel: 'email' | 'sms'): Promise<KlaviyoCampaign[]> {
  const out: KlaviyoCampaign[] = [];
  // NOTE: the campaigns endpoint rejects page[size]; pagination is via the
  // cursor links only.
  let url: string | null = `/api/campaigns?filter=${encodeURIComponent(`equals(messages.channel,'${channel}')`)}&sort=-created_at`;
  for (let page = 0; page < 3 && url; page++) {
    const json = await kfetch(url);
    for (const c of (json.data as CampaignData[]) || []) {
      const a = c.attributes || {};
      out.push({
        id: c.id,
        name: String(a.name || 'Untitled'),
        channel,
        status: String(a.status || 'unknown').toLowerCase(),
        sendTime: a.send_time || a.scheduled_at || null,
      });
    }
    const next = (json.links as { next?: string } | undefined)?.next || null;
    url = next ? next.replace('https://a.klaviyo.com', '') : null;
  }
  return out;
}

async function placedOrderMetricId(): Promise<string | null> {
  let url: string | null = '/api/metrics';
  for (let page = 0; page < 4 && url; page++) {
    const json = await kfetch(url);
    const metrics = (json.data as Array<{ id: string; attributes?: { name?: string } }>) || [];
    const hit = metrics.find(m => m.attributes?.name === 'Placed Order')
      ?? metrics.find(m => /placed order/i.test(m.attributes?.name || ''));
    if (hit) return hit.id;
    const next = (json.links as { next?: string } | undefined)?.next || null;
    url = next ? next.replace('https://a.klaviyo.com', '') : null;
  }
  return null;
}

// Per-campaign stats for the last 30 days via the Campaign Values Report.
async function campaignValues(conversionMetricId: string, from: string, to: string): Promise<Map<string, { recipients: number; openRate: number; clickRate: number; revenue: number }>> {
  const map = new Map<string, { recipients: number; openRate: number; clickRate: number; revenue: number }>();
  const body = {
    data: {
      type: 'campaign-values-report',
      attributes: {
        timeframe: klaviyoTimeframe(from, to),
        conversion_metric_id: conversionMetricId,
        statistics: ['recipients', 'open_rate', 'click_rate', 'conversion_value'],
      },
    },
  };
  const json = await kfetch('/api/campaign-values-reports/', { method: 'POST', body: JSON.stringify(body) });
  const results = ((json.data as { attributes?: { results?: unknown[] } })?.attributes?.results ?? []) as Array<{
    groupings?: { campaign_id?: string };
    statistics?: { recipients?: number; open_rate?: number; click_rate?: number; conversion_value?: number };
  }>;
  for (const r of results) {
    const id = r.groupings?.campaign_id;
    if (!id) continue;
    map.set(id, {
      recipients: Number(r.statistics?.recipients ?? 0),
      openRate: Number(r.statistics?.open_rate ?? 0),
      clickRate: Number(r.statistics?.click_rate ?? 0),
      revenue: Number(r.statistics?.conversion_value ?? 0),
    });
  }
  return map;
}

export interface KlaviyoFlow {
  id: string;
  name: string;
  status: string;
  recipients: number;
  openRate: number;
  clickRate: number;
  revenue: number;
}

export interface FlowsSummary {
  revenue: number;
  flows: number;        // flows that sent anything in the window
  recipients: number;
  avgOpenRate: number;
  avgClickRate: number;
  items: KlaviyoFlow[]; // sorted by revenue desc
  error?: string;       // e.g. key lacks flows:read
}

export interface RetentionData {
  overview: {
    email: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number };
    sms: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number };
  };
  // Automated flows (welcome, abandoned cart, post-purchase …) — usually the
  // larger half of owned revenue, and invisible in the campaign list.
  flows: FlowsSummary;
  recent: KlaviyoCampaign[];     // sent in ~last 30 days, with stats
  scheduled: KlaviyoCampaign[];  // draft/queued/scheduled upcoming
  statsError?: string;
}

async function listFlows(): Promise<Map<string, { name: string; status: string }>> {
  const map = new Map<string, { name: string; status: string }>();
  let url: string | null = '/api/flows?fields[flow]=name,status';
  while (url) {
    const json = await kfetch(url);
    for (const f of (json.data as Array<{ id: string; attributes?: { name?: string; status?: string } }>) || []) {
      map.set(f.id, { name: f.attributes?.name || f.id, status: f.attributes?.status || '' });
    }
    const next = (json.links as { next?: string } | undefined)?.next;
    url = next ? next.replace('https://a.klaviyo.com', '') : null;
  }
  return map;
}

// Per-flow stats for the last 30 days via the Flow Values Report. Results
// come per flow message; summed up to the flow (rates weighted by recipients).
async function flowValues(conversionMetricId: string, from: string, to: string): Promise<Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>> {
  const map = new Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>();
  const body = {
    data: {
      type: 'flow-values-report',
      attributes: {
        timeframe: klaviyoTimeframe(from, to),
        conversion_metric_id: conversionMetricId,
        statistics: ['recipients', 'open_rate', 'click_rate', 'conversion_value'],
      },
    },
  };
  const json = await kfetch('/api/flow-values-reports/', { method: 'POST', body: JSON.stringify(body) });
  const results = ((json.data as { attributes?: { results?: unknown[] } })?.attributes?.results ?? []) as Array<{
    groupings?: { flow_id?: string };
    statistics?: { recipients?: number; open_rate?: number; click_rate?: number; conversion_value?: number };
  }>;
  for (const r of results) {
    const id = r.groupings?.flow_id;
    if (!id) continue;
    const recipients = Number(r.statistics?.recipients ?? 0);
    const cur = map.get(id) || { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += recipients;
    cur.opens += Number(r.statistics?.open_rate ?? 0) * recipients;
    cur.clicks += Number(r.statistics?.click_rate ?? 0) * recipients;
    cur.revenue += Number(r.statistics?.conversion_value ?? 0);
    map.set(id, cur);
  }
  return map;
}

async function fetchFlows(metricIdPromise: Promise<string | null>, from: string, to: string): Promise<FlowsSummary> {
  const empty: FlowsSummary = { revenue: 0, flows: 0, recipients: 0, avgOpenRate: 0, avgClickRate: 0, items: [] };
  try {
    const [names, metricId] = await Promise.all([listFlows(), metricIdPromise]);
    if (!metricId) throw new Error("No 'Placed Order' metric found in Klaviyo");
    const values = await flowValues(metricId, from, to);
    const items: KlaviyoFlow[] = [];
    for (const [id, v] of Array.from(values.entries())) {
      if (v.recipients <= 0 && v.revenue <= 0) continue;
      const meta = names.get(id);
      items.push({
        id,
        name: meta?.name || id,
        status: meta?.status || '',
        recipients: v.recipients,
        openRate: v.recipients > 0 ? Math.round((v.opens / v.recipients) * 1000) / 10 : 0,
        clickRate: v.recipients > 0 ? Math.round((v.clicks / v.recipients) * 1000) / 10 : 0,
        revenue: Math.round(v.revenue),
      });
    }
    items.sort((a, b) => b.revenue - a.revenue);
    const recipients = items.reduce((s, f) => s + f.recipients, 0);
    const w = (f: (x: KlaviyoFlow) => number) => recipients > 0 ? items.reduce((s, x) => s + f(x) * x.recipients, 0) / recipients : 0;
    return {
      revenue: items.reduce((s, f) => s + f.revenue, 0),
      flows: items.length,
      recipients,
      avgOpenRate: Math.round(w(f => f.openRate) * 10) / 10,
      avgClickRate: Math.round(w(f => f.clickRate) * 10) / 10,
      items,
    };
  } catch (e) {
    return { ...empty, error: String(e instanceof Error ? e.message : e) };
  }
}

// Campaign + flow performance for a date range (YYYY-MM-DD, inclusive).
// Defaults to the last 30 days.
export async function fetchRetentionData(from?: string, to?: string): Promise<RetentionData> {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const rangeTo = to || todayStr;
  const rangeFrom = from || new Date(Date.parse(`${rangeTo}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const metricIdPromise = placedOrderMetricId().catch(() => null);
  const flowsPromise = fetchFlows(metricIdPromise, rangeFrom, rangeTo);
  const [email, sms] = await Promise.all([listCampaigns('email'), listCampaigns('sms')]);
  const all = [...email, ...sms];

  let statsError: string | undefined;
  try {
    const metricId = await metricIdPromise;
    if (!metricId) throw new Error("No 'Placed Order' metric found in Klaviyo");
    const values = await campaignValues(metricId, rangeFrom, rangeTo);
    for (const c of all) {
      const v = values.get(c.id);
      if (v) {
        c.recipients = v.recipients;
        c.openRate = Math.round(v.openRate * 1000) / 10;
        c.clickRate = Math.round(v.clickRate * 1000) / 10;
        c.revenue = Math.round(v.revenue);
      }
    }
  } catch (e) {
    statsError = String(e instanceof Error ? e.message : e);
  }

  const now = Date.now();
  // A campaign belongs to the range if it was sent inside it. The values
  // report only returns campaigns that sent in the window, so a campaign
  // with stats and no send_time is in range too.
  const sentRecently = (c: KlaviyoCampaign) => {
    if (c.status !== 'sent') return false;
    if (c.sendTime) {
      const d = c.sendTime.slice(0, 10);
      return d >= rangeFrom && d <= rangeTo;
    }
    return c.recipients !== undefined;
  };
  const isScheduled = (c: KlaviyoCampaign) =>
    ['draft', 'scheduled', 'queued', 'queued without recipients', 'sending'].includes(c.status)
    || (c.sendTime !== null && Date.parse(c.sendTime) > now);

  const agg = (list: KlaviyoCampaign[]) => {
    const withStats = list.filter(c => c.recipients !== undefined);
    const recipients = withStats.reduce((s, c) => s + (c.recipients || 0), 0);
    const w = (f: (c: KlaviyoCampaign) => number) =>
      recipients > 0 ? withStats.reduce((s, c) => s + f(c) * (c.recipients || 0), 0) / recipients : 0;
    return {
      revenue: withStats.reduce((s, c) => s + (c.revenue || 0), 0),
      campaigns: withStats.length,
      recipients,
      avgOpenRate: Math.round(w(c => c.openRate || 0) * 10) / 10,
      avgClickRate: Math.round(w(c => c.clickRate || 0) * 10) / 10,
    };
  };

  const recent = all.filter(sentRecently).sort((a, b) => (b.sendTime || '').localeCompare(a.sendTime || ''));
  return {
    overview: { email: agg(email.filter(sentRecently)), sms: agg(sms.filter(sentRecently)) },
    flows: await flowsPromise,
    recent: recent.slice(0, 40),
    scheduled: all.filter(isScheduled).sort((a, b) => (a.sendTime || '9999').localeCompare(b.sendTime || '9999')).slice(0, 25),
    ...(statsError ? { statsError } : {}),
  };
}
