import { imuTilt } from './imu-vector';
import { drawTiltScene } from './tilt-scene';

/** Small orthographic 3D renderer; works without WebGL or external assets. */
export function createImuView(canvas: HTMLCanvasElement, caption: HTMLElement, reset: HTMLButtonElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    caption.textContent = '이 브라우저에서는 Canvas를 사용할 수 없습니다.';
    return { update: (_x?: number, _y?: number, _z?: number) => {}, dispose: () => {} };
  }
  const context = ctx;
  const initialYaw = -0.6;
  const initialPitch = 0.42;
  let yaw = initialYaw;
  let pitch = initialPitch;
  let value: ReturnType<typeof imuTilt> = null;
  let pointer: { id: number; x: number; y: number } | undefined;
  let width = 300;
  let height = 260;
  const controller = new AbortController();
  const options = { signal: controller.signal };

  function draw() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth; height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTiltScene(context, width, height, value, yaw, pitch);
  }
  function restore() { yaw = initialYaw; pitch = initialPitch; draw(); }
  reset.addEventListener('click', restore, options);
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }, options);
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    yaw += (event.clientX - pointer.x) * .012;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.clientY - pointer.y) * .012));
    pointer.x = event.clientX; pointer.y = event.clientY; draw();
  }, options);
  const release = () => { pointer = undefined; };
  canvas.addEventListener('pointerup', release, options);
  canvas.addEventListener('pointercancel', release, options);
  canvas.addEventListener('lostpointercapture', release, options);
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { restore(); return; }
    yaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0)));
    draw();
  }, options);
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  return {
    update(x?: number, y?: number, z?: number) {
      value = imuTilt(x, y, z);
      caption.textContent = value
        ? `추정 기울기 · 숙임(+) ${value.downDeg.toFixed(1)}° · 오른쪽(+) ${value.rightDeg.toFixed(1)}° · 수평 회전 미측정`
        : '유효한 중력 방향 수신 대기 (0 벡터는 자세를 추정할 수 없음)';
      draw();
    },
    dispose() { controller.abort(); observer.disconnect(); },
  };
}
