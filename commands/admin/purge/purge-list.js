const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-list')
    .setDescription('List all purge rules in this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // fetch rules + guild timezone
    const [{ data: rules, error }, { data: guildRow, error: gErr }] = await Promise.all([
      supabase.from('purge_rules')
        .select('id, channel_id, cadence, keep_pinned, enabled, last_run_on, anchor_date')
        .eq('guild_id', interaction.guildId)
        .order('created_at', { ascending: true }),
      supabase.from('guild_settings')
        .select('timezone')
        .eq('guild_id', interaction.guildId)
        .single(),
    ]);

    if (error || gErr) {
      console.error(error || gErr);
      return interaction.editReply('❌ Could not fetch purge rules.');
    }
    if (!rules?.length) return interaction.editReply(`No purge rules yet. Guild timezone: \`${guildRow?.timezone || 'Europe/Brussels'}\`.`);

    const tz = guildRow?.timezone || 'Europe/Brussels';
    const lines = rules.map(r =>
      `• <#${r.channel_id}> — **${r.cadence}** @ 03:00 ${tz} | keep_pinned=${r.keep_pinned} | enabled=${r.enabled} | last_run=${r.last_run_on ?? 'never'} | anchor=${r.anchor_date}`,
    );

    interaction.editReply([`Timezone: \`${tz}\``, ...lines].join('\n'));
  },
};
