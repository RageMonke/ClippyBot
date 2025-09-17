const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../lib/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Set the timezone for this server.')
    .addStringOption(opt =>
        opt.setName('tz')
            .setDescription('Timezone for this server')
            .addChoices(
            { name: 'Europe/Brussels (CET/CEST)', value: 'Europe/Brussels' },
            { name: 'Europe/London (GMT/BST)', value: 'Europe/London' },
            { name: 'America/New_York (EST/EDT)', value: 'America/New_York' },
            { name: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
            { name: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
            { name: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
            { name: 'Asia/Singapore (SGT)', value: 'Asia/Singapore' },
            { name: 'Australia/Sydney (AEDT/AEST)', value: 'Australia/Sydney' },
            // …add the 10–20 most relevant
            )
            .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const tz = interaction.options.getString('tz');

    const { error } = await supabase
      .from('guild_settings')
      .upsert({
        guild_id: interaction.guildId,
        timezone: tz,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'guild_id' });

    if (error) {
      console.error(error);
      return interaction.editReply('❌ Failed to save timezone.');
    }

    await interaction.editReply(`✅ Timezone for this server set to \`${tz}\`.`);
  },
};