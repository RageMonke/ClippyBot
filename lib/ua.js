// events/messageCreate.uitgaan.session.js
const {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { DateTime } = require('luxon');
const { parsePlanWithAI } = require('./parseWithAI');

const WATCH_CHANNEL_IDS = (process.env.UITGAAN_CHANNEL_IDS || '')
   .split(',')
   .map(s => s.trim())
   .filter(Boolean);

function isWatchedChannel(message) {
  if (WATCH_CHANNEL_IDS.includes(message.channelId)) return true;
  const ch = message.channel;
  // if it's a thread, check parent
  if (typeof ch.isThread === 'function' && ch.isThread() && ch.parentId) {
    return WATCH_CHANNEL_IDS.includes(ch.parentId);
  }
  return false;
}

const SESSIONS = new Map();
const LAST_CALL_AT = new Map();
const MAX_MESSAGES = 14;
const SESSION_TTL_MS = 15 * 60 * 1000;

function getSession(channelId) {
  let s = SESSIONS.get(channelId);
  if (!s) {
    s = { transcript: [], askedField: null, timer: null };
    SESSIONS.set(channelId, s);
  }
  clearTimeout(s.timer);
  s.timer = setTimeout(() => SESSIONS.delete(channelId), SESSION_TTL_MS);
  return s;
}

function joinTranscript(s) {
  return s.transcript.map(x => `${x.a}: ${x.t}`).join('\n');
}

function looksRelevant(text) {
  return /(\b(uit|gaan|drinken|club|bar|eten|brug|party|brugge|film|cinema)\b|🍻|🍹|🍾)/i.test(text);
}

function brusselsDate(dateISO, timeHM) {
  // Parse in Europe/Brussels to get correct DST offset, then to JS Date (UTC)
  return DateTime.fromISO(`${dateISO}T${timeHM}`, { zone: 'Europe/Brussels' }).toJSDate();
}

module.exports = {
  name: 'uitgaanAgent',

  async execute(message) {
    // --- Guards
    if (message.author.bot) return;
    if (!isWatchedChannel(message)) return;

    const text = (message.content || '').trim();
    if (!text) return;

    // Start/continue session only if relevant (or already started)
    if (!looksRelevant(text) && !SESSIONS.get(message.channelId)) return;

    const s = getSession(message.channelId);
    s.transcript.push({
      a: message.member?.displayName || message.author.username,
      t: text,
    });
    if (s.transcript.length > MAX_MESSAGES) s.transcript.shift();

    const transcript = joinTranscript(s);
    const nowIso = new Date().toISOString();

    // soft throttle per channel (1.5s)
    const nowTs = Date.now();
    const last = LAST_CALL_AT.get(message.channelId) || 0;
    if (nowTs - last < 1500) return;
    LAST_CALL_AT.set(message.channelId, nowTs);

    // Single LLM call on the rolling transcript
    let plan;
    try {
      plan = await parsePlanWithAI(transcript, nowIso);
    } catch (err) {
      console.error('parsePlanWithAI failed:', err);
      return;
    }

    if ((plan.confidence || 0) < 0.55) {
      // Not confident enough yet → stay quiet
      console.log('Low confidence:', plan, 'for transcript:', transcript);
      return;
    }

    // If the convo mentions vrijdag & zaterdag but date is still missing, ask the day once
    const mentionsFri = /\bvrij(dag)?\b/i.test(transcript);
    const mentionsSat = /\bzat(erdag)?\b/i.test(transcript);
    if (!plan.date_iso && mentionsFri && mentionsSat && s.askedField !== 'date') {
      s.askedField = 'date';
      await message.reply(
        'Ik zie **vrijdag** én **zaterdag**—voor welke dag wil je een event maken? (bv. "vrijdag" of "zaterdag")',
      );
      return;
    }

    // If something essential is missing, ask ONE compact follow-up (don’t spam the same field)
    const missing =
      !plan.venue ? 'venue' :
      !plan.date_iso ? 'date' :
      !plan.start_time_iso ? 'start_time' : null;

    if (missing) {
      if (s.askedField === missing) return;
      s.askedField = missing;

      const hint =
        missing === 'venue' ? 'bv. Charlatan / Kompass / Carré / Brugge' :
        missing === 'date' ? 'bv. vr 06/09' :
        'bv. 15:00 of 22:30';

      await message.reply(`Lijkt op een plan! Ik mis **${missing}** (${hint}).`);
      return;
    }

    // We have venue + date + time → create event (default 3h)
    const start = brusselsDate(plan.date_iso, plan.start_time_iso);
    const now = new Date();
    if (start.getTime() < now.getTime() - 30 * 60 * 1000) {
      // start looks in the past → ask once, then wait for another msg
      if (s.askedField !== 'date') {
        s.askedField = 'date';
        await message.reply('Bedoel je **vandaag** of **volgende week**? (typ bv. "vrijdag 22:30")');
      }
      return;
    }
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

    try {
      const event = await message.guild.scheduledEvents.create({
        name: plan.title || `Uitgaan – ${plan.venue}`,
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: {
          // If venue is actually a city/destination, this is still fine
          location: plan.city ? `${plan.venue}, ${plan.city}` : plan.venue,
        },
        description: `Venue: ${plan.venue}${plan.city ? ` (${plan.city})` : ''}`,
      });

      await message.reply(`🎉 Event aangemaakt: **${event.name}**. Check je Events!`);
      const url = `https://discord.com/events/${message.guild.id}/${event.id}`;
      await message.reply(`🎉 Event aangemaakt: **${event.name}** → ${url}`);
      SESSIONS.delete(message.channelId);
    } catch (err) {
      console.error('Failed to create scheduled event:', err);
      await message.reply('Kon het event niet aanmaken (permissions/inputs?).');
    }
  },
};
