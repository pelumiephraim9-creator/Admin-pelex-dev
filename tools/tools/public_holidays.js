'use strict';
module.exports = {
  name: 'public_holidays',
  description: 'Public holidays for a country and year, using the 2 letter country code (NG for Nigeria, GB, US, DE, GH, KE...).',
  parameters: { type: 'object', properties: { country_code: { type: 'string' }, year: { type: 'integer' } }, required: ['country_code'] },
  label: a => 'Checking public holidays in ' + String(a.country_code || '').toUpperCase().slice(0, 2),
  run: async ({ country_code, year }, ctx) => {
    const cc = String(country_code || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(cc)) throw new Error('Use a 2 letter country code such as NG.');
    const y = Number(year) || new Date().getUTCFullYear(); if (y < 1975 || y > 2075) throw new Error('That year is out of range.');
    const j = await ctx.getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`);
    if (!Array.isArray(j) || !j.length) throw new Error('No holidays found.');
    return `${cc} ${y}\n` + j.map(h => `${h.date}: ${h.name}${h.localName && h.localName !== h.name ? ' (' + h.localName + ')' : ''}`).join('\n');
  },
};
