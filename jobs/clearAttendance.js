const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const { supabase } = require('../lib/supabase');

function scheduleClearAttendance(client, guildId, timezone) {
  cron.schedule('0 3 * * *', async () => {
    const { data: allData, error } = await supabase
        .from('library_attendance')
        .select('location, attendance, message_id, channel_id')
        .eq('guild_id', guildId);

    if (error) {
        console.error(error);
        return;
    }

    for (const data of allData) {
        const attendanceDic = data.attendance;

        for (const key in attendanceDic) {
            attendanceDic[key] = [];
        }

        attendanceString = '';

        for (const [key, value] of Object.entries(attendanceDic)) {
            const mentions = value.map(id => `<@${id}>`).join(', ');
            attendanceString += `> ${key}: ${mentions}\n`;
        }

        const location = data.location;

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

        ch = await client.channels.fetch(data.channel_id);
        msg = await ch.messages.fetch(data.message_id);
        await msg.edit({ embeds: [embed] });

        const { err } = await supabase
            .from('library_attendance')
            .update({
                    attendance: attendanceDic,
            })
            .eq('guild_id', guildId)
            .eq('message_id', data.message_id);

        if (err) {
            console.error(err);
            return;
        }
    }
  }, { timezone });
}

module.exports = async (client) => {
  const { data, error } = await supabase.from('guild_settings').select('guild_id, timezone');
  if (error || !data) return;
  for (const g of data) scheduleClearAttendance(client, g.guild_id, g.timezone || 'Europe/Brussels');
};
