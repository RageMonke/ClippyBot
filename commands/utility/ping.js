const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),

    async execute(interaction) {
        const reply = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const pingTime = reply.createdTimestamp - interaction.createdTimestamp;
        await interaction.editReply(`API Latency: ${Math.round(interaction.client.ws.ping)}ms\nPing: ${pingTime}ms`);
    },
};
