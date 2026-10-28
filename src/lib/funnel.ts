// Ad budget by funnel stage — how much of each platform's spend goes to top,
// middle and bottom of funnel. Platforms expose no "stage" field, so the stage
// is read from campaign (and ad-set) names with keyword rules, plus Google's
// campaign type when Windsor returns it. Anything no rule matches is reported
// as "unclassified" with its name, so the rules can be extended for a client.
import { windsorParams, clientPlatforms, getClient, type PlatformKey } from '@/src/lib/client';

export type Stage = 'tof' | 'mof' | 'bof' | 'other';
export const STAGE_LABELS: Record<Stage, string> = { tof: 'Top of funnel', mof: 'Middle of funnel', bof: 'Bottom of funnel', other: 'Unclassified' };

export interface FunnelCampaign { name: string; spend: number; stage: Stage; reason: string }
export interface FunnelPlatform { key: PlatformKey; platform: string; spend: number; stages: Record<Stage, number>; campaigns: FunnelCampaign[]; error?: string }
export interface FunnelData { range: { from: string; to: string }; platforms: FunnelPlatform[]; totals: { spend: number; stages: Record<Stage, number> }; note: string }

// Order matters: bottom-of-funnel words win over top-of-funnel words, because
// "Prospecting – DPA retargeting" is a retargeting campaign.
const BOF = ['retarget', 'remarket', 'rtg', 'rmkt', 'dpa', 'catalog', 'catalogue', 'cart', 'abandon', 'checkout', 'viewed', 'visitor', 'website visitors', 'past purchasers', 'purchasers', 'customers', 'crm', 'email list', 'brand', 'branded', 'shopping', 'pmax', 'performance max', 'bof', 'bottom', 'conversion', 'conversions', 'hot'];
const MOF = ['mof', 'middle', 'mid-funnel', 'midfunnel', 'consideration', 'engag', 'video view', 'viewers', 'traffic', 'warm', 'social', 'ig engagers', 'fb engagers', 'page engagers', 'lead', 'nurture'];
const TOF = ['tof', 'top', 'prospect', 'cold', 'awareness', 'reach', 'broad', 'interest', 'lookalike', 'lal', 'asc', 'advantage+', 'advantage plus', 'acquisition', 'new customer', 'demand gen', 'discovery', 'youtube', 'display', 'video', 'non-brand', 'nonbrand', 'non brand', 'generic', 'testing', 'test'];

function hit(name: string, words: string[]): string | null {
  const n = ` ${name.toLowerCase().replace(/[_|/\-]+/g, ' ')} `;
  for (const w of words) if (n.includes(w)) return w;
  return null;
}

/** Classify one campaign by name (and Google channel type when known). */
export function classify(name: string, opts: { channelType?: string; adsetNames?: string[] } = {}): { stage: Stage; reason: string } {
  const rules = getClient().funnelRules;
  const text = [name, ...(opts.adsetNames || [])].join(' | ');
  // Client-specific words first (exact phrases set on the profile).
  for (const [stage, words] of [['bof', rules?.bof], ['mof', rules?.mof], ['tof', rules?.tof]] as Array<[Stage, string[] | undefined]>) {
    const w = words?.length ? hit(text, words.map(x => x.toLowerCase())) : null;
    if (w) return { stage, reason: `name contains "${w}"` };
  }
  const ct = (opts.channelType || '').toUpperCase();
  if (ct) {
    if (/SHOPPING|PERFORMANCE_MAX/.test(ct)) return { stage: 'bof', reason: `Google ${ct.toLowerCase().replace('_', ' ')} campaign` };
    if (/SEARCH/.test(ct)) {
      const w = hit(name, ['brand', 'branded']);
      return w ? { stage: 'bof', reason: 'brand search' } : { stage: 'mof', reason: 'non-brand search (people already looking)' };
    }
    if (/VIDEO|DISPLAY|DEMAND_GEN|DISCOVERY/.test(ct)) return { stage: 'tof', reason: `Google ${ct.toLowerCase().replace('_', ' ')} campaign` };
  }
  let w = hit(text, BOF); if (w) return { stage: 'bof', reason: `name contains "${w}"` };
  w = hit(text, MOF); if (w) return { stage: 'mof', reason: `name contains "${w}"` };
  w = hit(text, TOF); if (w) return { stage: 'tof', reason: `name contains "${w}"` };
  return { stage: 'other', reason: 'no funnel word in the campaign or ad-set name' };
}

type Row = Record<string, string | number | null | undefined>;
const API_KEY = process.env.WINDSOR_API_KEY;
const cache = new Map<string, { at: number; data: FunnelPlatform }>();
const CACHE_MS = 10 * 60 * 1000;

async function windsorRows(source: string, fields: string, params: Record<string, string>): Promise<Row[]> {
  const scoped = windsorParams(source, params);
  if (!scoped || !API_KEY) return [];
  const qs = new URLSearchParams({ api_key: API_KEY, fields, _renderer: 'json', ...scoped });
  const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`http_${res.status} from ${source}`);
  const json = await res.json();
  if (json.error) throw new Error(String(json.error));
  return (json.data || []) as Row[];
}

// Field sets per Windsor connector: campaign name, the ad-set name where the
// connector has one, spend. Google also tries its campaign type.
const FIELD_TRIES: Record<string, string[]> = {
  facebook: ['campaign,adset_name,spend', 'campaign,spend'],
  google_ads: ['campaign,advertising_channel_type,spend', 'campaign,campaign_advertising_channel_type,spend', 'campaign,spend'],
  tiktok: ['campaign,adset_name,spend', 'campaign,spend'],
  snapchat: ['campaign,ad_squad_name,spend', 'campaign,spend'],
  pinterest: ['campaign,ad_group_name,spend', 'campaign,spend'],
};

async function platformFunnel(key: PlatformKey, label: string, source: string, from: string, to: string, isToday: boolean): Promise<FunnelPlatform> {
  const ck = `${key}:${from}:${to}`;
  const hitc = cache.get(ck);
  if (!isToday && hitc && Date.now() - hitc.at < CACHE_MS) return hitc.data;
  const stages: Record<Stage, number> = { tof: 0, mof: 0, bof: 0, other: 0 };
  let rows: Row[] = []; let error: string | undefined;
  for (const fields of FIELD_TRIES[source] || ['campaign,spend']) {
    try { rows = await windsorRows(source, fields, { date_from: from, date_to: to }); error = undefined; break; }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  const byCampaign = new Map<string, { spend: number; adsets: Set<string>; channelType?: string }>();
  for (const r of rows) {
    const name = String(r.campaign || '').trim(); if (!name) continue;
    const spend = Number(r.spend || 0); if (!(spend > 0)) continue;
    const e = byCampaign.get(name) || { spend: 0, adsets: new Set<string>() };
    e.spend += spend;
    const adset = String(r.adset_name || r.ad_squad_name || r.ad_group_name || '').trim(); if (adset) e.adsets.add(adset);
    const ct = String(r.advertising_channel_type || r.campaign_advertising_channel_type || '').trim(); if (ct) e.channelType = ct;
    byCampaign.set(name, e);
  }
  const campaigns: FunnelCampaign[] = Array.from(byCampaign.entries()).map(([name, e]) => {
    const c = classify(name, { channelType: e.channelType, adsetNames: Array.from(e.adsets) });
    stages[c.stage] += e.spend;
    return { name, spend: Math.round(e.spend * 100) / 100, stage: c.stage, reason: c.reason };
  }).sort((a, b) => b.spend - a.spend);
  const data: FunnelPlatform = { key, platform: label, spend: Math.round(Object.values(stages).reduce((s, v) => s + v, 0) * 100) / 100, stages, campaigns, ...(error ? { error } : {}) };
  if (!isToday && !error) cache.set(ck, { at: Date.now(), data });
  return data;
}

export async function fetchFunnel(from: string, to: string, isToday = false): Promise<FunnelData> {
  const platforms = await Promise.all(clientPlatforms().map(p => platformFunnel(p.key, p.label, p.windsorSource, from, to, isToday).catch(e => ({ key: p.key, platform: p.label, spend: 0, stages: { tof: 0, mof: 0, bof: 0, other: 0 }, campaigns: [], error: e instanceof Error ? e.message : String(e) } as FunnelPlatform))));
  const totals = { spend: 0, stages: { tof: 0, mof: 0, bof: 0, other: 0 } as Record<Stage, number> };
  for (const p of platforms) { totals.spend += p.spend; (Object.keys(p.stages) as Stage[]).forEach(s => { totals.stages[s] += p.stages[s]; }); }
  return {
    range: { from, to },
    platforms: platforms.filter(p => p.spend > 0 || p.error),
    totals,
    note: 'Stage is read from campaign and ad-set names (retargeting, brand, shopping and catalog words = bottom; consideration, engagement, traffic = middle; prospecting, cold, broad, lookalike, awareness = top) and from Google campaign type. Campaigns with no funnel word are listed as unclassified — rename them or add words to the client profile.',
  };
}

export function funnelText(d: FunnelData): string {
  const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const pct = (v: number, t: number) => (t > 0 ? `${Math.round((v / t) * 100)}%` : '0%');
  const line = (label: string, spend: number, st: Record<Stage, number>) => `${label}: ${$(spend)} — top ${$(st.tof)} (${pct(st.tof, spend)}) · middle ${$(st.mof)} (${pct(st.mof, spend)}) · bottom ${$(st.bof)} (${pct(st.bof, spend)})${st.other > 0 ? ` · unclassified ${$(st.other)} (${pct(st.other, spend)})` : ''}`;
  const out = [`AD BUDGET BY FUNNEL STAGE ${d.range.from} → ${d.range.to}`, line('All platforms', d.totals.spend, d.totals.stages)];
  for (const p of d.platforms) {
    out.push(line(p.platform, p.spend, p.stages));
    const unc = p.campaigns.filter(c => c.stage === 'other').slice(0, 6);
    if (unc.length) out.push(`  unclassified: ${unc.map(c => `${c.name} (${$(c.spend)})`).join(', ')}`);
  }
  out.push(d.note);
  return out.join('\n');
}
