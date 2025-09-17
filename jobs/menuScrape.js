const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { supabase } = require('../lib/supabase');

function menuScrape(client, guildId, timezone) {
  cron.schedule('0 3 * * *', async () => {
    console.log('Starting menu scrape for guild', guildId);
    const { data: info, error } = await supabase
        .from('menu')
        .select('location, channel_id, message_id')
        .eq('guild_id', guildId);

    if (error) {
        console.error(error);
        return;
    }

    console.log('Fetched menu info:', info[0].channel_id);
    const ch = await client.channels.fetch(info[0].channel_id);
    const msg = await ch.messages.fetch(info[0].message_id);
    const location = info[0].location;

    const { data } = await axios.get('https://www.ugent.be/student/nl/meer-dan-studeren/resto/restosencafetarias/restodebrug.htm');
    const $ = cheerio.load(data);

    const menuUrl = $('#parent-fieldname-text > div > div > div:nth-child(1) > div > ul:nth-child(4) > li:nth-child(2) > a').attr('href');
    const { data: menuData } = await axios.get(menuUrl);
    const $$ = cheerio.load(menuData);

    const days = $$('div.item');

    const menuEmbeds = [];

    days.each(async (i, el) => {
        const day = $$(el).find('a').text().trim();
        const menuItems = {};

        $$(el).find('h3 + ul').each((j, ul) => {
            const category = $$(ul).prev('h3').text().trim();
            const items = [];
            $$(ul).find('li').each((k, li) => {
                items.push($$(li).text().trim());
            });
            menuItems[category] = items;
        });

        const fields = Object.entries(menuItems).map(([name, items]) => ({
            name: name,
            value: items.length > 0 ?
                items.map(item => `> ${item}`).join('\n') :
                'Geen items beschikbaar',
            inline: false,
        }));

        const embed = new EmbedBuilder()
            .setColor('#393A40')
            .setTitle(`**Resto - ${location}**`)
            .setDescription(`Menu voor ${day}`)
            .addFields(...fields);

        menuEmbeds.push(embed);
    });

    await msg.edit({ embeds: menuEmbeds });
  }, { timezone });
}

module.exports = async (client) => {
  const { data, error } = await supabase.from('guild_settings').select('guild_id, timezone');
  if (error || !data) return;
  for (const g of data) menuScrape(client, g.guild_id, g.timezone || 'Europe/Brussels');
};
