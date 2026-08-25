import { loadDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Public, shareable creative brief — designers open the link with no login.
// Neutral document styling on purpose: the dashboard's pastel theme is NOT
// Rocknot's brand, and a brief should read like a professional work doc.

// Minimal markdown → HTML (headings, bold, italics, lists, tables, hr).
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\(((?:https?:|\/)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inUl = false, inOl = false, para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flushPara(); closeLists(); continue; }
    if (/^\|.+\|$/.test(t)) {
      flushPara(); closeLists();
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().slice(1, -1).split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      out.push('<table>' + rows.map((r, ri) =>
        `<tr>${r.map(c => ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`
      ).join('') + '</table>');
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); closeLists(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^---+$/.test(t)) { flushPara(); closeLists(); out.push('<hr/>'); continue; }
    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) { flushPara(); if (inOl) { out.push('</ol>'); inOl = false; } if (!inUl) { out.push('<ul>'); inUl = true; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); if (inUl) { out.push('</ul>'); inUl = false; } if (!inOl) { out.push('<ol>'); inOl = true; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    closeLists();
    para.push(t);
  }
  flushPara(); closeLists();
  return out.join('\n');
}

export default async function BriefPage({ params }: { params: { id: string } }) {
  const id = params.id.replace(/[^a-z0-9_]/gi, '');
  const md = await loadDoc(`brief_${id}`).catch(() => null);

  if (!md) {
    return (
      <div style={{ fontFamily: 'Georgia, serif', maxWidth: 700, margin: '80px auto', padding: '0 24px', color: '#111' }}>
        <h1 style={{ fontSize: 22 }}>Brief not found</h1>
        <p style={{ color: '#555' }}>This brief may have been replaced by a newer version — ask for a fresh link.</p>
      </div>
    );
  }

  return (
    <div className="brief-doc">
      <style>{`
        .brief-doc { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 0 auto; padding: 48px 28px 96px; color: #1a1a1a; line-height: 1.65; font-size: 16px; background: #fff; }
        .brief-doc h1 { font-size: 28px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; }
        .brief-doc h2 { font-size: 19px; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #111; }
        .brief-doc h3 { font-size: 16px; margin: 22px 0 8px; }
        .brief-doc p { margin: 0 0 12px; }
        .brief-doc em { color: #444; }
        .brief-doc ul, .brief-doc ol { margin: 0 0 14px; padding-left: 24px; }
        .brief-doc li { margin-bottom: 5px; }
        .brief-doc a { color: #0a58ca; text-decoration: underline; word-break: break-all; }
        .brief-doc code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; background: #f4f4f4; padding: 1px 5px; border-radius: 4px; }
        .brief-doc table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 14px; }
        .brief-doc th, .brief-doc td { border: 1px solid #ddd; padding: 7px 10px; text-align: left; vertical-align: top; }
        .brief-doc th { background: #f7f7f7; }
        .brief-doc hr { border: none; border-top: 1px solid #ddd; margin: 26px 0; }
        .brief-meta { font-family: -apple-system, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #999; margin-bottom: 26px; }
        @media print { .brief-doc { padding: 0; } }
      `}</style>
      <p className="brief-meta">Rocknot · Creative Brief</p>
      <div dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />
    </div>
  );
}
