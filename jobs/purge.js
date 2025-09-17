// jobs/purge.js
const cron = require('node-cron');
const { supabase } = require('../lib/supabase');
const { purgeChannel } = require('../lib/purge');
const { isDueToday } = require('../lib/cadence');

function schedulePurgeForGuild(client, guildId, timezone) {
  cron.schedule('0 3 * * *', async () => {
    const { data: rules, error } = await supabase
      .from('purge_rules').select('*')
      .eq('guild_id', guildId).eq('enabled', true);

    if (error || !rules?.length) return;
    for (const r of rules) {
      if (!isDueToday(r)) continue;
      const res = await purgeChannel(client, r.channel_id, { keepPinned: r.keep_pinned });
      if (res.ok) {
        await supabase.from('purge_rules')
          .update({ last_run_on: new Date().toISOString().slice(0, 10) })
          .eq('id', r.id);
      }
    }
  }, { timezone });
}

module.exports = async (client) => {
  const { data, error } = await supabase.from('guild_settings').select('guild_id, timezone');
  if (error || !data) return;
  for (const g of data) schedulePurgeForGuild(client, g.guild_id, g.timezone || 'Europe/Brussels');
};
