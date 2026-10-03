import { orientGlasses, projectVector, type imuTilt, type Vector3 } from './imu-vector';

/** Shared wireframe for the physical G2 image and the phone preview. */
export function drawTiltScene(ctx: CanvasRenderingContext2D, width: number, height: number,
  tilt: ReturnType<typeof imuTilt>, yaw = -.6, pitch = .42) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / 3.6, height / 3.1);
  const project = (v: Vector3) => {
    const [x, y, z] = projectVector(v, yaw, pitch);
    return [width / 2 + x * scale, height / 2 - y * scale, z];
  };
  const line = (a: Vector3, b: Vector3, gray: number, thickness = 1) => {
    const [x, y] = project(a), [ex, ey] = project(b);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = `rgb(${gray},${gray},${gray})`; ctx.lineWidth = thickness; ctx.stroke();
  };
  // Fixed world reference remains horizontal when the glasses tilt.
  ctx.setLineDash([3, 4]); line([-1.45, 0, 0], [1.45, 0, 0], 85); ctx.setLineDash([]);
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#bbb'; ctx.fillText(tilt ? 'TILT ESTIMATE / YAW --' : 'WAITING FOR VALID IMU', width / 2, 10);
  if (!tilt) return;
  const edges: { a: Vector3; b: Vector3; gray: number }[] = [];
  const add = (a: Vector3, b: Vector3, gray = 255) => edges.push({ a: orientGlasses(a, tilt), b: orientGlasses(b, tilt), gray });
  for (const side of [-1, 1]) {
    // Lens outlines, bridge and temples make pitch visible in a monochrome image.
    for (let i = 0; i < 24; i++) {
      const lens = (angle: number): Vector3 => [side * .56 + .43 * Math.cos(angle), .27 * Math.sin(angle), .5];
      add(lens(i * Math.PI / 12), lens((i + 1) * Math.PI / 12));
    }
    add([side, .08, .5], [side, .08, -.65], 187);
    add([side, .08, -.65], [side * .87, -.15, -.88], 187);
  }
  add([-.13, .07, .5], [.13, .07, .5]);
  // Forward/nose marker; avoids front/back ambiguity near a vertical pose.
  add([0, 0, .5], [0, 0, 1.05], 221);
  add([0, 0, 1.05], [-.1, 0, .86], 221); add([0, 0, 1.05], [.1, 0, .86], 221);
  edges.sort((a, b) => project(a.a)[2] + project(a.b)[2] - project(b.a)[2] - project(b.b)[2]);
  for (const edge of edges) line(edge.a, edge.b, edge.gray, 2);
  const [rx, ry] = project(orientGlasses([1.22, 0, .5], tilt));
  ctx.fillStyle = '#fff'; ctx.fillText('R', rx, ry);
}
