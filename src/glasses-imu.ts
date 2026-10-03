import { imuTilt } from './imu-vector';
import { drawTiltScene } from './tilt-scene';

export const IMU_IMAGE_WIDTH = 288;
export const IMU_IMAGE_HEIGHT = 144;

/** A real grayscale frame for the glasses image container, not just a DOM view. */
export function createGlassesImuFrame(canvas: HTMLCanvasElement) {
  canvas.width = IMU_IMAGE_WIDTH;
  canvas.height = IMU_IMAGE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('안경 이미지 생성용 Canvas를 사용할 수 없습니다.');
  const ctx = context;
  return (x?: number, y?: number, z?: number): Uint8Array => {
    drawTiltScene(ctx, canvas.width, canvas.height, imuTilt(x, y, z));
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Gray8 accepted by the SDK/host; quantize to the glasses' 16 levels.
    const gray8 = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < gray8.length; i++) gray8[i] = Math.round(rgba[i * 4] / 17) * 17;
    return gray8;
  };
}
