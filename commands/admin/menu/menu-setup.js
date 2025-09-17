const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('menu-setup')
        .setDescription('Set up the channel for menu updates.')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel for menu updates')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(o =>
            o.setName('location')
                .setDescription('location of the restaurant')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ch = interaction.options.getChannel('channel');
        const location = interaction.options.getString('location');

        const { error } = await supabase
            .from('menu')
            .upsert([
                {
                    guild_id: interaction.guild.id,
                    location: location,
                    channel_id: ch.id,
                    message_id: null,
                },
            ],
            { onConflict: 'location' },
        );

        if (error) {
            console.error(error);
            return interaction.editReply('There was an error while setting up the menu system.');
        }

        interaction.editReply('✅ Menu system set up successfully!');

        const message = await ch.send('Menu system is set up! You will receive updates here.');

        const { error: err } = await supabase
            .from('menu')
            .update({ message_id: message.id })
            .eq('guild_id', interaction.guild.id)
            .eq('location', location)
            .eq('channel_id', ch.id);

        if (err) {
            console.error(err);
            return interaction.followUp({ content: 'There was an error while saving the message ID.', flags: MessageFlags.Ephemeral });
        }
    },
};