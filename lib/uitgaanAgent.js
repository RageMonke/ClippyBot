// events/messageCreate.uitgaan.session.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

// const { DateTime } = require('luxon');
const { parsePlanWithAI } = require('./parseWithAI');
const { savePending } = require('./uitgaanStore');

const WATCH_CHANNEL_IDS = (process.env.UITGAAN_CHANNEL_IDS || '')
   .split(',')
   .map(s => s.trim())
   .filter(Boolean);

const SESSIONS = new Map();
const LAST_CALL_AT = new Map();
const MAX_MESSAGES = 14;
const SESSION_TTL_MS = 15 * 60 * 1000;

function isWatchedChannel(message) {
  if (WATCH_CHANNEL_IDS.includes(message.channelId)) return true;
  const ch = message.channel;
  // if it's a thread, check parent
  if (typeof ch.isThread === 'function' && ch.isThread() && ch.parentId) {
    return WATCH_CHANNEL_IDS.includes(ch.parentId);
  }
  return false;
}

function getSession(channelId) {
  let s = SESSIONS.get(channelId);
  if (!s) {
    s = {
      transcript: [],
      askedField: null,
      timer: null,
      initiatorId: null,
      guildId: null,
      channelId,
      waitingApproval: false,
      pendingToken: null,
    };
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

// function brusselsDate(dateISO, timeHM) {
//   // Parse in Europe/Brussels to get correct DST offset, then to JS Date (UTC)
//   return DateTime.fromISO(`${dateISO}T${timeHM}`, { zone: 'Europe/Brussels' }).toJSDate();
// }

function planEmbed(plan, authorTag) {
  const lines = [
    `**Waar:** ${plan.venue}${plan.city ? ` (${plan.city})` : ''}`,
    `**Wanneer:** ${plan.date_iso} om ${plan.start_time_iso}`,
  ];
  return new EmbedBuilder()
    .setTitle(plan.title || `Uitgaan – ${plan.venue}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: authorTag ? `Aangevraagd door ${authorTag}` : 'Bevestig om event aan te maken' });
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
    if (!s.initiatorId) {
      s.initiatorId = message.author.id;
      s.guildId = message.guild?.id || null;
    }
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

    // If we already asked for approval, don’t re-post another confirmation
    if (s.waitingApproval) return;

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

    // If something essential is missing, ask ONE compact follow-up (don’t spam the same field)
    const missing =
      !plan.venue ? 'venue' :
      !plan.date_iso ? 'date' :
      !plan.start_time_iso ? 'start_time' : null;

    if (missing) {
      if (s.askedField === missing) return;
      s.askedField = missing;

      const hint =
        missing === 'venue' ? 'bv. Gent, Brugge, ...' :
        missing === 'date' ? 'bv. vr 06/09' :
        'bv. 15:00 of 22:30';

      await message.reply(`Lijkt op een plan! Ik mis **${missing}** (${hint}).`);
      return;
    }

    // We have venue + date + time -> reply in channel with confirmation buttons
    const token = crypto.randomUUID();
    s.waitingApproval = true;
    s.pendingToken = token;

    // Save for interaction handler
    savePending(token, {
      guildId: s.guildId,
      channelId: message.channelId,
      allowUserId: s.initiatorId,
      plan,
    });

    const embed = planEmbed(plan, message.author.tag);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`uitgaan:approve:${token}`)
        .setLabel('Maak event')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`uitgaan:cancel:${token}`)
        .setLabel('Annuleer')
        .setStyle(ButtonStyle.Secondary),
    );

    await message.reply({
      content: `<@${s.initiatorId}> Wil je hier een Discord-event van maken? *(alleen jij of een mod kan bevestigen)*`,
      embeds: [embed],
      components: [row],
    });
  },
};
