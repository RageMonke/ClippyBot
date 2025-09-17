const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge-add')
    .setDescription('Schedule a purge for a channel at 03:00 (uses this guild’s timezone).')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Text channel to purge')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addStringOption(o =>
      o.setName('cadence')
        .setDescription('How often to purge (default: daily)')
        .addChoices(
          { name: 'daily', value: 'daily' },
          { name: 'weekly', value: 'weekly' },
          { name: 'monthly', value: 'monthly' },
          { name: 'yearly', value: 'yearly' },
        )
        .setRequired(false))
    .addBooleanOption(o =>
      o.setName('keep_pinned')
        .setDescription('Keep pinned messages? (default true)')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.options.getChannel('channel');
    const cadence = interaction.options.getString('cadence') || 'daily';
    const keep = interaction.options.getBoolean('keep_pinned');

    // optional: ensure guild_settings row exists (for timezone)
    await supabase.from('guild_settings').upsert({
      guild_id: interaction.guildId,
    }, { onConflict: 'guild_id' });

    const { error } = await supabase
      .from('purge_rules')
      .insert({
        guild_id: interaction.guildId,
        channel_id: ch.id,
        cadence,
        keep_pinned: keep ?? true,
        enabled: true,
        anchor_date: new Date().toISOString().slice(0, 10),
      });

    if (error) {
      console.error(error);
      return interaction.editReply('❌ Could not create purge rule.');
    }
    interaction.editReply(`✅ Purge scheduled for <#${ch.id}>: **${cadence}** @ 03:00 (guild timezone), keep_pinned=${keep ?? true}.`);
  },
};
