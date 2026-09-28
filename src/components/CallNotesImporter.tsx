'use client';

import { useState } from 'react';
import type { ActionItem } from '@/src/lib/callNotes';

type Draft = ActionItem & { include: boolean };

// Paste (or dictate) the notes from a client call → preview the action items
// → create them as tasks on this dashboard's board. Nothing crosses clients:
// this panel only ever writes to the deployment it is running on.
export default function CallNotesImporter({ people, onCreated, onClose }: { people: string[]; onCreated: () => void; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState('');
  const [callDate, setCallDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState<'extract' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function extract() {
    setBusy('extract'); setError(null); setDone(null);
    try {
      const r = await fetch('/api/tasks/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes, source, callDate, people, dryRun: true }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Could not read the notes');
      setDrafts((d.items as ActionItem[]).map(i => ({ ...i, include: true })));
      if (!d.items?.length) setError('No action items found in those notes.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the notes'); }
    finally { setBusy(null); }
  }

  async function create() {
    const items = (drafts || []).filter(d => d.include && d.title.trim());
    if (!items.length) return;
    setBusy('create'); setError(null);
    try {
      const r = await fetch('/api/tasks/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, source, callDate }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Could not create tasks');
      setDone(`${d.created.length} task${d.created.length === 1 ? '' : 's'} added${d.skipped ? ` · ${d.skipped} already on the board` : ''}`);
      setDrafts(null); setNotes('');
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create tasks'); }
    finally { setBusy(null); }
  }

  const edit = (i: number, patch: Partial<Draft>) => setDrafts(ds => (ds || []).map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="bg-white border border-violet-200 rounded-2xl p-4 mb-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-bold text-gray-800">📞 Import call notes</p>
          <p className="text-xs text-gray-400">Paste or dictate the notes; the action items become tasks on this board.</p>
        </div>
        <button onClick={onClose} className="text-xs text-gray-400">Close</button>
      </div>

      {!drafts && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="Call (e.g. Weekly with NPA · Irene 1:1 · Orly)" className="px-3 py-2 text-sm border border-gray-200 rounded-xl" />
            <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl" />
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8} placeholder="Paste the notes, or tap the mic on your keyboard and talk through the action items…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={extract} disabled={busy !== null || !notes.trim()} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl">
              {busy === 'extract' ? 'Reading…' : 'Find action items'}
            </button>
            {done && <span className="text-xs text-green-600 font-semibold">✓ {done}</span>}
          </div>
        </>
      )}

      {drafts && (
        <>
          <p className="text-xs text-gray-500 mb-2">Untick anything that is not a task, fix owners or dates, then create.</p>
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className={`grid grid-cols-[auto_1fr] gap-2 items-start rounded-xl border p-2 ${d.include ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
                <input type="checkbox" checked={d.include} onChange={e => edit(i, { include: e.target.checked })} className="mt-2" />
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_90px] gap-2">
                  <input value={d.title} onChange={e => edit(i, { title: e.target.value })} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                  <input value={d.assignee || ''} onChange={e => edit(i, { assignee: e.target.value })} placeholder="Owner" list="importer-people" className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                  <input type="date" value={d.dueDate || ''} onChange={e => edit(i, { dueDate: e.target.value })} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                  <select value={d.priority} onChange={e => edit(i, { priority: e.target.value as ActionItem['priority'] })} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                  {d.description && <p className="sm:col-span-4 text-[11px] text-gray-400">{d.description}</p>}
                </div>
              </div>
            ))}
          </div>
          <datalist id="importer-people">{people.map(p => <option key={p} value={p} />)}</datalist>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={create} disabled={busy !== null || !drafts.some(d => d.include)} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl">
              {busy === 'create' ? 'Adding…' : `Create ${drafts.filter(d => d.include).length} task${drafts.filter(d => d.include).length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => setDrafts(null)} disabled={busy !== null} className="text-xs text-gray-500">Back to notes</button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
