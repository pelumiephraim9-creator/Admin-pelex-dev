'use strict';
// Example of a one-file tool. Drop any file like this into the tools/ folder and redeploy. No other file changes.
const U = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  mass: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237, oz: 0.028349523125, t: 1000 },
  volume: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625 },
  speed: { 'm/s': 1, 'km/h': 0.2777777778, mph: 0.44704, kn: 0.5144444444 },
  data: { b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12 },
  area: { 'm2': 1, 'km2': 1e6, ha: 10000, acre: 4046.8564224, 'ft2': 0.09290304 },
};
const ALIAS = { meter: 'm', meters: 'm', metre: 'm', kilometer: 'km', kilometers: 'km', mile: 'mi', miles: 'mi', foot: 'ft', feet: 'ft', inch: 'in', inches: 'in', kilogram: 'kg', kilograms: 'kg', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', liter: 'l', liters: 'l', litre: 'l', litres: 'l', gallon: 'gal', gallons: 'gal', kph: 'km/h', kmh: 'km/h', mps: 'm/s', knot: 'kn', knots: 'kn', hectare: 'ha', acres: 'acre', c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', kelvin: 'k', k: 'k' };
const norm = u => { u = String(u || '').trim().toLowerCase().replace(/²/g, '2').replace('°', ''); return ALIAS[u] || u; };
const round = n => Math.abs(n) >= 1e-6 && Math.abs(n) < 1e15 ? String(Math.round(n * 1e6) / 1e6) : String(n);

module.exports = {
  name: 'convert_units',
  description: 'Convert a value between units of length, mass, volume, speed, area, data size and temperature (c, f, k). Example: 5 miles to km.',
  parameters: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] },
  label: a => 'Converting ' + String(a.from || '').slice(0, 12) + ' to ' + String(a.to || '').slice(0, 12),
  run: async ({ value, from, to }) => {
    const v = Number(value); const f = norm(from), t = norm(to);
    if (!Number.isFinite(v)) throw new Error('The value must be a number.');
    const temp = ['c', 'f', 'k'];
    if (temp.includes(f) && temp.includes(t)) {
      const c = f === 'c' ? v : f === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      const out = t === 'c' ? c : t === 'f' ? c * 9 / 5 + 32 : c + 273.15;
      return `${v} °${f.toUpperCase()} = ${round(out)} °${t.toUpperCase()}`;
    }
    for (const kind of Object.keys(U)) if (U[kind][f] && U[kind][t]) return `${v} ${f} = ${round(v * U[kind][f] / U[kind][t])} ${t}`;
    return 'TOOL FAILED: I cannot convert between "' + String(from).slice(0, 20) + '" and "' + String(to).slice(0, 20) + '".';
  },
};
