const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dynamic-list')
        .setDescription('List all dynamic voice channels.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { data: channels, error } = await supabase
            .from('dynamic_vc_rules')
            .select('channel_id, base_label')
            .eq('guild_id', interaction.guild.id);

        if (error) {
            console.error('Supabase error:', error);
            return interaction.editReply('❌ There was an error fetching the dynamic VC rules.');
        }

        if (!channels?.length) {
            return interaction.editReply('ℹ️ There are no dynamic VC rules set up for this server.');
        }

        const lines = channels.map(ch => `• <#${ch.channel_id}> (base label: **${ch.base_label}**)`);
        interaction.editReply(['📋 **Dynamic Voice Channels:**', ...lines].join('\n'));
    },
};