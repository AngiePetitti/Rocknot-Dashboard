'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type Prefs = { tasks: boolean; reports: boolean; alerts: boolean };
type Status = 'unsupported' | 'unconfigured' | 'loading' | 'off' | 'on' | 'blocked';

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(Array.from(raw).map(c => c.charCodeAt(0)));
}

/**
 * Sidebar bell: turns browser notifications on for this login on this device
 * (tasks assigned to you, your tasks due today, reports ready, data alerts),
 * with per-kind toggles. Also fires the once-a-day task digest on the first
 * dashboard load of the day.
 */
export default function NotificationBell({ compact = false }: { compact?: boolean }) {
  const { data: session } = useSession();
  const [status, setStatus] = useState<Status>('loading');
  const [prefs, setPrefs] = useState<Prefs>({ tasks: true, reports: true, alerts: true });
  const [publicKey, setPublicKey] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setStatus('unsupported'); return; }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        const r = await fetch(`/api/push/subscribe${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`, { cache: 'no-store' });
        const d = await r.json();
        if (cancelled) return;
        setPublicKey(d.publicKey || '');
        if (d.prefs) setPrefs(d.prefs);
        if (!d.configured) { setStatus('unconfigured'); return; }
        if (Notification.permission === 'denied') { setStatus('blocked'); return; }
        setStatus(sub && d.thisDevice ? 'on' : 'off');
        // Morning digest: once per day per login, from the first load.
        if (sub && d.thisDevice) {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
          const k = 'rk_push_digest_day';
          try {
            if (localStorage.getItem(k) !== today) { localStorage.setItem(k, today); fetch('/api/push/digest', { method: 'POST' }).catch(() => {}); }
          } catch { /* ignore */ }
        }
      } catch (e) { if (!cancelled) { setStatus('off'); setError(e instanceof Error ? e.message : String(e)); } }
    })();
    return () => { cancelled = true; };
  }, [session?.user]);

  async function enable() {
    setBusy(true); setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) as BufferSource });
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), prefs }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not register this device');
      setStatus('on');
      try { localStorage.setItem('rk_push_digest_day', ''); } catch { /* ignore */ }
      fetch('/api/push/digest', { method: 'POST' }).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }); await sub.unsubscribe(); }
      setStatus('off');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function savePrefs(next: Prefs) {
    setPrefs(next);
    fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs: next }) }).catch(() => {});
  }

  if (!session?.user || status === 'unsupported' || status === 'unconfigured') return null;
  const on = status === 'on';
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} title={on ? 'Notifications on' : 'Turn on notifications'}
        className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors ${on ? 'bg-violet-50 text-violet-700 hover:bg-violet-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
        <span className="text-sm">{on ? '🔔' : '🔕'}</span>
        {!compact && <span>{on ? 'Notifications on' : status === 'blocked' ? 'Notifications blocked' : 'Turn on notifications'}</span>}
      </button>
      {open && (
        <div className="absolute z-50 bottom-full mb-2 left-0 w-72 rounded-2xl border border-gray-100 bg-white shadow-xl p-3 text-xs">
          <p className="font-bold text-gray-800 mb-1">Browser notifications</p>
          {status === 'blocked' ? (
            <p className="text-gray-500">Blocked in this browser. Allow notifications for this site in the address-bar settings, then reload.</p>
          ) : (
            <>
              <p className="text-gray-500 mb-2">Desktop and phone alerts for this login on this device, even when the tab is closed.</p>
              <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={prefs.tasks} onChange={e => savePrefs({ ...prefs, tasks: e.target.checked })} /> Tasks assigned to me, and mine due today</label>
              <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={prefs.reports} onChange={e => savePrefs({ ...prefs, reports: e.target.checked })} /> Cleo finished one of my reports</label>
              <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={prefs.alerts} onChange={e => savePrefs({ ...prefs, alerts: e.target.checked })} /> Data alerts (spend mismatches, feed problems)</label>
              <div className="mt-2 flex gap-2">
                {on ? (
                  <button disabled={busy} onClick={disable} className="flex-1 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-1.5">Turn off on this device</button>
                ) : (
                  <button disabled={busy || !publicKey} onClick={enable} className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold py-1.5">{busy ? 'Enabling…' : 'Turn on'}</button>
                )}
              </div>
              {error && <p className="text-red-600 mt-2 break-words">{error}</p>}
              <p className="text-[10px] text-gray-400 mt-2">iPhone: add the dashboard to your Home Screen first (Share → Add to Home Screen), then turn on from there.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
