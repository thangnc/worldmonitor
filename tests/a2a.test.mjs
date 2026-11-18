import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

const CARD_PATH = join(ROOT, 'public/.well-known/agent-card.json');
const SERVER_CARD_PATH = join(ROOT, 'public/.well-known/mcp/server-card.json');

const card = JSON.parse(readFileSync(CARD_PATH, 'utf-8'));
const serverCard = JSON.parse(readFileSync(SERVER_CARD_PATH, 'utf-8'));

// Guards for the published A2A agent card at /.well-known/agent-card.json.
// The /a2a JSON-RPC endpoint was removed in Lite Phase 1c; the card leaves
// with the public discovery docs in a later PR.
describe('a2a: agent card contract', () => {
  it('carries the required A2A v0.3.0 fields', () => {
    assert.equal(card.protocolVersion, '0.3.0');
    assert.ok(card.name && typeof card.name === 'string');
    assert.ok(card.description && card.description.length > 50, 'description must be substantive');
    assert.equal(card.url, 'https://www.worldmonitor.app/a2a');
    assert.equal(card.preferredTransport, 'JSONRPC');
    assert.ok(card.version && typeof card.version === 'string');
    assert.ok(Array.isArray(card.defaultInputModes) && card.defaultInputModes.length > 0);
    assert.ok(Array.isArray(card.defaultOutputModes) && card.defaultOutputModes.length > 0);
  });

  it('advertises the deployed JSON-RPC service in supportedInterfaces', () => {
    assert.ok(Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0);
    assert.deepEqual(card.supportedInterfaces, [{
      url: 'https://www.worldmonitor.app/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '0.3',
    }]);
    assert.equal(card.supportedInterfaces[0].url, card.url);
    assert.equal(card.supportedInterfaces[0].protocolBinding, card.preferredTransport);
  });

  it('declares capabilities honestly: no streaming, no push notifications, no tasks', () => {
    assert.equal(card.capabilities.streaming, false);
    assert.equal(card.capabilities.pushNotifications, false);
    assert.equal(card.capabilities.stateTransitionHistory, false);
    assert.equal(card.supportsAuthenticatedExtendedCard, false);
  });

  it('every skill has id, name, description, and tags', () => {
    assert.ok(Array.isArray(card.skills) && card.skills.length >= 2);
    for (const skill of card.skills) {
      assert.ok(skill.id, 'skill missing id');
      assert.ok(skill.name, `${skill.id} missing name`);
      assert.ok(skill.description && skill.description.length > 0, `${skill.id} missing description`);
      assert.ok(Array.isArray(skill.tags) && skill.tags.length > 0, `${skill.id} missing tags`);
    }
  });

  it('shares branding with the MCP server card (same icon)', () => {
    assert.equal(card.iconUrl, serverCard.icon);
  });
});
