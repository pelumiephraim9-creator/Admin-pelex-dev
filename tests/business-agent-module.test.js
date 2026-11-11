'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const business = require('../agents/business');

test('Business Agent module has the canonical identity and is enabled for authenticated read-only analysis', () => {
  assert.equal(business.id, 'business');
  assert.equal(business.label, 'Business Agent');
  assert.equal(business.implemented, true);\n  assert.deepEqual(business.tools, []);
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
