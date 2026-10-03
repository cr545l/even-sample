/** SDK format: signed PCM16 little-endian, mono, 16 kHz. */
export function analyzePcm(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  let sumSquares = 0;
  let peak = 0;
  const preview: number[] = [];
  for (let i = 0; i < samples; i++) {
    const value = view.getInt16(i * 2, true);
    const normalized = value / 32768;
    sumSquares += normalized ** 2;
    peak = Math.max(peak, Math.abs(normalized));
    if (preview.length < 16) preview.push(value);
  }
  const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
  return { samples, bytes: bytes.byteLength, durationMs: samples / 16,
    rms, peak, dbfs: rms > 0 ? 20 * Math.log10(rms) : null,
    preview, trailingBytes: bytes.byteLength % 2 };
}

export function valueText(value: unknown, digits = 3): string {
  if (value === undefined || value === null) return '미수신';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : '미수신';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

export function gestureType(input?: { eventType?: number; imuData?: unknown }): number | null {
  if (!input || input.imuData || input.eventType === 8) return null;
  // Zero-valued CLICK_EVENT may be omitted by SDK protobuf normalization.
  const type = input.eventType ?? 0;
  return [0, 1, 2, 3, 9, 10].includes(type) ? type : null;
}

export function sourceText(source?: number): string {
  return ({ 1: '오른쪽 안경 다리', 2: 'R1 링', 3: '왼쪽 안경 다리' } as Record<number, string>)[source ?? 0] ?? '미제공';
}
