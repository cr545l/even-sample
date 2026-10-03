import {
  AppLocationAccuracy, AudioInputSource, CreateStartUpPageContainer, ImuReportPace,
  EvenAppMethod, ImuCtrlCmd, ImageContainerProperty, ImageRawDataUpdate, ImageRawDataUpdateResult,
  OsEventTypeList, RebuildPageContainer, TextContainerProperty, TextContainerUpgrade, waitForEvenAppBridge,
  type AppImageAsset, type AppLocation, type DeviceStatus, type EvenAppBridge, type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { analyzePcm, gestureType, sourceText, valueText } from './sensors';
import { createImuView } from './imu-view';
import { createGlassesImuFrame, IMU_IMAGE_WIDTH, IMU_IMAGE_HEIGHT } from './glasses-imu';
import { hasNativeHost, describeImuReply } from './native-host';
import { imuTilt } from './imu-vector';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const imuView = createImuView($<HTMLCanvasElement>('imu-3d'), $('imu-vector-caption'), $<HTMLButtonElement>('imu-view-reset'));
const drawGlassesFrame = createGlassesImuFrame($<HTMLCanvasElement>('glasses-imu-frame'));
type Stream = { active: boolean; message: string; received: number; count: number };
const stream = (): Stream => ({ active: false, message: '중지됨', received: 0, count: 0 });
const imu = { ...stream(), x: undefined as number | undefined, y: undefined as number | undefined, z: undefined as number | undefined };
const mic = { ...stream(), source: '미수신', direction: null as number | null, role: '미수신', data: undefined as ReturnType<typeof analyzePcm> | undefined };
const gps = { ...stream(), fix: undefined as AppLocation | undefined };
const devices = new Map<string, { model?: string; status: Partial<DeviceStatus>; received: number }>();
let camera: Omit<AppImageAsset, 'base64'> | undefined;
let input = { count: 0, type: '미수신', source: '미제공', received: 0 };
let lastEvent: unknown = {};
const events: string[] = [];
let bridge: EvenAppBridge | undefined;
let connected = false;
let connecting = false;
let connectionMessage = 'Even 앱 네이티브 연결 확인 중';
let displayMessage = '화면 생성 전';
let imuRequested = false;
let imuControlState: 'idle' | 'pending' | 'accepted' | 'rejected' | 'unsupported' | 'receiving' = 'idle';
let imuReply: unknown = '아직 요청하지 않음';
let pageReady = false;
let busy = false;
let disposed = false;
let pending = Promise.resolve();
let page = 1;
let screenSending = false;
let lastScreen = '';
let screenRetryAt = 0;
let lastImageKey = '';
let lastImageAt = 0;
let lastImageStatus = '';
const pageNames = ['기기 상태', 'IMU', '오디오', '휴대폰 위치', '입력', '카메라'];
const subscriptions: (() => void)[] = [];

function log(message: string) {
  events.unshift(`${new Date().toLocaleTimeString()}  ${message}`);
  events.length = Math.min(events.length, 30);
  $('event-log').textContent = events.join('\n');
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  $('error').textContent = message;
  log(message);
  console.error('[G2 Sensors]', message);
}
function age(at: number) { return at ? `${((Date.now() - at) / 1000).toFixed(1)}초 전` : '미수신'; }
function field(id: string, value: unknown, digits = 3) { $(id).textContent = valueText(value, digits); }
function statusText(state: Stream) {
  return `${state.message} · ${state.active && !state.received ? '수신 대기' : age(state.received)} · ${state.count}회`;
}
function nextPage(direction = 1) { page = (page + direction + pageNames.length) % pageNames.length; render(); }

function renderDevices() {
  const host = $('devices'); host.replaceChildren();
  if (!devices.size) { host.textContent = '기기 정보 미수신'; return; }
  for (const [serial, entry] of devices) {
    const box = document.createElement('div'); box.className = 'device';
    const title = document.createElement('h3');
    title.textContent = `${entry.model?.toUpperCase() ?? '모델 미제공'} · ${serial || 'SN 미제공'}`;
    const details = document.createElement('dl'); const s = entry.status;
    for (const [name, value] of [
      ['연결', s.connectType], ['배터리 (%)', s.batteryLevel], ['착용', s.isWearing],
      ['충전 중', s.isCharging], ['케이스 안', s.isInCase], ['마지막 갱신', age(entry.received)],
    ]) {
      const dt = document.createElement('dt'); dt.textContent = String(name);
      const dd = document.createElement('dd'); dd.textContent = valueText(value);
      details.append(dt, dd);
    }
    box.append(title, details); host.append(box);
  }
}
function glassText() {
  const tilt = imuTilt(imu.x, imu.y, imu.z);
  const s = [...devices.values()][0]?.status;
  const n = (v: unknown, digits = 2) => v === undefined || v === null ? '--' : valueText(v, digits);
  const flag = (v?: boolean) => v === undefined ? '--' : v ? 'yes' : 'no';
  const body = [
    `DEVICE\nLink: ${n(s?.connectType)}\nBattery: ${n(s?.batteryLevel)}%\nWorn: ${flag(s?.isWearing)}  Charging: ${flag(s?.isCharging)}\nIn case: ${flag(s?.isInCase)}`,
    `IMU ${imu.active ? 'ON' : 'OFF'}\nX: ${n(imu.x)}\nY: ${n(imu.y)}\nZ: ${n(imu.z)}\nDown: ${n(tilt?.downDeg, 1)} deg\nRight: ${n(tilt?.rightDeg, 1)} deg`,
    `AUDIO ${mic.active ? 'ON' : 'OFF'}\nSource: ${mic.source === '미수신' ? '--' : mic.source}\nRMS: ${n(mic.data?.rms)}  Peak: ${n(mic.data?.peak)}\ndBFS: ${n(mic.data?.dbfs)}\nDirection: ${n(mic.direction)} / ${mic.role === '미수신' ? '--' : mic.role}`,
    `PHONE LOCATION ${gps.active ? 'ON' : 'OFF'}\nLat: ${n(gps.fix?.latitude, 5)}\nLon: ${n(gps.fix?.longitude, 5)}\nAccuracy: ${n(gps.fix?.accuracy)} m\nSpeed: ${n(gps.fix?.speed)} m/s`,
    `INPUT / ${input.count} events\n${input.type === '미수신' ? 'Waiting for input' : input.type}\nSee phone for source and history\nTap / swipe: change page\nDouble tap: system exit dialog`,
    `PHONE CAMERA\n${camera ? camera.mimeType : 'No capture'}\nSize: ${camera ? camera.size : '--'} bytes\nCapture from phone dashboard\nNo camera on G2`,
  ][page];
  return `${demo ? 'DEMO ' : ''}SENSORS ${page + 1}/6\n${body}`;
}
function render() {
  if (disposed) return;
  $('status').textContent = connectionMessage;
  $('native-status').textContent = demo ? '가상 데모 (기기 연결 없음)' : connected ? 'Even 앱/시뮬레이터 호스트 확인됨' : '네이티브 호스트 미확인';
  const deviceLinks = [...devices.values()].map(d => d.status.connectType).filter(Boolean);
  $('device-link-status').textContent = deviceLinks.length ? deviceLinks.join(', ') : '기기 연결 미확인';
  $('display-status').textContent = displayMessage;
  $('imu-reply').textContent = JSON.stringify(imuReply, null, 2) ?? String(imuReply);
  $('imu-status').textContent = statusText(imu); $('mic-status').textContent = statusText(mic); $('gps-status').textContent = statusText(gps);
  field('imu-x', imu.x); field('imu-y', imu.y); field('imu-z', imu.z);
  imuView.update(imu.x, imu.y, imu.z);
  if (demo) drawGlassesFrame(imu.x, imu.y, imu.z);
  field('audio-source', mic.source); field('audio-direction', mic.direction); field('audio-role', mic.role);
  field('audio-rms', mic.data?.rms, 5); field('audio-peak', mic.data?.peak, 5);
  $('audio-db').textContent = mic.data ? mic.data.dbfs === null ? '−∞ (무음)' : `${mic.data.dbfs.toFixed(1)} dBFS` : '미수신';
  field('audio-bytes', mic.data?.bytes); field('audio-samples', mic.data?.samples); field('audio-duration', mic.data?.durationMs);
  $('pcm-preview').textContent = mic.data ? mic.data.preview.join(', ') : '미수신';
  ($('audio-meter') as HTMLMeterElement).value = mic.data?.rms ?? 0;
  for (const key of ['latitude', 'longitude', 'accuracy', 'altitude', 'speed', 'heading', 'timestamp'] as const) {
    field(`gps-${key}`, gps.fix?.[key], key === 'latitude' || key === 'longitude' ? 6 : 3);
  }
  field('input-count', input.count); field('input-type', input.type); field('input-source', input.source);
  $('input-time').textContent = age(input.received); $('raw').textContent = JSON.stringify(lastEvent, null, 2);
  $('glass-page').textContent = `${page + 1} / 6 · ${pageNames[page]}`; $('glass-preview').textContent = glassText();
  $('imu-toggle').textContent = imu.active ? 'IMU 중지' : 'IMU 시작';
  $('mic-toggle').textContent = mic.active ? '마이크 중지' : '마이크 시작';
  $('gps-toggle').textContent = gps.active ? '위치 추적 중지' : '위치 추적 시작';
  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => { button.disabled = !connected || busy; });
  $<HTMLButtonElement>('connect-retry').disabled = connected || connecting || demo;
  ($('mic-source') as HTMLSelectElement).disabled = mic.active || busy;
  ($('imu-pace') as HTMLSelectElement).disabled = imu.active || busy;
  renderDevices();
}
async function syncGlasses() {
  if (!bridge || !pageReady || disposed || screenSending || Date.now() < screenRetryAt) return;
  const content = glassText();
  const imageKey = [imu.x, imu.y, imu.z].map(v => v === undefined ? '-' : v.toFixed(2)).join(',');
  const imageStatus = imu.received
    ? `${imu.active ? Date.now() - imu.received < 5000 ? 'LIVE' : 'STALE SAMPLE' : 'LAST SAMPLE'}\nEstimated tilt / Yaw --`
    : imuControlState === 'unsupported' ? 'IMU UNSUPPORTED\nCheck Even App / G2'
    : imuControlState === 'rejected' ? 'IMU REQUEST FAILED\nSee phone diagnostics'
    : imuRequested ? 'WAITING FOR IMU\nNo samples received' : 'IMU NOT STARTED\nHold: retry IMU';
  screenSending = true;
  try {
    if (content !== lastScreen) {
      if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'sensors', content }))) throw new Error('안경 텍스트 갱신 실패');
      lastScreen = content;
    }
    if (imageStatus !== lastImageStatus) {
      if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 4, containerName: 'imu-status', content: imageStatus }))) throw new Error('안경 IMU 상태 갱신 실패');
      lastImageStatus = imageStatus;
    }
    if (imageKey !== lastImageKey && Date.now() - lastImageAt >= 1000) {
      const imageData = drawGlassesFrame(imu.x, imu.y, imu.z);
      const result = await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: 2, containerName: 'imu3d', imageData }));
      if (result !== ImageRawDataUpdateResult.success) throw new Error(`안경 3D 이미지 전송 실패: ${result}`);
      lastImageKey = imageKey; lastImageAt = Date.now();
      displayMessage = '텍스트 화면 생성됨 · 3D 이미지 전송 승인 (실제 표시 여부는 안경에서 확인)';
    }
  } catch (error) { displayMessage = String(error); screenRetryAt = Date.now() + 5000; failure(error); }
  finally { screenSending = false; }
}
function run(action: () => Promise<void>) {
  if (busy || disposed) return pending;
  busy = true; $('error').textContent = ''; render();
  pending = action().catch(failure).finally(() => { busy = false; render(); });
  return pending;
}
async function switchStream(state: Stream, enable: boolean, action: () => Promise<boolean>, label: string) {
  state.message = enable ? '시작 요청 중' : '중지 요청 중'; render();
  try {
    const ok = demo || await action();
    if (!ok) throw new Error(`${label}: 요청 실패 (권한·앱 버전·기기 지원 확인)`);
    state.active = enable;
    if (enable) state.received = 0;
    state.message = enable ? '시작됨' : '중지됨 · 마지막 수신값'; log(`${label} ${enable ? '시작' : '중지'}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const unsupported = /unknown variant|not supported|not implemented|unknown method/i.test(detail);
    state.message = unsupported ? '현재 호스트에서 미지원' : '요청 실패';
    if (unsupported) throw new Error(`${label}: 현재 시뮬레이터/앱에서 이 API를 지원하지 않습니다. 실제 G2와 최신 Even 앱에서 확인하세요.`);
    throw error;
  }
}
async function toggleImu(enable = !imu.active) {
  const pace = Number(($('imu-pace') as HTMLSelectElement).value) as ImuReportPace;
  if (!demo && !pageReady) throw new Error('IMU를 시작하기 전에 안경 화면 생성이 성공해야 합니다. Even 앱의 G2 연결 상태를 확인하세요.');
  imuRequested = enable;
  imuControlState = 'pending';
  imu.message = enable ? 'IMU 시작 요청 중' : 'IMU 중지 요청 중';
  const previousSamples = imu.count;
  try {
    // Same method and payload as SDK 0.0.16 imuControl, preserving the raw reply
    // instead of losing all failure detail when the SDK converts it to boolean.
    const params = new ImuCtrlCmd({ iMUReportEn: enable ? 1 : 0, reportFrq: pace }).toJson();
    const response: unknown = demo ? true : await bridge!.callEvenApp(EvenAppMethod.ImuControl, params);
    imuReply = { requested: enable, params, response, time: new Date().toISOString() };
    if (response !== true && !(enable && imu.count > previousSamples)) {
      imuControlState = 'rejected';
      imu.message = '호스트 응답 실패 · 원본 확인';
      throw new Error(`IMU: ${describeImuReply(response)} 네이티브 응답은 아래 연결 진단에 표시됩니다.`);
    }
    imu.active = enable;
    imuControlState = enable ? imu.count > previousSamples ? 'receiving' : 'accepted' : 'idle';
    if (enable && imu.count === previousSamples) imu.received = 0;
    imu.message = enable ? '시작 승인 · 샘플 수신 확인 중' : '중지됨 · 마지막 수신값';
    log(`IMU ${enable ? '시작' : '중지'} 요청 승인`);
  } catch (error) {
    const unsupported = /unknown variant|not supported|not implemented|unknown method/i.test(String(error));
    if (unsupported) { imu.message = '현재 호스트에서 IMU 미지원'; imuRequested = false; imuControlState = 'unsupported'; }
    else { imuControlState = 'rejected'; imu.message = 'IMU 요청 실패 · 원본 응답 확인'; }
    imuReply = { ...typeof imuReply === 'object' && imuReply ? imuReply : {}, error: String(error) };
    if (unsupported) throw new Error('현재 호스트는 IMU API를 지원하지 않습니다. 실제 G2와 Even 앱 버전을 확인하세요.');
    throw error;
  }
}
async function toggleMic(enable = !mic.active) {
  const source = ($('mic-source') as HTMLSelectElement).value as AudioInputSource;
  await switchStream(mic, enable, () => bridge!.audioControl(enable, source), '마이크');
}
async function toggleGps(enable = !gps.active) {
  await switchStream(gps, enable, () => enable
    ? bridge!.startAppLocationUpdates({ accuracy: AppLocationAccuracy.High, intervalMs: 1000, distanceFilter: 0 })
    : bridge!.stopAppLocationUpdates(), '휴대폰 위치');
}
async function stopAll() {
  const results = await Promise.allSettled([
    imu.active || imuRequested ? toggleImu(false) : Promise.resolve(), mic.active ? toggleMic(false) : Promise.resolve(), gps.active ? toggleGps(false) : Promise.resolve(),
  ]);
  const errors = results.filter(r => r.status === 'rejected');
  if (errors.length) throw new Error(errors.map(e => String(e.reason)).join('; '));
}
function onLocation(fix: AppLocation) {
  if (disposed) return;
  gps.fix = fix; gps.received = Date.now(); gps.count++; lastEvent = { appLocation: fix };
}
function onStatus(status: DeviceStatus) {
  if (disposed) return;
  const previous = devices.get(status.sn);
  devices.set(status.sn, { model: previous?.model, status, received: Date.now() });
  lastEvent = { deviceStatus: status }; log(`기기 상태: ${status.connectType}`);
}
async function refreshDevice() {
  if (demo) {
    devices.set('DEMO-ONLY', { model: 'g2 (가상)', status: { batteryLevel: 82, isWearing: true, isCharging: false, isInCase: false }, received: Date.now() }); return;
  }
  const info = await bridge!.getDeviceInfo();
  if (!info) { log('기기 정보 없음: 연결 상태 확인'); return; }
  devices.set(info.sn, { model: info.model, status: info.status, received: Date.now() });
  lastEvent = { deviceInfo: info }; log(`기기 정보 갱신: ${info.model}`);
}
function onEvent(event: EvenHubEvent) {
  if (disposed) return;
  const axes = event.sysEvent?.imuData;
  if (axes && imuRequested) {
    // Some hosts report samples before returning the control acknowledgement.
    // A false/malformed acknowledgement must not discard actual sensor data.
    if (imuControlState !== 'receiving') {
      log('IMU 샘플 수신 확인');
      if ($('error').textContent?.startsWith('IMU:')) $('error').textContent = '';
    }
    imu.active = true; imuControlState = 'receiving'; imu.message = 'IMU 실데이터 수신됨';
    imu.x = axes.x; imu.y = axes.y; imu.z = axes.z; imu.received = Date.now(); imu.count++;
  }
  const audio = event.audioEvent;
  if (audio && mic.active) {
    mic.data = analyzePcm(audio.audioPcm); mic.source = audio.source; mic.direction = audio.direction; mic.role = audio.speakerRole;
    mic.received = Date.now(); mic.count++;
  }
  lastEvent = audio ? { audio: { source: audio.source, direction: audio.direction, speakerRole: audio.speakerRole, bytes: audio.audioPcm.byteLength, statistics: mic.data } } : event;
  const type = gestureType(event.sysEvent ?? event.textEvent ?? event.listEvent);
  if (type !== null) {
    input = { count: input.count + 1, type: OsEventTypeList[type], source: sourceText(event.sysEvent?.eventSource), received: Date.now() };
    log(`${input.type} · ${input.source}`);
    if (type === OsEventTypeList.CLICK_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) nextPage();
    if (type === OsEventTypeList.SCROLL_TOP_EVENT) nextPage(-1);
    if (type === OsEventTypeList.LONG_PRESS_EVENT) void run(() => toggleImu(!imu.active));
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) void pending.then(() => run(async () => {
      if (!await bridge!.shutDownPageContainer(1)) throw new Error('종료 확인창 요청 실패');
    }));
  }
  const os = event.sysEvent?.eventType;
  if (os === OsEventTypeList.FOREGROUND_EXIT_EVENT) void pending.then(() => run(stopAll));
  if (os === OsEventTypeList.SYSTEM_EXIT_EVENT || os === OsEventTypeList.ABNORMAL_EXIT_EVENT) dispose();
}
async function capture() {
  if (demo) { $('camera-status').textContent = '데모에서는 실제 카메라를 사용하지 않습니다.'; return; }
  const asset = await bridge!.captureImageFromCamera();
  if (!asset) { $('camera-status').textContent = '취소됨 또는 권한/촬영 결과 없음'; return; }
  const { base64, ...metadata } = asset; camera = metadata;
  $('camera-status').textContent = '사진 수신 완료 · 메모리에만 표시'; $('camera-meta').textContent = JSON.stringify(metadata, null, 2);
  const image = $('camera-image') as HTMLImageElement;
  if (/^image\/(jpeg|png|webp|gif)$/i.test(asset.mimeType)) {
    image.src = `data:${asset.mimeType};base64,${base64.replace(/^data:[^,]+,/, '')}`; image.hidden = false;
  } else { image.removeAttribute('src'); image.hidden = true; }
  log('휴대폰 사진 수신');
}
$('imu-toggle').onclick = () => void run(() => toggleImu());
$('connect-retry').onclick = () => void start().catch(failure);
$('mic-toggle').onclick = () => void run(() => toggleMic());
$('gps-toggle').onclick = () => void run(() => toggleGps());
$('stop-all').onclick = () => void run(stopAll);
$('refresh-device').onclick = () => void run(refreshDevice);
$('capture').onclick = () => void run(capture);
$('clear-camera').onclick = () => {
  camera = undefined; ($('camera-image') as HTMLImageElement).removeAttribute('src'); $('camera-image').hidden = true;
  $('camera-meta').textContent = ''; $('camera-status').textContent = '사진 지움'; render();
};
$('gps-once').onclick = () => void run(async () => {
  const fix = demo ? { latitude: 37.5665, longitude: 126.978, accuracy: 10, timestamp: Date.now() }
    : await bridge!.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: 5000 });
  if (fix) { onLocation(fix); log('위치 1회 조회 완료'); } else throw new Error('위치 없음: 권한 거부·측위 실패·시간 초과 가능');
});
$('next-page').onclick = () => nextPage(); $('previous-page').onclick = () => nextPage(-1);
$('demo-tap').onclick = () => {
  input = { count: input.count + 1, type: 'CLICK_EVENT (가상)', source: '가상 오른쪽 안경 다리', received: Date.now() }; nextPage(); log('가상 탭');
};
function demoTick() {
  const t = Date.now() / 1000;
  if (imu.active) {
    const down = Math.sin(t * .6) * .65, right = Math.sin(t * .8) * .65;
    const scale = Math.hypot(1, .3);
    imu.x = (-down + .3 * right) / scale; imu.y = (.3 * down + right) / scale;
    imu.z = Math.sqrt(1 - down * down - right * right);
    imu.count++; imu.received = Date.now();
  }
  if (mic.active) {
    const bytes = new Uint8Array(3200); const view = new DataView(bytes.buffer);
    for (let i = 0; i < 1600; i++) view.setInt16(i * 2, Math.round(Math.sin(i * 0.17) * 5000), true);
    mic.data = analyzePcm(bytes); mic.count++; mic.received = Date.now();
    mic.source = ($('mic-source') as HTMLSelectElement).value; mic.direction = 0; mic.role = 'unknown';
  }
  if (gps.active) onLocation({ latitude: 37.5665, longitude: 126.978, altitude: 35, accuracy: 10, speed: 0, heading: 0, timestamp: Date.now() });
}
const ticker = window.setInterval(() => { if (demo) demoTick(); render(); void syncGlasses(); }, 500);
function dispose() {
  if (disposed) return;
  disposed = true; window.clearInterval(ticker); subscriptions.forEach(off => off()); imuView.dispose();
  // Host teardown may cancel async calls; Stop All is the reliable manual path.
  void pending.finally(() => stopAll()).catch(console.error);
}
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
async function start() {
  if (connected || connecting || disposed) return;
  connecting = true;
  $('demo-banner').hidden = !demo; $('demo-tap').hidden = !demo; render();
  if (demo) {
    connected = true; connecting = false; connectionMessage = '가상 데이터 데모 · 실제 센서 연결 없음';
    await run(async () => { await refreshDevice(); await toggleImu(true); }); return;
  }
  connectionMessage = 'Even 앱 네이티브 호스트 확인 중…'; render();
  // Flutter can inject its handler after the document has loaded.
  for (let attempt = 0; attempt < 30 && !hasNativeHost(window) && !disposed; attempt++) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (!hasNativeHost(window) || disposed) {
    connecting = false;
    connectionMessage = '일반 브라우저에서는 G2에 연결할 수 없습니다. 휴대폰 Even 앱 → Even Hub → Scan QR로 여세요.';
    displayMessage = '미연결 · 안경 화면 생성 요청하지 않음'; render(); return;
  }
  bridge = await waitForEvenAppBridge(); if (disposed) return;
  connected = true; connecting = false;
  subscriptions.push(bridge.onEvenHubEvent(onEvent), bridge.onDeviceStatusChanged(onStatus), bridge.onAppLocationChanged(onLocation));
  connectionMessage = '네이티브 호스트 확인됨 · G2 기기 연결과 화면 생성은 아래에서 별도로 확인';
  await run(async () => {
    const layout = {
      containerTotalNum: 5,
      textObject: [
        new TextContainerProperty({ containerID: 1, containerName: 'sensors', xPosition: 0, yPosition: 0,
          width: 282, height: 246, paddingLength: 6, borderWidth: 0, isEventCapture: 1, content: glassText() }),
        new TextContainerProperty({ containerID: 3, containerName: 'imu-title', xPosition: 288, yPosition: 0,
          width: 288, height: 40, paddingLength: 4, borderWidth: 0, isEventCapture: 0, content: 'IMU 3D / TILT' }),
        new TextContainerProperty({ containerID: 4, containerName: 'imu-status', xPosition: 288, yPosition: 192,
          width: 288, height: 56, paddingLength: 0, borderWidth: 0, isEventCapture: 0, content: 'Waiting for IMU samples' }),
        new TextContainerProperty({ containerID: 5, containerName: 'controls', xPosition: 0, yPosition: 250,
          width: 576, height: 38, paddingLength: 4, borderWidth: 0, isEventCapture: 0, content: 'Tap: next  Hold: IMU  Double tap: exit' }),
      ],
      imageObject: [new ImageContainerProperty({ containerID: 2, containerName: 'imu3d', xPosition: 288, yPosition: 44,
        width: IMU_IMAGE_WIDTH, height: IMU_IMAGE_HEIGHT })],
    };
    const result = await bridge!.createStartUpPageContainer(new CreateStartUpPageContainer(layout));
    pageReady = result === 0;
    // A dev-server reload can leave the host's startup page alive.
    if (result === 1) pageReady = await bridge!.rebuildPageContainer(new RebuildPageContainer(layout));
    displayMessage = pageReady ? '안경 컨테이너 생성 승인 · 3D 이미지 전송 대기' : `안경 컨테이너 생성 실패 (코드 ${result})`;
    if (!pageReady) failure(new Error(displayMessage));
    await refreshDevice();
  });
  if (pageReady) await run(() => toggleImu(true));
  console.info('[G2 Sensors] ready');
}
void start().catch(failure);
