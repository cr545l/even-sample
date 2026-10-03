import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNativeHost, describeImuReply } from '../src/native-host.ts';

test('SDK JS readiness alone is not a native host connection', () => {
  assert.equal(hasNativeHost({ EvenAppBridge: { ready: true } }), false);
  assert.equal(hasNativeHost({ flutter_inappwebview: {} }), false);
  assert.equal(hasNativeHost({ flutter_inappwebview: { callHandler: () => {} } }), true);
  assert.equal(hasNativeHost(null), false);
});
test('An IMU failure preserves the actual reply instead of inventing a cause', () => {
  assert.match(describeImuReply(false), /false/);
  assert.match(describeImuReply({ code: 'unsupported' }), /unsupported/);
  assert.match(describeImuReply(true), /승인/);
});
