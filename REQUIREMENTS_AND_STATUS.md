# Pelex requirements and status (source note, 30 Oct 2026)

## Rules
- Wire the front end once; backend changes thereafter.
- Only Ads should say "Coming soon"; unfinished features should show readiness status.
- Build order: general agent, Business, Pitch, Gmail, Personal.
- Keep responses dynamic and professional: analyse, advise, warn, and give a reasoned view.

## Reported completed items
- Search analysis with advice, advantages, disadvantages, warnings, and sources.
- Weather cards and real-image search.
- Image generation providers: Cloudflare, Together, Hugging Face, Gemini; Pollinations disabled unless IMAGE_ALLOW_WATERMARK=1.
- Slash-command interpretation and typo handling.
- Job sharing and legitimacy checks (requires job_distribution.sql).
- Pitch link checking and scheduled-task screen/worker (deployment must be verified).
- Gmail drafting workflow; inbox features depend on Google approval.
- Image creation and reference-image screens.
- Model fallback for Groq 404 and session memory.

## Still to build (per source note)
1. Business agent implementation.
2. Pitch agent daily job hunt.
3. Gmail agent after Google approval.
4. Personal agent.
5. Converters.
6. Paystack payments.
7. Telegram and WhatsApp channels, Projects redesign, and ArtCraft integration.

## Supabase migration notes
The source requirements list groups.sql, pelex_update_oct26.sql, public_agent.sql, media_storage.sql, job_distribution.sql, welcome_email.sql, and add_testers.sql. welcome_email.sql was not supplied; do not fabricate it. scheduler_v2.sql is separate and requires checking the existing scheduled_tasks schema before execution.
