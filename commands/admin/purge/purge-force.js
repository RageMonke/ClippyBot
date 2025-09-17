const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');
const { purgeChannel } = require('../../../lib/purge');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-force')
    .setDescription('Force a purge now for a channel using its saved settings.')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Text channel to purge now')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.options.getChannel('channel');

    const { data: rule, error } = await supabase
      .from('purge_rules')
      .select('*')
      .eq('guild_id', interaction.guildId)
      .eq('channel_id', ch.id)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      return interaction.editReply('❌ DB error reading rule.');
    }
    if (!rule) {
      return interaction.editReply('ℹ️ No purge rule exists for that channel. Create one with `/purge-add`.');
    }

    const res = await purgeChannel(interaction.client, ch.id, { keepPinned: rule.keep_pinned });
    if (!res.ok) return interaction.editReply('❌ Purge failed (check permissions).');

    // Optionally mark last_run_on since we purged now
    await supabase
      .from('purge_rules')
      .update({ last_run_on: new Date().toISOString().slice(0, 10) })
      .eq('id', rule.id);

    interaction.editReply(`✅ Purged <#${ch.id}> (deleted ~${res.deleted ?? 0} recent messages).`);
  },
};
