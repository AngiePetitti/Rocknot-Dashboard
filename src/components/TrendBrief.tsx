'use client';

import { useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';
import type { TrendBrief as Brief } from '@/src/lib/trends';

type Channel = 'social' | 'email' | 'sms';
const CHANNEL_LABEL: Record<Channel, string> = { social: 'Social', email: 'Email', sms: 'SMS' };

function ago(iso: string): string {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000));
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function TrendBrief({ brandName }: { brandName: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('social');
  const [open, setOpen] = useState(true);

  async function refresh() {
    setRefreshing(true); setError(null);
    try {
      const r = await fetch('/api/trends', { method: 'POST' });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setBrief(d.brief);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not refresh'); }
    finally { setRefreshing(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/trends', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d.error && !d.brief) setError(d.error);
      setBrief(d.brief || null);
      setLoading(false);
      // Older than a day → refresh quietly in the background; the stored one shows meanwhile.
      if (d.brief && d.stale) refresh();
    }).catch(() => { if (!cancelled) { setError('Could not load trends'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card accentColor="#f472b6" className="mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-gray-700">✨ On Trend — what {brandName} should be riding this week</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Live web scan of the category, the calendar and pop culture · refreshed daily
            {brief && <> · updated {ago(brief.generatedAt)}</>}
            {refreshing && <> · updating…</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing || loading} className="text-xs font-semibold text-violet-600 disabled:opacity-50">{refreshing ? 'Scanning…' : 'Refresh'}</button>
          <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400">{open ? 'Hide' : 'Show'}</button>
        </div>
      </div>

      {loading && <p className="text-xs text-gray-400 mt-3">Scanning the web for what is moving right now… first load takes about a minute.</p>}
      {error && !brief && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {open && brief && (
        <div className="mt-3">
          {brief.headline && <p className="text-sm font-semibold text-gray-800 mb-4">{brief.headline}</p>}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-pink-600 uppercase tracking-wider mb-2">Trending now</p>
              <ul className="space-y-2.5">
                {brief.now.map((t, i) => (
                  <li key={i} className="text-xs">
                    <p className="font-semibold text-gray-800">{t.title}</p>
                    <p className="text-gray-500">{t.why}</p>
                    {t.angle && <p className="text-violet-700 mt-0.5">→ {t.angle}</p>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-2">Coming up</p>
              <ul className="space-y-2.5">
                {brief.upcoming.map((t, i) => (
                  <li key={i} className="text-xs">
                    <p className="font-semibold text-gray-800">{t.date && <span className="text-amber-700 mr-1.5">{t.date}</span>}{t.title}</p>
                    <p className="text-gray-500">{t.why}</p>
                    {t.angle && <p className="text-violet-700 mt-0.5">→ {t.angle}</p>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-cyan-600 uppercase tracking-wider mb-2">Pop culture to ride</p>
              <ul className="space-y-2.5">
                {brief.popCulture.map((t, i) => (
                  <li key={i} className="text-xs">
                    <p className="font-semibold text-gray-800">{t.title}</p>
                    <p className="text-gray-500">{t.why}</p>
                    {t.angle && <p className="text-violet-700 mt-0.5">→ {t.angle}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Content ideas</p>
              {(['social', 'email', 'sms'] as Channel[]).map(ch => (
                <button key={ch} onClick={() => setChannel(ch)} className={`text-xs px-2.5 py-1 rounded-full font-semibold ${channel === ch ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>{CHANNEL_LABEL[ch]}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {brief.ideas[channel].map((idea, i) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
                  <p className="font-semibold text-gray-800">{idea.hook}</p>
                  <p className="text-gray-500 mt-1">{idea.format}{idea.cta ? ` · CTA: ${idea.cta}` : ''}</p>
                </div>
              ))}
            </div>
          </div>

          {brief.sources.length > 0 && (
            <p className="text-[11px] text-gray-400 mt-4">
              Sources: {brief.sources.map((s, i) => (
                <span key={i}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title}</a></span>
              ))}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
