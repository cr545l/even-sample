/** SDK readiness only signals JS/DOM initialization, not a native connection. */
export function hasNativeHost(scope: unknown): boolean {
  const host = scope as { flutter_inappwebview?: { callHandler?: unknown } } | null;
  return typeof host?.flutter_inappwebview?.callHandler === 'function';
}

export function describeImuReply(reply: unknown): string {
  if (reply === true) return '호스트가 시작/중지 요청을 승인했습니다.';
  if (reply === false) return '호스트가 false를 반환했습니다. 구체적인 거부 사유는 제공하지 않았습니다.';
  const text = JSON.stringify(reply) ?? String(reply);
  return `SDK의 성공 응답(true)이 아닙니다: ${text.slice(0, 300)}`;
}
