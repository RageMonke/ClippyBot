const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const dayjs = require('dayjs');
const { supabase } = require('../../lib/supabase');
const { readWeekEvents, monday } = require('../../lib/ics');
const { renderGridPNG, buildBlocks } = require('../../lib/renderGrid');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timetable-image')
    .setDescription('Render the shared timetable as a PNG image.')
    .addStringOption(o => o.setName('week_start')
      .setDescription('Week start (YYYY-MM-DD). Defaults to current week.')),
  async execute(interaction) {
    await interaction.deferReply();

    const startStr = interaction.options.getString('week_start');
    const weekStart = startStr ? dayjs(startStr).toDate() : monday(new Date()).toDate();

    // fetch calendars & users
    const { data: cals, error } = await supabase
      .from('calendars')
      .select('user_id, source_type, ics_url, storage_path');

    if (error) {
      console.error(error);
      return interaction.editReply('DB error fetching calendars.');
    }
    if (!cals || !cals.length) {
      return interaction.editReply('No calendars linked yet. Ask members to run `/calendar-add`.');
    }

    // resolve user display names
    const users = [];
    for (const c of cals) {
      try {
        const user = await interaction.client.users.fetch(c.user_id);
        users.push({ id: c.user_id, displayName: user.displayName ?? user.username, username: user.username });
      } catch {
        users.push({ id: c.user_id, displayName: c.user_id, username: c.user_id });
      }
    }

    // read week events per user
    const userEvents = new Map();
    for (const c of cals) {
      try {
        const evs = await readWeekEvents(c, weekStart, supabase);
        userEvents.set(c.user_id, evs);
      } catch (e) {
        console.error('ICS parse error', c.user_id, e.message);
      }
    }

    // build drawable blocks
    const blocks = buildBlocks({ users, userEvents });

    // render
    const png = renderGridPNG({
      weekStartISO: dayjs(weekStart).format('YYYY-MM-DD'),
      blocks,
      members: cals.length,
      hours: { start: 8, end: 22 },
    });

    const file = new AttachmentBuilder(png, { name: `timetable-${dayjs(weekStart).format('YYYY-MM-DD')}.png` });
    await interaction.editReply({ files: [file] });
  },
};
