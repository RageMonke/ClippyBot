/* eslint-disable no-useless-escape */
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
  if (!raw || typeof raw !== 'string') return 'Lesson';

  // 1) basic trim + normalize whitespace + remove weird controls
  let s = raw.replace(/\u200B/g, '').replace(/[\r\n\t]+/g, ' ').trim();
  s = s.replace(/\s{2,}/g, ' ');

  const original = s;

  // Helper: if final string too short or looks like garbage, return original
  const isBad = (t) => {
    if (!t) return true;
    const cleaned = t.replace(/[^A-Za-z0-9À-ž\s\-:,.!?'"]/g, '').trim();
    if (cleaned.length < 3) return true;
    // tokens that sometimes appear alone
    const badTokens = ['tba', 'geen', 'afgelast', 'canceled', 'canceled.', 'vrij', 'geen les'];
    if (badTokens.includes(t.toLowerCase())) return true;
    return false;
  };

  // 2) Remove common leading course codes (expanded):
  s = s.replace(/^(?:(?:[A-Z]{1,4}\d{1,6}[A-Z0-9\-\/\.]*)|[A-Z0-9]{2,12})(?:[-_\/\.]?(?:I{1,3}|[A-Z]{1,4}|\d{1,3}))?[\s:\-\–\—\|]+/i, '');

  // 3) Remove patterns like "COURSECODE - " or "COURSECODE | "
  s = s.replace(/^[A-Z0-9]{1,6}[\-_\/][A-Z0-9]{1,8}\s*[\-\|:]\s*/i, '');

  // 4) Remove leading role tokens: "Lecture", "Hoorcollege", "Lec", "Practicum", "Les"
  s = s.replace(/^(lecture|hoorcollege|le(c|cture)|practicum|les|workshop|seminar)\b[\s:\-–—]+/i, '');

  // <-- new: also strip these role tokens anywhere in the string so they don't remain inline -->
  s = s.replace(/\b(hoorcollege|practicum|werkcollege|workshop|seminar|tutorial|lecture|les|groepswerk|lab)\b/ig, '');

  // 5) Remove short bracketed codes at start: "(GR01)", "[A]", "(Lec)"
  s = s.replace(/^[\(\[]\s*[A-Za-z0-9\-\_]{1,8}\s*[\)\]]\s*/i, '');

  // 6) Remove inline group tokens like "GR04", "GR02", "groep GR04" (anywhere)
  s = s.replace(/\b(?:gr(?:oup|oup?g|oe?p)?|grp|groep)\s*[-_\s]?\d{1,3}\b/ig, '');
  s = s.replace(/\bGR\d{1,3}\b/ig, '');

  // 7) Remove standalone course-like tokens anywhere (target examples like B001625A, AE2111-I, WI2480LR-II)
  // Conservative: require letter(s) + digits (2..6) possibly followed by small suffixes
  s = s.replace(/\b[A-Z]{1,4}\d{2,6}[A-Z0-9\-\_\/\.]*\b/ig, '');

  // 8) Remove trailing short metadata tokens like "- Room 12", "| Aula", "— group GR02"
  s = s.replace(/[\-\|–—]\s*(room|zaal|grp|group|gr|auditorium|loc|locatie|aula|zaal)?\s*[:#]?\s*[A-Za-z0-9\-\s]{1,25}$/i, '');
  s = s.replace(/\s*[\-\|–—]\s*(hoorcollege|werkcollege|praktijk|tutorial)\s*$/i, '');

  // 9) Remove repeated separators at start e.g. " - Title" or ": Title"
  s = s.replace(/^[\:\-\–\—\|\s]+/, '');

  // 10) Remove surrounding quotes or stray punctuation and any leftover isolated commas/periods
  s = s.replace(/^[\"'“‘]+\s*/, '').replace(/\s+[\"'”’]+$/, '');
  s = s.replace(/^[,.;:\-]+|[,.;:\-]+$/g, '');

  // 11) Collapse whitespace and stray separators again
  s = s.replace(/[\s,;:]{2,}/g, ' ').trim();

  // Remove duplicate words (e.g. "Elektriciteit . Elektriciteit" -> "Elektriciteit")
  s = s.split(/\s*[\.]\s*/).map(part => part.trim()).filter(Boolean)
    .reduce((acc, part) => {
      if (!acc.toLowerCase().includes(part.toLowerCase())) acc += (acc ? ' . ' : '') + part;
      return acc;
    }, '');

  // Final cleanup of any remaining dots and spaces
  s = s.replace(/\s*\.\s*$/, '')
        .replace(/\s*\.\s*\.\s*/g, ' . ')
        .replace(/\s{2,}/g, ' ')
        .trim();

  // 12) If result looks bad, fallback to removal of only the strict code (try a milder removal),
  // or ultimately return the original.
  if (isBad(s)) {
    const fallback = original.replace(/^\d{2,6}\s+/, '').trim();
    if (!isBad(fallback)) return fallback;
    return original;
  }

  return s;
}

// <-- new helper: extract role/group tags (only role-types; no GRxx/course codes) -->
function extractCourseTags(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const tags = new Set();
  const norm = raw.normalize ? raw.normalize() : raw;
  // only these role-like tokens are returned as tags
  const roleKeys = [
    'hoorcollege',
    'practicum',
    'werkcollege',
    'workshop',
    'seminar',
    'tutorial',
    'lecture',
    'les',
    'groepswerk',
    'groepsopdracht',
    'lab',
  ];
  const re = new RegExp(`\\b(?:${roleKeys.join('|')})\\b`, 'ig');
  let m;
  while ((m = re.exec(norm))) {
    tags.add(m[0].toLowerCase());
  }
  return Array.from(tags);
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
      const tags = extractCourseTags(ev.summary);

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
              tags: new Set(),
            });
          }
          groups.get(key).attendees.add(userInitials);
          for (const t of (tags || [])) groups.get(key).tags.add(t);
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
      tags: Array.from(g.tags),
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
