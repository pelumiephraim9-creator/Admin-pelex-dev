'use strict';

// Free global satellite imagery using OpenStreetMap geocoding + NASA GIBS.
// No API key, paid plan, or third-party image-search subscription is required.

const clip = (v, n) => String(v == null ? '' : v).replace(/[\\r\\n]+/g, ' ').slice(0, n);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  name: 'satellite_view',
  description: 'Retrieve a genuine NASA satellite image for a named place anywhere in the world. Use when someone asks to see satellite imagery, cloud cover, sunlight/daylight patterns, or the broad environmental appearance of a location. This is satellite imagery, NOT street-level photography or a live webcam. Always state the actual imagery date and source.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'A specific place, preferably city and country, e.g. Akure, Ondo State, Nigeria.' },
      view: { type: 'string', enum: ['true_color', 'clouds'], description: 'true_color for natural-colour land/cloud imagery; clouds for cloud cover.' }
    },
    required: ['location']
  },
  label: args => 'Retrieving satellite imagery for ' + clip(args && args.location, 70),
  enabled: () => true,
  run: async (args, ctx) => {
    const location = clip(args && args.location, 180).trim();
    if (!location) throw new Error('A location is required.');
    const view = args && args.view === 'clouds' ? 'clouds' : 'true_color';

    // Nominatim is a free OpenStreetMap geocoder. Respect its public usage policy.
    const geoUrl = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: location, format: 'jsonv2', limit: '1', addressdetails: '1'
    });
    const gt = ctx.withTimeout(12000);
    let geoResponse;
    try {
      geoResponse = await fetch(geoUrl, {
        signal: gt.signal,
        headers: { 'User-Agent': 'PelexSatelliteView/1.0 (free global imagery feature; contact: support@pelex.tech)', 'Accept': 'application/json' }
      });
    } finally { gt.done(); }
    if (!geoResponse.ok) throw new Error('The free location lookup service is temporarily unavailable.');
    const matches = await geoResponse.json();
    if (!Array.isArray(matches) || !matches.length) return { text: 'I could not confidently locate "' + location + '". Please specify the city and country. No image was substituted.' };
    const place = matches[0];
    const lat = Number(place.lat), lon = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('The location service returned invalid coordinates.');

    // A roughly 70 km-wide window: useful for regional conditions, not street-level detail.
    const halfLat = 0.32;
    const halfLon = Math.min(0.45, 0.32 / Math.max(0.25, Math.cos(lat * Math.PI / 180)));
    const bbox = [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat].map(v => v.toFixed(5)).join(',');
    const layer = view === 'clouds' ? 'MODIS_Terra_Cloud_Top_Temp_Day' : 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
    const endpoint = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

    // NASA imagery can lag acquisition. Try the latest few complete UTC days.
    const candidates = [];
    for (let back = 1; back <= 5; back++) {
      const d = new Date(Date.now() - back * 86400000);
      candidates.push(d.toISOString().slice(0, 10));
    }

    let imageUrl = '';
    let imageDate = '';
    let lastStatus = 0;
    for (const date of candidates) {
      const params = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: layer, STYLES: '', FORMAT: 'image/jpeg', TRANSPARENT: 'false',
        HEIGHT: '650', WIDTH: '1000', CRS: 'CRS:84', BBOX: bbox, TIME: date
      });
      const candidate = endpoint + '?' + params.toString();
      const t = ctx.withTimeout(18000);
      try {
        const response = await fetch(candidate, { signal: t.signal, headers: { 'User-Agent': 'PelexSatelliteView/1.0' } });
        lastStatus = response.status;
        const type = String(response.headers.get('content-type') || '').toLowerCase();
        if (response.ok && type.includes('image')) {
          imageUrl = candidate;
          imageDate = date;
          break;
        }
      } catch (e) {
        // Try the next recent date if the imagery endpoint is temporarily unavailable.
      } finally { t.done(); }
    }

    if (!imageUrl) {
      return { text: 'NASA did not return a usable image for ' + clip(place.display_name, 140) + ' in the recent date window (last service response: ' + (lastStatus || 'network unavailable') + '). I have not substituted an unrelated photograph. Try again later or use the NASA Worldview map.' };
    }

    const displayPlace = clip(place.display_name, 160);
    const worldview = 'https://worldview.earthdata.nasa.gov/?v=' +
      [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat].map(v => v.toFixed(3)).join(',');
    const caption = view === 'clouds' ? 'NASA satellite cloud-layer view' : 'NASA natural-colour satellite view';
    const markdown = '![' + caption + ' over ' + displayPlace.replace(/[\\[\\]]/g, '') + '](' + imageUrl + ')';
    return {
      text: caption + ' for ' + displayPlace + '.\nImagery date: ' + imageDate + ' (UTC date; not a live camera feed).\nCoverage: regional view around the requested location; satellite resolution and cloud conditions may limit ground detail.\nSource: NASA Global Imagery Browse Services (GIBS). Explore the same area in NASA Worldview: ' + worldview,
      markdown
    };
  }
};
