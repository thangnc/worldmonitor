// Shared Resend send path. Two layers:
// 1. scripts/lib/resend-send.cjs (Railway digest + relay workers): default
//    Reply-To and treating resend@4's resolved `{ error }` as a failure.
// 2. A static guard: the Railway workers never call `resend.emails.send`
//    directly.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_REPLY_TO, buildResendEmailPayload, sendResendEmail } = require('../scripts/lib/resend-send.cjs');

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    emails: {
      send: async (payload) => {
        calls.push(payload);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  return Promise.resolve(fn()).finally(() => { console.warn = warn; });
}

describe('scripts/lib/resend-send.cjs', () => {
  it('defaults Reply-To to support@ for brief@ and alerts@ senders', () => {
    assert.equal(DEFAULT_REPLY_TO, 'support@worldmonitor.app');
    for (const from of ['WorldMonitor Brief <brief@worldmonitor.app>', 'WorldMonitor <alerts@worldmonitor.app>']) {
      const payload = buildResendEmailPayload({ from, to: 'a@example.com', subject: 's', text: 't' });
      assert.equal(payload.replyTo, 'support@worldmonitor.app');
    }
  });

  it('an explicit replyTo wins, null omits it, and empty html is not sent', () => {
    const base = { from: 'x <x@worldmonitor.app>', to: 'a@example.com', subject: 's', text: 't' };
    assert.equal(buildResendEmailPayload({ ...base, replyTo: 'elie@worldmonitor.app' }).replyTo, 'elie@worldmonitor.app');
    assert.equal('replyTo' in buildResendEmailPayload({ ...base, replyTo: null }), false);
    assert.equal('html' in buildResendEmailPayload({ ...base, html: undefined }), false);
  });

  it('passes headers through when provided', () => {
    const payload = buildResendEmailPayload({
      from: 'x <x@worldmonitor.app>', to: 'a@example.com', subject: 's', text: 't',
      headers: { 'X-Test': '1' },
    });
    assert.deepEqual(payload.headers, { 'X-Test': '1' });
  });

  it('reports success with the Resend id', async () => {
    const client = fakeClient({ data: { id: 'email_1' }, error: null });
    const result = await sendResendEmail(client, { from: 'x', to: 'a@example.com', subject: 's', text: 't' });
    assert.deepEqual(result, { ok: true, id: 'email_1' });
    assert.equal(client.calls[0].replyTo, 'support@worldmonitor.app');
  });

  it('treats a resolved { error } as a failed send (resend@4 does not throw)', async () => {
    const client = fakeClient({ data: null, error: { name: 'validation_error', message: 'bad to' } });
    const result = await quiet(() => sendResendEmail(client, { from: 'x', to: 'bad', subject: 's', text: 't' }));
    assert.deepEqual(result, { ok: false, reason: 'rejected' });
  });

  it('treats a thrown error and a missing client as failures', async () => {
    const thrown = await quiet(() => sendResendEmail(fakeClient(new Error('socket hang up')), { from: 'x', to: 'a', subject: 's' }));
    assert.deepEqual(thrown, { ok: false, reason: 'error' });
    const missing = await quiet(() => sendResendEmail(null, { from: 'x', to: 'a', subject: 's' }));
    assert.deepEqual(missing, { ok: false, reason: 'no_client' });
  });
});

describe('every send goes through a shared helper', () => {
  it('Railway mail workers never call resend.emails.send directly', () => {
    for (const file of ['scripts/seed-digest-notifications.mjs', 'scripts/notification-relay.cjs']) {
      const src = readFileSync(join(root, file), 'utf8');
      assert.equal(/\bresend\.emails\.send\s*\(/.test(src), false,
        `${file} must send through scripts/lib/resend-send.cjs`);
      assert.match(src, /require\('\.\/lib\/resend-send\.cjs'\)/, `${file} must import the shared helper`);
    }
  });
});
