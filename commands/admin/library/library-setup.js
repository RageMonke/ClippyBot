const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { supabase } = require('../../../lib/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('library-setup')
        .setDescription('Set up the library system in this server.')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel for library use')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(o =>
            o.setName('location')
                .setDescription('location of the library')
                .setRequired(true))
        .addNumberOption(o =>
            o.setName('opens_at')
                .setDescription('Time the library opens')
                .setRequired(true))
        .addNumberOption(o =>
            o.setName('closes_at')
                .setDescription('Time the library closes')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ch = interaction.options.getChannel('channel');
        const location = interaction.options.getString('location');
        const opensAt = interaction.options.getNumber('opens_at');
        const closesAt = interaction.options.getNumber('closes_at');

        attendanceDic = {};
        for (let i = opensAt; i < closesAt; i++) {
            attendanceDic[`${i}u - ${i + 1}u`] = [];
        }

        attendanceString = '';

        for (const [key, value] of Object.entries(attendanceDic)) {
            const mentions = value.map(id => `<@${id}>`).join(', ');
            attendanceString += `> ${key}: ${mentions}\n`;
        }

        const buttons = [];

        for (const [key] of Object.entries(attendanceDic)) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`${key}`)
                .setLabel(key)
                .setStyle(ButtonStyle.Secondary));
        }

        const rows = [];

        for (let i = 0; i < buttons.length; i += 3) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 3)));
        }

        const embed = new EmbedBuilder()
            .setColor('#393A40')
            .setTitle(`**Bibliotheek - ${location}**`)
            .setDescription(attendanceString)
            .setFooter({ text: 'Klik op de knoppen hieronder om je aanwezigheid aan te geven.' });

        const headEmbed = new EmbedBuilder()
            .setColor('#393A40')
            .setImage('https://cdn.discordapp.com/attachments/1417635347852165242/1417635418123276379/schoonmeersen.png?ex=68cb335e&is=68c9e1de&hm=94804c9e45f11e76702e4bb002fa6128d33f3615db253bdf0ed5d459a3969d60&');

        interaction.editReply('Library system set up successfully.');
        await ch.send({ embeds: [headEmbed] });
        const message = await ch.send({
            embeds: [embed],
            components: [...rows],
        });

        const { error } = await supabase
            .from('library_attendance')
            .upsert([
                {
                    guild_id: interaction.guild.id,
                    location: location,
                    attendance: attendanceDic,
                    message_id: message.id,
                    channel_id: ch.id,
                },
            ],
            { onConflict: 'location' },
        );

        if (error) {
            console.error(error);
            return interaction.editReply('There was an error while setting up the library system.');
        }
    },
};