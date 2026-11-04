# Business Workspace: spec (decisions agreed with the owner)

## 1. Team and access
- One owner per business workspace. The owner can invite up to 3 more people, so a workspace has 1 to 4 people.
- New members are **Viewers** by default: they see charts and reports only.
- The owner can promote a member to **Editor** (can upload and enter data). Only the owner can invite, promote, demote, or remove anyone, and only the owner can change billing.
- An invitation is an invite code. Recommended format: `Workspace-` followed by at least 10 random characters (for example `Workspace-6GSV8QK2PD`). The 4-character form is too easy to guess. Codes expire after 7 days, can be revoked, and are single-use.
- A person must sign in and accept an invitation before they see anything.

## 2. Uploads (any data, auto-detected)
- Accepted files for this phase: CSV, XLSX, PDF, PNG, JPG. Maximum size: **10 MB per file**. Larger files are rejected with a clear message.
- Pelex detects the type from the file's content: invoice, receipt, sales sheet, expense log, or other data. It lists the fields it found and a confidence level.
- **Nothing is saved until the uploader confirms** the detected type and each detected field. This is mandatory.
- Anything Pelex cannot read clearly goes to a review list. It is never saved silently.
- Only Owners and Editors can upload. Viewers cannot.

## 3. Currency
- If every record in an upload is in one currency, that currency is used.
- If records use more than one currency, Pelex stops and shows a currency picker. The owner chooses the reporting currency before final results appear.
- Each record keeps its original currency and the conversion rate and date used.
- Naira and dollar symbols can be ambiguous, so the detected currency is always shown for confirmation.

## 4. Report view (for board meetings)
- A read-only page with only the charts and summary figures the owner selects. It never shows the ledger, customer names, the inbox, or chats.
- The owner can create a Report view link. It can expire, can be revoked, and cannot be edited by viewers.
- Recommended in meetings: share only the Report view window, not the whole screen. Pelex cannot stop a whole-screen share, so the owner should use the device's window picker.

## 5. Calls and notes (owner turns it on)
- Call integrations are **off by default**. The owner turns each one on in the workspace.
- First integration: **Zoom**. Google Meet and Microsoft Teams can follow when they are approved.
- Maximum call length for notes: **2 hours**. The recording stops automatically at 2 hours.
- Output the owner can choose, one or more:
  - **Recording** (audio or video, as the platform provides it)
  - **Audio recap** (a short spoken summary)
  - **PDF** (summary, decisions, action items)
  - **Digital notes** (structured notes in the app)
- Before a recording or transcript starts, every participant must be told it is being recorded and transcribed. Pelex shows this notice and the owner confirms it.

## 6. Keeping notes (retention)
- Notes are kept for **7 days** from creation, unless the owner downloads them.
- If the owner has not downloaded a note by day 7, it is deleted automatically. Pelex warns the owner on day 5.
- Once a note has been downloaded, it is kept until the owner deletes it.
- An **Archive** lists previous meetings, each with its available outputs (recording, audio recap, PDF, digital notes), its date, and its download state. Previously downloaded records can be opened again from the archive.

## 7. Privacy and policy
- The privacy policy and terms must cover workspace members, business data uploads, call recordings and transcripts, the 2-hour limit, and the 7-day rule.
- Two-step approval applies to every change that alters records or sends anything, as set out in the policies.

## 8. Order of work
1. Phase 1 (front end, this round): workspace card, invite and role display, upload card with confirmation, currency picker, meetings and notes card with archive.
2. Phase 2 (backend): workspace tables and permissions, invite codes, upload storage and detection, ledger.
3. Phase 3: Report view link and sharing.
4. Phase 4: Zoom connection, recordings, notes, deletion and reminder jobs.
