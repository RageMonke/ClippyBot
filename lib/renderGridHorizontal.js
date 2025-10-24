// lib/renderGridHorizontal.js
const { createCanvas } = require('canvas');
// const dayjs = require('dayjs');

// Weekdays only
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ROW_DAYS = 5;

// /* ---------- DISTINCT USER COLORS ---------- */
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
  if (!text) return '';
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
/*
 Improved packing algorithm:
 - canonical owner per event = first attendee according to ownersOrder
 - ownersOrder provided per-day: most-active-first
 - process events by owner-rank then start time so frequent users get top lanes
 - greedy placement checks entire lane (not only the last event) to avoid overlaps
 - prefer owner's existing lane when possible
*/
function calculateUserMetrics(blocks, dayIndex) {
  const metrics = new Map();

  for (const block of blocks) {
    if (block.dayIndex !== dayIndex) continue;

    const attendees = Array.isArray(block.attendees) ? block.attendees : [];
    const duration = (block.endDate - block.startDate) / (1000 * 60);

    for (const user of attendees) {
      if (!metrics.has(user)) {
        metrics.set(user, {
          totalMinutes: 0,
          firstClass: null,
          lastClass: null,
          classes: [],
        });
      }

      const userMetric = metrics.get(user);
      userMetric.totalMinutes += duration;
      userMetric.classes.push(block);

      if (!userMetric.firstClass || block.startDate < userMetric.firstClass) {
        userMetric.firstClass = block.startDate;
      }
      if (!userMetric.lastClass || block.endDate > userMetric.lastClass) {
        userMetric.lastClass = block.endDate;
      }
    }
  }

  return metrics;
}

function hasTimeOverlap(block1, block2) {
  return block1.startDate < block2.endDate && block2.startDate < block1.endDate;
}

function canMergeLanes(lane1, lane2) {
  for (const block1 of lane1.blocks) {
    for (const block2 of lane2.blocks) {
      if (hasTimeOverlap(block1, block2)) {
        return false;
      }
    }
  }
  return true;
}

function findUsersWithSharedClasses(user, blocks, processedUsers) {
  const sharedUsers = new Set();
  const userBlocks = blocks.filter(b =>
    Array.isArray(b.attendees) &&
    b.attendees.includes(user),
  );

  for (const block of userBlocks) {
    for (const attendee of block.attendees) {
      if (attendee !== user && !processedUsers.has(attendee)) {
        sharedUsers.add(attendee);
      }
    }
  }
  return Array.from(sharedUsers);
}

function smartLanePacking(blocks, dayIndex) {
  const metrics = calculateUserMetrics(blocks, dayIndex);
  const sortedUsers = Array.from(metrics.entries()).sort((a, b) => {
    if (b[1].totalMinutes !== a[1].totalMinutes) {
      return b[1].totalMinutes - a[1].totalMinutes;
    }
    const spreadA = a[1].lastClass - a[1].firstClass;
    const spreadB = b[1].lastClass - b[1].firstClass;
    return spreadB - spreadA;
  });

  const lanes = [];
  const processedBlocks = new Set();
  const processedUsers = new Set();
  const userLaneMap = new Map();

  // Process users in order, but prioritize shared classes
  const processUser = (user, userMetric) => {
    if (processedUsers.has(user)) return;
    processedUsers.add(user);

    const userBlocks = userMetric.classes.filter(b => !processedBlocks.has(b));
    if (!userBlocks.length) return;

    // Separate blocks into non-conflicting and conflicting
    const nonConflicting = [];
    const conflicting = [];

    for (let i = 0; i < userBlocks.length; i++) {
      let hasConflict = false;
      for (let j = 0; j < userBlocks.length; j++) {
        if (i !== j && hasTimeOverlap(userBlocks[i], userBlocks[j])) {
          hasConflict = true;
          break;
        }
      }
      if (hasConflict) {
        conflicting.push(userBlocks[i]);
      } else {
        nonConflicting.push(userBlocks[i]);
      }
    }

    // Create lane with non-conflicting blocks
    if (nonConflicting.length > 0) {
      const newLane = {
        owner: user,
        blocks: nonConflicting,
        attendees: new Set([user]),
      };
      lanes.push(newLane);
      userLaneMap.set(user, lanes.length - 1);

      nonConflicting.forEach(b => {
        if (Array.isArray(b.attendees)) {
          b.attendees = [user, ...b.attendees.filter(a => a !== user)];
        }
        processedBlocks.add(b);
      });
    }

    // Handle conflicting blocks - try to place in other attendees' lanes
    for (const block of conflicting) {
      let placed = false;
      const blockAttendees = Array.isArray(block.attendees) ? block.attendees : [];

      // Try to place in another attendee's lane
      for (const attendee of blockAttendees) {
        if (attendee === user) continue;

        const attendeeLane = userLaneMap.get(attendee);
        if (attendeeLane !== undefined) {
          const lane = lanes[attendeeLane];
          // Check if block fits in this lane
          let fits = true;
          for (const existingBlock of lane.blocks) {
            if (hasTimeOverlap(block, existingBlock)) {
              fits = false;
              break;
            }
          }

          if (fits) {
            lane.blocks.push(block);
            lane.blocks.sort((a, b) => a.startDate - b.startDate);
            lane.attendees.add(user);
            // Reorder attendees: new lane owner first, original owner second, then rest
            if (Array.isArray(block.attendees)) {
              const others = block.attendees.filter(a => a !== attendee && a !== user);
              block.attendees = [attendee, user, ...others];
            }
            processedBlocks.add(block);
            placed = true;
            break;
          }
        }
      }

      // If couldn't place in existing lane, create new lane
      if (!placed) {
        const newLane = {
          owner: user,
          blocks: [block],
          attendees: new Set([user]),
        };
        lanes.push(newLane);
        if (Array.isArray(block.attendees)) {
          block.attendees = [user, ...block.attendees.filter(a => a !== user)];
        }
        processedBlocks.add(block);
      }
    }

    // Find and process users with shared classes immediately
    const sharedUsers = findUsersWithSharedClasses(user, blocks, processedUsers);
    for (const sharedUser of sharedUsers) {
      if (metrics.has(sharedUser)) {
        processUser(sharedUser, metrics.get(sharedUser));
      }
    }
  };

  // Process all users
  for (const [user, userMetric] of sortedUsers) {
    processUser(user, userMetric);
  }

  // Try to merge non-overlapping lanes
  let i = 0;
  while (i < lanes.length) {
    let merged = false;
    let j = i + 1;
    while (j < lanes.length) {
      if (canMergeLanes(lanes[i], lanes[j])) {
        lanes[i].blocks.push(...lanes[j].blocks);
        lanes[i].blocks.sort((a, b) => a.startDate - b.startDate);
        lanes[i].attendees = new Set([...lanes[i].attendees, ...lanes[j].attendees]);

        for (const attendee of lanes[j].attendees) {
          userLaneMap.set(attendee, i);
        }

        lanes.splice(j, 1);
        merged = true;
      } else {
        j++;
      }
    }
    if (!merged) i++;
  }

  // Convert lanes back to block format
  const laneAssignments = new Map();
  const blockAttendeeOrder = new Map();

  lanes.forEach((lane, laneIndex) => {
    lane.blocks.forEach(block => {
      block.lane = laneIndex;
      block.lanes = lanes.length;
      laneAssignments.set(block, laneIndex);
      // Store the reordered attendees
      if (Array.isArray(block.attendees)) {
        blockAttendeeOrder.set(block, [...block.attendees]);
      }
    });
  });

  return blocks
    .filter(b => b.dayIndex === dayIndex)
    .map(block => {
      const reorderedAttendees = blockAttendeeOrder.get(block);
      return {
        ...block,
        lane: laneAssignments.get(block) || 0,
        lanes: lanes.length,
        attendees: reorderedAttendees || block.attendees,
      };
    })
    .sort((a, b) => a.startDate - b.startDate);
}
// Replace the existing lanePackByUserColoring function with:
// eslint-disable-next-line no-unused-vars
function lanePackByUserColoring(blocksDay, ownersOrder) {
  return smartLanePacking(blocksDay, blocksDay[0]?.dayIndex || 0);
}

/* ---------- RENDER ---------- */
function renderGridPNGHorizontal({
  weekStartISO,
  blocks,
  users = [],
  members,
  hours = { start: 8, end: 22 },
  slotW = 34,
  // dayRowH remains as a minimum; actual per-day height will be computed dynamically
  dayRowH = 120,
  leftLabelW = 120,
}) {
  const slotsPerDay = (hours.end - hours.start) * 2;
  const titleH = 34, gapH = 12, timeRulerH = 24;
  const headerH = titleH + gapH + timeRulerH;

  // Build distinct user colors
  const userLabels = users.map(u => (u.initials || u.displayName || u.id || '??').trim());
  const colorMap = assignUserColors(userLabels);
  const colorFor = (label) => colorMap.get((label || '').trim()) || toHSL(BASE_PALETTE[BASE_PALETTE.length - 1]);

  // badge types map and precompute which badges are used (so legend can show only those)
  const badgeMap = {
    'hoorcollege': 'H',
    'practicum': 'P',
    'werkcollege': 'W',
    'workshop': 'S',
    'seminar': 'S',
    'tutorial': 'T',
    'lecture': 'L',
    'les': 'L',
    'lab': 'L',
  };
  // shared badge sizing / styling constants (use everywhere)
  const BADGE_W = 14;
  const BADGE_H = 12;
  const BADGE_BR = 2;
  const BADGE_GAP = 8;
  const BADGE_BG = 'rgba(11,18,32,0.18)';
  const BADGE_TEXT = 'rgba(203,213,225,0.65)';
  const usedBadges = new Set();
  for (const b of blocks || []) {
    const tArr = Array.isArray(b.tags) ? b.tags.map(x => (x || '').toLowerCase()) : [];
    for (const k of Object.keys(badgeMap)) {
      if (tArr.includes(k)) usedBadges.add(k);
    }
  }

  // --- First pass: estimate legend rows to compute legend height ---
  const temp = createCanvas(1, 1);
  const tctx = temp.getContext('2d');
  tctx.font = 'bold 13px system-ui, Arial';
  const chipW = 14, chipH = 14, gapX = 12, gapY = 8;
  const labelStartX = 70;
  const contentW = leftLabelW + slotW * slotsPerDay + 1;

  let lxTemp = labelStartX, rows = 1;
  for (const lbl of userLabels) {
    const needed = chipW + 6 + tctx.measureText(lbl).width + gapX;
    if (lxTemp + needed > contentW - 10) { rows++; lxTemp = labelStartX; }
    lxTemp += needed;
  }
  const legendTopPad = 12;
  const legendRowH = chipH + gapY;
  // reserve space for types row (badges) + user chips rows so nothing is drawn off-canvas
  const typesH = usedBadges.size ? (BADGE_H + 10) : 0;
  const usersH = userLabels.length ? (legendTopPad + rows * legendRowH + 10) : 0;
  const legendH = typesH + usersH;

  // --- Compute per-day heights dynamically based on activity (lanes needed) ---
  const baseOrder = users.map(u => (u.initials || u.displayName || u.id || '??').trim());
  const blocksByDay = Array.from({ length: ROW_DAYS }, () => []);
  for (const b of blocks) if (Number.isFinite(b.dayIndex) && b.dayIndex < ROW_DAYS) blocksByDay[b.dayIndex].push(b);

  // We'll compute per-day lane counts and heights
  const dayLaneCounts = new Array(ROW_DAYS).fill(1);
  const dayHeights = new Array(ROW_DAYS).fill(dayRowH);

  // measurement context for text sizing decisions
  const measureCtx = createCanvas(1, 1).getContext('2d');

  for (let d = 0; d < ROW_DAYS; d++) {
    const dayBlocks = blocksByDay[d];
    if (!dayBlocks.length) { dayLaneCounts[d] = 1; dayHeights[d] = dayRowH; continue; }

    // Build user intervals for this day to compute total minutes per user (merged)
    const userIntervals = new Map();
    for (const ev of dayBlocks) {
      const s = ev.startDate.getTime();
      const e = ev.endDate.getTime();
      for (const a of (Array.isArray(ev.attendees) ? ev.attendees : [])) {
        if (!userIntervals.has(a)) userIntervals.set(a, []);
        userIntervals.get(a).push([s, e]);
      }
    }
    for (const [u, arr] of userIntervals) {
      arr.sort((x, y) => x[0] - y[0]);
      const merged = [];
      for (const it of arr) {
        if (!merged.length || merged[merged.length - 1][1] <= it[0]) merged.push(it);
        else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], it[1]);
      }
      userIntervals.set(u, merged);
    }
    // totals in minutes
    const totals = new Map();
    for (const [u, arr] of userIntervals) {
      let tot = 0;
      for (const it of arr) tot += (it[1] - it[0]) / 60000;
      totals.set(u, tot);
    }

    // Build owners order for this day: sort base order by descending total minutes
    const ownersOrder = [...baseOrder].sort((a, b) => {
      const ta = totals.get(a) || 0;
      const tb = totals.get(b) || 0;
      if (tb !== ta) return tb - ta;
      return baseOrder.indexOf(a) - baseOrder.indexOf(b);
    });

    // pack lanes for this day (improved greedy)
    const packed = lanePackByUserColoring(dayBlocks, ownersOrder);
    const lanes = Math.max(...packed.map(p => p.lanes), 1);
    dayLaneCounts[d] = lanes;

    // Determine required lane height by analyzing representative events:
    // increase baseline so cards can display title/time/people reliably
    let requiredLaneH = 44;
    const titleFont = 'bold 12px system-ui, Arial';
    const smallFont = '11px system-ui, Arial';
    measureCtx.font = titleFont;

    for (const ev of packed) {
      const startMin = (ev.startDate.getHours() * 60 + ev.startDate.getMinutes()) - hours.start * 60;
      const durMin = Math.max(0, (ev.endDate - ev.startDate) / 60000);
      const endMin = Math.min((hours.end - hours.start) * 60, startMin + durMin);
      if (endMin <= 0 || startMin >= (hours.end - hours.start) * 60) continue;

      const estW = Math.max(40, ((endMin - startMin) / 30) * slotW - 6);
      const stripes = Math.min((Array.isArray(ev.attendees) ? ev.attendees.length : 0), 4) * 5;
      const innerMax = estW - stripes - 16;

      let lines = 2;
      measureCtx.font = titleFont;
      // const titleW = measureCtx.measureText(ev.title || 'Lesson').width;
      // attendees line check
      const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
      if (attendees.length) {
        measureCtx.font = smallFont;
        const who = attendees.slice(0, Math.max(1, Math.floor(innerMax / 60))).join(', ');
        if (measureCtx.measureText(who).width <= innerMax) lines = Math.max(lines, 3);
      }
      const candidateH = 8 + lines * 16;
      requiredLaneH = Math.max(requiredLaneH, candidateH);
    }

    const laneGap = 6;
    const topBottomPad = 16;
    const computed = topBottomPad + lanes * requiredLaneH + (lanes - 1) * laneGap;
    dayHeights[d] = Math.max(dayRowH, Math.ceil(computed));
  }

  // --- Canvas sized with dynamic per-day heights + header + legend ---
  const width = contentW;
  const scheduleHeight = dayHeights.reduce((a, b) => a + b, 0);
  const height = headerH + scheduleHeight + legendH;

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

  // Time ruler and vertical grid lines across full scheduleHeight
  ctx.font = '12px system-ui, Arial';
  ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = '#263040';
  ctx.lineWidth = 1;

  for (let s = 0; s <= slotsPerDay; s++) {
    const x = leftLabelW + s * slotW + 0.5;
    ctx.beginPath(); ctx.moveTo(x, headerH); ctx.lineTo(x, headerH + scheduleHeight); ctx.stroke();
    if (s % 2 === 0 && s < slotsPerDay) {
      const hour = hours.start + s / 2;
      const label = String(hour).padStart(2, '0') + ':00';
      ctx.fillText(label, x + 4, headerH - 6);
    }
  }

  // Day rows + labels (dynamic heights)
  let accY = headerH;
  for (let d = 0; d < ROW_DAYS; d++) {
    const rowH = dayHeights[d];
    const y = accY + 0.5;
    ctx.strokeStyle = '#263040'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.font = 'bold 14px system-ui, Arial';
    ctx.fillText(DAY_LABELS[d], 12, y + 22);
    accY += rowH;
  }

  // Helper: draw attendee color stripes (up to 4)
  function drawStripes(x, y, h, attendees) {
    const n = attendees.length;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colorFor(attendees[i]);
      ctx.fillRect(x + i * 5, y, 4, h);
    }
    return n * 5;
  }

  // Draw events per day using day-specific ownersOrder and heights
  accY = headerH;
  for (let d = 0; d < ROW_DAYS; d++) {
    const dayBlocks = blocksByDay[d];
    const rowTop = accY;
    const rowH = dayHeights[d];
    accY += rowH;

    if (!dayBlocks.length) continue;

    // Build user intervals & totals to sort owners by activity (same logic as earlier)
    const userIntervals = new Map();
    for (const ev of dayBlocks) {
      const s = ev.startDate.getTime();
      const e = ev.endDate.getTime();
      for (const a of (Array.isArray(ev.attendees) ? ev.attendees : [])) {
        if (!userIntervals.has(a)) userIntervals.set(a, []);
        userIntervals.get(a).push([s, e]);
      }
    }
    for (const [u, arr] of userIntervals) {
      arr.sort((x, y) => x[0] - y[0]);
      const merged = [];
      for (const it of arr) {
        if (!merged.length || merged[merged.length - 1][1] <= it[0]) merged.push(it);
        else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], it[1]);
      }
      userIntervals.set(u, merged);
    }
    const totals = new Map();
    for (const [u, arr] of userIntervals) {
      let tot = 0;
      for (const it of arr) tot += (it[1] - it[0]) / 60000;
      totals.set(u, tot);
    }
    const ownersOrder = [...baseOrder].sort((a, b) => {
      const ta = totals.get(a) || 0;
      const tb = totals.get(b) || 0;
      if (tb !== ta) return tb - ta;
      return baseOrder.indexOf(a) - baseOrder.indexOf(b);
    });

    const packed = lanePackByUserColoring(dayBlocks, ownersOrder);

    const innerTop = rowTop + 8;
    const innerH = rowH - 16;
    const lanes = Math.max(...packed.map(p => p.lanes), 1);

    // Determine lane height used for rendering (consistent with earlier computation)
    const laneGap = 6;
    const laneH = Math.max(32, Math.floor((innerH - (lanes - 1) * laneGap) / lanes));

    // minutes converter
    const minutesFromDate = (date) => {
      const m = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
      return m - hours.start * 60;
    };

    for (const b of packed) {
      const durMin = Math.max(0, (b.endDate - b.startDate) / 60000);
      const startMin = Math.max(0, minutesFromDate(b.startDate));
      const endMin = Math.min((hours.end - hours.start) * 60, startMin + durMin);

      if (endMin <= 0 || startMin >= (hours.end - hours.start) * 60) continue;

      const x = leftLabelW + (startMin / 30) * slotW + 3;
      const w = Math.max(12, ((endMin - startMin) / 30) * slotW - 6);
      const y = innerTop + b.lane * (laneH + laneGap);
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
      const tags = Array.isArray(b.tags) ? b.tags : [];

      const stripesW = drawStripes(x, y, h, attendees);

      // Text
      const innerX = x + stripesW + 8;
      // reserve badge width + gap so title/time never overlaps badge; time will not be ellipsed
      const maxTextW = Math.max(12, w - (innerX - x) - (BADGE_W + BADGE_GAP + 6));

      // Title in first attendee color
      const firstColor = colorFor(attendees[0] || '');
      ctx.fillStyle = firstColor;
      ctx.font = 'bold 12px system-ui, Arial';
      ctx.fillText(fitText(ctx, b.title || 'Lesson', maxTextW), innerX, y + 14);

      // Always draw full time below title (never shortened)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px system-ui, Arial';
      const timeStr = `${String(b.startDate.getHours()).padStart(2, '0')}:${String(b.startDate.getMinutes()).padStart(2, '0')}–${String(b.endDate.getHours()).padStart(2, '0')}:${String(b.endDate.getMinutes()).padStart(2, '0')}`;
      // draw full time (we reserved space above to avoid overlap)
      ctx.fillText(timeStr, innerX, y + 28);

      // badge: small role-type marker (H/P/W...) drawn top-right of card
      // eslint-disable-next-line no-shadow
      const tArr = Array.isArray(tags) ? tags.map(x => (x || '').toLowerCase()) : [];
      let badgeKey = null;
      const priority = ['hoorcollege', 'practicum', 'werkcollege', 'workshop', 'seminar', 'tutorial', 'lecture', 'les', 'lab'];
      for (const k of priority) if (tArr.includes(k)) { badgeKey = k; break; }

      if (badgeKey) {
        const badgeLetter = badgeMap[badgeKey] || '?';
        const bw = BADGE_W, bh = BADGE_H, br = BADGE_BR;
        // keep a small padding from the right edge so badge doesn't touch card border
        const bx = x + w - bw - 6;
        const by = y + 4;
        // Even more subtle badge
        ctx.fillStyle = BADGE_BG;
        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fill();
        // lighter text
        ctx.fillStyle = BADGE_TEXT;
        ctx.font = '10px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeLetter, bx + bw / 2, by + bh / 2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }

      // Attendees line if there is vertical space and attendees
      if (h >= 40 && attendees.length) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '11px system-ui, Arial';
        const approx = Math.max(1, Math.floor(maxTextW / 60));
        const shown = attendees.slice(0, approx);
        const extra = attendees.length - shown.length;
        const who = shown.join(', ') + (extra > 0 ? ` +${extra}` : '');
        // move attendees slightly lower if badge present to avoid any visual collision
        const attendeesY = badgeKey ? y + 44 : y + 42;
        ctx.fillText(fitText(ctx, who, maxTextW), innerX, attendeesY);
      }
    }
  }

  // Legend with fixed positioning - Types and Users side by side
  if (userLabels.length || usedBadges.size) {
    const legendTop = headerH + scheduleHeight + 12;
    const legendY = legendTop + 6;

    // First measure types width to position it from the right
    let typesWidth = 0;
    if (usedBadges.size) {
      ctx.font = '11px system-ui, Arial';
      typesWidth = 60;
      for (const k of ['hoorcollege', 'practicum', 'werkcollege', 'workshop', 'seminar', 'tutorial', 'lecture', 'les', 'lab']) {
        if (!usedBadges.has(k)) continue;
        typesWidth += ctx.measureText(k).width + BADGE_W + 24;
      }
    }

    // Users legend (left side)
    if (userLabels.length) {
      const chipW2 = 12, chipH2 = 12, gapX2 = 12, gapY2 = 8;

      // draw users label vertically centered with chips
      ctx.font = 'bold 12px system-ui, Arial';
      ctx.fillStyle = '#94a3b8';
      ctx.textBaseline = 'middle';
      ctx.fillText('Users:', 10, legendY + chipH2 / 2);

      let lx = 60, ly = legendY;
      const maxLx = width - typesWidth - 40;

      for (const lbl of userLabels) {
        const col = colorFor(lbl);
        const needed = chipW2 + 6 + ctx.measureText(lbl).width + gapX2;
        if (lx + needed > maxLx) { lx = 60; ly += chipH2 + gapY2; }
        ctx.fillStyle = col;
        ctx.fillRect(lx, ly, chipW2, chipH2);
        ctx.fillStyle = '#94a3b8';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, lx + chipW2 + 6, ly + chipH2 / 2);
        ctx.textBaseline = 'alphabetic';
        lx += needed;
      }
    }

    // Types legend (right side)
    if (usedBadges.size) {
      let lx = width - typesWidth;

      // Types label
      ctx.font = 'bold 12px system-ui, Arial';
      ctx.fillStyle = '#94a3b8';
      ctx.textBaseline = 'middle';
      ctx.fillText('Types:', lx, legendY + BADGE_H / 2);
      lx += 60;

      for (const k of ['hoorcollege', 'practicum', 'werkcollege', 'workshop', 'seminar', 'tutorial', 'lecture', 'les', 'lab']) {
        if (!usedBadges.has(k)) continue;
        const letter = badgeMap[k];
        const bw = BADGE_W, bh = BADGE_H, br = BADGE_BR;
        const by = legendY;

        // badge bg
        ctx.fillStyle = BADGE_BG;
        ctx.beginPath();
        ctx.moveTo(lx + br, by);
        ctx.lineTo(lx + bw - br, by);
        ctx.quadraticCurveTo(lx + bw, by, lx + bw, by + br);
        ctx.lineTo(lx + bw, by + bh - br);
        ctx.quadraticCurveTo(lx + bw, by + bh, lx + bw - br, by + bh);
        ctx.lineTo(lx + br, by + bh);
        ctx.quadraticCurveTo(lx, by + bh, lx, by + bh - br);
        ctx.lineTo(lx, by + br);
        ctx.quadraticCurveTo(lx, by, lx + br, by);
        ctx.closePath();
        ctx.fill();

        // badge letter
        ctx.fillStyle = 'rgba(203,213,225,0.9)';
        ctx.font = '10px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, lx + bw / 2, by + bh / 2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        // label
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px system-ui, Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(k, lx + bw + 6, by + bh / 2);
        ctx.textBaseline = 'alphabetic';

        lx += ctx.measureText(k).width + bw + 24;
      }
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderGridPNGHorizontal };
