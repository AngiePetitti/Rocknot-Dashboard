'use client';

import { useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';

interface ListedUser { email: string; role: 'admin' | 'team'; locked: boolean; source: 'env' | 'sheet'; }

export default function AdminUsers({ currentEmail }: { currentEmail: string }) {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'team'>('team');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not load users'); setStatus('error'); return; }
      setUsers(d.users || []); setStatus('ok');
    } catch { setStatus('error'); }
  }
  useEffect(() => { load(); }, []);

  async function apply(fn: () => Promise<Response>) {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Something went wrong'); return; }
      setUsers(d.users || []);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const addUser = () => {
    if (!newEmail.trim()) return;
    apply(() => fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: newEmail.trim(), role: newRole }) }))
      .then(() => setNewEmail(''));
  };
  const changeRole = (email: string, role: 'admin' | 'team') =>
    apply(() => fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }));
  const remove = (email: string) => {
    if (!confirm(`Remove ${email}? They'll lose access on their next sign-in.`)) return;
    apply(() => fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }));
  };

  return (
    <div className="space-y-5">
      <Card accentColor="#818cf8">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Add a person</h2>
        <p className="text-xs text-gray-400 mb-3">They sign in with this Google email. Admins see everything incl. Financials; Team sees everything except Financials.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
            placeholder="name@company.com"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'team')} className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
            <option value="team">Team</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={addUser} disabled={busy || !newEmail.trim()} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">Add</button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </Card>

      <Card accentColor="#86efac">
        <h2 className="text-sm font-bold text-gray-700 mb-3">People with access</h2>
        {status === 'loading' ? (
          <p className="text-sm text-gray-400 py-4">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No one yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {users.map(u => (
              <div key={u.email} className="flex items-center gap-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">{u.email.charAt(0).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.email}{u.email === currentEmail && <span className="text-gray-400 font-normal"> (you)</span>}</p>
                  {u.locked && <p className="text-[10px] text-gray-400">Permanent admin (set in env) — manage in Vercel</p>}
                </div>
                {u.locked ? (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 capitalize">{u.role}</span>
                ) : (
                  <>
                    <select value={u.role} disabled={busy} onChange={e => changeRole(u.email, e.target.value as 'admin' | 'team')} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                      <option value="team">Team</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => remove(u.email)} disabled={busy} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Changes take effect the next time that person signs in (sessions last up to 8 hours). You &amp; Orly are permanent admins and can&apos;t be removed here.</p>
      </Card>
    </div>
  );
}
