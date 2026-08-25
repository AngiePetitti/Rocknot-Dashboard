// Klaviyo email/SMS data via their REST API (private key in KLAVIYO_API_KEY).
// Defensive like the other connectors: every call surfaces its real error so
// a wrong scope or schema shows up on the tab instead of silent zeros.

const KEY = (process.env.KLAVIYO_API_KEY || '').trim();
const REVISION = '2024-10-15';

export function klaviyoConfigured(): boolean {
  return Boolean(KEY);
}

async function kfetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
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
  let url: string | null = `/api/campaigns?filter=${encodeURIComponent(`equals(messages.channel,'${channel}')`)}&sort=-created_at&page[size]=50`;
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
  const json = await kfetch('/api/metrics?page[size]=100');
  const metrics = (json.data as Array<{ id: string; attributes?: { name?: string } }>) || [];
  return metrics.find(m => m.attributes?.name === 'Placed Order')?.id
    ?? metrics.find(m => /placed order/i.test(m.attributes?.name || ''))?.id
    ?? null;
}

// Per-campaign stats for the last 30 days via the Campaign Values Report.
async function campaignValues(conversionMetricId: string): Promise<Map<string, { recipients: number; openRate: number; clickRate: number; revenue: number }>> {
  const map = new Map<string, { recipients: number; openRate: number; clickRate: number; revenue: number }>();
  const body = {
    data: {
      type: 'campaign-values-report',
      attributes: {
        timeframe: { key: 'last_30_days' },
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

export interface RetentionData {
  overview: {
    email: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number };
    sms: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number };
  };
  recent: KlaviyoCampaign[];     // sent in ~last 30 days, with stats
  scheduled: KlaviyoCampaign[];  // draft/queued/scheduled upcoming
  statsError?: string;
}

export async function fetchRetentionData(): Promise<RetentionData> {
  const [email, sms] = await Promise.all([listCampaigns('email'), listCampaigns('sms')]);
  const all = [...email, ...sms];

  let statsError: string | undefined;
  try {
    const metricId = await placedOrderMetricId();
    if (!metricId) throw new Error("No 'Placed Order' metric found in Klaviyo");
    const values = await campaignValues(metricId);
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
  const cutoff = now - 35 * 86400000;
  const sentRecently = (c: KlaviyoCampaign) =>
    c.status === 'sent' && (!c.sendTime || Date.parse(c.sendTime) >= cutoff || c.recipients !== undefined);
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
    recent: recent.slice(0, 40),
    scheduled: all.filter(isScheduled).sort((a, b) => (a.sendTime || '9999').localeCompare(b.sendTime || '9999')).slice(0, 25),
    ...(statsError ? { statsError } : {}),
  };
}
