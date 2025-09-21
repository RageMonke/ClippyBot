// lib/renderGridHorizontal.js
const { createCanvas } = require('canvas');
// const dayjs = require('dayjs');

// Weekdays only
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ROW_DAYS = 5;

function timeToSlots(date, startHour) {
  return (date.getHours() * 60 + date.getMinutes() - startHour * 60) / 30;
}

/* ---------- DISTINCT USER COLORS ---------- */
/* High-contrast palette (OK for dark bg). Each entry is [h,s%,l%] HSL */
const BASE_PALETTE = [
  [265, 85, 75],
  [20, 90, 70],
  [200, 85, 65],
  [140, 70, 65],
  [350, 75, 72],
  [45, 95, 70],
  [300, 70, 72],
  [185, 70, 70],
  [10, 85, 68],
  [80, 70, 68],
  [230, 80, 72],
  [0, 0, 80],
];
const toHSL = ([h, s, l]) => `hsl(${h} ${s}% ${l}%)`;

/* Assign colors to user labels (initials) trying to maximize distance */
function assignUserColors(labels) {
  const uniq = [...new Set(labels.filter(Boolean).map(s => s.trim()))];
  const colors = new Map();
  if (!uniq.length) return colors;

  // Greedy: pick a seed, then repeatedly pick the color farthest from used ones
  const usedIdx = new Set();
  const palette = [...BASE_PALETTE];

  // Start with a deterministic seed based on label order
  const seed = 0;
  usedIdx.add(seed);
  colors.set(uniq[0], toHSL(palette[seed]));

  for (let i = 1; i < uniq.length; i++) {
    let bestIdx = -1, bestScore = -1;
    for (let pi = 0; pi < palette.length; pi++) {
      if (usedIdx.has(pi)) continue;
      // score: min hue distance to already used
      const score = [...usedIdx].reduce((minD, ui) => {
        const [h1] = palette[ui];
        const [h2] = palette[pi];
        let d = Math.abs(h1 - h2); if (d > 180) d = 360 - d;
        return Math.min(minD, d);
      }, 999);
      if (score > bestScore) { bestScore = score; bestIdx = pi; }
    }
    // If we run out, cycle
    const idx = bestIdx === -1 ? (i % palette.length) : bestIdx;
    usedIdx.add(idx);
    colors.set(uniq[i], toHSL(palette[idx]));
  }
  return colors;
}

/* ---------- TEXT UTILS ---------- */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = ((lo + hi + 1) / 2) | 0;
    const t = text.slice(0, mid) + '…';
    if (ctx.measureText(t).width <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

/* ---------- LANE PACKING ---------- */
function lanePack(blocksDay) {
  const items = [...blocksDay].sort((a, b) => a.startDate - b.startDate || b.endDate - a.endDate);
  const lanes = [];
  for (const b of items) {
    let placed = false;
    for (let li = 0; li < lanes.length; li++) {
      const last = lanes[li][lanes[li].length - 1];
      if (last.endDate <= b.startDate) { lanes[li].push(b); b.lane = li; placed = true; break; }
    }
    if (!placed) { b.lane = lanes.length; lanes.push([b]); }
  }
  const lanesCount = Math.max(1, lanes.length);
  for (const b of items) b.lanes = lanesCount;
  return items;
}

/* ---------- RENDER ---------- */
function renderGridPNGHorizontal({
  weekStartISO,
  blocks,
  users = [],
  members,
  hours = { start: 8, end: 22 },
  slotW = 34,
  dayRowH = 120,
  leftLabelW = 120,
}) {
  const slotsPerDay = (hours.end - hours.start) * 2;
  const titleH = 34, gapH = 12, timeRulerH = 24;
  const headerH = titleH + gapH + timeRulerH;

  // Build distinct user colors
  const userLabels = users.map(u => (u.initials || u.displayName || u.id || '??').trim());
  const colorMap = assignUserColors(userLabels);
  const colorFor = (label) => colorMap.get(label || '') || toHSL(BASE_PALETTE[BASE_PALETTE.length - 1]);

  // --- First pass: estimate legend rows to compute height dynamically ---
  const temp = createCanvas(1, 1);
  const tctx = temp.getContext('2d');
  tctx.font = 'bold 13px system-ui, Arial';
  const chipW = 14, chipH = 14, gapX = 12, gapY = 8;
  const labelStartX = 70;
  const contentW = leftLabelW + slotW * slotsPerDay + 1;

  let lx = labelStartX, rows = 1;
  for (const lbl of userLabels) {
    const needed = chipW + 6 + tctx.measureText(lbl).width + gapX;
    if (lx + needed > contentW - 10) { rows++; lx = labelStartX; }
    lx += needed;
  }
  const legendTopPad = 12;
  const legendRowH = chipH + gapY;
  const legendH = (userLabels.length ? (legendTopPad + rows * legendRowH + 10) : 0);

  // --- Canvas sized with dynamic legend height ---
  const width = contentW;
  const height = headerH + dayRowH * ROW_DAYS + legendH;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // BG
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, Arial';
  const title = `UGent Shared Timetable — Week of ${weekStartISO}  •  ${members} member${members === 1 ? '' : 's'}`;
  ctx.fillText(title, 10, 24);

  // Time ruler
  ctx.font = '12px system-ui, Arial';
  ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = '#263040';
  ctx.lineWidth = 1;

  for (let s = 0; s <= slotsPerDay; s++) {
    const x = leftLabelW + s * slotW + 0.5;
    ctx.beginPath(); ctx.moveTo(x, headerH); ctx.lineTo(x, headerH + ROW_DAYS * dayRowH); ctx.stroke();
    if (s % 2 === 0 && s < slotsPerDay) {
      const hour = hours.start + s / 2;
      const label = String(hour).padStart(2, '0') + ':00';
      ctx.fillText(label, x + 4, headerH - 6);
    }
  }

  // Day rows + labels
  for (let d = 0; d < ROW_DAYS; d++) {
    const y = headerH + d * dayRowH + 0.5;
    ctx.strokeStyle = '#263040'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 14px system-ui, Arial';
    ctx.fillText(DAY_LABELS[d], 12, y + 22);
  }

  // Group by day, pack lanes
  const blocksByDay = Array.from({ length: ROW_DAYS }, () => []);
  for (const b of blocks) if (b.dayIndex < ROW_DAYS) blocksByDay[b.dayIndex].push(b);

  // Helper: draw attendee color stripes (up to 4)
  function drawStripes(x, y, h, attendees) {
    const n = Math.min(attendees.length, 4);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colorFor(attendees[i]);
      ctx.fillRect(x + i * 5, y, 4, h);
    }
    return n * 5;
  }

  for (let d = 0; d < ROW_DAYS; d++) {
    const dayBlocks = blocksByDay[d];
    if (!dayBlocks.length) continue;

    const packed = lanePack(dayBlocks);
    const rowTop = headerH + d * dayRowH;
    const innerTop = rowTop + 8;
    const innerH = dayRowH - 16;
    const lanes = Math.max(...packed.map(p => p.lanes), 1);
    const laneH = Math.max(22, Math.floor(innerH / lanes) - 6);

    for (const b of packed) {
      const startS = Math.max(0, Math.floor(timeToSlots(b.startDate, hours.start)));
      const endS = Math.min(slotsPerDay, Math.ceil(timeToSlots(b.endDate, hours.start)));
      if (endS <= 0 || startS >= slotsPerDay) continue;

      const x = leftLabelW + startS * slotW + 3;
      const w = Math.max(18, (endS - startS) * slotW - 6);
      const y = innerTop + b.lane * (laneH + 6);
      const h = laneH;

      // Card
      ctx.fillStyle = 'rgba(203,213,225,0.22)';
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1.1;
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const attendees = Array.isArray(b.attendees) ? b.attendees : [];
      const stripesW = drawStripes(x, y, h, attendees);

      // Text
      const innerX = x + stripesW + 8;
      const maxTextW = w - (innerX - x) - 6;

      // Title in first attendee color
      const firstColor = colorFor(attendees[0] || '');
      ctx.fillStyle = firstColor;
      ctx.font = 'bold 12px system-ui, Arial';
      ctx.fillText(fitText(ctx, b.title || 'Lesson', maxTextW), innerX, y + 14);

      if (h >= 30) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px system-ui, Arial';
        const timeStr = `${String(b.startDate.getHours()).padStart(2, '0')}:${String(b.startDate.getMinutes()).padStart(2, '0')}–${String(b.endDate.getHours()).padStart(2, '0')}:${String(b.endDate.getMinutes()).padStart(2, '0')}`;
        ctx.fillText(fitText(ctx, timeStr, maxTextW), innerX, y + 28);
      }
      if (h >= 44 && attendees.length) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '11px system-ui, Arial';
        const approx = Math.max(1, Math.floor(maxTextW / 22));
        const shown = attendees.slice(0, approx);
        const extra = attendees.length - shown.length;
        const who = shown.join(', ') + (extra > 0 ? ` +${extra}` : '');
        ctx.fillText(fitText(ctx, who, maxTextW), innerX, y + 42);
      }
    }
  }

  // Legend (dynamic height, no extra whitespace)
  if (userLabels.length) {
    const legendTop = headerH + dayRowH * ROW_DAYS + 12;
    ctx.font = 'bold 13px system-ui, Arial';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('Users:', 10, legendTop);

    // eslint-disable-next-line no-shadow
    const chipW = 14, chipH = 14, gapX = 12, gapY = 8;
    // eslint-disable-next-line no-shadow
    let lx = 70, ly = legendTop + 2;

    for (const lbl of userLabels) {
      const col = colorFor(lbl);
      const needed = chipW + 6 + ctx.measureText(lbl).width + gapX;
      if (lx + needed > width - 10) { lx = 70; ly += chipH + gapY; }
      ctx.fillStyle = col; ctx.fillRect(lx, ly - chipH + 2, chipW, chipH);
      ctx.fillStyle = '#e2e8f0'; ctx.fillText(lbl, lx + chipW + 6, ly + 2);
      lx += needed;
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderGridPNGHorizontal };
