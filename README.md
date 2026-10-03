# G2 Sensor Explorer

Even Hub SDK **0.0.16**에서 접근 가능한 센서·기기 상태를 표시하는 Vite + TypeScript 샘플입니다. 휴대폰 화면은 모든 상세 값, 안경 화면은 6개 요약 페이지를 표시합니다. 기존 카운터 샘플의 `package_id`는 유지했습니다.

## 표시하는 정보

| 입력 / API | 표시 값 | 출처와 제한 |
| --- | --- | --- |
| `imuControl`, `sysEvent.imuData` | X/Y/Z 원값, 수신 횟수·시점 | G2. 축 단위/좌표계 미명시, 가속도·자이로 분리 값 없음. P100~P1000은 보고 코드이며 Hz 아님 |
| `audioControl`, `audioEvent` | 소스, RMS, peak, dBFS, PCM 바이트·샘플 수·길이, 첫 16개 PCM 값, 방향 태그, 화자 분류 | G2 또는 휴대폰 중 하나. PCM16 LE, 16 kHz, mono. 방향은 원값이며 화자는 앱 알고리즘의 추정 |
| `getAppLocation`, `startAppLocationUpdates` | 위도·경도·정확도·고도·속도·방위·Unix ms 타임스탬프 | 휴대폰 위치 서비스. 일부 필드는 제공되지 않을 수 있음 |
| `getDeviceInfo`, `onDeviceStatusChanged` | 모델·SN·연결·배터리·착용·충전·케이스 상태 | 조회 또는 이벤트에 실제로 등장한 기기만 표시. R1 전체 목록 조회 API는 없음 |
| `onEvenHubEvent` | 탭·더블 탭·스크롤·길게 누르기·놓기, 오른쪽/왼쪽 다리/R1 출처 | 출처 생략 시 미제공. 시스템/메뉴 이벤트는 최근 SDK 원본에서 확인 |
| `captureImageFromCamera` | 휴대폰 사진, 경로·이름·MIME·바이트 크기 | 버튼으로 1회 촬영. G2 카메라 또는 연속 영상 스트림이 아님 |

SDK에서 노출하지 않는 조도·온도·심박·개별 마이크 채널·가속도/자이로 개별 축은 표시하지 않습니다. 사용자 프로필과 앨범 선택은 센서가 아니므로 포함하지 않았습니다. 정의는 설치된 `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts`와 [Device APIs](https://hub.evenrealities.com/docs/build/device-apis)를 기준으로 합니다.

## 수집과 권한

**G2 안경 화면**은 왼쪽에 센서 숫자, 오른쪽에 3D 안경 모형을 표시합니다. 처음부터 IMU 페이지로 열립니다. 오른쪽은 `ImageContainerProperty`의 288×144 이미지 영역이며 `updateImageRawData`로 Gray8 프레임을 최대 초당 1회, 순차 전송합니다. 이미지는 16단계 명암으로 양자화하고 실제 전송 응답을 확인합니다. 유효한 IMU 데이터가 없으면 대기 문구를 표시하며, 대기·거부·미지원 상태를 안경에 표시합니다. 길게 누르기로 IMU 시작/중지를 다시 요청할 수 있습니다.

휴대폰과 G2는 같은 3D 안경 모형을 사용합니다. 정면 `(0,0,1)`, 오른쪽 귀를 어깨로 기울인 `(0.3,1,0)` 관측을 기준으로 정규화한 입력에 `down=(-x+0.3y)/√1.09`, `right=(0.3x+y)/√1.09`, `up=z`를 적용합니다. 약 16.7°의 경험적 축 보정이며 SDK가 보장한 좌표계는 아닙니다. 원본 X/Y/Z는 그대로 표시합니다.

모형은 보정한 중력 방향을 세계의 위쪽에 맞추는 최소 회전을 사용합니다. 수평 회전(yaw)은 측정하지 않습니다. Down/Right 각도는 각각 `asin(down)`, `asin(right)`인 독립적인 축 기울기(±90°)이며 순차 Euler 각도가 아닙니다. 완전히 뒤집힌 자세의 회전축은 모호하므로 X축 180°를 사용합니다. 0 벡터·누락 값은 모형 대신 수신 대기를 표시합니다. 빠른 움직임의 가속도는 기울기 오차를 만들 수 있습니다. 휴대폰 드래그·방향키는 관찰 시점만 바꾸고, 안경에는 고정 시점으로 전송합니다. R은 착용자 오른쪽, 짧은 화살표는 코 방향입니다.

### 연결 오류 구분

`waitForEvenAppBridge()`의 준비 완료만으로 G2 연결 성공을 판단할 수 없습니다. 이 샘플은 `window.flutter_inappwebview.callHandler` 존재 여부를 먼저 확인합니다. 일반 Chrome/Edge에서는 센서 호출을 하지 않으며 **휴대폰 Even 앱 → Even Hub → Scan QR** 안내를 표시합니다. PC 주소를 일반 브라우저로 여는 것은 네트워크 확인용입니다.

화면 상단에는 네이티브 호스트, G2 기기 연결 상태, 안경 컨테이너/이미지 전송 결과를 각각 표시합니다. `IMU 요청·원본 응답 진단`에는 전송한 `iMUReportEn`/`reportFrq`와 실제 네이티브 응답을 남깁니다. `false`만 반환되면 앱이 구체적인 원인을 제공하지 않은 것이므로 권한 문제로 단정하지 않습니다. SDK와 같은 요청 형식을 사용하되 실패를 boolean으로 축약하지 않도록 공개 `callEvenApp` API에서 원본 응답을 보존합니다. 시작 요청 이후 도착한 실제 IMU 샘플은 응답 값이 모호해도 버리지 않습니다.

SDK 0.0.16의 명시된 최소 Even 앱 버전은 **2.2.10**입니다. 실제 Even 앱에서 계속 거부되면 앱/펌웨어 버전과 위 원본 응답을 확인하세요. IMU는 별도의 매니페스트 권한 항목이 없습니다. 시뮬레이터의 IMU 미지원과 휴대폰 앱의 거부 응답은 서로 다른 상황입니다.

- 연결 후 기기 정보를 조회하고 IMU를 자동 시작합니다.
- 마이크, 위치, 카메라는 각각의 시작/조회/촬영 버튼을 눌러 사용합니다. 매니페스트에 `g2-microphone`, `phone-microphone`, `location`, `camera`를 선언했습니다.
- 마이크 입력을 바꾸려면 중지 → 소스 선택 → 시작 순서로 조작합니다.
- `전체 수집 중지`는 IMU·마이크·지속 위치 추적을 모두 중지합니다. 최근 수신값은 시점과 함께 남깁니다.
- 백그라운드 진입 시 수집 중지를 요청합니다. 페이지 종료 시에도 정리를 요청하지만 호스트 종료 중 비동기 호출은 완료되지 않을 수 있으므로 명시적 중지 버튼을 권장합니다. 재진입 시 수집은 버튼으로 다시 시작합니다.
- PCM 전체나 사진·위치를 서버에 업로드하거나 영구 저장하지 않습니다. 오디오 통계는 최근 프레임만, 입력 기록은 최대 30개만 보관합니다. 사진 촬영 앱 자체의 저장 정책은 휴대폰 호스트에 따릅니다.
- `미수신`은 0/false가 아닙니다. 시작 성공과 실제 샘플 수신도 구분합니다. 요청 거부와 명시적인 API 미지원은 화면에 표시합니다.

## 실행

Node.js 22.19 이상인 22.x 환경에서 구성했습니다. CLI와 시뮬레이터는 프로젝트 의존성으로 설치되므로 전역 설치가 필요하지 않습니다.

```powershell
npm install
npm run dev
```

다른 터미널에서 시뮬레이터를 실행합니다.

```powershell
npm run simulator
```

시뮬레이터의 Click 또는 아래 스크롤로 다음 페이지, 위 스크롤로 이전 페이지, Double Click으로 종료 확인창을 엽니다. 개발 서버는 5173 포트를 사용하며, 이미 사용 중이면 다른 포트로 자동 이동하지 않고 오류를 표시합니다.

일반 브라우저에서는 http://localhost:5173/?demo=1 을 열어 가상 IMU·오디오·위치 데이터를 확인할 수 있습니다. 마이크/위치 버튼도 실제 장치 대신 가상 데이터를 사용합니다. 노란 배너로 데모임을 표시하며 실제 안경 검증을 대신하지 않습니다. 기본 주소에서는 네이티브 호스트를 확인하고, 없으면 미연결 안내를 표시합니다.

설치된 시뮬레이터 0.9.5는 `imuControl`을 미지원으로 응답했습니다. 안경 화면의 3D 축 이미지 출력은 시뮬레이터에서 확인했습니다. 시뮬레이터의 기기 정보도 실측 데이터가 아니므로 실제 G2/휴대폰에서 각 권한과 센서 수신을 검증해야 합니다. 웹/텍스트 갱신은 최대 초당 2회, 안경 이미지 전송은 최대 초당 1회입니다.

## 실제 G2 연결

Hecaton에서는 **Build and G2** 명령을 사용하면 빌드 → 개발 서버 실행 → LAN 주소 확인 → QR 출력 → 로그 유지까지 진행합니다. `Build and Run`은 시뮬레이터용 5173, `Build and G2`는 실제 기기용 5174 포트를 사용합니다. 두 명령 파일은 함께 보관하세요.

### 먼저 준비할 것

1. 휴대폰 Even 앱에 로그인하고 **Devices → Add device → Even G2**로 페어링합니다. 앱과 G2 펌웨어 업데이트도 확인하세요. R1은 선택 사항입니다.
2. [Even Hub 로그인](https://hub.evenrealities.com/login)을 휴대폰 앱과 **같은 계정**으로 진행합니다. 앱을 최근 앱 목록에서 완전히 종료한 뒤 다시 열면 **Even Hub 탭 우측 상단 개발자 영역 → Scan QR**가 나타납니다. 별도의 개발자 모드 토글을 켜는 방식이 아닙니다.
3. PC와 휴대폰을 같은 LAN에 연결합니다. PC는 유선, 휴대폰은 같은 공유기의 Wi-Fi여도 됩니다. 게스트 Wi-Fi의 기기 격리 기능은 통신을 막을 수 있습니다.
4. Windows 방화벽에서 이 네트워크의 **TCP 5174 인바운드**를 허용합니다. 개인(Private) 프로필용 규칙은 공용(Public) 네트워크에 적용되지 않습니다. 신뢰하는 가정 네트워크라면 Windows 네트워크 설정을 개인으로 변경한 뒤 해당 포트를 허용할 수 있습니다. 명령은 방화벽이나 네트워크 설정을 자동 변경하지 않습니다.

### Build and G2 사용 순서

1. 명령을 실행하고 출력된 `http://<PC LAN IP>:5174`를 휴대폰 브라우저에서 엽니다. 웹 안내 화면이 보이면 PC 서버 접근은 가능한 상태입니다. 일반 브라우저에서 SDK 연결 대기가 표시되는 것은 정상입니다.
2. 휴대폰 **Even 앱의 Scan QR**로 터미널 QR을 스캔합니다. 휴대폰 기본 카메라 대신 Even 앱을 사용하세요.
3. 안경의 센서 화면이 표시되면 한 번 탭해 페이지가 바뀌는지 확인합니다. 휴대폰 화면에서 필요한 센서의 수집을 시작하세요. 코드 수정은 개발 서버를 통해 반영됩니다. 연결이 끊기면 QR을 다시 스캔하세요.

PC 명령은 Bluetooth 페어링이나 휴대폰 QR 스캔을 대신하지 않으며 실제 기기 연결 성공을 자동 판정하지 않습니다. 세션에서 표시하는 로그는 PC 개발 서버 로그이며 휴대폰 WebView의 `console.log`가 자동 전송되는 것은 아닙니다. `Ctrl+C` 또는 터미널 세션 종료 시 PC 서버는 함께 종료됩니다. 이미 열린 G2 앱은 안경에서 두 번 탭하여 별도로 종료하세요.

LAN 주소가 여러 개라 자동 선택할 수 없으면 PC에 할당된 주소를 직접 지정합니다. VPN/Tailscale 주소를 사용할 때도 휴대폰에서 접근 가능한 주소여야 합니다.

```powershell
cmake -DG2_HOST=192.168.0.101 -P ".hecaton/.command/Build and G2.cmake"
```

또는 `EVEN_G2_HOST` 환경변수를 지정한 환경에서 Hecaton을 실행합니다. 로그는 `.hecaton/logs/G2/`에 저장됩니다. 명령 파일은 `.hecaton/.command/Build and G2.cmake` 및 공통 구현인 `Build and Run.cmake`입니다.

선행 조건의 공식 안내: [Hardware / Developer Mode / Network & Firewall](https://hub.evenrealities.com/docs/get-started/quickstart/hardware).

### npm으로 수동 연결하기

1. 휴대폰의 Even 앱에서 개발자 모드를 활성화하고 G2를 연결합니다.
2. PC와 휴대폰을 같은 네트워크에 연결하고 `npm run dev`를 실행합니다.
3. `ipconfig`로 PC의 LAN IPv4 주소를 확인합니다.
4. 아래 주소의 예시 IP를 자신의 PC 주소로 바꾸고 QR을 생성합니다.

```powershell
npm run qr -- --url http://192.168.0.10:5173
```

Even 앱의 Scan QR로 스캔합니다. 접속이 안 되면 Windows 방화벽의 개인 네트워크 Node.js 허용 여부와 공유기의 기기 간 통신 차단 여부를 확인하세요.

## 빌드와 패키징

```powershell
npm run check
npm test
npm run build
npm run pack
```

`dist/`에 웹 빌드, 루트에 `even-g2-sensors.ehpk`가 생성됩니다. `pack`은 빌드도 수행합니다. SDK 버전은 0.0.16으로 고정했으며 패키징에도 같은 버전을 전달합니다. 배포 전 `app.json`의 예시 `package_id`를 본인 고유 ID로 변경하세요. 실제 기기 검증과 개발자 포털 업로드는 별도로 진행해야 합니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `src/main.ts` | 센서 구독·권한 제어, 6개 안경 페이지, 웹 화면, 중지/정리 |
| `src/sensors.ts` | PCM 분석, 누락값/입력 출처 처리 |
| `src/imu-view.ts`, `src/imu-vector.ts` | IMU 3D 방향 렌더링, 시점 조작, 벡터 계산 |
| `src/glasses-imu.ts` | G2 이미지 컨테이너에 전송할 288×144 흑백 프레임 생성 |
| `src/native-host.ts` | 실제 네이티브 호스트 탐지, IMU 원본 응답 진단 |
| `tests/sensors.test.mjs` | PCM 경계값, 0/false, IMU/입력 이벤트 구분 테스트 |
| `src/style.css` | 휴대폰/브라우저 화면 스타일 |
| `index.html` | 웹 화면과 데모 진입점 |
| `app.json` | Even Hub 매니페스트 |
| `vite.config.ts` | 상대경로 빌드와 개발 서버 포트 |

안경에는 SDK 텍스트 컨테이너를 사용하고, HTML/CSS는 휴대폰과 브라우저 화면에 사용합니다. 안경 문구는 영어, 웹 안내는 한국어입니다. 안경 문구를 바꾸려면 `src/main.ts`의 `glassText()`를 수정하세요.

## 참고 문서

- [Overview](https://hub.evenrealities.com/docs/get-started/overview)
- [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app)
- [Simulator](https://hub.evenrealities.com/docs/test/simulator)
- [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging)
