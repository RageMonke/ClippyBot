const axios = require('axios');
const IcalExpander = require('ical-expander').default;
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc'); dayjs.extend(utc);

function monday(d) {
  const x = dayjs(d).startOf('day');
  // JS Monday=1 … we want Monday as start
  const wd = (x.day() + 6) % 7;
  return x.subtract(wd, 'day').startOf('day');
}
function addDays(d, n) { return dayjs(d).add(n, 'day'); }

async function fetchIcs(cal, supabase) {
  if (cal.source_type === 'url') {
    const res = await axios.get(cal.ics_url, { responseType: 'text' });
    return res.data;
  }
  // storage_path = bucket/key
  const [bucket, ...rest] = cal.storage_path.split('/');
  const key = rest.join('/');
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw error;
  return await data.text();
}

async function readWeekEvents(cal, weekStart, supabase) {
  const ics = await fetchIcs(cal, supabase);
  const expander = new IcalExpander({ ics, maxIterations: 3000 });

  const start = monday(weekStart).toDate();
  const end = addDays(start, 7).toDate();

  const { events, occurrences } = expander.between(start, end);

  const singles = events.map(e => ({
    start: e.startDate.toJSDate(),
    end: e.endDate.toJSDate(),
    summary: (e.summary || '').trim(),
  }));
  const recurs = occurrences.map(o => ({
    start: o.startDate.toJSDate(),
    end: o.endDate.toJSDate(),
    summary: (o.item.summary || '').trim(),
  }));

  return [...singles, ...recurs].filter(ev => ev.end > start && ev.start < end);
}

module.exports = { readWeekEvents, monday, addDays };
