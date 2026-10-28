'use strict';
module.exports = {
  name: 'qr_code',
  description: 'Make a QR code picture for a link, text, phone number or Wi-Fi details. The text is sent to the free QR service api.qrserver.com, so do not use it for secrets.',
  parameters: { type: 'object', properties: { data: { type: 'string', description: 'What the QR code should contain' } }, required: ['data'] },
  label: () => 'Making a QR code',
  run: async ({ data }) => {
    const d = String(data || '').trim(); if (!d) throw new Error('Tell me what the QR code should contain.'); if (d.length > 500) throw new Error('That is too long for a QR code (limit 500 characters).');
    return { text: 'QR code ready. It will be shown to the person automatically.', markdown: `![QR code](https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(d)})` };
  },
};
