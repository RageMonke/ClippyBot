const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-remove')
    .setDescription('Remove the purge rule for a channel.')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel with a purge rule')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.options.getChannel('channel');

    const { error } = await supabase
      .from('purge_rules')
      .delete()
      .eq('guild_id', interaction.guildId)
      .eq('channel_id', ch.id);

    if (error) {
      console.error(error);
      return interaction.editReply('❌ Could not remove rule (maybe none existed).');
    }
    interaction.editReply(`🗑️ Removed purge rule for <#${ch.id}>.`);
  },
};
