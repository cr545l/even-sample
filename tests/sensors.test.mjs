import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcm, gestureType, sourceText, valueText } from '../src/sensors.ts';

test('PCM16 decodes signed little-endian values including full negative scale', () => {
  const stats = analyzePcm(new Uint8Array([0, 128, 255, 127, 0, 0]));
  assert.deepEqual(stats.preview, [-32768, 32767, 0]);
  assert.equal(stats.peak, 1); assert.equal(stats.samples, 3); assert.equal(stats.durationMs, 3 / 16);
  assert.ok(Math.abs(stats.rms - Math.sqrt((1 + (32767 / 32768) ** 2) / 3)) < 1e-10);
});
test('PCM respects byteOffset, silence and an incomplete trailing byte', () => {
  const stats = analyzePcm(new Uint8Array([255, 255, 0, 0, 8]).subarray(2));
  assert.equal(stats.rms, 0); assert.equal(stats.dbfs, null); assert.equal(stats.trailingBytes, 1);
  assert.deepEqual(analyzePcm(new Uint8Array()).preview, []);
});
test('Zero and false are real readings, not missing data', () => {
  assert.equal(valueText(0), '0'); assert.equal(valueText(false), '아니오');
  assert.equal(valueText(undefined), '미수신'); assert.equal(valueText(null), '미수신');
});
test('IMU and lifecycle events never become taps; normalized zero remains a tap', () => {
  assert.equal(gestureType(), null); assert.equal(gestureType({ imuData: { x: 0 } }), null);
  assert.equal(gestureType({ eventType: 8 }), null); assert.equal(gestureType({ eventType: 5 }), null);
  assert.equal(gestureType({}), 0); assert.equal(gestureType({ eventType: 10 }), 10);
  assert.equal(sourceText(2), 'R1 링'); assert.equal(sourceText(undefined), '미제공');
});
