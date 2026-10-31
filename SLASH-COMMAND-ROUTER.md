'use strict';
/* PELEX UNIVERSAL SLASH COMMAND REGISTRY (version 3)
   One source of truth for every slash command. The site's "/" menu, GET /commands, /help and the chat router all read this file.
   A command with implemented:false belongs to an agent that is not built yet. It answers "not connected" and never calls a model.
   To add a command, add one line to GENERAL (or to AGENTS for a future agent). Nothing else changes. */

const ON = new Set(('general,' + (process.env.AGENTS_READY || '')).split(',').map(x => x.trim()).filter(Boolean));   // AGENTS_READY=business,pitch turns an agent on
const AGENTS = {
  general:  { ready: true,  label: 'General Agent' },
  gmail:    { ready: ON.has('gmail'),    label: 'Gmail Agent' },
  pitch:    { ready: ON.has('pitch'),    label: 'Pitch Agent' },
  business: { ready: ON.has('business'), label: 'Business Agent' },
  personal: { ready: ON.has('personal'), label: 'Personal Agent' },
};
// features the site shows as "Soon" until they are really running. The site reads this and updates itself; FEATURES_ON=connectors,artcraft turns more on.
const FEATURES = { chat: true, commands: true, image: false, scheduled: false, pitchcheck: false, connectors: false, artcraft: false, whatsapp: false, telegram: false, notifications: false, ads: false };
for (const k of (process.env.FEATURES_ON || '').split(',').map(x => x.trim()).filter(Boolean)) if (k !== 'ads') FEATURES[k] = true;
const setFeature = (k, v) => { if (k in FEATURES && k !== 'ads') FEATURES[k] = !!v; };
const CHANNELS = { web: { ready: true }, telegram: { ready: !!process.env.TELEGRAM_READY }, whatsapp: { ready: !!process.env.WHATSAPP_READY } };

// [name, aliases, category, description, usage, hint for the model, task lane]
const g = (name, aliases, category, description, usage, hint, task) => ({ name, aliases, agent: 'general', category, description, usage, example: usage.replace(/<[^>]+>/g, m => ({ '<text>': 'your text here' }[m] || m.slice(1, -1))), implemented: true, hint, task: task || null, args: /^\/\S+ </.test(usage) ? 'required' : 'optional' });
const GENERAL = [
  g('help', ['commands', 'menu'], 'Basics', 'Show every command', '/help [word]', ''),
  g('prompt', ['promptwriter'], 'Writing', 'Turn a rough idea into a strong AI prompt', '/prompt <what you want>', 'Act as a prompt engineer. Write one clear, detailed, ready-to-paste prompt for the request. Include role, goal, context, constraints and output format. Then add two short tips to improve it.'),
  g('image', ['imagine', 'draw', 'picture'], 'Create', 'Create a picture from a description', '/image <description>', 'Create the picture with the image_generate tool. Write a detailed English prompt (subject, style, colours, mood) from the input, then show the result. If the input only asks for a common reference (what an app screen or ad layout looks like), call find_images first and generate only if nothing suitable is found.'),
  g('examples', ['pictures', 'photos', 'inspiration', 'references'], 'Create', 'Find real example pictures from the web', '/examples <what to look for>', 'Use the find_images tool first to show real example pictures with their sources. Add one line on what each shows. Offer to generate a custom picture only if none are suitable.'),
  g('qr', ['qrcode'], 'Create', 'Make a QR code', '/qr <link or text>', 'Make a QR code with the qr_code tool for the input.'),
  g('file', ['save', 'export'], 'Create', 'Save text as a downloadable file', '/file <name.ext> <content>', 'Create a downloadable file with the create_file tool. The first word of the input is the file name with its extension; the rest is the content.'),
  g('doc', ['document', 'report'], 'Create', 'Write a full, finished document', '/doc <topic>', 'Write the complete finished document with clear headings, never an outline. Match the document type to the request (report, proposal, letter, policy, guide).'),
  g('summarize', ['tldr', 'summary'], 'Writing', 'Summarise a text or a web page', '/summarize <text or link>', 'Summarise the input in plain language: first a one-sentence gist, then the key points, then anything the person should act on. If the input is a link, read it with read_website first.'),
  g('translate', ['tr'], 'Writing', 'Translate into another language', '/translate <language>: <text>', 'Translate the text into the language named at the start of the input. Keep the tone and meaning. Add a short pronunciation note only for non-Latin scripts.'),
  g('rewrite', ['improve', 'polish'], 'Writing', 'Improve clarity, tone and grammar', '/rewrite <text>', 'Rewrite the text so it is clearer, correctly written and well toned, keeping the meaning. Show the improved version first, then a short list of what changed.'),
  g('email', ['mail'], 'Writing', 'Draft an email (nothing is sent)', '/email <what it should say>', 'Draft a professional email with a subject line, greeting, body and a clear call to action. This is only a draft for the person to review; nothing is sent.'),
  g('social', ['post', 'caption'], 'Writing', 'Social media posts and captions', '/social <topic> [platform]', 'Write three social media post options for the topic, suited to the platform named (default Instagram or LinkedIn). Include hashtags and a call to action.'),
  g('ad', ['advert', 'copy'], 'Writing', 'Advert copy and slogans', '/ad <product or offer>', 'Write advert copy for the product or offer: five headlines, two short body versions, and a call to action. Keep the claims honest.'),
  g('explain', ['eli5', 'teach'], 'Learn', 'Explain something simply', '/explain <topic>', 'Explain the topic simply with an everyday example. Start with the core idea in two sentences, then go deeper in short steps.'),
  g('define', ['meaning'], 'Learn', 'Dictionary definition', '/define <word>', 'Define the word with the define_word tool, then give a short plain-language explanation.'),
  g('wiki', ['wikipedia'], 'Learn', 'Look something up on Wikipedia', '/wiki <topic>', 'Look the topic up with the wikipedia tool and summarise it briefly with the source link.'),
  g('country', ['nation'], 'Learn', 'Facts about a country', '/country <name>', 'Use the country_info tool for the country and present the key facts neatly.'),
  g('compare', ['vs'], 'Learn', 'Compare options side by side', '/compare <A> vs <B>', 'Compare the options in a clear table (criteria in rows), then give a short recommendation and say what it depends on.'),
  g('plan', ['steps', 'roadmap'], 'Work', 'Make a step-by-step plan', '/plan <goal>', 'Turn the goal into a realistic step-by-step plan with timing, what to prepare, and the first action to take today.'),
  g('brainstorm', ['ideas'], 'Work', 'Generate ideas', '/brainstorm <topic>', 'Give 10 varied, specific ideas for the topic. Group them, and mark the three most promising with a short reason.'),
  g('jobs', ['remote', 'job'], 'Work', 'Find remote jobs', '/jobs <role> [region]', 'Find current remote job openings with the remote_jobs tool (use tavily_search if it is missing). Show up to five as title, company and link.'),
  g('canva', ['design'], 'Create', 'A design brief ready for Canva', '/canva <what to design>', 'Write a Canva-ready design brief: purpose, size, layout sections, exact text for each section, colours, fonts and image ideas. This is a brief only; nothing is created in Canva.'),
  g('search', ['web', 'google', 'find'], 'Research', 'Search the web', '/search <question>', 'Search the web with tavily_search (or web_search) and answer with the sources.'),
  g('news', ['headlines'], 'Research', 'Latest news on a topic', '/news <topic>', 'Search for the latest news on the topic with a news search and give the main points with dates and sources.'),
  g('read', ['open', 'url'], 'Research', 'Read and explain a web page', '/read <link>', 'Open the link with read_website and explain what it says. If it fails, say so plainly.'),
  g('weather', ['forecast'], 'Tools', 'Weather and 5-day forecast', '/weather <place>', 'Use the get_weather tool for the place and present it clearly.'),
  g('time', ['date', 'clock'], 'Tools', 'Current time in a place', '/time [timezone]', 'Use the get_time tool and answer plainly.'),
  g('calc', ['calculate', 'math'], 'Tools', 'Exact maths', '/calc <expression>', 'Use the calculator tool for the arithmetic. Show the result and one line of working.'),
  g('convert', ['units'], 'Tools', 'Convert units', '/convert <5 miles to km>', 'Use the convert_units tool for the conversion.'),
  g('currency', ['fx', 'rate'], 'Tools', 'Currency conversion', '/currency <100 USD to NGN>', 'Use the convert_currency tool and state the rate and the time it was updated.'),
  g('crypto', ['coin'], 'Tools', 'Crypto price', '/crypto <coin id, e.g. bitcoin>', 'Use the crypto_price tool for the coin.'),
  g('holidays', ['holiday'], 'Tools', 'Public holidays', '/holidays <country code> [year]', 'Use the public_holidays tool for the country code (and year, if given).'),
  g('code', ['dev', 'program'], 'Code', 'Write working code', '/code <what to build>', 'Write complete, runnable code for the request in fenced blocks with the language named. Add brief run instructions.', 'coding'),
  g('debug', ['fix', 'bug'], 'Code', 'Find and fix a bug', '/debug <code and the error>', 'Find the cause of the bug. State the cause in one or two sentences, give the corrected code, then say how to confirm the fix.', 'coding'),
  g('review', ['audit'], 'Code', 'Review code for problems', '/review <code>', 'Review the code for bugs, security problems and clarity. List issues by importance with a concrete fix for each.', 'coding'),
  g('sql', ['query'], 'Code', 'Write or explain SQL', '/sql <what you need>', 'Write the SQL (PostgreSQL unless told otherwise) with a short explanation. Use safe, parameterised patterns.', 'coding'),
  g('regex', ['regexp'], 'Code', 'Build a regular expression', '/regex <what to match>', 'Write the regular expression, explain each part briefly, and give three matching and three non-matching examples.', 'coding'),
  g('data', ['analyze', 'analyse', 'csv'], 'Data', 'Analyse data or a table', '/data <paste data or ask>', 'Analyse the data: summary, patterns, odd values, and clear next steps. Use the calculator for any arithmetic.', 'data'),
];

// agents that are not built yet: they answer "not connected" and never reach a model
const a = (agent, name, aliases, description, usage) => ({ name, aliases, agent, category: AGENTS[agent].label, description, usage, example: usage, implemented: false, hint: '', task: null, args: 'optional' });
const FUTURE = [
  a('gmail', 'gmail', [], 'Search and read your Gmail', '/gmail <what to find>'),
  a('gmail', 'inbox', [], 'Summarise your inbox', '/inbox'),
  a('gmail', 'reply', [], 'Draft a reply to an email', '/reply <which email>'),
  a('gmail', 'label', [], 'Organise mail with labels', '/label <rule>'),
  a('pitch', 'pitch', [], 'Find jobs and write pitches', '/pitch <role>'),
  a('pitch', 'cv', ['resume'], 'Improve your CV', '/cv'),
  a('pitch', 'coverletter', ['cover'], 'Write a cover letter', '/coverletter <job link>'),
  a('pitch', 'jobmatch', [], 'Check how well you match a job', '/jobmatch <job link>'),
  a('business', 'business', ['biz'], 'Talk to your Business bot', '/business <message>'),
  a('business', 'faq', [], 'Manage your customer FAQ', '/faq <question>'),
  a('business', 'customers', [], 'See customer conversations', '/customers'),
  a('personal', 'personal', ['me'], 'Talk to your Personal bot', '/personal <message>'),
  a('personal', 'remind', ['reminder'], 'Set a reminder', '/remind <what and when>'),
  a('personal', 'note', ['notes'], 'Save a private note', '/note <text>'),
  a('personal', 'task', ['todo', 'tasks'], 'Add or list tasks', '/task <text>'),
  a('personal', 'calendar', ['cal'], 'Check or add calendar events', '/calendar <when>'),
];
const REGISTRY = GENERAL.concat(FUTURE);

const BY_NAME = new Map();
for (const c of REGISTRY) { BY_NAME.set(c.name, c); for (const al of c.aliases) if (!BY_NAME.has(al)) BY_NAME.set(al, c); }

const pub = c => ({ name: c.name, aliases: c.aliases, agent: c.agent, category: c.category, description: c.description, usage: c.usage, example: c.example, implemented: c.implemented, args: c.args });
function list(agent) {
  const all = REGISTRY.filter(c => !agent || c.agent === agent).map(pub);
  const ag = Object.fromEntries(Object.entries(AGENTS).map(([k, v]) => [k, { ready: v.ready, label: v.label, commands: REGISTRY.filter(c => c.agent === k).length }]));
  return { version: 3, router: 'universal', universal: true, note: 'Any word after / works as a command. Words that are not listed are worked out from their meaning.', count: all.length, agent: agent || 'all', agents: ag, channels: CHANNELS, features: FEATURES, commands: all };
}
function lev(x, y) { const d = Array.from({ length: x.length + 1 }, (_, i) => [i]); for (let j = 1; j <= y.length; j++) d[0][j] = j; for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return d[x.length][y.length]; }
function suggest(word) {
  const seen = new Set(), out = [];
  for (const [k, c] of BY_NAME) { if (seen.has(c.name)) continue; if (k.startsWith(word) || word.startsWith(k) || lev(k, word) <= 2) { seen.add(c.name); out.push(c); } }
  return out.slice(0, 5);
}
function helpText(filter) {
  const f = String(filter || '').trim().toLowerCase().replace(/^\//, '');
  const rows = REGISTRY.filter(c => !f || c.name.includes(f) || c.aliases.some(x => x.includes(f)) || c.category.toLowerCase().includes(f) || c.agent === f);
  if (!rows.length) return `I found no command matching "${f}". Type /help to see them all.`;
  const cats = new Map(); for (const c of rows) { if (!cats.has(c.category)) cats.set(c.category, []); cats.get(c.category).push(c); }
  let out = f ? `**Commands matching "${f}"**\n` : '**Pelex commands**\nType `/` in the chat box to pick one, then add your text.\n';
  for (const [cat, cs] of cats) { out += `\n**${cat}**\n`; for (const c of cs) out += `- \`${c.usage}\` : ${c.description}${c.implemented ? '' : ' (not connected yet)'}\n`; }
  if (!f) out += '\n**Any other word works too.** Type `/` plus any word (for example `/roast`, `/recipe`, `/truth`) and Pelex works out what you mean.\nCommands marked "not connected yet" belong to agents that are still being built.';
  return out;
}
/* resolve(text) -> null (not a command, treat as normal chat)
                  | { immediate, command }            answer straight away, no model
                  | { run: { text, task, name }, command }   send this instruction to the model */
function resolve(text) {
  const m = /^\/([a-zA-Z][a-zA-Z0-9_-]{0,24})(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;                       // not a command (also paths like /usr/bin)
  const word = m[1].toLowerCase(), args = (m[2] || '').trim(), c = BY_NAME.get(word);
  if (!c) {
    // a near miss of a known command (a typo) runs that command; anything else is a custom command and is worked out from its meaning
    const near = word.length >= 4 ? suggest(word).find(x => [x.name].concat(x.aliases).some(k => lev(k, word) <= 1)) : null;
    if (near && near.implemented) return resolve('/' + near.name + (args ? ' ' + args : ''));
    return { run: { text: `[Custom slash command /${word}] The person used a slash command that is not in my list. Treat the command word "${word}" as the task, style or persona they want, and carry it out using the input. If the word is unclear, choose the most sensible meaning, say it in one short line, and continue. Do not refuse only because the command is not listed.\n\nInput: ${args || '(none)'}`, task: null, name: word }, command: { name: word, status: 'custom', agent: 'general' } };
  }
  if (c.name === 'help') return { immediate: helpText(args), command: { name: 'help', status: 'ok', agent: 'general' } };
  if (!c.implemented) return { immediate: `\`/${c.name}\` needs the **${AGENTS[c.agent].label}**, which is not connected yet. Nothing was run. Meanwhile I can help with this in a normal chat: just describe what you want without the slash.`, command: { name: c.name, status: 'not_connected', agent: c.agent } };
  if (c.args === 'required' && !args) return { immediate: `\`/${c.name}\` needs some text after it.\n\nUsage: \`${c.usage}\`\nExample: \`/${c.name} ${c.example.replace(/^\/\S+\s*/, '')}\``, command: { name: c.name, status: 'needs_input', agent: c.agent } };
  return { run: { text: `[Slash command /${c.name}] ${c.hint}\n\nInput: ${args || '(none)'}`, task: c.task, name: c.name }, command: { name: c.name, status: 'ok', agent: c.agent } };
}
module.exports = { version: 3, FEATURES, setFeature, REGISTRY, AGENTS, CHANNELS, list, resolve, helpText, suggest, count: REGISTRY.length };
