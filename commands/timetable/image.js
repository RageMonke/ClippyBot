// commands/timetable/image.js
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const dayjs = require('dayjs');
const { supabase } = require('../../lib/supabase');
const { readWeekEvents, monday } = require('../../lib/ics');
const { buildBlocks } = require('../../lib/renderGrid');
const { renderGridPNG } = require('../../lib/renderGrid');
const { renderGridPNGHorizontal } = require('../../lib/renderGridHorizontal');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timetable-image')
    .setDescription('Render the shared timetable as an image.')
    .addStringOption(o => o.setName('week_start').setDescription('YYYY-MM-DD; defaults to current week'))
    // .addStringOption(o => o.setName('layout')
    //   .setDescription('vertical (default) or horizontal')
    //   .addChoices(
    //     { name: 'vertical (days as columns)', value: 'vertical' },
    //     { name: 'horizontal (days as rows)', value: 'horizontal' },
    //   ),
    // )
    .addIntegerOption(o => o.setName('slotw').setDescription('px per 30-min (horizontal) e.g. 34-40'))
    .addIntegerOption(o => o.setName('dayrowh').setDescription('px per day row (horizontal) e.g. 110-140')),
  async execute(interaction) {
    await interaction.deferReply();

    const startStr = interaction.options.getString('week_start');
    const weekStart = startStr ? dayjs(startStr).toDate() : monday(new Date()).toDate();
    const layout = interaction.options.getString('layout') || 'horizontal';

    const { data: cals, error } = await supabase
      .from('calendars')
      .select('user_id, source_type, ics_url, storage_path, initials')
      .eq('guild_id', interaction.guildId);

    if (error) return interaction.editReply('DB error fetching calendars.');
    if (!cals || !cals.length) return interaction.editReply('No calendars linked yet. Ask members to run `/calendar-connect`.');

    const users = [];
    for (const c of cals) {
      let displayName = c.user_id;
      try {
        const u = await interaction.client.users.fetch(c.user_id);
        displayName = u.displayName ?? u.username ?? c.user_id;
      // eslint-disable-next-line no-empty
      } catch {}
      users.push({ id: c.user_id, displayName, initials: (c.initials || '').trim() });
    }

    const userEvents = new Map();
    for (const c of cals) {
      try {
        userEvents.set(c.user_id, await readWeekEvents(c, weekStart, supabase));
      } catch (e) {
        console.error('ICS parse error', c.user_id, e.message);
      }
    }

    const blocks = buildBlocks({ users, userEvents, weekStart });

    const slotW = interaction.options.getInteger('slotw') ?? 60;
    const dayRowH = interaction.options.getInteger('dayrowh') ?? 240;

    const png = (layout === 'horizontal')
      ? renderGridPNGHorizontal({
          weekStartISO: dayjs(weekStart).format('YYYY-MM-DD'),
          blocks,
          users,
          members: cals.length,
          hours: { start: 8, end: 21 },
          slotW,
          dayRowH,
          leftLabelW: 120,
        })
      : renderGridPNG({
          weekStartISO: dayjs(weekStart).format('YYYY-MM-DD'),
          blocks,
          members: cals.length,
          hours: { start: 8, end: 21 },
        });

    const file = new AttachmentBuilder(png, { name: `timetable-${dayjs(weekStart).format('YYYY-MM-DD')}-${layout}.png` });
    await interaction.editReply({ files: [file] });
  },
};
