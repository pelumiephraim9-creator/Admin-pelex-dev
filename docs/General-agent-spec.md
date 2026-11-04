# General Agent: fix specification (backend)

Status: the General Agent is partly built. The items below are not yet correct.

## 0. What the front end now sends
- Image requests include `metadata.intent`:
  - `edit`: an image is attached and the words ask for a change (enhance, brighten, remove, colour, background, and similar). Edit the attached image.
  - `analyse`: an image is attached and the words ask about it. Describe or answer, do not generate.
  - `create`: a new picture from text (the /image command). Generate.
- A set request (for example 5 images with one character) must include a character sheet in `metadata.sheet` once the agent has written it, so every later image uses the same sheet.

## 1. Editing an image the person uploads
- If an image is attached, the request is an edit, not a new picture. Words such as "enhance", "brighten", "remove background", "make it warmer" apply to the attached image.
- Keep the original subject, composition, people and objects. Change only what was asked.
- If the request is unclear, ask one short question before generating anything.
- Return the edited image and keep the original next to it for comparison.

## 2. Creating a set of images that must match
- When the person asks for a set (for example "5 images with the same character"), first write a character sheet and lock it: face, hair, age, skin tone, outfit, accessories, and the product (for example the bag: colour, shape, strap, orientation).
- Generate every image from that sheet. Reuse the same reference image and seed where the model supports it.
- Check each image against the sheet. Regenerate any that drift, and report which ones were regenerated.
- If the person supplies a reference image, match its style and subject. Do not restyle it into another style (for example a cartoon) unless asked.

## 3. Websites and mock-ups
- Give a full page plan first: sections, content for each, and the order. Then build the page.
- Language lock: write everything in the language the person used. Never switch languages unless asked. Keep the same language for headings, buttons and body text.
- Design: minimalist by default. One accent colour, one or two fonts, generous spacing, clear hierarchy, mobile-first.
- Deliver a single self-contained HTML file. Preview it at phone (390px), tablet (768px) and desktop (1280px) before presenting it, and fix any layout problems first.

## 4. Behaviour rules for every task
- Follow the exact request. If the person says "lock the same character", that is a hard requirement.
- Say what was done and what was not possible.
- Ask before anything that spends money, sends a message or deletes data.

## 5. Order of work
1. Image editing from an upload (section 1)
2. Character-locked image sets (section 2)
3. Website mock-ups with language lock and minimalist design (section 3)
4. Connectors (not started)
5. ArtCraft (not started)
6. Pitch Agent (spec written; agent not built, see pitch_agent_matching_spec.md)

## 6. Where these go in the repo
- Put specs in a `docs/` folder as markdown, for example `docs/general-agent-spec.md` and `docs/pitch-agent-matching-spec.md`. They are reference documents, not code.
- The agent code itself goes in the existing `agent/` folder (the tools and jobs folders). Code changes there should follow these specs.

## 7. Reading a web page or a live chart
- When the person asks to pull, open or analyse a link (for example a TradingView page), fetch the page with the web-page tool and analyse what it actually returned. Never answer with a generated picture.
- Live chart pages are often rendered by scripts and block automated reading. If the page cannot be read, say so in one sentence and offer two options: a public market-data source, or the person attaches a screenshot of the chart. An attached screenshot is analysed with the "analyse" intent.
- Market analysis is information, not financial advice. State the data used, its time, and the uncertainty.
- Never generate a picture of data, a chart or a page unless the person asks for a new picture.
