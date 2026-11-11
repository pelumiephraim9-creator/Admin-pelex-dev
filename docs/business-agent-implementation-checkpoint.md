# Pelex Business Agent — Implementation Checkpoint

Last updated: 2026-11-11 (UTC)

## Approved architecture — locked acceptance standard

Every selected business type is a separate business project. The same core project architecture applies to all supported types, while each type uses its own enabled modules, operational record types, calculations, reports and dashboard metrics.

1. One project = one business.
2. Every ledger transaction, upload, agreement, operational record, device, payment connection/event, agent action, knowledge item and meeting note must belong to one project.
3. Every project-scoped operation must validate both project ID and workspace ID.
4. Monthly and lifetime reporting must be limited to the selected project and its reporting currency.
5. Business-specific calculations must follow the selected business type and enabled modules; do not force every business into lending or supermarket logic.
6. Isolation is enforced in the database, backend RPCs, APIs and frontend selectors—not only by UI filters.
7. Do not recreate the cleared Business Agent test workspace or test uploads. Do not alter unrelated agents or their data.

## Repositories and live project

- Frontend: `pelumiephraim9-creator/Uncle_Pelex_Agent`
- Backend: `pelumiephraim9-creator/Admin-pelex-dev`
- Supabase project ref: `lmqcbiiggcgppwfonlpn`
- Backend foundation PR #5 was previously merged into `main`.
- Both repositories are being updated directly on `main`, consistent with the user's explicit workflow preference.

## Verified live database state

- 18 business types are in `public.business_types`.
- 17 types have explicit business-specific dashboard branches; `general` uses the generic fallback.
- Types include general, finance, savings_cooperative, retail_store, supermarket, wholesale, manufacturing, restaurant, pharmacy, hospitality, real_estate, transport, services_agency, education, ecommerce, agriculture, construction and fashion.
- Project-scoped tables have non-null project IDs and composite project/workspace constraints for ledger entries, uploads, agreements, operational records, devices, pairing codes, agent actions, business knowledge, meeting notes, payment connections and payment events.
- RLS is enabled on the core project tables.
- `business_list_transactions` now rejects a null project and returns only rows with the exact requested workspace and project.
- `payment_events.workspace_id` is now NOT NULL so its composite project/workspace foreign key cannot be bypassed by a null workspace ID.
- The inspected test workspace is empty: zero business projects, operational records, ledger entries, agreements, uploads and payment events. Do not populate it as part of verification.
- Supabase security advisor's anonymous SECURITY DEFINER warning count dropped from 37 to 21. The remaining Business Agent anonymous function is `redeem_pairing_code`, intentionally public for one-time device pairing; device ingest and payment webhook endpoints also intentionally use token authentication. Other advisories include unrelated tables/functions and must not be changed casually.

## Changes applied and committed

### Supabase migrations

- `20261111202806_business_agent_project_rpc_permissions`
  - Removed anonymous/public execution from project mutations, approvals, upload deletion/restoration, project agreement operations, business creation/listing and project action requests.
- `20261111202822_require_project_scoped_business_transaction_reads`
  - Disallowed workspace-wide transaction listing; requires a valid project and filters by both workspace and project.
- `20261111203206_business_project_schema_integrity_reconciliation`
  - Verified the deployed project architecture and made payment event workspace scope mandatory.
- `20261111203239_business_project_device_pairing_permissions`
  - Pairing-code creation is authenticated-only; one-time redemption remains public by design.
- `20261111203310_restrict_deleted_upload_purge_to_service_role`
  - Scheduled upload purge is service-role-only.
- `20261111203440_add_fashion_business_type_and_project_metrics`
  - Added Fashion and Clothing Retail with sales, inventory, orders, payables, receivables and reports modules, plus fashion-specific dashboard metrics.
- `20261111203553_fashion_order_revenue_and_refund_metrics`
  - Added online order revenue, order refunds and net order revenue metrics.

Historical project foundation SQL files `20261111110000` through `20261111110800` are present in the backend repository and the corresponding live schema objects were verified, but those older versions are absent from Supabase's migration history. The reconciliation migration records and asserts the live baseline; do not blindly replay the old migrations because some are not safely repeatable.

### Frontend

- Removed the workspace-wide “All projects” option from the transaction register.
- Stale local storage value `all` is normalized to a valid project selection.
- Transaction register sends an explicit project ID to the RPC.
- Dashboard no longer presents a workspace-wide portfolio fallback.
- Fashion order fulfilments are rendered as a count metric.

### Backend tests

Added regression tests for project-scoped transaction reads, anonymous RPC permission restrictions, Fashion type registration and Fashion dashboard metrics.

## Current verification status

- Supabase changes above were applied successfully and key permissions, schema, project filters and Fashion dashboard branches were re-queried.
- Frontend main before this checkpoint: `133f27687adfd3597a87f50e83e59d3b1a02d43d`.
- Backend main before this checkpoint: `ad64cc40d6439c7601e24b68aefe2016d8dae337`.
- GitHub Actions runs were created for the backend changes but remained QUEUED at last inspection. Do not report tests as passed until a completed run has a successful conclusion.
- A local clone/test run was not possible because the container could not resolve github.com.
- A commit to main does not by itself prove the Netlify frontend or Render backend has deployed. Confirm deployment separately.

## Remaining work — resume here

1. **Wait for CI**: inspect the latest Backend checks and Business Agent backend checks. Resolve any failures before moving on.
2. **End-to-end browser verification**: create ephemeral test projects only in an isolated test environment (never the cleared production test workspace); verify create/switch/edit project, transaction entry, upload, record confirmation, dashboard, monthly drill-down, currency guard and project switching.
3. **All 18 business types**: verify every type's setup fields, enabled modules, allowed record types, dashboard metrics and monthly reports. Include lending, supermarket, restaurant, fashion, retail, wholesale, manufacturing, pharmacy, hospitality, property, transport, agency, education, ecommerce, agriculture, construction, savings cooperative and general.
4. **Business-specific entry UX**: the existing operational entry form is a flexible module-driven form. It still needs a full review to ensure each business type gets the appropriate labels, fields, validation and workflow (e.g. fashion SKU/size/colour, restaurant menu/food cost, supermarket SKU/barcode and stock, manufacturing batch costing, bookings/occupancy, etc.).
5. **File ingestion**: verify actual PDF, image, spreadsheet and document extraction end to end. The database already binds each upload and confirmed row to the selected project, but document extraction/readability must be independently tested and repaired where needed.
6. **Project membership**: current authorization is primarily workspace-membership based. Determine whether every workspace member should access every project or whether separate businesses require a project-members table and project-level roles. Do not claim member-level isolation between sibling projects until this is resolved.
7. **Audit and history**: review legacy workspace-wide audit/history surfaces (including `audit_log` and `upload_audit`) and ensure project views cannot show sibling-project activity.
8. **Deployment confirmation**: confirm Netlify frontend deployment and Render backend health after the relevant main commits.
9. **Regression protection**: verify Personal, General, Pitch, Mailbot and other agents remain unchanged.

## Important working rules

- Do not ask the user to paste repository contents; inspect the repositories directly.
- Do not overwrite unrelated code or data.
- Do not recreate the cleared test workspace.
- Do not mark the Business Agent complete based only on migrations or commits. Completion requires successful CI and end-to-end checks across the supported business types.


## Frontend audit follow-up — 2026-11-11

The Business Agent setup/dashboard frontend was re-audited after reports that the business type selector was blank and the volume/pie charts were not visible.

### Corrections committed to frontend main

- The business type catalogue is loaded independently of workspace creation and sign-in state (the catalogue has a public-read policy and currently contains 18 supported business types). This prevents a blank type selector for a new account or an account without a workspace.
- The project setup card is mounted directly inside Business Agent immediately after the Workspace & team access card. Its insertion anchor uses the stable workspace body element, not a heading label, so copy changes cannot move the setup card above/below the wrong section.
- Workspace is explicitly described as a team container; individual businesses are created as separate business projects below it.
- Project create and edit now use the same validated `save_setup_project_v3` RPC. It checks authenticated workspace edit access, duplicate names, and prevents changing business type/currency after records exist.
- Monthly dashboard charts now include transaction volume, transaction mix and operational activity mix. Ledger chart data is fetched through `business_list_transactions` with both workspace and selected project IDs plus the selected reporting-month date range. Operational mix comes from the selected-project dashboard summary. No workspace-wide chart fallback is used.
- Empty states are shown before a project is selected or when a project has no activity. Month-end calculations use local calendar dates to avoid UTC+ timezone shifts.
- The old workspace-wide setup card remains retired; external duplicate Project Management/Data Entry navigation remains removed.

### Remaining verification (not yet complete)

- The static frontend has been committed to GitHub main, but live Netlify deployment and browser-based create/edit/project-switch/chart rendering have not yet been confirmed. GitHub combined commit status returned no status entries; do not report CI as passing.
- The operational entry form still needs a full business-type-specific field/validation UX pass beyond the currently supported module and record-type rules.
- File extraction/import still requires end-to-end PDF, image, spreadsheet and office-document tests.
- Project-level membership roles remain outstanding; workspace membership currently governs access to sibling projects.
- Do not create test data in the cleared production workspace. Use an isolated test environment for end-to-end tests.
