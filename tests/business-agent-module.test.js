'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const business = require('../agents/business');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

test('Business Agent module has the canonical identity and is enabled for authenticated read-only analysis', () => {
  assert.equal(business.id, 'business');
  assert.equal(business.label, 'Business Agent');
  assert.equal(business.implemented, true);
  assert.deepEqual(business.tools, []);
  assert.ok(business.instructions.trim().length > 100);
});

test('Business Agent instructions enforce core accounting distinctions', () => {
  const rules = business.instructions.toLowerCase().replace(/\s+/g, ' ');
  for (const phrase of [
    'startup capital',
    'operating revenue',
    'cash balance',
    'net operating profit',
    'loan principal',
    'interest received',
    'savings',
    'currency',
    'confirmation',
    'workspace'
  ]) {
    assert.ok(rules.includes(phrase), `Missing required business rule: ${phrase}`);
  }
});

test('Business Agent does not assume every business is a lender', () => {
  assert.match(business.instructions, /optional and individually\s+configurable/i);
  assert.match(business.instructions, /never assume the business is a lender/i);
});

test('Business Agent context is gated by verified workspace membership and is read-only', () => {
  assert.match(server, /async function loadBusinessContext/);
  assert.match(server, /workspace_members\?select=role/);
  assert.match(server, /if \(agentId === 'business'\)/);
  assert.match(server, /who\.kind !== 'user'/);
  assert.match(server, /meta\.businessContext = await loadBusinessContext/);
  assert.match(business.instructions, /read-only/i);
});

test('Business Agent context includes only the selected project and its configured business type', () => {
  assert.match(server, /fetchAllBusinessRows/);
  assert.match(server, /currency_summaries/);
  assert.match(server, /business_type_definition/);
  assert.match(server, /operational_totals/);
  assert.match(server, /business_project_records/);
  assert.match(server, /history_truncated_at_safety_limit/);
  assert.match(server, /project_id: 'eq\.' \+ selected\.id/);
  assert.match(business.instructions, /business_type_definition/);
  assert.match(business.instructions, /every new transaction/);
});

test('legacy receipts are not assumed to be new operating revenue', () => {
  assert.match(server, /e\.kind == null && e\.entry_type === 'receipt'/);
  assert.match(business.instructions, /legacy receipt with no explicit accounting kind/i);
});

test('Business Agent transaction reads cannot fall back to workspace-wide portfolio data', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261111202822_require_project_scoped_business_transaction_reads.sql',
    'utf8'
  );
  assert.match(migration, /IF p_project IS NULL THEN[\s\S]*?RAISE EXCEPTION/i);
  assert.match(migration, /le\.project_id = p_project/i);
  assert.match(migration, /le\.workspace_id = p_workspace/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.business_list_transactions[\s\S]*?FROM PUBLIC, anon/i);
});

test('Business Agent project mutation and approval RPCs are not anonymously executable', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261111202806_business_agent_project_rpc_permissions.sql',
    'utf8'
  );
  for (const fn of [
    'add_slip', 'agreements_for_project_month', 'create_agreement_for_project',
    'create_business', 'decide_agent_action', 'delete_upload',
    'restore_upload', 'request_agent_action'
  ]) {
    assert.match(migration, new RegExp('REVOKE ALL ON FUNCTION public\\.' + fn + '[\\s\\S]*?FROM PUBLIC, anon', 'i'));
  }
});

test('Fashion is a first-class business type with its own retail dashboard metrics', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261111203440_add_fashion_business_type_and_project_metrics.sql',
    'utf8'
  );
  assert.match(migration, /'fashion','Fashion and clothing retail'/);
  assert.match(migration, /'sales','inventory','orders','payables','receivables','reports'/);
  assert.match(migration, /when 'fashion' then business_metrics/);
  for (const metric of [
    'sales_revenue', 'refunds', 'discounts',
    'net_sales_after_refunds_and_discounts', 'cost_of_goods_recorded',
    'gross_profit_on_recorded_cost', 'orders_recorded',
    'stock_on_hand_value', 'stock_on_hand_quantity'
  ]) {
    assert.ok(migration.includes("'" + metric + "'"), 'Missing fashion metric: ' + metric);
  }
});
