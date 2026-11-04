# Pitch Agent: matching strategy (backend spec)

Owner's direction: years of experience should not lock a person into small companies. Target size depends on how strong the person is as a professional, shown by track record, skills, portfolio and results. Years are one signal, not the rule.

## 1. Build a candidate strength profile first
Score the person 0 to 100 from:
- Track record: shipped projects, measurable results, client reviews, portfolio quality (weight 35)
- Skill depth in the field: tools, certifications, specialisms (weight 25)
- Experience: years, and the size of the work handled (weight 20)
- Availability and fit: work mode, location, approved countries, rate expectations (weight 10)
- Communication: quality of the person's own tone samples and CV (weight 10)

Store `strength_score` on the pitch profile. It updates when the portfolio or CV changes.

## 2. Revenue floor and currency (owner's rule)
- Target companies that make **$5,000 per month or more** (about 60,000 USD a year). Anything above that is in range, with no upper cap.
- Nigeria anchor: **5,000,000 naira per month or more**.
- Other countries: convert the $5,000 floor to that country's currency at the current rate when the search runs. Store the currency, the rate and its date.
- The agent may look below the floor when a strong, specific match exists. Mark it Safe and state the revenue it found.
- Revenue figures are estimates from public sources. Always store the source. Where the company only publishes yearly figures, convert them to a monthly figure and say so.

## 2a. Each person gets their own jobs
- The agent is not a single shared feed. Each person's shortlist is built for that person alone.
- Keep a record of which jobs were shown to which person. Never show the same role to two people in the same cycle, and prefer jobs nobody else has been shown.
- Millions of roles exist across the sources. Search widely and rank for each person, so the shortlist stays distinct per person.

## 2b. Target tiers, not one band
Every candidate job gets one of three tiers, based on the strength score and the company's verified size:
- **Stretch** (aim high): a larger company or contract that the person's score supports. Ask for a fuller summary and mark the risk.
- **Fit** (the core target): the company size matches the person's level. This is most of the daily shortlist.
- **Safe** (reliable): a smaller or early-stage company with a clear need. Useful when a stretch is not yet realistic.
The tier is set by the score, not by years alone. A two-year candidate with a strong portfolio can reach Stretch contracts; five to six years and above with proof of results is expected at the larger end. All tiers respect the $5,000-a-month floor, except Safe matches that are clearly justified.

## 3. Company signals, from public information only
Use what is verifiable and always store the source:
- Revenue or funding announcements; reported headcount; hiring pace (open roles over time)
- Recent news, product launches, press
- For contract or freelance work: the posted budget or project value. Store it as stated.
If size cannot be verified, store `revenue_band = "Not verified"`. Never invent a figure.

## 4. Find the direct application link
- Start from the company, not a job board. Job boards are used only to discover companies.
- Open the company's own careers page. Use the direct link it published: its own site or its applicant-tracking page (Greenhouse, Lever, Ashby, Workable and similar).
- Set `direct_link_verified = true` only after the page loads and shows the role. Aggregator links are never the application link.

## 5. Check eligibility
- Compare the posting's location and remote rules with the person's approved countries. Drop jobs that exclude the person.

## 6. Build the proposal
- `match_score` (0 to 100) and `target_tier` (Stretch, Fit or Safe), with the reasons for each.
- `company_summary`: what the company does and why it is doing well, with sources.
- `pros` and `cons`: why it fits, and the real risks, including a Stretch risk note where relevant.
- `prep_tips`: what to read, prepare and rehearse before the interview.
- `qualities`: what this employer is looking for.
- `subject` and `body`: the email in the person's tone.
- Status stays `pending` until the person approves.

## 7. Daily rhythm (strategy)
- Keep a balanced shortlist each day: a few Fit, one or two Stretch, and a Safe option when the pipeline is thin.
- Track the mix over time. If nothing gets replies, move the mix toward Fit and tighten the email. If replies come but no interviews, work on the prep tips and the portfolio.
- Show the person their weekly results: found, sent, replies, interviews, and the tier that converts best.

## 8. Approval and hand-off
- Nothing is sent without approval: approve, redraft the tone, or skip.
- On approval, write to `gmail_outbox` (subject, body, direct link). The Gmail Bot sends from the chosen account, with the portfolio attached.

## 9. Standards for every agent
- Cite sources for every claim, and label estimates.
- Ask before anything sends a message, spends money or changes data.
- Log each search so the person can see what was checked and why a job was chosen.
