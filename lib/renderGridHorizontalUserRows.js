// lib/renderGridHorizontalUserRows.js
const { createCanvas } = require('canvas');

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ROW_DAYS = 5;

const minSinceMidnight = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/* High-contrast palette (H,S,L%) for dark bg */
const PALETTE = [
  [265, 85, 75], [20, 90, 70], [200, 85, 65], [140, 70, 65], [350, 75, 72], [45, 95, 70],
  [300, 70, 72], [185, 70, 70], [10, 85, 68], [80, 70, 68], [230, 80, 72], [0, 0, 80],
];
const hsl = ([h, s, l]) => `hsl(${h} ${s}% ${l}%)`;

function assignUserColors(labels) {
  const uniq = [...new Set(labels)];
  const map = new Map();
  if (!uniq.length) return map;
  const used = new Set([0]);
  map.set(uniq[0], hsl(PALETTE[0]));
  for (let i = 1;i < uniq.length;i++) {
    let best = -1, score = -1;
    for (let pi = 0; pi < PALETTE.length; pi++) {
      if (used.has(pi)) continue;
      const sc = [...used].reduce((m, u) => {
        let d = Math.abs(PALETTE[u][0] - PALETTE[pi][0]); if (d > 180) d = 360 - d; return Math.min(m, d);
      }, 999);
      if (sc > score) {score = sc;best = pi;}
    }
    const idx = best === -1 ? i % PALETTE.length : best;
    used.add(idx);
    map.set(uniq[i], hsl(PALETTE[idx]));
  }
  return map;
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = ((lo + hi + 1) / 2) | 0; const t = text.slice(0, mid) + '…';
    if (ctx.measureText(t).width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

/**
 * Horizontal timetable with per-day user subrows
 * - Days = rows (Mon–Fri)
 * - Each day row is subdivided into N user rows (order = users array)
 * - For shared events: full card on canonical owner’s subrow (first attendee by users order),
 *   thin "reference chip" on other attendees’ subrows at the same time
 */
function renderGridPNGHorizontalUserRows({
  weekStartISO,
  blocks,
  users = [],
  members,
  hours = { start: 8, end: 22 },
  slotW = 34,
  userRowH = 52,
  leftLabelW = 120,
}) {
  const slotsPerDay = (hours.end - hours.start) * 2;
  const minutesPerDay = (hours.end - hours.start) * 60;

  const titleH = 34, gapH = 12, timeRulerH = 24;
  const headerH = titleH + gapH + timeRulerH;

  // one day row = users.length * userRowH + inner padding
  const dayInnerPad = 10;
  const dayRowH = users.length * userRowH + dayInnerPad * 2;

  const legendHBase = 16;
  const width = leftLabelW + slotW * slotsPerDay + 1;
  const height = headerH + ROW_DAYS * dayRowH + legendHBase + 40;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // user labels & colors
  const labels = users.map(u => (u.initials || u.displayName || u.id || '??').trim());
  const colorMap = assignUserColors(labels);
  const colorFor = lab => colorMap.get(lab) || 'hsl(0 0% 80%)';

  // Background
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Inter, system-ui, Arial';
  const title = `UGent Shared Timetable — Week of ${weekStartISO}  •  ${members} member${members === 1 ? '' : 's'}`;
  ctx.fillText(title, 10, 24);

  // Top time ruler (across the whole week band area)
  ctx.font = '12px Inter, system-ui, Arial';
  ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = '#263040';
  ctx.lineWidth = 1;

  for (let s = 0; s <= slotsPerDay; s++) {
    const x = leftLabelW + s * slotW + 0.5;
    // vertical grid spanning all day rows
    ctx.beginPath();
    ctx.moveTo(x, headerH);
    ctx.lineTo(x, headerH + ROW_DAYS * dayRowH);
    ctx.stroke();

    if (s % 2 === 0 && s < slotsPerDay) {
      const hour = hours.start + s / 2;
      const label = String(hour).padStart(2, '0') + ':00';
      ctx.fillText(label, x + 4, headerH - 6);
    }
  }

  // Day bands (Mon–Fri)
  for (let d = 0; d < ROW_DAYS; d++) {
    const dayTop = headerH + d * dayRowH;

    // horizontal separator
    ctx.strokeStyle = '#263040';
    ctx.beginPath();
    ctx.moveTo(0, dayTop + 0.5);
    ctx.lineTo(width, dayTop + 0.5);
    ctx.stroke();

    // Day label
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 14px Inter, system-ui, Arial';
    ctx.fillText(DAY_LABELS[d], 12, dayTop + 22);

    // draw per-user subrow separators
    for (let ui = 0; ui < users.length; ui++) {
      const y = dayTop + dayInnerPad + ui * userRowH + 0.5;
      ctx.strokeStyle = 'rgba(38,48,64,0.6)';
      ctx.beginPath();
      ctx.moveTo(leftLabelW, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // left labels per user (once per day for scannability)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter, system-ui, Arial';
      const lab = labels[ui];
      ctx.fillText(lab, 12, y + 18);
    }
  }

  // Group identical events within the week to avoid duplicating full cards
  const orderIndex = new Map(labels.map((lab, idx) => [lab, idx]));
  const groups = new Map();
  for (const b of blocks) {
    if (b.dayIndex >= ROW_DAYS) continue;
    const key = `${b.dayIndex}|${+b.startDate}|${+b.endDate}|${b.title}`;
    if (!groups.has(key)) groups.set(key, { ...b, attendees: new Set(b.attendees || []) });
    else for (const a of (b.attendees || [])) groups.get(key).attendees.add(a);
  }
  const events = [];
  for (const g of groups.values()) {
    const att = [...g.attendees];
    att.sort((a, b) => (orderIndex.get(a) ?? 999) - (orderIndex.get(b) ?? 999));
    events.push({
      dayIndex: g.dayIndex,
      startDate: g.startDate,
      endDate: g.endDate,
      title: g.title,
      attendees: att,
      owner: att[0] || null,
    });
  }

  // helpers
  function xFor(d) {
    const mins = Math.max(0, Math.min(minutesPerDay, minSinceMidnight(d) - hours.start * 60));
    return leftLabelW + (mins / 30) * slotW;
  }
  function yFor(dayIndex, userIdx) {
    const dayTop = headerH + dayIndex * dayRowH;
    return dayTop + dayInnerPad + userIdx * userRowH;
  }
  function drawRefChip(x, yTop, w, color) {
    const h = 8, r = 4;
    ctx.fillStyle = color + 'cc';
    ctx.beginPath();
    ctx.moveTo(x + r, yTop);
    ctx.arcTo(x + w, yTop, x + w, yTop + h, r);
    ctx.arcTo(x + w, yTop + h, x, yTop + h, r);
    ctx.arcTo(x, yTop + h, x, yTop, r);
    ctx.arcTo(x, yTop, x + w, yTop, r);
    ctx.closePath(); ctx.fill();
  }

  // Draw each event: full card on owner's subrow; thin reference on others'
  for (const ev of events) {
    const x1 = xFor(ev.startDate) + 3;
    const x2 = xFor(ev.endDate) - 3;
    const w = Math.max(8, x2 - x1);

    const ownerIdx = orderIndex.get(ev.owner) ?? 0;
    const ownerTop = yFor(ev.dayIndex, ownerIdx);

    // full card
    {
      const y = ownerTop + 6;
      const h = Math.max(20, userRowH - 12);

      // card
      ctx.fillStyle = 'rgba(203,213,225,0.22)';
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1.1;
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(x1 + r, y);
      ctx.arcTo(x1 + w, y, x1 + w, y + h, r);
      ctx.arcTo(x1 + w, y + h, x1, y + h, r);
      ctx.arcTo(x1, y + h, x1, y, r);
      ctx.arcTo(x1, y, x1 + w, y, r);
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // attendee stripes (up to 4)
      const cols = ev.attendees.slice(0, 4).map(a => colorFor(a));
      for (let i = 0;i < cols.length;i++) { ctx.fillStyle = cols[i]; ctx.fillRect(x1 + i * 5, y, 4, h); }

      // text
      const innerX = x1 + cols.length * 5 + 8;
      const maxW = w - (innerX - x1) - 6;

      // title in owner's color
      ctx.fillStyle = colorFor(ev.owner);
      ctx.font = 'bold 12px Inter, system-ui, Arial';
      ctx.fillText(fitText(ctx, ev.title || 'Lesson', maxW), innerX, y + 14);

      // time
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Inter, system-ui, Arial';
      const t = `${String(ev.startDate.getHours()).padStart(2, '0')}:${String(ev.startDate.getMinutes()).padStart(2, '0')}–${String(ev.endDate.getHours()).padStart(2, '0')}:${String(ev.endDate.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(fitText(ctx, t, maxW), innerX, y + 28);

      // other attendees
      const others = ev.attendees.filter(a => a !== ev.owner);
      if (others.length && h >= 42) {
        ctx.fillStyle = '#cbd5e1'; ctx.font = '11px Inter, system-ui, Arial';
        ctx.fillText(fitText(ctx, others.join(', '), maxW), innerX, y + 42);
      }
    }

    // reference chips on non-owner users
    for (let ui = 0; ui < users.length; ui++) {
      const lab = labels[ui];
      if (!ev.attendees.includes(lab) || ui === ownerIdx) continue;
      const chipTop = yFor(ev.dayIndex, ui) + 3;
      drawRefChip(x1, chipTop, w, colorFor(lab));
    }
  }

  // Legend (users → colors)
  const legendTop = headerH + ROW_DAYS * dayRowH + 12;
  ctx.font = 'bold 13px Inter, system-ui, Arial';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText('Users:', 10, legendTop);

  let lx = 70, ly = legendTop + 2;
  const chipW = 14, chipH = 14, gapX = 12, gapY = 8;
  for (const lab of labels) {
    const need = chipW + 6 + ctx.measureText(lab).width + gapX;
    if (lx + need > width - 10) { lx = 70; ly += chipH + gapY; }
    ctx.fillStyle = colorFor(lab); ctx.fillRect(lx, ly - chipH + 2, chipW, chipH);
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(lab, lx + chipW + 6, ly + 2);
    lx += need;
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderGridPNGHorizontalUserRows };
