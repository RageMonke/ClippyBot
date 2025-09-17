const { DateTime } = require('luxon');

function isDueToday(rule, now = DateTime.now().setZone('Europe/Brussels')) {
  const last = rule.last_run_on ? DateTime.fromISO(rule.last_run_on) : null;
  if (last && last.toISODate() === now.toISODate()) return false;

  const anchor = rule.anchor_date
    ? DateTime.fromISO(rule.anchor_date)
    : now;

  switch (rule.cadence) {
    case 'daily':
      return true;
    case 'weekly':
      return now.weekday === anchor.weekday;
    case 'monthly':
      return now.day === Math.min(anchor.day, now.endOf('month').day);
    case 'yearly':
      return (now.month === anchor.month) && (now.day === anchor.day);
    default:
      return false;
  }
}

module.exports = { isDueToday };
