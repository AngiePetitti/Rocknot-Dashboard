'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/src/components/ui/Card';
import type { MarketingEvent } from '@/src/app/api/calendar/route';

interface TemplateItem { label: string; daysBefore: number }
type EventChecks = Record<string, { done: boolean; by?: string; at?: string }>;

function pstToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
function daysUntil(date: string): number {
  return Math.round((Date.parse(date) - Date.parse(pstToday())) / 86400000);
}

// The standard launch/sale run-list, materialized per calendar event.
// Items become "due" at their lead time before the event — an unchecked
// item past its lead time shows red.
export default function LaunchChecklists({ events, isAdmin }: { events: MarketingEvent[]; isAdmin: boolean }) {
  const [template, setTemplate] = useState<TemplateItem[]>([]);
  const [byEvent, setByEvent] = useState<Record<string, EventChecks>>({});
  const [loaded, setLoaded] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/launch/checklist', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.template)) setTemplate(d.template);
        if (d?.byEvent) setByEvent(d.byEvent);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Placeholder-dated events ("date TBD", parked on the 1st) get no
  // countdown pressure — lead times are meaningless without a real date.
  const isTbd = (e: MarketingEvent) => /tbd|placeholder|to be confirmed|not confirmed|no confirmation/i.test(e.description || '');

  // Launches & sales from 21 days out through 3 days past (post-launch
  // last-chance items can still be pending on launch day).
  const upcoming = useMemo(() => {
    return events
      .filter(e => (e.type === 'launch' || e.type === 'sale') && !isTbd(e) && daysUntil(e.date) >= -3 && daysUntil(e.date) <= 21)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  // Undated launches wait in a compact holding list — checklist available,
  // nothing ever turns red until a real date is set on the event.
  const awaitingDate = useMemo(() => {
    return events
      .filter(e => (e.type === 'launch' || e.type === 'sale') && isTbd(e) && daysUntil(e.date) >= -14)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);
  const [showAwaiting, setShowAwaiting] = useState(false);

  async function toggle(eventId: string, label: string, done: boolean) {
    setByEvent(prev => ({
      ...prev,
      [eventId]: { ...(prev[eventId] || {}), [label]: { done, at: new Date().toISOString() } },
    }));
    try {
      const res = await fetch('/api/launch/checklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, label, done }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      setError('Could not save — check your connection and tap again.');
    }
  }

  async function saveTemplate() {
    const items = templateDraft.split('\n').map(line => {
      const m = line.match(/^(.*?)(?:\s*\|\s*(\d+))?\s*$/);
      return { label: (m?.[1] || '').trim(), daysBefore: Number(m?.[2] ?? 0) };
    }).filter(i => i.label);
    const res = await fetch('/api/launch/checklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: items }),
    });
    const d = await res.json();
    if (d?.template) { setTemplate(d.template); setEditingTemplate(false); }
    else setError(d?.error || 'Save failed');
  }

  if (!loaded || !template.length) return null;

  return (
    <Card accentColor="#f9a8d4" className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-bold text-gray-700 flex-1">🚀 Launch checklists</h2>
        {isAdmin && (
          <button
            onClick={() => {
              if (editingTemplate) { setEditingTemplate(false); return; }
              setTemplateDraft(template.map(t => `${t.label} | ${t.daysBefore}`).join('\n'));
              setEditingTemplate(true);
            }}
            className="text-[11px] font-semibold text-pink-500 hover:text-pink-700"
          >
            {editingTemplate ? 'Cancel' : '⚙ Edit playbook'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Every launch and sale on the calendar gets this run-list automatically — emails, SMS, banners, codes,
        content. Items turn red when their lead time passes unchecked. The same playbook applies to every event;
        edit it once and it&apos;s documented forever.
      </p>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {editingTemplate && (
        <div className="mb-4">
          <textarea
            value={templateDraft}
            onChange={e => setTemplateDraft(e.target.value)}
            rows={12}
            className="w-full text-xs font-mono border border-pink-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-pink-300"
          />
          <p className="text-[11px] text-gray-400 mt-1">One item per line: <code>Task name | days-before-launch</code></p>
          <button onClick={saveTemplate} className="mt-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-pink-500 text-white hover:bg-pink-600">Save playbook</button>
        </div>
      )}

      {(() => {
        const renderEvent = (ev: MarketingEvent, tbd: boolean) => {
            const days = daysUntil(ev.date);
            const checks = byEvent[ev.id] || {};
            const done = template.filter(t => checks[t.label]?.done).length;
            const overdue = tbd ? 0 : template.filter(t => !checks[t.label]?.done && days <= t.daysBefore).length;
            const isOpen = openEvent === ev.id || (!tbd && openEvent === null && upcoming[0]?.id === ev.id && days <= 7);
            const allDone = done === template.length;
            return (
              <div key={ev.id} className={`border rounded-xl ${allDone ? 'border-green-200 bg-green-50/30' : overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
                <button
                  onClick={() => setOpenEvent(isOpen ? '' : ev.id)}
                  className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left"
                >
                  <span className="text-sm font-semibold text-gray-800">{ev.title}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {tbd ? '📅 date TBD' : `${ev.date.slice(5)} · ${days > 0 ? `in ${days}d` : days === 0 ? 'TODAY' : `${-days}d ago`}`}
                  </span>
                  <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${allDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    ☑ {done}/{template.length}
                  </span>
                  {overdue > 0 && !allDone && (
                    <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700">
                      ⚠ {overdue} due now
                    </span>
                  )}
                  <span className="ml-auto text-gray-300 text-sm">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-1">
                    {[...template].sort((a, b) => b.daysBefore - a.daysBefore).map(t => {
                      const c = checks[t.label];
                      const isDue = !tbd && !c?.done && days <= t.daysBefore;
                      return (
                        <button
                          key={t.label}
                          onClick={() => toggle(ev.id, t.label, !c?.done)}
                          className="flex items-start gap-2 text-left w-full group"
                        >
                          <span className={`mt-0.5 w-4 h-4 shrink-0 rounded border text-[10px] font-bold flex items-center justify-center ${c?.done ? 'bg-green-500 border-green-500 text-white' : isDue ? 'border-red-400 bg-white' : 'border-gray-300 bg-white group-hover:border-pink-400'}`}>
                            {c?.done ? '✓' : ''}
                          </span>
                          <span className={`text-xs flex-1 ${c?.done ? 'text-gray-300 line-through' : isDue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                            {t.label}
                          </span>
                          <span className={`text-[10px] whitespace-nowrap ${isDue ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>
                            {c?.done && c.by ? `✓ ${c.by}` : t.daysBefore === 0 ? 'launch day' : `${t.daysBefore}d before`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
        };

        return (
          <>
            {upcoming.length === 0 && awaitingDate.length === 0 && (
              <p className="text-xs text-gray-400 py-2">No launches or sales on the calendar in the next 3 weeks. Add one above and its checklist appears here.</p>
            )}
            {upcoming.length > 0 && (
              <div className="flex flex-col gap-2">{upcoming.map(ev => renderEvent(ev, false))}</div>
            )}
            {awaitingDate.length > 0 && (
              <div className={upcoming.length > 0 ? 'mt-3 pt-2 border-t border-gray-100' : ''}>
                <button
                  onClick={() => setShowAwaiting(o => !o)}
                  className="text-[11px] font-semibold text-gray-400 hover:text-gray-600"
                >
                  {showAwaiting ? '▾' : '▸'} Waiting on a launch date ({awaitingDate.length}) — no countdown until the event gets a real date
                </button>
                {showAwaiting && (
                  <div className="flex flex-col gap-2 mt-2">{awaitingDate.map(ev => renderEvent(ev, true))}</div>
                )}
              </div>
            )}
          </>
        );
      })()}
    </Card>
  );
}
