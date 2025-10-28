const { EmbedBuilder } = require('discord.js');
const { supabase } = require('./supabase');

async function updateAttendance(interaction) {
    const { data, error } = await supabase
        .from('library_attendance')
        .select('location, attendance')
        .eq('guild_id', interaction.guild.id)
        .eq('message_id', interaction.message.id);

    if (error) {
        console.error(error);
        return;
    }

    const attendanceDic = data[0].attendance;

    if (!attendanceDic[interaction.customId].includes(interaction.user.id)) {
        attendanceDic[interaction.customId].push(interaction.user.id);
    } else {
        attendanceDic[interaction.customId] = attendanceDic[interaction.customId].filter(id => id !== interaction.user.id);
    }

    attendanceString = '';

    for (const [key, value] of Object.entries(attendanceDic)) {
        const mentions = value.map(id => `<@${id}>`).join(', ');
        attendanceString += `> ${key}: ${mentions}\n`;
    }

    const location = data[0].location;

    // format today’s date, e.g. "21-09-2025"
    const today = new Date().toLocaleDateString('nl-BE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const embed = new EmbedBuilder()
        .setColor('#393A40')
        .setTitle(`**Bibliotheek - ${location}**`)
        .setDescription(attendanceString + '```ansi\n[1;31mDeze functie zal binnenkort verdwijnen wegens weinig gebruik\n```')
        .setFooter({ text: `Klik op de knoppen hieronder om je aanwezigheid op ${today} aan te geven.` });

    msg = await interaction.channel.messages.fetch(interaction.message.id);
    await msg.edit({ embeds: [embed] });

    const { err } = await supabase
        .from('library_attendance')
        .update({
                attendance: attendanceDic,
        })
        .eq('guild_id', interaction.guild.id)
        .eq('message_id', interaction.message.id);

    if (err) {
        console.error(err);
        return interaction.editReply('There was an error while updating the library system.');
    }

    interaction.editReply('Je aanwezigheid is bijgewerkt.');
}

module.exports = { updateAttendance };