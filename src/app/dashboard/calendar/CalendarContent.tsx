'use client';

import { useEffect, useState } from 'react';
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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function today(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

interface FormState {
  title: string;
  date: string;
  endDate: string;
  type: MarketingEvent['type'];
  description: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  date: '',
  endDate: '',
  type: 'launch',
  description: '',
};

export default function CalendarContent() {
  const [events, setEvents] = useState<MarketingEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [{ year, month }, setView] = useState(today());

  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState<MarketingEvent | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calendar')
      .then(r => r.json())
      .then(d => { setEvents(d.events || []); setStatus('ok'); })
      .catch(() => setStatus('error'));
  }, []);

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  function cellDate(day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function eventsForDay(day: number): MarketingEvent[] {
    const d = cellDate(day);
    return events.filter(e => {
      if (e.endDate) return d >= e.date && d <= e.endDate;
      return e.date === d;
    });
  }

  function openNew(date?: string) {
    setEditEvent(null);
    setForm({ ...EMPTY_FORM, date: date || todayStr() });
    setShowModal(true);
  }

  function openEdit(ev: MarketingEvent) {
    setEditEvent(ev);
    setForm({
      title: ev.title,
      date: ev.date,
      endDate: ev.endDate || '',
      type: ev.type,
      description: ev.description || '',
    });
    setShowModal(true);
  }

  async function saveEvent() {
    if (!form.title || !form.date) return;
    setSaving(true);
    try {
      const body = {
        title: form.title,
        date: form.date,
        endDate: form.endDate || undefined,
        type: form.type,
        description: form.description || undefined,
        color: TYPE_COLORS[form.type],
      };
      if (editEvent) {
        const r = await fetch(`/api/calendar/${editEvent.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        setEvents(prev => prev.map(e => e.id === editEvent.id ? d.event : e));
      } else {
        const r = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        setEvents(prev => [...prev, d.event]);
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id: string) {
    await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    setEvents(prev => prev.filter(e => e.id !== id));
    setShowModal(false);
  }

  function prevMonth() {
    setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  }
  function nextMonth() {
    setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  }

  const upcomingEvents = [...events]
    .filter(e => e.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  const todayDateStr = todayStr();

  return (
    <div>
      <Header title="Marketing Calendar" subtitle="Plan launches, deadlines & campaigns">
        <button
          onClick={() => openNew()}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          Add Event
        </button>
      </Header>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Could not load calendar events. Make sure Vercel KV is configured.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calendar grid */}
        <Card accentColor="#8b5cf6" className="lg:col-span-2">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <h2 className="text-sm font-bold text-gray-800">{MONTHS[month]} {year}</h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="bg-gray-50 min-h-[72px]" />;
              const dateStr = cellDate(day);
              const dayEvents = eventsForDay(day);
              const isToday = dateStr === todayDateStr;
              const isSelected = selectedDate === dateStr;
              return (
                <div
                  key={i}
                  onClick={() => { setSelectedDate(isSelected ? null : dateStr); }}
                  className={`bg-white min-h-[72px] p-1 cursor-pointer transition-colors hover:bg-violet-50 ${isSelected ? 'ring-2 ring-inset ring-violet-400' : ''}`}
                >
                  <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-violet-600 text-white' : 'text-gray-600'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map(ev => (
                      <div
                        key={ev.id}
                        onClick={e => { e.stopPropagation(); openEdit(ev); }}
                        className="truncate text-[10px] font-medium px-1 py-0.5 rounded cursor-pointer hover:opacity-80"
                        style={{ backgroundColor: ev.color + '20', color: ev.color }}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-[10px] text-gray-400 px-1">+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                  {dayEvents.length === 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); openNew(dateStr); }}
                      className="opacity-0 hover:opacity-100 group-hover:opacity-100 text-[10px] text-gray-300 hover:text-violet-400 transition-opacity w-full text-left px-1"
                    >
                      + add
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected day events */}
          {selectedDate && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600">{selectedDate}</p>
                <button
                  onClick={() => openNew(selectedDate)}
                  className="text-xs text-violet-600 hover:text-violet-700 font-medium"
                >
                  + Add event
                </button>
              </div>
              {eventsForDay(parseInt(selectedDate.split('-')[2])).length === 0 ? (
                <p className="text-xs text-gray-400">No events. Click &quot;+ Add event&quot; to create one.</p>
              ) : (
                <div className="space-y-1.5">
                  {eventsForDay(parseInt(selectedDate.split('-')[2])).map(ev => (
                    <div
                      key={ev.id}
                      onClick={() => openEdit(ev)}
                      className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: ev.color }} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{ev.title}</p>
                        <p className="text-[10px] text-gray-400">{TYPE_LABELS[ev.type]}{ev.description ? ` · ${ev.description}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Upcoming events sidebar */}
        <div className="space-y-4">
          {/* Legend */}
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

          {/* Upcoming */}
          <Card accentColor="#86efac">
            <h3 className="text-xs font-bold text-gray-600 uppercase mb-3">Upcoming</h3>
            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-gray-400">No upcoming events.</p>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.map(ev => (
                  <div
                    key={ev.id}
                    onClick={() => openEdit(ev)}
                    className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex flex-col items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: ev.color }}
                    >
                      <span className="text-[9px] font-bold leading-none uppercase">{MONTHS[parseInt(ev.date.split('-')[1]) - 1].slice(0, 3)}</span>
                      <span className="text-sm font-bold leading-none">{parseInt(ev.date.split('-')[2])}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{ev.title}</p>
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 ${TYPE_BG[ev.type]}`}>
                        {TYPE_LABELS[ev.type]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(TYPE_LABELS) as MarketingEvent['type'][]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border-2 transition-all ${
                        form.type === t ? 'border-current' : 'border-transparent bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                      style={form.type === t ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t], backgroundColor: TYPE_COLORS[t] + '15' } : {}}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] }} />
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
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional details, links, or reminders…"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              {editEvent && (
                <button
                  onClick={() => deleteEvent(editEvent.id)}
                  className="px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEvent}
                disabled={saving || !form.title || !form.date}
                className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl transition-colors"
              >
                {saving ? 'Saving…' : editEvent ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
