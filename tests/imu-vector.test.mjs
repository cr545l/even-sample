import test from 'node:test';
import assert from 'node:assert/strict';
import { imuVector, projectVector, imuTilt, orientGlasses } from '../src/imu-vector.ts';

test('Measured poses map to the expected calibrated tilt', () => {
  assert.equal(imuTilt(0, 0, 1).downDeg, 0);
  for (const side of [-1, 1]) {
    const tilt = imuTilt(.3 * side, side, 0);
    assert.ok(Math.abs(tilt.downDeg) < 1e-6);
    assert.ok(Math.abs(tilt.rightDeg - side * 90) < 1e-5);
    assert.ok(Math.abs(orientGlasses([1, 0, 0], tilt)[1] + side) < 1e-6);
  }
  const down = imuTilt(-.9, .2, 0);
  assert.ok(down.downDeg > 85 && Math.abs(down.rightDeg) < 5);
  assert.ok(orientGlasses([0, 0, 1], down)[1] < -.99);
  const up = imuTilt(.5, -.2, .8);
  assert.ok(up.downDeg < -30 && Math.abs(up.rightDeg) < 4);
});

test('Tilt rotation aligns gravity with world up and preserves model geometry', () => {
  for (const sample of [[0, 0, 1], [-.9, .2, 0], [.3, 1, 0], [.5, -.2, .8], [0, 0, -1], [.1, .2, -.9]]) {
    const tilt = imuTilt(...sample);
    const up = orientGlasses(tilt.gravity, tilt);
    assert.ok(Math.hypot(up[0], up[1] - 1, up[2]) < 1e-8);
    assert.ok(Math.abs(Math.hypot(...orientGlasses([1, 2, 3], tilt)) - Math.sqrt(14)) < 1e-8);
  }
  assert.equal(imuTilt(0, 0, 0), null);
  assert.equal(imuTilt(1, 2), null);
  assert.equal(imuTilt(Infinity, 0, 1), null);
});

test('Direction preserves signed ratios independently of sensor magnitude', () => {
  const vector = imuVector(3, -4, 0);
  assert.equal(vector.magnitude, 5);
  assert.deepEqual(vector.direction, [0.6, -0.8, 0]);
  assert.deepEqual(imuVector(30, -40, 0).direction, vector.direction);
});
test('Missing axes and a zero vector have distinct states', () => {
  assert.equal(imuVector(1, 2), null);
  assert.equal(imuVector(NaN, 2, 3), null);
  assert.deepEqual(imuVector(0, 0, 0), { magnitude: 0, direction: [0, 0, 0] });
});
test('Camera rotation preserves vector length and handles depth', () => {
  const rotated = projectVector([1, 2, 3], .8, -.4);
  assert.ok(Math.abs(Math.hypot(...rotated) - Math.sqrt(14)) < 1e-10);
  const [x, y, z] = projectVector([0, 0, 1], Math.PI / 2, 0);
  assert.ok(Math.abs(x - 1) < 1e-10 && Math.abs(y) < 1e-10 && Math.abs(z) < 1e-10);
});
