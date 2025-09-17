const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dynamic-add')
        .setDescription('Create a dynamic voice channel.')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Voice channel to make dynamic')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ch = interaction.options.getChannel('channel');
        const label = ch.name.replace(/\d+$/, '').trim();

        const { error } = await supabase
            .from('dynamic_vc_rules')
            .upsert({
                guild_id: interaction.guildId,
                channel_id: ch.id,
                base_label: label,
                created_channels: [],
            }, { onConflict: 'channel_id' })
            .select()
            .single();

        const guild = interaction.guild;
        await guild.channels.edit(ch.id, { name: `${label} 1` });

        if (error) {
            console.error(error);
            return interaction.editReply('❌ Could not create dynamic VC rule');
        }
        interaction.editReply(`✅ Dynamic VC rule created for <#${ch.id}> (base label: **${label}**)`);
    },
};