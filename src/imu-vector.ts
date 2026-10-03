export type Vector3 = [number, number, number];

/** Empirical mounting correction from right-ear-down (0.3, 1, 0).
 * This is a gravity hypothesis based on measured poses, not an SDK axis contract.
 */
export function imuTilt(x?: number, y?: number, z?: number) {
  const raw = imuVector(x, y, z);
  if (!raw || raw.magnitude < 1e-6) return null;
  const [nx, ny, up] = raw.direction;
  const scale = Math.hypot(1, .3);
  const down = (-nx + .3 * ny) / scale;
  const right = (.3 * nx + ny) / scale;
  const degrees = (v: number) => Math.asin(Math.max(-1, Math.min(1, v))) * 180 / Math.PI;
  // Independent axis inclinations, not sequential Euler angles.
  return { down, right, up, downDeg: degrees(down), rightDeg: degrees(right),
    gravity: [-right, up, -down] as Vector3 };
}

/** Minimal rotation from body-frame gravity to world up. No heading measurement.
 * Model axes: X wearer's right, Y up, Z forward. Positive down lowers the nose;
 * positive right lowers the right temple. No accumulated/integrated rotation.
 */
export function orientGlasses(point: Vector3, tilt: NonNullable<ReturnType<typeof imuTilt>>): Vector3 {
  const [gx, gy, gz] = tilt.gravity;
  const axis: Vector3 = [-gz, 0, gx]; // gravity cross world-up
  const sine = Math.hypot(...axis);
  if (sine < 1e-8) return gy >= 0 ? [...point] : [point[0], -point[1], -point[2]];
  const [ax, ay, az] = axis.map(v => v / sine);
  const [x, y, z] = point;
  const dot = ax * x + ay * y + az * z;
  return [
    x * gy + (ay * z - az * y) * sine + ax * dot * (1 - gy),
    y * gy + (az * x - ax * z) * sine + ay * dot * (1 - gy),
    z * gy + (ax * y - ay * x) * sine + az * dot * (1 - gy),
  ];
}

export function imuVector(x?: number, y?: number, z?: number) {
  if (![x, y, z].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const magnitude = Math.hypot(x!, y!, z!);
  if (!Number.isFinite(magnitude)) return null;
  const direction: Vector3 = magnitude === 0 ? [0, 0, 0] : [x! / magnitude, y! / magnitude, z! / magnitude];
  return { magnitude, direction };
}

/** Rotate the viewing camera, not the sensor reading. */
export function projectVector([x, y, z]: Vector3, yaw: number, pitch: number): Vector3 {
  const horizontal = x * Math.cos(yaw) + z * Math.sin(yaw);
  const depth = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [horizontal, y * Math.cos(pitch) - depth * Math.sin(pitch), y * Math.sin(pitch) + depth * Math.cos(pitch)];
}
