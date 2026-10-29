const https = require('https');

module.exports = {
  name: 'serper_search',
  description:
    'Search the web using Google Search results through the Serper API. Use for current information, websites, news, and research.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.'
      },
      num: {
        type: 'integer',
        description: 'Number of results, from 1 to 10.'
      },
      country: {
        type: 'string',
        description: 'Two-letter country code, such as ng or us.'
      }
    },
    required: ['query']
  },

  label(args) {
    return `Search web: ${args.query}`;
  },

  enabled(cfg) {
    return Boolean(process.env.SERPER_API_KEY);
  },

  async run(args, ctx) {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      return {
        text: 'Serper Search is not configured. Add SERPER_API_KEY to Render environment variables.'
      };
    }

    const query = String(args.query || '').trim();

    if (!query) {
      return { text: 'Please provide a search query.' };
    }

    const num = Math.max(
      1,
      Math.min(10, Number.parseInt(args.num, 10) || 5)
    );

    const payload = JSON.stringify({
      q: query,
      num,
      gl: String(args.country || 'ng').toLowerCase()
    });

    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'google.serper.dev',
          path: '/search',
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 15000
        },
        (res) => {
          let body = '';

          res.setEncoding('utf8');
          res.on('data', chunk => {
            body += chunk;
          });

          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return resolve({
                text: `Serper request failed with HTTP ${res.statusCode}. Check your API key and Serper account quota.`
              });
            }

            try {
              const data = JSON.parse(body);
              const results = (data.organic || []).map((item, index) => {
                return [
                  `${index + 1}. ${item.title || 'Untitled'}`,
                  item.link || '',
                  item.snippet || ''
                ].filter(Boolean).join('\n');
              });

              resolve({
                text: results.length
                  ? results.join('\n\n')
                  : 'No organic search results were returned.'
              });
            } catch {
              resolve({
                text: 'Serper returned an unreadable response.'
              });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });

      req.on('error', () => {
        resolve({
          text: 'Serper Search could not connect. Check the network and try again.'
        });
      });

      req.write(payload);
      req.end();
    });
  }
};