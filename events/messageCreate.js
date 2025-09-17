const { Events } = require('discord.js');
const uitgaanAgent = require('../lib/uitgaanAgent');

module.exports = {
    name: Events.MessageCreate,

    async execute(message) {
        await uitgaanAgent.execute(message);
    },
};