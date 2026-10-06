'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

export interface BoardTask { id?: string; title: string; status: string; assignee?: string; dueDate?: string; priority: string }

/**
 * Match a task's casual first-name assignee ("Angie") to the signed-in login
 * (name or email) on the first three letters of the first token, so "Angie"
 * still finds "Angely" / "angie@…". Shared by the banner and the push digest.
 */
export function assigneeMatchesUser(assignee: string | undefined, user: { name?: string | null; email?: string | null } | null | undefined): boolean {
  if (!assignee || !user) return false;
  const idents = [user.name || '', (user.email || '').split('@')[0]]
    .map(s => s.trim().toLowerCase().split(/[\s._-]+/)[0])
    .filter(s => s.length >= 3)
    .map(s => s.slice(0, 3));
  const a = assignee.trim().toLowerCase().split(/[\s._-]+/)[0].slice(0, 3);
  return a.length >= 3 && idents.includes(a);
}

export function useMyTasks(): { myTasks: BoardTask[]; myOverdue: BoardTask[]; myDueToday: BoardTask[]; todayPst: string } {
  const { data: session } = useSession();
  const [allTasks, setAllTasks] = useState<BoardTask[]>([]);
  useEffect(() => {
    fetch('/api/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.tasks)) setAllTasks(d.tasks); })
      .catch(() => {});
  }, []);
  const todayPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const myTasks = useMemo(() => allTasks.filter(t => t.status !== 'done' && assigneeMatchesUser(t.assignee, session?.user)), [allTasks, session]);
  const myOverdue = myTasks.filter(t => t.dueDate && t.dueDate < todayPst);
  const myDueToday = myTasks.filter(t => t.dueDate === todayPst);
  return { myTasks, myOverdue, myDueToday, todayPst };
}

/**
 * The loud personal task reminder: red when anything is overdue, amber when
 * something is due today or simply open. Only the signed-in person's tasks.
 * Shown on the Overview and the Marketing Calendar.
 */
export default function MyTasksBanner() {
  const { data: session } = useSession();
  const { myTasks, myOverdue, myDueToday, todayPst } = useMyTasks();
  if (session?.user?.role === 'partner' || myTasks.length === 0) return null;
  return (
    <Link
      href="/dashboard/tasks"
      className={`block rounded-2xl border-2 px-4 py-3 mb-4 shadow-sm transition-transform active:scale-[0.99] ${
        myOverdue.length ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${myOverdue.length ? 'bg-red-500' : 'bg-amber-500'}`} />
        <p className={`text-sm font-bold ${myOverdue.length ? 'text-red-700' : 'text-amber-700'}`}>
          {myOverdue.length
            ? `🔔 You have ${myOverdue.length} OVERDUE task${myOverdue.length > 1 ? 's' : ''}${myDueToday.length ? ` + ${myDueToday.length} due today` : ''}`
            : myDueToday.length
            ? `🔔 You have ${myDueToday.length} task${myDueToday.length > 1 ? 's' : ''} due TODAY`
            : `🔔 You have ${myTasks.length} open task${myTasks.length > 1 ? 's' : ''} on the board`}
        </p>
        <span className={`ml-auto text-xs font-semibold ${myOverdue.length ? 'text-red-600' : 'text-amber-600'}`}>Open board →</span>
      </div>
      <ul className="mt-1 space-y-0.5 pl-4">
        {/* Only URGENT tasks get itemized — the rest is just the count. */}
        {[...myOverdue, ...myDueToday.filter(t => !myOverdue.includes(t))].slice(0, 3).map((t, i) => (
          <li key={i} className="text-xs text-gray-600 list-disc">
            {t.title}
            {t.dueDate && <span className={t.dueDate < todayPst ? 'text-red-600 font-semibold' : 'text-gray-400'}> · due {t.dueDate.slice(5)}</span>}
          </li>
        ))}
      </ul>
    </Link>
  );
}
