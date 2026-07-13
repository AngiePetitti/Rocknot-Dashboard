'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import type { MarketingEvent } from '@/src/app/api/calendar/route';

const TYPE_LABELS: Record<MarketingEvent['type'], string> = {
  deadline: 'Deadline',
  launch: 'Launch',
  sale: 'Sale',
  influencer: 'Influencer',
  content: 'Content Due',
  photo_shoot: 'Photo Shoot',
  other: 'Other',
};

const TYPE_COLORS: Record<MarketingEvent['type'], string> = {
  deadline: '#ef4444',
  launch: '#8b5cf6',
  sale: '#f59e0b',
  influencer: '#ec4899',
  content: '#3b82f6',
  photo_shoot: '#06b6d4',
  other: '#6b7280',
};

const TYPE_BG: Record<MarketingEvent['type'], string> = {
  deadline: 'bg-red-50 text-red-700',
  launch: 'bg-violet-50 text-violet-700',
  sale: 'bg-amber-50 text-amber-700',
  influencer: 'bg-pink-50 text-pink-700',
  content: 'bg-blue-50 text-blue-700',
  photo_shoot: 'bg-cyan-50 text-cyan-700',
  other: 'bg-gray-100 text-gray-600',
};

const CHANNEL_OPTIONS = ['Email', 'SMS', 'Paid', 'Organic', 'Other'];
type Status = 'planned' | 'live' | 'done';
const STATUS_OPTIONS: { value: Status; label: string; color: string; bg: string }[] = [
  { value: 'planned', label: 'Planned', color: '#64748b', bg: 'bg-slate-100 text-slate-600' },
  { value: 'live', label: 'Live', color: '#16a34a', bg: 'bg-green-100 text-green-700' },
  { value: 'done', label: 'Done', color: '#94a3b8', bg: 'bg-gray-100 text-gray-400' },
];
const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s])) as Record<Status, typeof STATUS_OPTIONS[number]>;

const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayObj() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

interface FormState {
  title: string;
  date: string;
  endDate: string;
  type: MarketingEvent['type'];
  channels: string[];
  status: Status;
  description: string;
}

const EMPTY_FORM: FormState = { title: '', date: '', endDate: '', type: 'launch', channels: [], status: 'planned', description: '' };

export default function CalendarContent() {
  const [events, setEvents] = useState<MarketingEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [{ year, month }, setView] = useState(todayObj());
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState<MarketingEvent | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const showModalRef = useRef(false);
  useEffect(() => { showModalRef.current = showModal; }, [showModal]);

  const refreshEvents = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const r = await fetch('/api/calendar', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) { setLoadError(d.error || 'Could not load calendar events.'); setStatus('error'); return; }
      setEvents(d.events || []);
      setLoadError(null);
      setStatus('ok');
      setLastSynced(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch {
      setLoadError('Could not reach the calendar.');
      setStatus('error');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  // Initial load + gentle auto-refresh so Google Sheet edits show up on their
  // own (paused while the add/edit modal is open, to not clobber typing).
  useEffect(() => {
    refreshEvents();
    const id = setInterval(() => { if (!showModalRef.current) refreshEvents(); }, 60000);
    return () => clearInterval(id);
  }, [refreshEvents]);

  // ── Performance overlay ──
  // Actual daily revenue + ad spend for the visible month, so you can see
  // whether a launch/sale/campaign actually moved the needle.
  const [perf, setPerf] = useState<Record<string, { revenue: number; spend: number }>>({});
  const [showPerf, setShowPerf] = useState(true);

  useEffect(() => {
    const mm = String(month + 1).padStart(2, '0');
    const lastDay = new Date(year, month + 1, 0).getDate();
    const from = `${year}-${mm}-01`;
    const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    fetch(`/api/windsor?tf=custom&date_from=${from}&date_to=${to}`)
      .then(r => r.json())
      .then(d => {
        const m: Record<string, { revenue: number; spend: number }> = {};
        for (const row of (d.revenueData || [])) m[row.date] = { revenue: Number(row.revenue || 0), spend: Number(row.adSpend || 0) };
        setPerf(m);
      })
      .catch(() => setPerf({}));
  }, [year, month]);

  // ── Filters ──
  const [filterType, setFilterType] = useState<'all' | MarketingEvent['type']>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | Status>('all');
  const matchesFilters = useCallback((e: MarketingEvent) => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (filterStatus !== 'all' && (e.status || 'planned') !== filterStatus) return false;
    if (filterChannel !== 'all' && !parseChannels(e.channel).includes(filterChannel)) return false;
    return true;
  }, [filterType, filterChannel, filterStatus]);

  const money = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
  function shiftDate(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().split('T')[0];
  }

  // When editing a past/running event, pull its window's revenue and the
  // equivalent window right before it, to show whether it moved the needle.
  const [eventResults, setEventResults] = useState<null | { windowRev: number; priorRev: number | null; days: number }>(null);
  useEffect(() => {
    if (!editEvent || !editEvent.date) { setEventResults(null); return; }
    const start = editEvent.date;
    const end = editEvent.endDate || editEvent.date;
    if (start > todayStr()) { setEventResults(null); return; } // future — no results yet
    const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
    const priorEnd = shiftDate(start, -1);
    const priorStart = shiftDate(start, -days);
    fetch(`/api/windsor?tf=custom&date_from=${priorStart}&date_to=${end}`)
      .then(r => r.json())
      .then(d => {
        const rev: Record<string, number> = {};
        for (const row of (d.revenueData || [])) rev[row.date] = Number(row.revenue || 0);
        const sum = (a: string, b: string) => Object.entries(rev).reduce((s, [dt, v]) => (dt >= a && dt <= b ? s + v : s), 0);
        const windowRev = sum(start, end);
        const priorRev = sum(priorStart, priorEnd);
        setEventResults({ windowRev, priorRev: priorRev > 0 ? priorRev : null, days });
      })
      .catch(() => setEventResults(null));
  }, [editEvent]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function cellDate(day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function eventsForDate(dateStr: string): MarketingEvent[] {
    return events.filter(e => matchesFilters(e) && (
      e.endDate ? (dateStr >= e.date && dateStr <= e.endDate) : e.date === dateStr
    ));
  }

  function eventsForDay(day: number): MarketingEvent[] {
    return eventsForDate(cellDate(day));
  }

  const isMultiDay = (e: MarketingEvent) => Boolean(e.endDate && e.endDate !== e.date);
  // Multi-day events that cover this date (for the colored band across the run).
  function spansForDate(dateStr: string): MarketingEvent[] {
    return events.filter(e => matchesFilters(e) && isMultiDay(e) && dateStr >= e.date && dateStr <= (e.endDate as string));
  }
  // Single-day events that land on this date (rendered as pills).
  function singlesForDate(dateStr: string): MarketingEvent[] {
    return events.filter(e => matchesFilters(e) && !isMultiDay(e) && e.date === dateStr);
  }

  function parseChannels(ch?: string): string[] {
    return (ch || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  function openNew(date?: string) {
    setEditEvent(null);
    setSaveError(null);
    setForm({ ...EMPTY_FORM, date: date || todayStr() });
    setShowModal(true);
  }

  function openEdit(ev: MarketingEvent) {
    setEditEvent(ev);
    setSaveError(null);
    setForm({
      title: ev.title, date: ev.date, endDate: ev.endDate || '', type: ev.type,
      channels: parseChannels(ev.channel), status: ev.status || 'planned', description: ev.description || '',
    });
    setShowModal(true);
  }

  async function saveEvent() {
    if (!form.title || !form.date) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        title: form.title, date: form.date, endDate: form.endDate || undefined, type: form.type,
        channel: form.channels.join(', ') || undefined, status: form.status,
        description: form.description || undefined, color: TYPE_COLORS[form.type],
      };
      const url = editEvent ? `/api/calendar/${editEvent.id}` : '/api/calendar';
      const r = await fetch(url, { method: editEvent ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || !d.event) { setSaveError(d.error ? `Couldn't save — ${d.error}` : "Couldn't save this event."); return; }
      if (editEvent) setEvents(prev => prev.map(e => e.id === editEvent.id ? d.event : e));
      else setEvents(prev => [...prev, d.event]);
      setShowModal(false);
    } catch (err) {
      setSaveError(`Couldn't save — ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id: string) {
    setSaveError(null);
    try {
      const r = await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setSaveError(d.error ? `Couldn't delete — ${d.error}` : "Couldn't delete this event."); return; }
      setEvents(prev => prev.filter(e => e.id !== id));
      setShowModal(false);
    } catch (err) {
      setSaveError(`Couldn't delete — ${String(err)}`);
    }
  }

  function prevMonth() {
    setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
    setSelectedDate(null);
  }
  function nextMonth() {
    setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
    setSelectedDate(null);
  }

  const todayDateStr = todayStr();

  const upcomingEvents = [...events]
    .filter(e => matchesFilters(e) && e.date >= todayDateStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 15);

  // All events in this month sorted by date, for the mobile agenda view
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEvents = [...events]
    .filter(e => {
      if (!matchesFilters(e)) return false;
      const start = e.date.slice(0, 7);
      const end = (e.endDate || e.date).slice(0, 7);
      return start <= monthPrefix && end >= monthPrefix;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const selectedDayEvents = selectedDate ? eventsForDate(selectedDate) : [];

  // Build 12-month lookahead from today for the year strip
  const yearStrip: { label: string; prefix: string; evts: MarketingEvent[] }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const evts = events.filter(e => {
      if (!matchesFilters(e)) return false;
      const start = e.date.slice(0, 7);
      const end = (e.endDate || e.date).slice(0, 7);
      return start <= prefix && end >= prefix;
    });
    yearStrip.push({ label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`, prefix, evts });
  }

  function jumpToMonth(prefix: string) {
    const [y, m] = prefix.split('-').map(Number);
    setView({ year: y, month: m - 1 });
    setSelectedDate(null);
  }

  return (
    <div>
      <Header title="Marketing Calendar" subtitle="Plan launches, deadlines & campaigns · synced with Google Sheet">
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshEvents(true)}
            title="Sync now"
            className="flex items-center gap-1.5 px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 text-xs font-medium rounded-xl transition-colors"
          >
            <span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span>
            <span className="hidden sm:inline">{lastSynced ? `Synced ${lastSynced}` : 'Sync'}</span>
          </button>
          <button
            onClick={() => openNew()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            <span>Add Event</span>
          </button>
        </div>
      </Header>

      {status === 'error' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Couldn&apos;t load the calendar{loadError ? ` — ${loadError}` : '.'} Check that the Google Sheet is shared with the service account and <code>CALENDAR_SHEET_ID</code> is set in Vercel.</span>
        </div>
      )}

      {/* ── Next Up ── */}
      {upcomingEvents.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 px-0.5">Next Up</p>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory">
            {upcomingEvents.slice(0, 8).map(ev => {
              const daysAway = Math.round((new Date(ev.date).getTime() - new Date(todayDateStr).getTime()) / 86400000);
              const countdownLabel = daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d away`;
              const isUrgent = daysAway <= 3;
              return (
                <button
                  key={ev.id}
                  onClick={() => openEdit(ev)}
                  className="snap-start shrink-0 flex flex-col gap-2 p-3 rounded-2xl border bg-white text-left transition-all hover:shadow-md active:opacity-80"
                  style={{ minWidth: '140px', maxWidth: '160px', borderColor: ev.color + '40' }}
                >
                  {/* Countdown badge */}
                  <span
                    className="self-start text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: isUrgent ? ev.color : ev.color + '18', color: isUrgent ? '#fff' : ev.color }}
                  >
                    {countdownLabel}
                  </span>
                  {/* Title */}
                  <p className="text-xs font-bold text-gray-800 leading-snug line-clamp-2">{ev.title}</p>
                  {/* Type + date row */}
                  <div className="mt-auto space-y-0.5">
                    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TYPE_BG[ev.type]}`}>
                      {TYPE_LABELS[ev.type]}
                    </span>
                    <p className="text-[10px] text-gray-400 leading-none">
                      {MONTHS_SHORT[parseInt(ev.date.split('-')[1]) - 1]} {parseInt(ev.date.split('-')[2])}
                      {ev.endDate && ev.endDate !== ev.date && ` – ${MONTHS_SHORT[parseInt(ev.endDate.split('-')[1]) - 1]} ${parseInt(ev.endDate.split('-')[2])}`}
                    </p>
                  </div>
                  {/* Color bar at bottom */}
                  <div className="w-full h-0.5 rounded-full mt-1" style={{ backgroundColor: ev.color }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Year-ahead strip ── */}
      <div className="mb-4 -mx-1">
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-none snap-x snap-mandatory">
          {yearStrip.map(({ label, prefix, evts }) => {
            const isCurrentView = `${year}-${String(month + 1).padStart(2, '0')}` === prefix;
            const topColors = Array.from(new Set(evts.map(e => e.color))).slice(0, 4);
            return (
              <button
                key={prefix}
                onClick={() => jumpToMonth(prefix)}
                className={`snap-start shrink-0 flex flex-col items-start gap-1.5 px-3 py-2.5 rounded-xl border transition-all ${
                  isCurrentView
                    ? 'bg-violet-600 border-violet-600 text-white'
                    : evts.length > 0
                    ? 'bg-white border-gray-200 hover:border-violet-300 text-gray-700'
                    : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100'
                }`}
                style={{ minWidth: '80px' }}
              >
                <span className={`text-[11px] font-bold leading-none ${isCurrentView ? 'text-white' : ''}`}>{label}</span>
                {evts.length > 0 ? (
                  <div className="flex items-center gap-1.5 w-full">
                    <div className="flex gap-0.5">
                      {topColors.map((c, ci) => (
                        <div key={ci} className="w-2 h-2 rounded-full" style={{ backgroundColor: isCurrentView ? 'rgba(255,255,255,0.7)' : c }} />
                      ))}
                    </div>
                    <span className={`text-[10px] font-semibold ml-auto ${isCurrentView ? 'text-violet-200' : 'text-gray-400'}`}>
                      {evts.length}
                    </span>
                  </div>
                ) : (
                  <span className={`text-[10px] ${isCurrentView ? 'text-violet-300' : 'text-gray-300'}`}>—</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Controls: filters + revenue overlay ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as typeof filterType)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABELS) as MarketingEvent['type'][]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select
          value={filterChannel}
          onChange={e => setFilterChannel(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="all">All channels</option>
          {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {(filterType !== 'all' || filterChannel !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setFilterType('all'); setFilterChannel('all'); setFilterStatus('all'); }} className="text-xs text-violet-600 hover:text-violet-700 font-medium px-1">Clear</button>
        )}
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-500 font-medium">
          <span
            onClick={() => setShowPerf(v => !v)}
            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${showPerf ? 'bg-violet-400' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${showPerf ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          Revenue overlay
        </label>
      </div>

      {/* ── DESKTOP layout (md+) ── */}
      <div className="hidden md:grid md:grid-cols-3 gap-4">
        {/* Calendar grid — 2 cols */}
        <Card accentColor="#8b5cf6" className="md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <h2 className="text-sm font-bold text-gray-800">{MONTHS[month]} {year}</h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {DAYS_FULL.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="bg-gray-50 min-h-[72px]" />;
              const dateStr = cellDate(day);
              const spans = spansForDate(dateStr);
              const singles = singlesForDate(dateStr);
              const isToday = dateStr === todayDateStr;
              const isSelected = selectedDate === dateStr;
              const isWeekStart = i % 7 === 0;
              return (
                <div
                  key={i}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`bg-white min-h-[72px] p-1 cursor-pointer transition-colors hover:bg-violet-50 ${isSelected ? 'ring-2 ring-inset ring-violet-400' : ''}`}
                >
                  <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-violet-600 text-white' : 'text-gray-600'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {/* Multi-day campaigns: a colored band spanning the run. Title
                        shows on the start day (or the first day of each week). */}
                    {spans.slice(0, 3).map(ev => {
                      const isStart = dateStr === ev.date;
                      const isEnd = dateStr === ev.endDate;
                      const done = ev.status === 'done';
                      return (
                        <div
                          key={ev.id}
                          onClick={e => { e.stopPropagation(); openEdit(ev); }}
                          className={`h-4 flex items-center overflow-hidden cursor-pointer hover:opacity-80 ${isStart ? 'rounded-l pl-1' : 'pl-1 -ml-1'} ${isEnd ? 'rounded-r pr-1' : '-mr-1 pr-1'}`}
                          style={{ backgroundColor: ev.color + (done ? '18' : '30'), borderLeft: isStart ? `2px solid ${ev.color}` : undefined }}
                          title={ev.title}
                        >
                          {(isStart || isWeekStart) && (
                            <span className={`truncate text-[10px] font-semibold ${done ? 'line-through opacity-60' : ''}`} style={{ color: ev.color }}>
                              {ev.title}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {/* Single-day events as pills */}
                    {singles.slice(0, Math.max(0, 2 - Math.min(spans.length, 2))).map(ev => (
                      <div
                        key={ev.id}
                        onClick={e => { e.stopPropagation(); openEdit(ev); }}
                        className={`truncate text-[10px] font-medium px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${ev.status === 'done' ? 'line-through opacity-60' : ''}`}
                        style={{ backgroundColor: ev.color + '20', color: ev.color }}
                      >
                        {ev.status === 'live' && '● '}{ev.title}
                      </div>
                    ))}
                    {(spans.length + singles.length) > 3 && (
                      <div className="text-[10px] text-gray-400 px-1">+{spans.length + singles.length - 3} more</div>
                    )}
                  </div>
                  {showPerf && perf[dateStr] && perf[dateStr].revenue > 0 && (
                    <div className="mt-0.5 text-[9px] font-semibold text-emerald-600 text-right leading-none" title={`Revenue ${money(perf[dateStr].revenue)} · Ad spend ${money(perf[dateStr].spend)}`}>
                      {money(perf[dateStr].revenue)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedDate && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">{formatDisplayDate(selectedDate)}</p>
                <button onClick={() => openNew(selectedDate)} className="text-xs text-violet-600 hover:text-violet-700 font-medium">+ Add event</button>
              </div>
              {selectedDayEvents.length === 0 ? (
                <p className="text-xs text-gray-400">No events. Click &quot;+ Add event&quot; to create one.</p>
              ) : (
                <div className="space-y-1.5">
                  {selectedDayEvents.map(ev => (
                    <div key={ev.id} onClick={() => openEdit(ev)} className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: ev.color }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-semibold text-gray-800 truncate">{ev.title}</p>
                          {ev.status && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_META[ev.status].bg}`}>{STATUS_META[ev.status].label}</span>}
                        </div>
                        <p className="text-[10px] text-gray-400">
                          {TYPE_LABELS[ev.type]}{ev.channel ? ` · ${ev.channel}` : ''}
                          {ev.endDate && ev.endDate !== ev.date ? ` · thru ${MONTHS_SHORT[parseInt(ev.endDate.split('-')[1]) - 1]} ${parseInt(ev.endDate.split('-')[2])}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Card accentColor="#f9a8d4">
            <h3 className="text-xs font-bold text-gray-600 uppercase mb-3">Event Types</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(TYPE_LABELS) as MarketingEvent['type'][]).map(t => (
                <div key={t} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${TYPE_BG[t]}`}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[t] }} />
                  {TYPE_LABELS[t]}
                </div>
              ))}
            </div>
          </Card>
          <Card accentColor="#86efac">
            <h3 className="text-xs font-bold text-gray-600 uppercase mb-3">Upcoming</h3>
            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-gray-400">No upcoming events.</p>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.map(ev => (
                  <div key={ev.id} onClick={() => openEdit(ev)} className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <div className="w-8 h-8 rounded-lg flex flex-col items-center justify-center text-white shrink-0" style={{ backgroundColor: ev.color }}>
                      <span className="text-[9px] font-bold leading-none uppercase">{MONTHS_SHORT[parseInt(ev.date.split('-')[1]) - 1]}</span>
                      <span className="text-sm font-bold leading-none">{parseInt(ev.date.split('-')[2])}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{ev.title}</p>
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 ${TYPE_BG[ev.type]}`}>{TYPE_LABELS[ev.type]}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── MOBILE layout (< md) ── */}
      <div className="md:hidden space-y-3">

        {/* Compact month calendar with dot indicators */}
        <Card accentColor="#8b5cf6">
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors active:bg-gray-200">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <h2 className="text-sm font-bold text-gray-800">{MONTHS[month]} {year}</h2>
            <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors active:bg-gray-200">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_SHORT.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{d}</div>
            ))}
          </div>

          {/* Compact cells: just the number + colored dots */}
          <div className="grid grid-cols-7 gap-px">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="h-11" />;
              const dateStr = cellDate(day);
              const dayEvents = eventsForDay(day);
              const isToday = dateStr === todayDateStr;
              const isSelected = selectedDate === dateStr;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`h-11 flex flex-col items-center justify-start pt-1 rounded-xl transition-all ${
                    isSelected ? 'bg-violet-100' : isToday ? 'bg-violet-50' : 'hover:bg-gray-50 active:bg-gray-100'
                  }`}
                >
                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-violet-600 text-white' : isSelected ? 'text-violet-700' : 'text-gray-700'
                  }`}>
                    {day}
                  </span>
                  {/* Up to 3 colored dots for events */}
                  {dayEvents.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {dayEvents.slice(0, 3).map((ev, di) => (
                        <div key={di} className="w-1 h-1 rounded-full" style={{ backgroundColor: ev.color }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Selected day panel */}
        {selectedDate ? (
          <Card accentColor="#c4b5fd">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-gray-800">{formatDisplayDate(selectedDate)}</p>
                <p className="text-xs text-gray-400">{selectedDayEvents.length === 0 ? 'No events' : `${selectedDayEvents.length} event${selectedDayEvents.length > 1 ? 's' : ''}`}</p>
              </div>
              <button
                onClick={() => openNew(selectedDate)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                <span className="text-base leading-none">+</span> Add
              </button>
            </div>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs text-gray-400 pb-1">Tap &quot;+ Add&quot; to create an event for this day.</p>
            ) : (
              <div className="space-y-2">
                {selectedDayEvents.map(ev => (
                  <button
                    key={ev.id}
                    onClick={() => openEdit(ev)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors active:opacity-70"
                    style={{ backgroundColor: ev.color + '12' }}
                  >
                    <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{ev.title}</p>
                      <span className="mt-1 inline-flex flex-wrap items-center gap-1">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BG[ev.type]}`}>{TYPE_LABELS[ev.type]}</span>
                        {ev.status && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_META[ev.status].bg}`}>{STATUS_META[ev.status].label}</span>}
                        {ev.channel && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">{ev.channel}</span>}
                      </span>
                      {ev.description && <p className="text-xs text-gray-500 mt-1 leading-snug">{ev.description}</p>}
                      {ev.endDate && ev.endDate !== ev.date && <p className="text-[11px] text-gray-400 mt-1">Ends {formatDisplayDate(ev.endDate)}</p>}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                ))}
              </div>
            )}
          </Card>
        ) : (
          /* When no day selected, show the month's agenda */
          <Card accentColor="#86efac">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-600 uppercase">
                {monthEvents.length > 0 ? `${MONTHS[month]} Events` : 'No Events This Month'}
              </h3>
            </div>
            {monthEvents.length === 0 ? (
              <p className="text-xs text-gray-400">Tap any day to add events, or use &quot;+ Add Event&quot; above.</p>
            ) : (
              <div className="space-y-2">
                {monthEvents.map(ev => (
                  <button
                    key={ev.id}
                    onClick={() => openEdit(ev)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left active:opacity-70 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl flex flex-col items-center justify-center text-white shrink-0" style={{ backgroundColor: ev.color }}>
                      <span className="text-[9px] font-bold leading-none uppercase">{MONTHS_SHORT[parseInt(ev.date.split('-')[1]) - 1]}</span>
                      <span className="text-base font-bold leading-none">{parseInt(ev.date.split('-')[2])}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{ev.title}</p>
                      <span className="mt-1 inline-flex flex-wrap items-center gap-1">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BG[ev.type]}`}>{TYPE_LABELS[ev.type]}</span>
                        {ev.status && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_META[ev.status].bg}`}>{STATUS_META[ev.status].label}</span>}
                        {ev.channel && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">{ev.channel}</span>}
                      </span>
                      {ev.description && <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{ev.description}</p>}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0 mt-1" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Event Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center sm:p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          {/* On mobile: bottom sheet. On sm+: centered card */}
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl shadow-xl overflow-y-auto max-h-[92dvh] sm:max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-0">
              <div className="w-10 h-1 rounded-full bg-gray-200" />
            </div>

            <div className="px-5 pt-3 pb-8 sm:p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-gray-900">{editEvent ? 'Edit Event' : 'New Event'}</h2>
                <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Summer Sale Launch"
                    className="w-full px-3 py-2.5 text-sm text-gray-800 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Type *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(TYPE_LABELS) as MarketingEvent['type'][]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, type: t }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border-2 transition-all ${
                          form.type === t ? 'border-current' : 'border-transparent bg-gray-50 text-gray-500'
                        }`}
                        style={form.type === t ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t], backgroundColor: TYPE_COLORS[t] + '15' } : {}}
                      >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[t] }} />
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm text-gray-800 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm text-gray-800 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Channel</label>
                  <div className="flex flex-wrap gap-2">
                    {CHANNEL_OPTIONS.map(ch => {
                      const on = form.channels.includes(ch);
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, channels: on ? f.channels.filter(c => c !== ch) : [...f.channels, ch] }))}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all ${on ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-transparent bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                          {ch}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Status</label>
                  <div className="flex gap-2">
                    {STATUS_OPTIONS.map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, status: s.value }))}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${form.status === s.value ? 'border-current' : 'border-transparent bg-gray-50 text-gray-500'}`}
                        style={form.status === s.value ? { color: s.color, borderColor: s.color, backgroundColor: s.color + '15' } : {}}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional details, links, or reminders…"
                    rows={3}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                  />
                </div>
              </div>

              {editEvent && eventResults && (eventResults.windowRev > 0 || eventResults.priorRev !== null) && (
                <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Results</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-gray-800">{money(eventResults.windowRev)}</span>
                    <span className="text-xs text-gray-400">revenue {eventResults.days === 1 ? 'that day' : `over these ${eventResults.days} days`}</span>
                  </div>
                  {eventResults.priorRev !== null && (() => {
                    const lift = Math.round(((eventResults.windowRev - eventResults.priorRev) / eventResults.priorRev) * 100);
                    const up = lift >= 0;
                    return (
                      <p className={`text-xs font-semibold mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
                        {up ? '▲' : '▼'} {Math.abs(lift)}% vs the prior {eventResults.days === 1 ? 'day' : `${eventResults.days} days`} ({money(eventResults.priorRev)})
                      </p>
                    );
                  })()}
                  <p className="text-[10px] text-gray-400 mt-1">Total Shopify revenue in the window — a directional read, not strictly attributed to this event.</p>
                </div>
              )}

              {saveError && (
                <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {saveError}
                </div>
              )}

              <div className="flex gap-2 mt-6">
                {editEvent && (
                  <button onClick={() => deleteEvent(editEvent.id)} className="px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                    Delete
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={() => setShowModal(false)} className="px-4 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">
                  Cancel
                </button>
                <button
                  onClick={saveEvent}
                  disabled={saving || !form.title || !form.date}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl transition-colors"
                >
                  {saving ? 'Saving…' : editEvent ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
