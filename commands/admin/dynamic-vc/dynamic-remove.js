const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dynamic-remove')
        .setDescription('Remove a dynamic voice channel.')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Voice channel to make dynamic')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ch = interaction.options.getChannel('channel');

        const { error } = await supabase
            .from('dynamic_vc_rules')
            .delete()
            .eq('guild_id', interaction.guildId)
            .eq('channel_id', ch.id);

        if (error) {
            console.error(error);
            return interaction.editReply('❌ Could not remove dynamic VC rule');
        }
        interaction.editReply(`🗑️ Removed dynamic vc rule for <#${ch.id}>.`);
    },
};