const { Events, MessageFlags, Collection, PermissionFlagsBits } = require('discord.js');
const { updateAttendance } = require('../lib/attendance');
const { getPending, deletePending } = require('../lib/uitgaanStore');
const { DateTime } = require('luxon');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			const { cooldowns } = interaction.client;

			if (!cooldowns.has(command.data.name)) {
				cooldowns.set(command.data.name, new Collection());
			}

			const now = Date.now();
			const timestamps = cooldowns.get(command.data.name);
			const defaultCooldownDuration = 3;
			const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

			if (timestamps.has(interaction.user.id)) {
				const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

				if (now < expirationTime) {
					const expiredTimestamp = Math.round(expirationTime / 1000);
					return interaction.reply({ content: `Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
				}
			}

			timestamps.set(interaction.user.id, now);
			setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

			try {
				await command.execute(interaction);
			} catch (error) {
				console.error(error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
				} else {
					await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
				}
			return;
			}
		}

		// ---- BUTTONS ----
		if (interaction.isButton()) {
			const customId = interaction.customId || '';

			// 1) UITGAAN CONFIRMATION BUTTONS
			if (customId.startsWith('uitgaan:')) {
				const [, action, token] = customId.split(':');
				const pending = getPending(token);

				if (!pending) {
				// Expired or already handled
				return interaction.reply({ content: 'Deze aanvraag is verlopen of al afgehandeld.', flags: MessageFlags.Ephemeral });
				}

				// Permission: initiator or mod (Manage Events/Guild)
				const guild = interaction.client.guilds.cache.get(pending.guildId);
				if (!guild) {
				return interaction.reply({ content: 'Guild niet gevonden.', flags: MessageFlags.Ephemeral });
				}

				let isAllowed = interaction.user.id === pending.allowUserId;
				if (!isAllowed) {
				try {
					const member = await guild.members.fetch(interaction.user.id);
					isAllowed =
					member.permissions.has(PermissionFlagsBits.ManageEvents) ||
					member.permissions.has(PermissionFlagsBits.ManageGuild);
				} catch {e;}
				}
				if (!isAllowed) {
				return interaction.reply({ content: 'Alleen de initiatiefnemer of een moderator kan dit.', flags: MessageFlags.Ephemeral });
				}

				// Disable buttons on the source message to avoid double clicks (non-response action)
				try {
				if (interaction.message?.editable) {
					await interaction.message.edit({ components: [] });
				}
				} catch {e;}

				if (action === 'cancel') {
				deletePending(token);
				return interaction.reply({ content: 'Oké—geen event aangemaakt.', flags: MessageFlags.Ephemeral });
				}

				if (action === 'approve') {
				const plan = pending.plan;
				const start = brusselsDate(plan.date_iso, plan.start_time_iso);
				const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

				try {
					const event = await guild.scheduledEvents.create({
					name: plan.title || `Uitgaan – ${plan.venue}`,
					scheduledStartTime: start,
					scheduledEndTime: end,
					privacyLevel: 2,
					entityType: 3,
					entityMetadata: {
						location: plan.city ? `${plan.venue}, ${plan.city}` : plan.venue,
					},
					description: `Venue: ${plan.venue}${plan.city ? ` (${plan.city})` : ''}`,
					});

					const url = `https://discord.com/events/${guild.id}/${event.id}`;

					// Ephemeral ack to the clicker
					await interaction.reply({ content: `🎉 Event aangemaakt: **${event.name}** → ${url}`, flags: MessageFlags.Ephemeral });

					// Public note in the channel
					const ch = guild.channels.cache.get(pending.channelId);
					if (ch) {
					await ch.send(`🎉 **${event.name}** is aangemaakt door <@${interaction.user.id}> → ${url}`);
					}
				} catch (err) {
					console.error('Failed creating event from approval:', err);
					await interaction.reply({ content: 'Kon het event niet aanmaken (permissions/inputs?).', flags: MessageFlags.Ephemeral });
				} finally {
					deletePending(token);
				}
				return;
				}

				// Unknown uitgaan action
				return interaction.reply({ content: 'Onbekende actie.', flags: MessageFlags.Ephemeral });
			}

			// 2) ALL OTHER BUTTONS (your existing attendance flow)
			try {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				await updateAttendance(interaction);
			} catch (err) {
				console.error(err);
				if (interaction.deferred) {
				await interaction.editReply({ content: 'Er ging iets mis bij het verwerken van je actie.' });
				}
			}
			return;
		}
	},
};

function brusselsDate(dateISO, timeHM) {
  // Parse in Europe/Brussels to get correct DST offset, then to JS Date (UTC)
  return DateTime.fromISO(`${dateISO}T${timeHM}`, { zone: 'Europe/Brussels' }).toJSDate();
}