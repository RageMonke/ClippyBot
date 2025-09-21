const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { supabase } = require('../../lib/supabase');
const path = require('node:path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calendar-connect')
    .setDescription('connect your calendar (.ics file or public ICS URL).')
    .addStringOption(o =>
      o.setName('initials')
        .setDescription('Your initials or short name (e.g., QD, Emma, AR).')
        .setRequired(true))
    .addStringOption(o =>
      o.setName('url').setDescription('Public ICS URL (Google/Apple/Outlook export)'))
    .addAttachmentOption(o =>
      o.setName('file').setDescription('Upload a .ics file')),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const file = interaction.options.getAttachment('file');
    const url = interaction.options.getString('url');
    const initials = (interaction.options.getString('initials') || '').trim();

    if (!file && !url) {
      return interaction.editReply('Please provide either a .ics **file** or a public ICS **url**.');
    }

    // Load existing row to replace & possibly delete old upload
    const { data: existing, error: selErr } = await supabase
      .from('calendars')
      .select('id, source_type, storage_path, ics_url')
      .eq('guild_id', interaction.guildId)
      .eq('user_id', interaction.user.id)
      .maybeSingle();

    if (selErr) {
      console.error(selErr);
      return interaction.editReply('DB error fetching your current calendar.');
    }

    let source_type, ics_url = null, storage_path = null;

    if (url) {
      if (!/^https?:\/\//i.test(url)) {
        return interaction.editReply('The provided URL must start with http(s)://');
      }
      source_type = 'url';
      ics_url = url.trim();

      // If there was a previous uploaded file, delete it to keep storage clean
      if (existing?.source_type === 'upload' && existing.storage_path) {
        const [bucket, ...rest] = existing.storage_path.split('/');
        const key = rest.join('/');
        // eslint-disable-next-line no-empty-function
        await supabase.storage.from(bucket).remove([key]).catch(() => {});
      }
    } else {
      if (path.extname(file.name).toLowerCase() !== '.ics') {
        return interaction.editReply('The attachment must be a `.ics` file.');
      }
      // download file & upload to Supabase Storage
      const res = await axios.get(file.url, { responseType: 'arraybuffer' });
      const bucket = 'calendars';
      const key = `${interaction.guildId}/${interaction.user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(key, res.data, {
        contentType: 'text/calendar',
        upsert: true,
      });
      if (upErr) {
        console.error(upErr);
        return interaction.editReply('Upload failed. Try again or use a URL.');
      }
      source_type = 'upload';
      storage_path = `${bucket}/${key}`;

      // If there was a previous uploaded file, delete it
      if (existing?.source_type === 'upload' && existing.storage_path) {
        const [oldBucket, ...rest] = existing.storage_path.split('/');
        const oldKey = rest.join('/');
        // eslint-disable-next-line no-empty-function
        await supabase.storage.from(oldBucket).remove([oldKey]).catch(() => {});
      }
    }

    // Upsert (replace previous for this guild+user)
    const { error: upsertErr } = await supabase
      .from('calendars')
      .upsert({
        guild_id: interaction.guildId,
        user_id: interaction.user.id,
        source_type,
        ics_url,
        storage_path,
        initials,
      }, { onConflict: 'guild_id,user_id' });

    if (upsertErr) {
      console.error(upsertErr);
      return interaction.editReply('Could not save your calendar (DB error).');
    }

    const replaced = existing ? 'replaced' : 'linked';
    return interaction.editReply(`✅ Your calendar is ${replaced}! Initials saved as **${initials}**. Use \`/timetable-image\` to render the grid.`);
  },
};
