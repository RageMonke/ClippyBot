const { Events, ActivityType } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);

		require('../jobs/purge')(client);
		require('../jobs/clearAttendance')(client);
		require('../jobs/menuScrape')(client);

		client.user.setActivity({
			name: 'this server',
			type: ActivityType.Watching,
		});

		// client.user.setActivity({
		// 	name: 'Updating Commands',
		// 	type: ActivityType.Custom,
		// });
	},
};