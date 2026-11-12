import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONNECTORS, STATUS_LABELS, connectedIds, connectionsKey, connectorById, emptyConnections, isConnected, normalizeConnections, setConnected, statusLabel,
} from '../src/js/pages/connections-rules.js';
import { EXPORT_CONTENTS } from '../src/js/pages/settings-rules.js';

test('the catalogue: every service has a known status, a reason or a way in, and Gmail is the only one to connect', () => {
  assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length, 'no repeated id');
  for (const connector of CONNECTORS) {
    assert.ok(connector.status in STATUS_LABELS, `${connector.id}: ${connector.status}`);
    assert.ok(connector.label && connector.does, connector.id);
    if (connector.status !== 'connectable' && connector.status !== 'built-in') {
      assert.ok(connector.note, `${connector.id} says why it cannot be connected, or what comes next`);
    }
  }
  assert.deepEqual(CONNECTORS.filter((c) => c.status === 'connectable').map((c) => c.id), ['gmail']);
  assert.match(connectorById('gmail').asks, /cannot read your inbox/, 'what Gmail is asked for, in words');
  assert.match(connectorById('naukri').note, /no public job search API/);
  assert.equal(connectorById('naukri').status, 'unavailable');
  assert.equal(connectorById('linkedin').status, 'import');
  assert.equal(connectorById('linkedin').href, 'upload.html#linkedin');
  assert.equal(connectorById('custom').status, 'planned');
  assert.equal(connectorById('nope'), null);
});

test('connecting and disconnecting Gmail, without changing the state it was given', () => {
  const start = emptyConnections();
  const on = setConnected(start, 'gmail', true);
  assert.equal(isConnected(on, 'gmail'), true);
  assert.equal(isConnected(start, 'gmail'), false, 'the old state is untouched');
  assert.deepEqual(connectedIds(on), ['gmail']);
  assert.equal(statusLabel(connectorById('gmail'), on), 'Connected');
  assert.equal(statusLabel(connectorById('gmail'), start), 'Not connected');
  const off = setConnected(on, 'gmail', false);
  assert.deepEqual(off, { connected: {} });
  assert.equal(isConnected(off, 'gmail'), false);
});

test('a service that cannot be connected cannot be switched on, whatever the page asks', () => {
  const start = emptyConnections();
  for (const id of ['naukri', 'linkedin', 'job-boards', 'job-services', 'custom', 'nope', undefined]) {
    assert.equal(setConnected(start, id, true), start, String(id));
  }
  assert.deepEqual(['linkedin', 'job-boards', 'job-services', 'naukri', 'custom'].map((id) => statusLabel(connectorById(id), start)),
    ['Import only', 'Built in', 'Planned', 'Not available', 'Planned']);
});

test('stored state is cleaned: only a service that can be connected, and only true', () => {
  assert.deepEqual(normalizeConnections({ connected: { gmail: true, naukri: true, custom: true, ghost: true } }), { connected: { gmail: true } });
  assert.deepEqual(normalizeConnections({ connected: { gmail: 'yes' } }), emptyConnections());
  assert.deepEqual(normalizeConnections({ connected: { gmail: 1 } }), emptyConnections());
  for (const junk of [null, undefined, 'x', 3, [], {}, { connected: null }, { connected: 'gmail' }]) {
    assert.deepEqual(normalizeConnections(junk), emptyConnections(), JSON.stringify(junk));
  }
});

test('one key per account, shared by Settings and Letters, and the export says which apps were connected', () => {
  assert.equal(connectionsKey('u-1'), 'coverlay.preview.connections.u-1');
  assert.equal(connectionsKey(undefined), 'coverlay.preview.connections.guest');
  assert.ok(EXPORT_CONTENTS.some((line) => /apps you connected \(never their sign-in tokens\)/.test(line)));
});
