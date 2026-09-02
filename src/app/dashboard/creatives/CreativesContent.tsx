'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Timeframe } from '@/src/lib/mockData';
import { cachedJson } from '@/src/lib/clientCache';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';

interface CreativePerformance {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok' | 'Snapchat';
  thumbnailUrl: string | null;
  videoUrl: string | null;
  previewUrl?: string | null;
  adUrl: string | null;
  campaign: string;
  adset: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
  conversions?: number;
  costPerConversion?: number;
}

type SortKey = 'spend' | 'roas' | 'ctr' | 'conversions';
type PlatformFilter = 'all' | 'Meta' | 'TikTok' | 'Snapchat';

export default function CreativesContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const [creatives, setCreatives] = useState<CreativePerformance[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'empty' | 'error'>('loading');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [selected, setSelected] = useState<CreativePerformance | null>(null);
  // Deep link from briefs: /dashboard/creatives?ad=<id> opens that ad's modal.
  const adParam = searchParams.get('ad');
  useEffect(() => {
    if (!adParam || !creatives.length) return;
    const hit = creatives.find(c => c.id === adParam);
    if (hit) setSelected(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adParam, creatives]);
  const [sharing, setSharing] = useState(false);

  // ── Creative briefs (AI) + format overview ──
  interface BriefEntry { id: string; track: 'video' | 'static' | 'orly'; title: string; summary: string }
  interface BriefsPayload { briefs?: BriefEntry[] | null; generatedAt?: string }
  const [briefsData, setBriefsData] = useState<BriefsPayload | null>(null);
  const [briefsGenerating, setBriefsGenerating] = useState(false);
  const [briefsError, setBriefsError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [briefCounts, setBriefCounts] = useState<{ video: number; static: number; orly: number }>({ video: 1, static: 1, orly: 1 });
  const totalBriefs = briefCounts.video + briefCounts.static + briefCounts.orly;
  useEffect(() => {
    fetch('/api/creatives/briefs', { cache: 'no-store' }).then(r => r.json()).then(setBriefsData).catch(() => {});
  }, []);
  async function generateBriefs() {
    setBriefsGenerating(true);
    setBriefsError(null);
    try {
      const res = await fetch('/api/creatives/briefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(briefCounts) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Generation failed');
      setBriefsData(d);
    } catch (e) {
      setBriefsError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBriefsGenerating(false);
    }
  }
  interface BriefStatus { status?: string; notes?: string }
  const [briefStatuses, setBriefStatuses] = useState<Record<string, BriefStatus>>({});
  const [taskCreatedFor, setTaskCreatedFor] = useState<Record<string, boolean>>({});
  const [sharedLinkCopied, setSharedLinkCopied] = useState(false);

  // One tap: brief → card on the Tasks board (In Progress) + mark it in
  // production here, so "we're making this" lives in one place.
  async function sendBriefToTasks(b: { id: string; title: string; track: string }, trackLabel: string) {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Produce: ${b.title}`,
          description: `${trackLabel} creative brief — full spec at the link.`,
          status: 'in_progress',
          priority: 'medium',
          link: `/brief/${b.id}`,
        }),
      });
      if (!res.ok) throw new Error('Task create failed');
      setTaskCreatedFor(prev => ({ ...prev, [b.id]: true }));
      if ((briefStatuses[b.id]?.status ?? 'new') === 'new') setBriefStatus(b.id, 'production');
    } catch {
      alert('Could not create the task — try again.');
    }
  }
  const [showSkippedBriefs, setShowSkippedBriefs] = useState(false);
  const [showCompletedBriefs, setShowCompletedBriefs] = useState(false);
  const [notesOpenFor, setNotesOpenFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  useEffect(() => {
    fetch('/api/creatives/briefs/status', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d?.statuses) setBriefStatuses(d.statuses); }).catch(() => {});
  }, []);
  async function setBriefStatus(id: string, status: string) {
    setBriefStatuses(prev => ({ ...prev, [id]: { ...prev[id], status } }));
    await fetch('/api/creatives/briefs/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }).catch(() => {});
  }
  async function saveBriefNotes(id: string) {
    setBriefStatuses(prev => ({ ...prev, [id]: { ...prev[id], notes: notesDraft } }));
    setNotesOpenFor(null);
    await fetch('/api/creatives/briefs/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, notes: notesDraft }) }).catch(() => {});
  }

  function copyBriefLink(id: string) {
    navigator.clipboard.writeText(`${window.location.origin}/brief/${id}`).then(() => {
      setCopiedLink(id);
      setTimeout(() => setCopiedLink(null), 1500);
    });
  }

  // ── Brand guidelines (referenced by every AI generation) ──
  const [guidelines, setGuidelines] = useState('');
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [guidelinesSaved, setGuidelinesSaved] = useState<null | 'saving' | 'saved' | 'error'>(null);
  useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' }).then(r => r.json()).then(d => setGuidelines(String(d?.guidelines || ''))).catch(() => {});
  }, []);
  const [uploadingGuide, setUploadingGuide] = useState<string | null>(null);
  async function uploadGuidelines(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setUploadingGuide(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the upload limit is 4MB. Export a compressed PDF (or just the pages with colors/fonts/voice) and try again.`);
      return;
    }
    setUploadingGuide('Reading the file with Cleo… (~30s for a PDF)');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/brand', { method: 'POST', body: fd });
      // Platform-level rejections (413 etc.) return plain text, not JSON.
      const raw = await res.text();
      let d: { error?: string; guidelines?: string };
      try { d = JSON.parse(raw); } catch {
        throw new Error(res.status === 413 ? 'File too large for upload (4MB max)' : raw.slice(0, 120));
      }
      if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');
      setGuidelines(String(d.guidelines || ''));
      setUploadingGuide(null);
      setGuidelinesSaved('saved');
      setTimeout(() => setGuidelinesSaved(null), 2000);
    } catch (e) {
      setUploadingGuide(e instanceof Error ? `Failed: ${e.message}` : 'Upload failed');
    }
  }
  async function saveGuidelines() {
    setGuidelinesSaved('saving');
    try {
      const res = await fetch('/api/brand', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guidelines }) });
      if (!res.ok) throw new Error();
      setGuidelinesSaved('saved');
      setTimeout(() => setGuidelinesSaved(null), 2000);
    } catch {
      setGuidelinesSaved('error');
    }
  }

  // Deterministic format rollup from the loaded creatives (name conventions).
  const [openFormat, setOpenFormat] = useState<string | null>(null);
  const formatStats = useMemo(() => {
    const buckets = new Map<string, { spend: number; revenue: number; clicks: number; impressions: number; ads: CreativePerformance[] }>();
    const formatOf = (name: string): string => {
      const n = name.toLowerCase();
      if (/^static|static_|_img_|image|\bstatic\b/.test(n)) return 'Static image';
      if (/ugc|montage|_mu_/.test(n)) return 'Video · UGC/montage';
      if (/founder|orly/.test(n)) return 'Video · founder';
      if (/talking\s*head/.test(n)) return 'Video · talking head';
      if (/demo/.test(n)) return 'Video · product demo';
      if (/showcase/.test(n)) return 'Video · product showcase';
      if (/voice/.test(n)) return 'Video · voiceover';
      return 'Video · unlabeled name';
    };
    for (const c of creatives) {
      const k = formatOf(c.name);
      const b = buckets.get(k) || { spend: 0, revenue: 0, clicks: 0, impressions: 0, ads: [] };
      b.spend += c.spend; b.revenue += c.revenue; b.clicks += c.clicks; b.impressions += c.impressions; b.ads.push(c);
      buckets.set(k, b);
    }
    return Array.from(buckets.entries())
      .map(([format, b]) => ({
        format, count: b.ads.length, spend: b.spend,
        roas: b.spend > 0 ? Math.round((b.revenue / b.spend) * 100) / 100 : 0,
        ctr: b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 100 : 0,
        ads: [...b.ads].sort((a, x) => x.spend - a.spend),
      }))
      .filter(f => f.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [creatives]);

  // iOS/Android: fetch the video and hand it to the native share sheet, where
  // "Save Video" drops it straight into the photo album — no Downloads detour.
  async function saveToPhotos(c: CreativePerformance) {
    if (!c.videoUrl) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/creative-download?url=${encodeURIComponent(c.videoUrl)}&name=${encodeURIComponent(c.name)}`);
      const blob = await res.blob();
      const file = new File([blob], `${c.name.replace(/[^\w\- ]+/g, '_').slice(0, 80)}.mp4`, { type: blob.type || 'video/mp4' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Desktop or unsupported browser — regular download.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      /* user cancelled the share sheet or fetch failed — nothing to clean up */
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    setStatus('loading');
    // Session-cached: a previously loaded timeframe renders instantly and
    // refreshes quietly in the background (same pattern as the other tabs).
    cachedJson<{ creatives?: CreativePerformance[] }>(
      `/api/windsor/creatives?tf=${tf}`,
      data => {
        const list: CreativePerformance[] = data.creatives || [];
        setCreatives(list);
        setStatus(list.length > 0 ? 'live' : 'empty');
      },
      () => setStatus('error')
    );
  }, [tf]);

  const filtered = creatives
    .filter(c => platformFilter === 'all' || c.platform === platformFilter)
    .sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.revenue, 0);
  const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const totalImpressions = filtered.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.clicks, 0);
  const totalConversions = filtered.reduce((s, c) => s + (c.conversions ?? 0), 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCostPerConv = totalConversions > 0 ? totalSpend / totalConversions : 0;

  return (
    <div>
      <Header title="Creative Analysis" subtitle={`Meta, TikTok & Snapchat creatives · ${TIMEFRAME_LABELS[tf] || tf}`}>
        <TimeframeSelector />
      </Header>

      {/* Summary */}
      {status === 'live' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card accentColor="#818cf8">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Creatives</p>
            <p className="text-xl font-bold text-gray-800">{filtered.length}</p>
          </Card>
          <Card accentColor="#f9a8d4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Total Spend</p>
            <p className="text-xl font-bold text-gray-800">{formatCurrency(totalSpend)}</p>
          </Card>
          <Card accentColor="#c4b5fd">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Attributed Revenue</p>
            <p className="text-xl font-bold text-gray-800">{formatCurrency(totalRevenue)}</p>
          </Card>
          <Card accentColor="#86efac">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Blended ROAS</p>
            <p className="text-xl font-bold" style={{ color: blendedROAS >= 3.5 ? '#22c55e' : '#ef4444' }}>
              {formatROAS(blendedROAS)}
            </p>
          </Card>
        </div>
      )}

      {/* ── Format overview — what's working, from the live numbers ── */}
      {status === 'live' && formatStats.length > 0 && (
        <Card accentColor="#fde68a" className="mb-5">
          <h2 className="text-sm font-bold text-gray-700 mb-1">🧠 What&apos;s Working — by Format</h2>
          <p className="text-xs text-gray-400 mb-3">Rolled up from every ad&apos;s naming + numbers for this period</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2">Format</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Ads</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Spend</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">ROAS</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">CTR</th>
                </tr>
              </thead>
              <tbody>
                {formatStats.map(fs => (
                  <>
                    <tr
                      key={fs.format}
                      onClick={() => setOpenFormat(o => o === fs.format ? null : fs.format)}
                      className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                    >
                      <td className="py-2 font-medium text-gray-700">{openFormat === fs.format ? '▾' : '▸'} {fs.format}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{fs.count}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{formatCurrency(fs.spend)}</td>
                      <td className="py-2 px-3 text-right font-bold" style={{ color: fs.roas >= 3.5 ? '#22c55e' : fs.roas >= 2 ? '#f59e0b' : '#ef4444' }}>{formatROAS(fs.roas)}</td>
                      <td className="py-2 pl-3 text-right text-gray-600">{fs.ctr}%</td>
                    </tr>
                    {openFormat === fs.format && fs.ads.slice(0, 15).map(ad => (
                      <tr key={ad.id} className="border-b border-gray-50 bg-gray-50/60">
                        <td className="py-1.5 pl-6 pr-2">
                          <button onClick={() => setSelected(ad)} className="text-xs text-violet-600 hover:text-violet-800 text-left break-words">
                            {ad.name} <span className="text-gray-400">[{ad.platform}]</span>
                          </button>
                        </td>
                        <td className="py-1.5 px-3 text-right text-xs text-gray-400" />
                        <td className="py-1.5 px-3 text-right text-xs text-gray-500">{formatCurrency(ad.spend)}</td>
                        <td className="py-1.5 px-3 text-right text-xs font-semibold" style={{ color: ad.roas >= 3.5 ? '#22c55e' : ad.roas >= 2 ? '#f59e0b' : '#ef4444' }}>{formatROAS(ad.roas)}</td>
                        <td className="py-1.5 pl-3 text-right text-xs text-gray-500">{ad.ctr}%</td>
                      </tr>
                    ))}
                    {openFormat === fs.format && fs.ads.length > 15 && (
                      <tr key={`${fs.format}-more`} className="bg-gray-50/60">
                        <td colSpan={5} className="py-1.5 pl-6 text-[11px] text-gray-400">…and {fs.ads.length - 15} more (see the grid below, sorted by spend)</td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Creative briefs for the team ── */}
      {status === 'live' && (
        <Card accentColor="#374151" className="mb-5">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h2 className="text-sm font-bold text-gray-700">🎬 Creative Briefs — Ready to Produce</h2>
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              {([['video', '✂️ Edits'], ['static', '🖼 Statics'], ['orly', '🎥 Orly']] as Array<[keyof typeof briefCounts, string]>).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1 text-[11px] text-gray-500">
                  {label}
                  <select
                    value={briefCounts[k]}
                    onChange={e => setBriefCounts(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                    disabled={briefsGenerating}
                    className="text-xs font-semibold border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-700"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
              ))}
              <button
                onClick={generateBriefs}
                disabled={briefsGenerating || totalBriefs === 0}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-gray-800 hover:bg-black disabled:opacity-50 text-white"
              >
                {briefsGenerating ? `✍️ Writing ${totalBriefs} brief${totalBriefs !== 1 ? 's' : ''}…` : (briefsData?.briefs?.length ?? 0) > 0 ? '↻ Regenerate' : '✍️ Generate briefs'}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            One deep brief per track, built from the last 30 days of ad data and your brand guidelines. Each opens as a standalone page you can send straight to a freelancer — no login needed.
            {briefsData?.generatedAt && <> Last generated {briefsData.generatedAt.slice(0, 10)}.</>}
          </p>
          {briefsError && <p className="text-xs text-red-500 mb-2">{briefsError}</p>}

          {(briefsData?.briefs?.length ?? 0) > 0 ? (() => {
            const all = briefsData!.briefs!;
            const stOf = (id: string) => briefStatuses[id]?.status ?? 'new';
            const active = all.filter(b => ['new', 'production'].includes(stOf(b.id)));
            const completed = all.filter(b => stOf(b.id) === 'completed');
            const skipped = all.filter(b => stOf(b.id) === 'skipped');
            const TRACK_META: Record<string, { icon: string; label: string }> = {
              video: { icon: '✂️', label: 'Video editor · re-edit of existing footage' },
              static: { icon: '🖼', label: 'Static ad · existing photography' },
              orly: { icon: '🎥', label: 'Orly on-camera · new shoot' },
            };
            const renderBrief = (b: typeof all[number]) => {
              const meta = TRACK_META[b.track] || { icon: '📄', label: b.track };
              const st = stOf(b.id);
              const notes = briefStatuses[b.id]?.notes ?? '';
              return (
                <div key={b.id} className={`border rounded-xl px-4 py-3 ${st === 'production' ? 'border-blue-300 bg-blue-50/30' : st === 'completed' ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{meta.icon} {meta.label}</p>
                    {st === 'production' && <span className="text-[10px] font-bold text-blue-600 bg-blue-100 rounded-full px-2 py-0.5">IN PRODUCTION</span>}
                    {st === 'completed' && <span className="text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5">✓ COMPLETED</span>}
                  </div>
                  <p className="text-sm font-semibold text-gray-800 break-words mt-0.5">{b.title}</p>
                  {b.summary && <p className="text-xs text-gray-500 mt-0.5 break-words">{b.summary}</p>}
                  {notes && notesOpenFor !== b.id && (
                    <p className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mt-1.5 whitespace-pre-wrap">🧪 {notes}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <a href={`/brief/${b.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-black">Open brief ↗</a>
                    <button onClick={() => copyBriefLink(b.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600">
                      {copiedLink === b.id ? '✓ Link copied' : '🔗 Copy link'}
                    </button>
                    {st !== 'completed' && st !== 'skipped' && (
                      <button
                        onClick={() => sendBriefToTasks(b, meta.label)}
                        disabled={!!taskCreatedFor[b.id]}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 disabled:opacity-60"
                      >
                        {taskCreatedFor[b.id] ? '✓ On Tasks board' : '📋 → Task'}
                      </button>
                    )}
                    {st !== 'production' && st !== 'completed' && (
                      <button onClick={() => setBriefStatus(b.id, 'production')} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100">▶ In production</button>
                    )}
                    {st === 'production' && (
                      <button onClick={() => setBriefStatus(b.id, 'completed')} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100">✓ Mark completed</button>
                    )}
                    <button
                      onClick={() => { setNotesOpenFor(notesOpenFor === b.id ? null : b.id); setNotesDraft(notes); }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
                    >
                      🧪 {notes ? 'Edit notes' : 'Add test notes'}
                    </button>
                    {st === 'new' && (
                      <button onClick={() => setBriefStatus(b.id, 'skipped')} title="Not doing this one" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:text-gray-600">Skip ✕</button>
                    )}
                  </div>
                  {notesOpenFor === b.id && (
                    <div className="mt-2">
                      <textarea
                        value={notesDraft}
                        onChange={e => setNotesDraft(e.target.value)}
                        rows={3}
                        placeholder="What we tested, what happened, what we learned — e.g. 'Hook variant B beat original 2.1x vs 1.4x ROAS over 5 days; keep question-hooks.'"
                        className="w-full text-xs border border-amber-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <button onClick={() => saveBriefNotes(b.id)} className="mt-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Save notes</button>
                    </div>
                  )}
                </div>
              );
            };
            return (
              <div className="flex flex-col gap-2">
                {active.map(renderBrief)}
                {active.length === 0 && <p className="text-xs text-gray-400 py-1">No active briefs — regenerate or check completed/skipped below.</p>}
                {completed.length > 0 && (
                  <div>
                    <button onClick={() => setShowCompletedBriefs(o => !o)} className="text-[11px] font-semibold text-green-700 hover:text-green-800">
                      {showCompletedBriefs ? '▾' : '▸'} Completed ({completed.length})
                    </button>
                    {showCompletedBriefs && <div className="flex flex-col gap-2 mt-1.5">{completed.map(renderBrief)}</div>}
                  </div>
                )}
                {skipped.length > 0 && (
                  <div>
                    <button onClick={() => setShowSkippedBriefs(o => !o)} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600">
                      {showSkippedBriefs ? '▾' : '▸'} Skipped ({skipped.length})
                    </button>
                    {showSkippedBriefs && <div className="flex flex-col gap-2 mt-1.5">{skipped.map(renderBrief)}</div>}
                  </div>
                )}
              </div>
            );
          })() : (
            !briefsGenerating && <p className="text-sm text-gray-400 text-center py-4">No briefs yet — add your brand guidelines below, then generate.</p>
          )}

          {/* Brand guidelines the AI must follow */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button onClick={() => setGuidelinesOpen(o => !o)} className="text-xs font-semibold text-gray-600 hover:text-gray-800">
              📘 Brand guidelines {guidelines ? '(uploaded ✓)' : '(none yet — add them so briefs match the real Rocknot brand)'} {guidelinesOpen ? '▾' : '▸'}
            </button>
            {guidelinesOpen && (
              <div className="mt-2">
                <p className="text-[11px] text-gray-400 mb-1.5">
                  Upload the brand PDF and Cleo extracts everything (colors with hex codes, fonts, logo rules, voice, photography direction) into the editable text below — or paste it yourself. Every AI-generated brief and retention campaign references this.
                </p>
                <label className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-700 border border-dashed border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer hover:border-gray-400 hover:bg-gray-50">
                  📎 Upload brand guide (PDF, image, or .txt — max 4MB)
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                    className="hidden"
                    onChange={e => { const file = e.target.files?.[0]; if (file) uploadGuidelines(file); e.target.value = ''; }}
                  />
                </label>
                {uploadingGuide && <p className="text-[11px] text-gray-500 mb-2">{uploadingGuide}</p>}
                <textarea
                  value={guidelines}
                  onChange={e => setGuidelines(e.target.value)}
                  rows={10}
                  placeholder={'e.g.\nColors: Black #111111, Crystal silver #D9D9D9 …\nFonts: …\nVoice: playful, confident, never corporate …\nPhotography: real models + flat-lays, no AI imagery …'}
                  className="w-full text-xs border border-gray-200 rounded-xl p-3 font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <button
                  onClick={saveGuidelines}
                  disabled={guidelinesSaved === 'saving'}
                  className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-black disabled:opacity-60"
                >
                  {guidelinesSaved === 'saving' ? 'Saving…' : guidelinesSaved === 'saved' ? '✓ Saved' : guidelinesSaved === 'error' ? 'Save failed — retry' : 'Save guidelines'}
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Filters */}
      {status === 'live' && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {(['all', 'Meta', 'TikTok', 'Snapchat'] as PlatformFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                platformFilter === p
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {p === 'all' ? 'All Platforms' : p}
            </button>
          ))}
          <span className="text-xs text-gray-300 mx-1">|</span>
          <span className="text-xs text-gray-400 mr-1">Sort by</span>
          {([
            { key: 'spend', label: 'Spend' },
            { key: 'roas', label: 'ROAS' },
            { key: 'ctr', label: 'CTR' },
            { key: 'conversions', label: 'Conversions' },
          ] as { key: SortKey; label: string }[]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                sortKey === opt.key
                  ? 'bg-purple-100 text-purple-700 border-purple-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {(() => {
            const downloadable = creatives.filter(c =>
              (platformFilter === 'all' || c.platform === platformFilter) && c.videoUrl);
            if (downloadable.length === 0) return null;
            return (
              <button
                onClick={() => {
                  // Stagger the attachment downloads so the browser accepts them all.
                  downloadable.forEach((c, i) => setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = `/api/creative-download?url=${encodeURIComponent(c.videoUrl!)}&name=${encodeURIComponent(c.name)}`;
                    a.download = '';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }, i * 800));
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors ml-auto"
              >
                ⬇ Download all videos ({downloadable.length})
              </button>
            );
          })()}
        </div>
      )}

      {/* Loading */}
      {status === 'loading' && (
        <Card>
          <p className="text-sm text-gray-400 text-center py-12">Loading creative data from Windsor…</p>
        </Card>
      )}

      {/* Error / Empty */}
      {(status === 'empty' || status === 'error') && (
        <Card accentColor="#fde68a">
          <div className="text-center py-10">
            <p className="text-2xl mb-2">🎨</p>
            <p className="text-sm font-bold text-gray-700 mb-1">No creative-level data available yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              {status === 'error'
                ? "We couldn't reach Windsor for creative data. Try refreshing in a bit."
                : "Windsor hasn't returned ad-level creative data for this period yet — this can take a sync cycle or two after creatives go live, or may require enabling creative-level fields on your Meta/TikTok connections in Windsor."}
            </p>
          </div>
        </Card>
      )}

      {/* Creative Grid */}
      {status === 'live' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(creative => (
            <div
              key={`${creative.platform}-${creative.id}`}
              onClick={() => setSelected(creative)}
              className="cursor-pointer transition-transform hover:-translate-y-0.5"
            >
            <Card className="overflow-hidden !p-0">
              {/* Thumbnail / placeholder */}
              <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden relative">
                {creative.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={creative.thumbnailUrl}
                    alt={creative.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="w-full h-full items-center justify-center text-gray-300 text-3xl"
                  style={{ display: creative.thumbnailUrl ? 'none' : 'flex' }}
                >
                  🎨
                </div>
                {/* Platform badge overlay */}
                <div className="absolute top-2 left-2">
                  <PlatformBadge platform={creative.platform} />
                </div>
                {/* Open in-dashboard breakdown */}
                <span className="absolute top-2 right-2 bg-white/90 text-gray-600 rounded-lg px-2 py-1 text-xs font-semibold shadow-sm flex items-center gap-1">
                  Analyze
                </span>
              </div>

              <div className="p-4">
                {/* Ad name */}
                <p className="text-sm font-bold text-gray-800 leading-snug line-clamp-2 mb-1">{creative.name}</p>

                {/* Campaign / adset */}
                {creative.campaign && (
                  <p className="text-xs text-gray-400 line-clamp-1 mb-0.5">
                    <span className="font-semibold text-gray-500">Campaign:</span> {creative.campaign}
                  </p>
                )}
                {creative.adset && (
                  <p className="text-xs text-gray-400 line-clamp-1 mb-3">
                    <span className="font-semibold text-gray-500">Ad Set:</span> {creative.adset}
                  </p>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Spend</p>
                    <p className="text-gray-700 font-bold">{formatCurrency(creative.spend)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Revenue</p>
                    <p className="text-gray-700 font-bold">{formatCurrency(creative.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">ROAS</p>
                    <p className="font-bold" style={{ color: creative.roas >= 3.5 ? '#22c55e' : '#ef4444' }}>
                      {formatROAS(creative.roas)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">CTR</p>
                    <p className="text-gray-700 font-bold">{formatPercent(creative.ctr)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Conversions</p>
                    <p className="text-gray-700 font-bold">{(creative.conversions ?? 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Cost / Conv</p>
                    <p className="text-gray-700 font-bold">{creative.costPerConversion ? formatCurrency(creative.costPerConversion) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                    <p className="text-gray-700 font-bold">{creative.clicks.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </Card>
            </div>
          ))}
        </div>
      )}

      {/* Creative detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header strip — badge + close live OUTSIDE the video so they
                never cover the player's own controls (mute button, etc.). */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-900 rounded-t-2xl">
              <PlatformBadge platform={selected.platform} />
              <button
                onClick={() => setSelected(null)}
                className="bg-white/90 hover:bg-white text-gray-600 hover:text-gray-900 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-sm"
              >
                ✕
              </button>
            </div>
            {/* Preview */}
            <div className={`${selected.videoUrl ? 'h-[68dvh] sm:aspect-video sm:h-auto' : selected.previewUrl ? 'h-[72dvh] sm:h-[560px]' : 'aspect-video'} bg-gray-100 flex items-center justify-center overflow-hidden relative`}>
              {selected.videoUrl ? (
                // No autoplay/muted: iOS only allows sound when playback starts
                // from the user's own tap, so the tap-to-play video keeps audio.
                <video
                  src={selected.videoUrl}
                  poster={selected.thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain bg-gray-900"
                />
              ) : selected.previewUrl ? (
                // Meta's official ad-preview embed — plays the real creative
                // when the raw video file is permission-gated.
                <iframe
                  src={selected.previewUrl}
                  className="w-full h-full border-0 bg-gray-900"
                  allow="autoplay; encrypted-media"
                  scrolling="no"
                  title={selected.name}
                />
              ) : selected.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.thumbnailUrl} alt={selected.name} className="w-full h-full object-contain bg-gray-900" />
              ) : (
                <span className="text-gray-300 text-5xl">🎨</span>
              )}
            </div>

            <div className="p-6">
              <p className="text-base font-bold text-gray-800 leading-snug mb-1">{selected.name}</p>
              {selected.campaign && (
                <p className="text-xs text-gray-400 mb-0.5">
                  <span className="font-semibold text-gray-500">Campaign:</span> {selected.campaign}
                </p>
              )}
              {selected.adset && (
                <p className="text-xs text-gray-400 mb-4">
                  <span className="font-semibold text-gray-500">Ad Set:</span> {selected.adset}
                </p>
              )}

              {/* Headline metrics vs account average for the period */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {([
                  { label: 'ROAS', value: formatROAS(selected.roas), avg: blendedROAS, actual: selected.roas, higherIsBetter: true },
                  { label: 'CTR', value: formatPercent(selected.ctr), avg: avgCTR, actual: selected.ctr, higherIsBetter: true },
                  { label: 'Cost / Conv', value: selected.costPerConversion ? formatCurrency(selected.costPerConversion) : '—', avg: avgCostPerConv, actual: selected.costPerConversion ?? 0, higherIsBetter: false },
                ]).map(m => {
                  const hasComparison = m.avg > 0 && m.actual > 0;
                  const deltaPct = hasComparison ? ((m.actual - m.avg) / m.avg) * 100 : 0;
                  const good = m.higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;
                  return (
                    <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{m.label}</p>
                      <p className="text-lg font-bold text-gray-800">{m.value}</p>
                      {hasComparison && (
                        <p className="text-[11px] font-semibold" style={{ color: good ? '#22c55e' : '#ef4444' }}>
                          {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(0)}% vs avg
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Full breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs mb-5">
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Spend</p>
                  <p className="text-gray-700 font-bold text-sm">{formatCurrency(selected.spend)}</p>
                  <p className="text-[10px] text-gray-400">{totalSpend > 0 ? `${((selected.spend / totalSpend) * 100).toFixed(1)}% of total` : ''}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Revenue</p>
                  <p className="text-gray-700 font-bold text-sm">{formatCurrency(selected.revenue)}</p>
                  <p className="text-[10px] text-gray-400">{totalRevenue > 0 ? `${((selected.revenue / totalRevenue) * 100).toFixed(1)}% of total` : ''}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Conversions</p>
                  <p className="text-gray-700 font-bold text-sm">{(selected.conversions ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Impressions</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.impressions.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.clicks.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">CPC</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.clicks > 0 ? formatCurrency(selected.spend / selected.clicks) : '—'}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
                <p className="text-[11px] text-gray-400">Period: {TIMEFRAME_LABELS[tf] || tf}</p>
                <button
                  onClick={async () => {
                    const url = `${window.location.origin}/dashboard/creatives?tf=${tf}&ad=${encodeURIComponent(selected.id)}`;
                    // Phone: native share sheet (text, AirDrop, Slack app…).
                    // Desktop: straight to clipboard — macOS also has
                    // navigator.share, but a share sheet is the wrong tool
                    // when you just want to paste a URL into Slack.
                    const isTouch = window.matchMedia('(pointer: coarse)').matches;
                    if (isTouch && navigator.share) {
                      try { await navigator.share({ title: selected.name, url }); return; } catch { /* cancelled — fall through to copy */ }
                    }
                    try {
                      await navigator.clipboard.writeText(url);
                      setSharedLinkCopied(true);
                      setTimeout(() => setSharedLinkCopied(false), 1500);
                    } catch { window.prompt('Copy this link:', url); }
                  }}
                  className="text-xs font-semibold text-violet-600 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-2 transition-colors"
                >
                  {sharedLinkCopied ? '✓ Link copied — paste in Slack' : '🔗 Copy link'}
                </button>
                {selected.videoUrl && (
                  <button
                    onClick={() => saveToPhotos(selected)}
                    disabled={sharing}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-3 py-2 transition-colors disabled:opacity-60"
                  >
                    {sharing ? 'Preparing…' : '📱 Save to Photos'}
                  </button>
                )}
                {selected.videoUrl && (
                  <a
                    href={`/api/creative-download?url=${encodeURIComponent(selected.videoUrl)}&name=${encodeURIComponent(selected.name)}`}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-3 py-2 transition-colors"
                  >
                    ⬇ Download
                  </a>
                )}
                {selected.adUrl && (
                  <a
                    href={selected.adUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-lg px-3 py-2 transition-colors"
                  >
                    Open in {selected.platform === 'Meta' ? 'Ads Manager' : selected.platform === 'Snapchat' ? 'Snapchat Ads' : 'TikTok Ads'} ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
