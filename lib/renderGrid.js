const { createCanvas } = require('canvas');
const dayjs = require('dayjs');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hashColor(name) {
  // stable pastel-ish color from course name
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},70%,70%)`;
}
function initialsFromName(displayName) {
  const parts = (displayName || '').split(' ').filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function clampToHours(start, end, dayStartHour, dayEndHour) {
  const s = dayjs(start);
  const e = dayjs(end);
  const sClamp = s.hour(dayStartHour).minute(0).second(0).millisecond(0);
  const eClamp = s.hour(dayEndHour).minute(0).second(0).millisecond(0);
  return {
    start: s.isBefore(sClamp) ? sClamp.toDate() : s.toDate(),
    end:   e.isAfter(eClamp) ? eClamp.toDate() : e.toDate(),
  };
}

function cleanCourseTitle(raw) {
  const txt = (raw || 'Lesson').trim();
  // strips things like: E702210A Gevorderd prog  |  E702210A. Gevorderd prog  |  E702210A: Gevorderd prog
  return txt.replace(/^[A-Z0-9]+[.:]?\s+/, '');
}

/**
 * blocks: [{ dayIndex, startDate, endDate, title, attendees: ['QD','LT'], color }]
 */
function renderGridPNG({ weekStartISO, blocks, members, hours = { start: 8, end: 22 } }) {
  // Layout
  const cellW = 210;
  const timeLabelW = 85;
  const titleH = 34;
  const gapH = 16;
  const dayHeaderH = 28;
  const headerH = titleH + gapH + dayHeaderH;
  const rowH = 22;
  const slotsPerDay = (hours.end - hours.start) * 2;
  const width = timeLabelW + cellW * 7 + 1;
  const height = headerH + rowH * slotsPerDay + 1 + 60;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // bg
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, Arial';
  const title = `UGent Shared Timetable — Week of ${weekStartISO}  •  ${members} member${members === 1 ? '' : 's'}`;
  ctx.fillText(title, 10, 24);

  // Headers (days)
  ctx.font = 'bold 14px system-ui, Arial';
  for (let d = 0; d < 7; d++) {
    const x = timeLabelW + d * cellW;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(DAYS[d], x + 8, titleH + gapH + 18);
  }

  // Grid lines + time labels
  ctx.strokeStyle = '#263040';
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, Arial';
  for (let i = 0; i <= slotsPerDay; i++) {
    const y = headerH + i * rowH + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    if (i % 2 === 0 && i < slotsPerDay) {
      const hour = hours.start + i / 2;
      const label = String(hour).padStart(2, '0') + ':00';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(label, 10, y + 16);
    }
  }
  for (let d = 0; d <= 7; d++) {
    const x = timeLabelW + d * cellW + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, headerH + slotsPerDay * rowH);
    ctx.stroke();
  }

  // Draw blocks
  const dayStart = hours.start * 60;
  const minutesPerSlot = 30;

  for (const b of blocks) {
    const x = timeLabelW + b.dayIndex * cellW + 3;
    const startMin = (b.startDate.getHours() * 60 + b.startDate.getMinutes()) - dayStart;
    const endMin = (b.endDate.getHours() * 60 + b.endDate.getMinutes()) - dayStart;
    if (endMin <= 0 || startMin >= (hours.end - hours.start) * 60) continue;

    const topSlot = Math.max(0, Math.floor(startMin / minutesPerSlot));
    const bottomSlot = Math.min(slotsPerDay, Math.ceil(endMin / minutesPerSlot));
    const y = headerH + topSlot * rowH + 2;
    const h = Math.max(14, (bottomSlot - topSlot) * rowH - 4);
    const w = cellW - 6;

    // Block
    ctx.fillStyle = b.color;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    const r = 8;
    // rounded rect
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = '#0b1020';
    ctx.font = 'bold 12px system-ui, Arial';
    const title2 = b.title.slice(0, 24);
    ctx.fillText(title2, x + 8, y + 16);

    ctx.fillStyle = '#0b1020';
    ctx.font = '11px system-ui, Arial';
    const timeStr = `${String(b.startDate.getHours()).padStart(2, '0')}:${String(b.startDate.getMinutes()).padStart(2, '0')}–${String(b.endDate.getHours()).padStart(2, '0')}:${String(b.endDate.getMinutes()).padStart(2, '0')}`;
    ctx.fillText(timeStr, x + 8, y + 32);

    const att = b.attendees.join(', ').slice(0, 20);
    ctx.fillStyle = '#0b1020';
    ctx.fillText(att, x + 8, y + 48);
  }

  // Legend (bottom)
//   const legendY = headerH + slotsPerDay * rowH + 10;
//   ctx.font = 'bold 13px system-ui, Arial';
//   ctx.fillStyle = '#e2e8f0';
//   ctx.fillText('Legend (course → color, initials):', 10, legendY);

  return canvas.toBuffer('image/png');
}

/**
 * Build drawable blocks from raw events of all users.
 * users: [{ id, displayName }]
 * userEvents: Map(userId => [{start, end, summary}])
 */
function buildBlocks({ users, userEvents, hours = { start:8, end:22 } }) {
  const groups = new Map();
  // const startD = dayjs(weekStart).startOf('day');

  // const userById = new Map(users.map(u => [u.id, u]));

  for (const u of users) {
    const evs = userEvents.get(u.id) || [];
    const userInitials = (u.initials && u.initials.trim()) || initialsFromName(u.displayName);

    for (const ev of evs) {
      const titleClean = cleanCourseTitle(ev.summary);

      const s = dayjs(ev.start);
      const e = dayjs(ev.end);

      // split events by day so blocks don't cross midnight
      let cur = s;
      while (cur.isBefore(e)) {
        const dayEnd = cur.endOf('day');
        const segEnd = dayEnd.isBefore(e) ? dayEnd.add(1, 'millisecond') : e;
        const dayIndex = ((cur.day() + 6) % 7);

        const clipped = clampToHours(cur.toDate(), segEnd.toDate(), hours.start, hours.end);
        if (dayjs(clipped.end).isAfter(clipped.start)) {
          const key = `${dayIndex}|${+clipped.start}|${+clipped.end}|${ev.summary}`;
          if (!groups.has(key)) {
            groups.set(key, {
              dayIndex,
              startDate: clipped.start,
              endDate: clipped.end,
              title: titleClean,
              attendees: new Set(),
            });
          }
          groups.get(key).attendees.add(userInitials);
        }
        cur = dayEnd.add(1, 'millisecond');
      }
    }
  }

  // 2) convert to blocks + colors
  const blocks = [];
  for (const g of groups.values()) {
    blocks.push({
      dayIndex: g.dayIndex,
      startDate: g.startDate,
      endDate: g.endDate,
      title: g.title,
      attendees: Array.from(g.attendees),
      color: hashColor(g.title),
    });
  }

  return blocks.sort((a, b) =>
    a.dayIndex - b.dayIndex ||
    a.startDate - b.startDate ||
    a.title.localeCompare(b.title),
  );
}

module.exports = { renderGridPNG, buildBlocks, initialsFromName, hashColor, cleanCourseTitle };
