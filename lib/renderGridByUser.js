// lib/renderGridByUser.js
// const { createCanvas } = require('canvas');
// const dayjs = require('dayjs');

// weekdays only
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ROW_DAYS = 5;

// minute helpers
const minSinceMidnight = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

// high-contrast user palette (same as we used before)
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
  for (let i = 1; i < uniq.length; i++) {
    let best = -1, score = -1;
    for (let pi = 0; pi < PALETTE.length; pi++) {
      if (used.has(pi)) continue;
      const sc = [...used].reduce((m, u) => {
        let d = Math.abs(PALETTE[u][0] - PALETTE[pi][0]); if (d > 180) d = 360 - d; return Math.min(m, d);
      }, 999);
      if (sc > score) {score = sc;best = pi;}
    }
    const idx = best === -1 ? i % PALETTE.length : best;
    used.add(idx); map.set(uniq[i], hsl(PALETTE[idx]));
  }
  return map;
}

/**
 * blocks: [{ dayIndex, startDate, endDate, title, attendees: ['QD','LT'] }]
 * users:  [{ id, initials, displayName }]
 *
 * Layout:
 * - Rows = users (in given order)
 * - X axis = 5 days * [hours.start..hours.end] with day separators
 */
function renderGridPNGByUser({
  weekStartISO,
  blocks,
  users = [],
  hours = { start: 8, end: 22 },
  members,
  slotW = 24,
  rowH = 72,
  leftLabelW = 130,
}) {
  const slotsPerDay = (hours.end - hours.start) * 2;
  const minutesPerDay = (hours.end - hours.start) * 60;
  const titleH = 34, gapH = 10, timeH = 24;
  const headerH = titleH + gapH + timeH;

  // canvas size
  const width = leftLabelW + (slotW * slotsPerDay) * ROW_DAYS + 1;
  const height = headerH + rowH * users.length + 56;

  // user colors
  const labels = users.map(u => (u.initials || u.displayName || u.id || '??').trim());
  const colorMap = assignUserColors(labels);
  const colorFor = label => colorMap.get(label) || 'hsl(0 0% 80%)';

  // group identical events (same day, title, start,end) so we can assign a canonical owner
  const groups = new Map();
  for (const b of blocks) {
    if (b.dayIndex >= ROW_DAYS) continue;
    const key = `${b.dayIndex}|${+b.startDate}|${+b.endDate}|${b.title}`;
    if (!groups.has(key)) groups.set(key, { ...b, attendees: new Set(b.attendees || []) });
    else for (const a of (b.attendees || [])) groups.get(key).attendees.add(a);
  }

  // choose canonical owner per event: smallest initials in users[] order
  const orderIndex = new Map(labels.map((lab, idx) => [lab, idx]));
  const grouped = [];
  for (const g of groups.values()) {
    const attendees = [...g.attendees];
    attendees.sort((a, b) => (orderIndex.get(a) ?? 999) - (orderIndex.get(b) ?? 999));
    grouped.push({
      dayIndex: g.dayIndex,
      startDate: g.startDate, endDate: g.endDate,
      title: g.title,
      attendees,
      owner: attendees[0] || null,
    });
  }

  // drawing
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // bg
  ctx.fillStyle = '#0f1115'; ctx.fillRect(0, 0, width, height);

  // title
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Inter, system-ui, Arial';
  ctx.fillText(`UGent Shared Timetable — Week of ${weekStartISO}  •  ${members} member${members === 1 ? '' : 's'}`, 10, 24);

  // top time ruler: show hours for each day band
  ctx.font = '12px Inter, system-ui, Arial'; ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = '#263040'; ctx.lineWidth = 1;

  for (let d = 0; d < ROW_DAYS; d++) {
    // day label above band
    const bandX = leftLabelW + d * (slotsPerDay * slotW);
    ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 13px Inter, system-ui, Arial';
    ctx.fillText(DAY_LABELS[d], bandX + 6, headerH - 8);

    // hour grid inside band
    ctx.fillStyle = '#94a3b8'; ctx.font = '12px Inter, system-ui, Arial';
    for (let s = 0; s <= slotsPerDay; s++) {
      const x = bandX + s * slotW + 0.5;
      ctx.beginPath(); ctx.moveTo(x, headerH); ctx.lineTo(x, headerH + users.length * rowH); ctx.stroke();
      if (s % 2 === 0 && s < slotsPerDay) {
        const hour = hours.start + s / 2;
        ctx.fillText(String(hour).padStart(2, '0') + ':00', x + 4, headerH - 6);
      }
    }
    // band separator
    const sepX = bandX + slotsPerDay * slotW + 0.5;
    ctx.beginPath(); ctx.moveTo(sepX, headerH); ctx.lineTo(sepX, headerH + users.length * rowH); ctx.stroke();
  }

  // user row labels + row lines
  for (let i = 0; i < users.length; i++) {
    const y = headerH + i * rowH + 0.5;
    ctx.strokeStyle = '#263040'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 14px Inter, system-ui, Arial';
    const lab = labels[i];
    ctx.fillText(lab, 12, y + 22);
  }

  // helpers
  const totalBandWidth = slotsPerDay * slotW;

  function xForDate(d, dayIndex) {
    const mins = Math.max(0, Math.min(minutesPerDay, minSinceMidnight(d) - hours.start * 60));
    const bandX = leftLabelW + dayIndex * totalBandWidth;
    return bandX + (mins / 30) * slotW;
  }
  function drawRefChip(x, y, w, color) {
    const h = 10, r = 4;
    ctx.fillStyle = color + 'cc';
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }

  // draw events: full card on owner row, small reference on other attendees' rows
  for (const ev of grouped) {
    const x1 = xForDate(ev.startDate, ev.dayIndex) + 3;
    const x2 = xForDate(ev.endDate, ev.dayIndex) - 3;
    if (x2 <= leftLabelW || x1 >= leftLabelW + ROW_DAYS * totalBandWidth) continue;
    const w = Math.max(8, x2 - x1);

    const ownerIdx = orderIndex.get(ev.owner) ?? 0;

    // full card on owner row
    {
      const yTop = headerH + ownerIdx * rowH + 10;
      const h = Math.max(22, rowH - 22);
      // card bg
      ctx.fillStyle = 'rgba(203,213,225,0.22)';
      ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.1;
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(x1 + r, yTop);
      ctx.arcTo(x1 + w, yTop, x1 + w, yTop + h, r);
      ctx.arcTo(x1 + w, yTop + h, x1, yTop + h, r);
      ctx.arcTo(x1, yTop + h, x1, yTop, r);
      ctx.arcTo(x1, yTop, x1 + w, yTop, r);
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // colored left bar per attendees
      const cols = ev.attendees.slice(0, 4).map(a => colorFor(a));
      for (let i = 0;i < cols.length;i++) { ctx.fillStyle = cols[i]; ctx.fillRect(x1 + i * 5, yTop, 4, h); }

      // title/time/attendees
      const innerX = x1 + cols.length * 5 + 8;
      const maxW = w - (innerX - x1) - 6;

      // title (owner color)
      ctx.fillStyle = colorFor(ev.owner);
      ctx.font = 'bold 12px Inter, system-ui, Arial';
      const title = trimTo(ctx, ev.title || 'Lesson', maxW);
      ctx.fillText(title, innerX, yTop + 14);

      // time
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Inter, system-ui, Arial';
      const t = `${String(ev.startDate.getHours()).padStart(2, '0')}:${String(ev.startDate.getMinutes()).padStart(2, '0')}–${String(ev.endDate.getHours()).padStart(2, '0')}:${String(ev.endDate.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(trimTo(ctx, t, maxW), innerX, yTop + 28);

      // others (excluding owner)
      const others = ev.attendees.filter(a => a !== ev.owner);
      if (others.length) {
        ctx.fillStyle = '#cbd5e1'; ctx.font = '11px Inter, system-ui, Arial';
        const who = trimTo(ctx, others.join(', '), maxW);
        ctx.fillText(who, innerX, yTop + 42);
      }
    }

    // reference chips on non-owner rows
    for (let ui = 0; ui < users.length; ui++) {
      const lab = labels[ui];
      if (!ev.attendees.includes(lab) || ui === ownerIdx) continue;
      const yMid = headerH + ui * rowH + 8;
      drawRefChip(x1, yMid, Math.max(6, w), colorFor(lab));
    }
  }

  // legend: user chips
  const legendY = headerH + users.length * rowH + 16;
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Inter, system-ui, Arial';
  ctx.fillText('Users:', 10, legendY);
  // eslint-disable-next-line prefer-const
  let lx = 70, ly = legendY + 2, chipW = 14, chipH = 14, gapX = 12;
  for (const lab of labels) {
    const need = chipW + 6 + ctx.measureText(lab).width + gapX;
    if (lx + need > width - 10) { lx = 70; ly += chipH + 8; }
    ctx.fillStyle = colorFor(lab); ctx.fillRect(lx, ly - chipH + 2, chipW, chipH);
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(lab, lx + chipW + 6, ly + 2);
    lx += need;
  }

  return canvas.toBuffer('image/png');

  // eslint-disable-next-line no-shadow
  function trimTo(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = ((lo + hi + 1) / 2) | 0, t = text.slice(0, mid) + '…';
      if (ctx.measureText(t).width <= maxW) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
  }
}

module.exports = { renderGridPNGByUser };
