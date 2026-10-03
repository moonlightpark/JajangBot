# Bot 작업 로그

## 현재 상태 (2026-10-04 기준)

| 항목 | 상태 |
| --- | --- |
| 거래소 | Bybit USDT 무기한 선물만 지원 (Hyperliquid 제거, 9번) |
| 기본 환경 | `BYBIT_ENV=demo` (메인넷 시세, 가상 자금) |
| 키 | 코인별 서브계정 키. 없으면 그 코인은 dry run |
| 리스크 한도 | `MAX_POSITION_USD`, `MAX_LEVERAGE` (기본은 한도 없음) |
| 대시보드 상단 | Live / Testnet / Demo / Dry run을 `.env` 기준으로 표시 |
| 판단 방식 | `MODEL=mock` / `jev` / `strategy`(TradingView Maginga 15Ho 채널 규칙, 11번) |
| 테스트 | `bun test` 82개 통과 |
| 미검증 | 실제 키로 주문하는 경로 (아래 "남은 작업" 참고) |

## 작업 목록

1. 프로젝트 분석과 로컬 실행 설정
2. 실행 오류 대응
3. 보안 검토
4. 보안 조치 (1번, 2번, 3번)
5. README.md 한글화
6. `.env` 주석 한글화
7. Bybit 거래소 지원 추가
8. 대시보드 상단 상태 표시를 실제 거래 모드로 변경
9. Hyperliquid 연동 코드 삭제 (Bybit 전용으로 전환)
10. `dev:web` 스크립트 수정
11. 판단 방식 3가지(mock, jev, 사용자 지정 전략) 지원
12. 전략 채널 라인(long / short)을 차트에 표시

각 항목은 작업한 시점의 기록입니다. 이후 작업으로 바뀐 내용(예: 1~7번의 Hyperliquid 관련 설명)은 9번에서 정리했습니다.

## 2026-10-04

### 1. 프로젝트 분석과 로컬 실행 설정

**프로젝트 구성**

| 구성 | 위치 | 런타임 | 포트 | 역할 |
| --- | --- | --- | --- | --- |
| 봇 | 루트 `src/` | Bun | 3000 | 호가 수신, Jev 판단, 주문, SSE 송출 |
| 대시보드 | `web/` | Next.js | 3001 | `/events` SSE를 받아 차트와 체결을 표시 |

- 거래 대상: Hyperliquid 무기한 선물. 코인 5개(BTC, ETH, SOL, DOGE, BNB)가 각각 독립된 슬리브로 동작합니다.
- 틱 흐름: 호가 읽기(`feed.ts`), Jev 판단(`model.ts`), 주문(`trader.ts`, `market.ts`), 대시보드 송출(`server.ts`) 순서입니다.
- 기본 상태: `PRIVATE_KEY`가 비어 있어 dry run이고, `MODEL=mock`이라 API 키 없이 동작합니다. 네트워크는 `HL_TESTNET=true`(테스트넷)입니다.

**설정 작업**

- 루트와 `web/`에서 `bun install`을 실행했습니다.
- `web/.env.example`을 복사해 `web/.env.local`을 만들었습니다.
- `bun test` 결과: 64개 통과, 0개 실패.
- 봇(3000)과 대시보드(3001)가 실행되고 응답하는 것을 확인했습니다.

**발견한 문제**

- `bun run dev:web`이 Bun 1.3.6에서 실행되지 않습니다. `bun --cwd web run dev`라는 인자 순서를 처리하지 못해 사용법만 출력됩니다. 대신 `bun run --cwd web dev`로 실행하거나 `bun upgrade`로 Bun을 올리면 됩니다.
- README가 안내하는 `.wallets.example.json` 파일이 저장소에 없습니다.

### 2. 실행 오류 대응

- **증상**: `bun run start`를 실행하면 `EADDRINUSE`가 나며 3000번 포트가 이미 사용 중이라고 나옴.
- **원인**: 앞서 확인용으로 백그라운드에서 띄운 봇이 3000번 포트를 계속 잡고 있었습니다.
- **조치**: 백그라운드 봇과 대시보드 프로세스를 종료해 3000번과 3001번 포트를 비웠습니다.
- **함께 나온 `hl l2Book HTTP 429`**: 봇 두 개가 동시에 Hyperliquid API를 호출해 요청 한도를 넘긴 것으로 판단됩니다.
- **결과**: 사용자가 로컬 실행 성공을 확인했습니다.

### 3. 보안 검토

검토 범위는 봇 `src/` 전체, 대시보드 `web/src`, 설정 파일, Dockerfile, 그리고 `bun audit`으로 점검한 의존성입니다.

| 번호 | 위험도 | 내용 | 상태 |
| --- | --- | --- | --- |
| 1 | 높음 | 루트 `.gitignore`가 없어 `.env`와 `.wallets.json`의 개인키가 커밋될 수 있음 | 조치 완료 |
| 2 | 높음 | `next@16.3.4` critical 취약점 GHSA-vcvr-r3jv-pc5j(`next/og` RCE). 코드에서 사용하지 않아 실제 악용 가능성은 낮음 | 조치 완료 |
| 3 | 중간 | 포지션 크기 상한이 없음. 레버리지가 코인 최대치까지 외부 모델 응답으로 정해짐 | 조치 완료(`.env`로 설정) |
| 4 | 중간 | 봇 API가 인증 없이 모든 인터페이스(`*:3000`)에 열려 있고 CORS가 `*`. SSE 연결 수 제한 없음 | 향후 재검토 |
| 5 | 낮음 | `.wallets.json`이나 `WALLETS_JSON`의 JSON 오류가 조용히 무시되어 해당 코인이 dry run으로 돎 | 향후 재검토 |
| 6 | 낮음 | `PRIVATE_KEY`가 `HL_COINS`의 첫 번째 코인에 붙음. 코인 순서를 바꾸면 메인 지갑이 바뀜 | 향후 재검토 |
| 7 | 낮음 | Docker 컨테이너가 root로 실행됨 | 향후 재검토 |

**이미 잘 되어 있는 부분**

- 개인키가 로그, 대시보드 API, Jev 요청 어디에도 포함되지 않습니다.
- 모델 응답을 허용 목록으로 검증하고, 읽을 수 없는 답은 hold로 처리합니다.
- 레버리지는 정해진 단계로 제한되고, 청산 주문은 `reduceOnly`입니다.
- 테스트넷이 기본값이고, Jev 호출은 4초가 지나면 끊깁니다.
- 봇 의존성에는 알려진 취약점이 없습니다.

### 4. 보안 조치 (1번, 2번, 3번)

**1번: 루트 `.gitignore` 추가**

- `.env`, `.env.*`, `.wallets.json`, `node_modules`, `*.log`, `.DS_Store`를 제외합니다.
- `.env.example`은 그대로 커밋됩니다.

**2번: Next.js 업그레이드**

- `web/package.json`의 `next`를 `16.3.4`에서 `^16.3.6`으로 올렸습니다.
- `cd web && bun audit` 결과 취약점이 없습니다.
- `bun run build`(프로덕션 빌드)가 성공했습니다.

**3번: 리스크 한도 환경 변수 추가**

| 변수 | 기본값 | 동작 |
| --- | --- | --- |
| `MAX_POSITION_USD` | 비어 있음(한도 없음) | 포지션을 이 금액 넘게 키우는 진입만 주문하지 않습니다. 반대 방향 진입과 청산은 막지 않습니다. 걸리면 로그에 `open held at MAX_POSITION_USD`가 출력되고 대기 주문은 취소됩니다. |
| `MAX_LEVERAGE` | 비어 있음(코인 최대치) | Jev에게 보여주는 레버리지 선택지를 이 값 이하로 줄입니다. 레버리지를 고르는 건 여전히 Jev입니다. |

변경한 파일:

- `src/config.ts`: `maxPositionUsd`, `maxLeverage` 설정을 추가했습니다. 값이 비어 있거나 0이면 `null`(한도 없음)입니다.
- `src/plan.ts`: `overPositionCap()`을 추가하고, `planQuote()`가 한도를 넘는 진입이면 `null`을 반환하도록 했습니다.
- `src/trader.ts`: `planQuote()`에 현재 중간가와 한도를 넘기고, 한도에 걸리면 로그를 남깁니다.
- `src/market.ts`: 코인 최대 레버리지에 `MAX_LEVERAGE` 상한을 적용합니다.
- `.env`, `.env.example`: 두 변수를 추가했습니다(값은 비어 있음).
- `test/trader.test.ts`: 한도 테스트 2개를 추가했습니다.

검증:

- `bun test` 결과: 66개 통과, 0개 실패.
- `src/types.ts`와 `web/src/lib/bot-types.ts`가 여전히 동일합니다.
- 실행 확인: 3099번 포트에서 BTC만 실행하고 `MAX_LEVERAGE=5`, `MAX_POSITION_USD=50`을 줬습니다.
  - 최대 레버리지가 40x에서 5x로 내려갔습니다.
  - 체결로 포지션이 생긴 뒤, 한도를 넘게 되는 진입은 주문 없이 처리되었습니다.

참고: Jev가 진입을 골라도 한도에 걸리면 주문이 나가지 않으므로, CLAUDE.md의 "Jev가 결정한다" 원칙과 겹칩니다. 판단은 매 틱 그대로 기록되지만, 한도는 기본적으로 꺼 두고 실제 키를 쓸 때만 켜는 것을 권장합니다.

### 5. README.md 한글화

README.md 전체를 한글로 다시 작성했습니다. 기존 내용에 더해 다음을 넣었습니다.

- 프로젝트 구조와 주요 파일 설명
- 로컬 실행 순서
- 문제 해결 표: `dev:web` 오류, 3000번 포트 충돌, HTTP 429
- 리스크 한도 설정
- 보안 주의사항
- 환경 변수 표에 `MAX_POSITION_USD`, `MAX_LEVERAGE`, `WALLETS_JSON` 추가

### 6. `.env` 주석 한글화

- `.env`의 주석을 모두 한글로 바꿨습니다. 설정값은 그대로입니다.
- 저장소에 없는 `.wallets.example.json` 안내는 `.wallets.json`에 직접 키를 넣으라는 문장으로 고쳤습니다.
- 확인 사항: 현재 `.env`가 `MODEL=jev`인데 `TYPESAFE_API_KEY`가 비어 있습니다. 이 상태로는 봇이 시작되지 않으므로, 키를 넣거나 `MODEL=mock`을 쓰세요.

### 7. Bybit 거래소 지원 추가

**결정 사항 (사용자 선택)**

- 방식: Hyperliquid를 유지하고 `VENUE=bybit` 선택 옵션으로 추가합니다. 기본값은 hyperliquid입니다.
- 기본 환경: Bybit 데모 트레이딩(`BYBIT_ENV=demo`)
- 계정: 코인별 서브계정 API 키

**구조**

- `src/venue.ts` (신규): Trader가 의존하는 공통 인터페이스 `VenueMarket`, `VenueFeed`와 `createVenue()`. Hyperliquid의 `Market`과 Bybit의 `BybitMarket`이 모두 이 인터페이스를 구현합니다.
- `src/bybit-api.ts` (신규): V5 REST 서명(HMAC-SHA256), 환경별 호스트, 서명 클라이언트. 데모는 주문을 `api-demo.bybit.com`, 비공개 스트림을 `stream-demo.bybit.com`, 시세를 메인넷 `stream.bybit.com`에서 받습니다.
- `src/bybit-feed.ts` (신규): `orderbook.50`, `publicTrade`, `kline.1`, `tickers` 웹소켓과 REST 스냅샷, 로컬 호가창 관리, 틱 클럭
- `src/bybit-market.ts` (신규):
  - 진입은 PostOnly 지정가로 내고, 같은 방향이면 amend로 정정합니다. 청산은 IOC입니다.
  - 레버리지 설정, 포지션, 지갑 조회를 처리합니다.
  - 비공개 웹소켓의 `execution`, `position`, `order`, `wallet` 채널을 받습니다.
  - Bybit 주문 ID는 문자열이라, 숫자 로컬 ID와 서로 대응시켜 관리합니다.
- 수정한 파일:
  - `src/config.ts`: `VENUE`, `BYBIT_ENV` 추가
  - `src/sleeves.ts`: Bybit 키 로딩(`BYBIT_API_KEY`, `BYBIT_API_SECRET`, `BYBIT_KEYS_JSON`, `.bybit-keys.json`), `hasKeys()` 추가
  - `src/index.ts`: `createVenue()` 사용
  - `src/trader.ts`: `VenueMarket` 타입 사용
  - `src/book.ts`: tick size 기반 가격 함수 추가
- Hyperliquid 코드의 동작은 바뀌지 않았습니다.

**Hyperliquid와 다른 점**

- **최소 주문 수량**: BTC는 최소 0.001개(약 $85)입니다. `QUOTE_USD`가 이보다 작으면 최소 수량으로 올려 주문하고, 시작 로그에 `min order`로 표시합니다.
- **최대 레버리지**: BTC, ETH는 150x입니다. `MAX_LEVERAGE` 설정을 권장합니다.
- **사전 조건**: 통합 거래 계정(UTA)과 단방향 포지션 모드가 필요합니다. API 키에 출금 권한을 주면 안 됩니다.

**설정 및 문서**

- `.env`, `.env.example`: `VENUE`, `BYBIT_ENV`, `BYBIT_API_KEY`, `BYBIT_API_SECRET`, `BYBIT_KEYS_JSON` 추가
- `.gitignore`: `.bybit-keys.json` 추가
- `README.md`: "Bybit에서 실행" 섹션, 보안 주의사항, 환경 변수 표 갱신
- `CLAUDE.md`: Bybit는 선택 옵션이고 기본값과 라이브 데모는 Hyperliquid라는 한 줄을 추가

**검증**

- `test/bybit.test.ts` (신규, 9개): 설정 검증, 호스트, 서명, 호가창 delta, 티커 변환, 가격과 수량 반올림, 계정 변환, 체결 방향, 키 로딩
- `bun test` 결과: 75개 통과, 0개 실패
- 타입 검사: 새 파일과 수정한 파일에는 오류가 없습니다. 기존 코드(`config.ts`의 Jev 설정, `market.ts`, `model.ts`)의 타입 오류 7개는 이번 작업 전부터 있던 것입니다.
- 실행 확인: 3099번 포트에서 `VENUE=bybit`, dry run으로 실행했습니다.
  - BTCUSDT와 ETHUSDT의 실제 데모 시세로 매 틱 판단이 이루어지고 체결이 시뮬레이션되었습니다.
  - 캔들이 15m 1000개, 1m 1001개 로드되었습니다.
  - `MAX_LEVERAGE=5`가 적용되었습니다.
- **아직 검증하지 못한 것**: API 키가 없어서 실제 주문 경로는 실행해 보지 못했습니다. 대상은 주문 생성, 정정, 취소, 레버리지 설정, 비공개 웹소켓 인증, 체결 수신입니다. 데모 계정 키로 확인이 필요합니다.

### 8. 대시보드 상단 상태 표시를 실제 거래 모드로 변경

**문제**: 상단의 "Live"는 대시보드와 봇의 연결 상태만 뜻했습니다. 그래서 dry run이든 테스트넷이든 항상 "Live"로 보였습니다.

**변경**

- 봇이 `.env`에서 정한 네트워크를 대시보드에 보냅니다. `Meta`에 `network` 필드(`mainnet` | `testnet` | `demo`)를 추가했고, `src/types.ts`와 `web/src/lib/bot-types.ts`를 똑같이 고쳤습니다.
  - Hyperliquid: `HL_TESTNET` 값에 따라 testnet 또는 mainnet
  - Bybit: `BYBIT_ENV` 값을 그대로 사용
- `web/src/lib/mode.ts` (신규): 네트워크, `DRY_RUN`, 선택한 코인의 키 유무로 상태를 정합니다.

  | 표시 | 조건 |
  | --- | --- |
  | Dry run | `DRY_RUN=true`이거나 선택한 코인에 키가 없음 (체결 시뮬레이션) |
  | Testnet | 키 있음, 테스트넷 |
  | Demo | 키 있음, Bybit 데모 트레이딩 |
  | Live | 키 있음, 메인넷 (실제 자금. 빨간색으로 표시) |
  | Offline / Connecting | 봇 연결 끊김 / 설정 수신 전 |

- 상태 옆에 거래소와 네트워크를 함께 표시합니다(예: "Bybit demo prices, simulated fills"). 모바일에서는 이 설명을 숨기고, 마우스를 올리면 툴팁으로 보입니다.
- 깜빡이는 효과는 쓰지 않았고, 가운뎃점(·)이나 대시(—)도 쓰지 않았습니다.
- 대시보드가 `network`를 보내지 않는 이전 버전 봇에 붙으면, 탐색기 주소로 testnet인지 mainnet인지 추정합니다.

**검증**

- `test/mode.test.ts` (신규, 3개)
- `test/sleeves.test.ts`: Hyperliquid 전용 테스트가 `.env`의 `VENUE`에 영향을 받지 않도록 venue를 명시했습니다.
- `bun test` 결과: 78개 통과(`VENUE=bybit`와 `VENUE=hyperliquid` 모두), 대시보드 타입 검사 통과
- 브라우저 확인: 현재 `.env`(`VENUE=bybit`, 키 없음)에서 "Dry run Bybit prices, simulated fills"로 표시되었습니다.

### 9. Hyperliquid 연동 코드 삭제 (Bybit 전용으로 전환)

**결정**: 사용자 요청으로 Hyperliquid 지원을 완전히 제거하고 Bybit만 사용합니다.

**백업**: 저장소가 git이 아니라 삭제를 되돌릴 수 없으므로, 삭제 전 상태를 세션 임시 폴더에 `JevTrader-before-hl-removal.tgz`로 백업했습니다(node_modules 제외). 세션이 끝나면 지워질 수 있습니다.

**삭제한 것**

- 파일: `src/feed.ts`(Hyperliquid 시세), `src/market.ts`(Hyperliquid 주문)
- 의존성: `@nktkas/hyperliquid`, `viem`
- `src/account.ts`: `ClearinghouseLike`, `accountFromClearinghouse`, `fillDir`
- `src/book.ts`: szDecimals 기반 `priceTick`, `alignPrice`, 기존 `quotePrice`, `takerPrice`
  - tick size 기반 함수가 `quotePrice`, `takerPrice`라는 이름을 이어받았습니다.
  - `HlLevel`은 `Level`로 이름을 바꿨습니다.
- `src/chart.ts`: Hyperliquid 캔들 로딩(`loadCandles`)
- `src/config.ts`: `VENUE`, `HL_TESTNET`, `PRIVATE_KEY`, `hexKey`, Hyperliquid 탐색기 주소
- `src/sleeves.ts`: `PRIVATE_KEY`, `WALLETS_JSON`, `.wallets.json` 로딩
- `src/venue.ts`: `createVenue`와 쓰이지 않는 `VenueFeed`. Trader가 쓰는 `VenueMarket` 인터페이스는 유지했습니다.

**바뀐 설정**

- 코인 목록 변수 이름: `HL_COINS`를 `COINS`로 바꿨습니다(값은 유지).
- `.env`와 `.env.example`에서 `VENUE`, `HL_TESTNET`, `PRIVATE_KEY`, 지갑 관련 주석을 제거했습니다.
- `.gitignore`에서 `.wallets.json`을 제거했습니다.

**대시보드 (`web/`)**

- `txUrl`: 탐색기 주소가 없으면 빈 문자열을 반환합니다(Hyperliquid 탐색기로 대체하지 않음).
- `useFeed`의 기본값을 바꿨습니다: venue는 bybit, 페어는 BTC-USDT입니다. 봇이 network를 보내지 않으면 mainnet으로 간주해, 실제 자금 거래를 낮춰 표시하는 일이 없게 했습니다.
- 주석과 문구에서 Hyperliquid를 Bybit로 바꿨습니다: `pnl.ts`, `mode.ts`, `FlowChart.tsx`, `llms.txt`

**문서**

- `README.md`: Bybit 전용으로 다시 썼습니다(실행, 환경, 서브계정 키, 리스크 한도, 보안, 환경 변수).
- `CLAUDE.md`: 핵심 원칙의 "Hyperliquid"를 "Bybit"로 바꾸고, Hyperliquid 지원을 2026-10-04에 제거했다고 기록했습니다.

**검증**

- 테스트를 정리했습니다. Hyperliquid 전용 테스트는 삭제하고, 나머지는 Bybit 기준으로 바꿨습니다.
  - `account`, `book`, `sleeves`, `bybit`, `mode`, `trader`, `model`, `indicators`
- `bun test` 결과: 72개 통과, 0개 실패
- 대시보드 타입 검사 통과. 봇의 남은 타입 오류 5개는 기존 Jev 관련 코드(`config.ts`, `model.ts`)에 원래 있던 것이고, `market.ts`의 오류 2개는 파일 삭제로 사라졌습니다.
- 실행 확인: 3099번 포트, dry run
  - meta 값: `venue: "bybit"`, `network: "demo"`, 페어 `BTC-USDT`와 `ETH-USDT`
  - 매 틱 판단이 정상으로 나왔습니다.
- 남은 Hyperliquid 언급은 CLAUDE.md에 제거 사실을 적은 한 줄뿐입니다.

**확인 필요**

- 배포된 데모(https://www.jev-trade.com/)의 봇도 Bybit 설정으로 다시 배포해야 화면과 실제가 일치합니다.
- `assets/desk.png` 스크린샷은 Hyperliquid 시절 화면일 수 있습니다.

### 10. `dev:web` 스크립트 수정

- **문제**: `"dev:web": "bun --cwd web run dev"`는 Bun 1.3.6에서 인자 순서를 처리하지 못해, 사용법만 출력하고 끝났습니다.
- **수정**: `package.json`의 스크립트를 `"dev:web": "bun run --cwd web dev"`로 바꿨습니다. 이 순서는 Bun 버전과 관계없이 동작합니다.
- **검증**: `bun run dev:web -p 3005`로 실행해, `next dev`가 시작되고 Next.js가 Ready 상태가 되는 것을 확인했습니다. 3001번 포트는 사용 중인 대시보드가 쓰고 있어서 3005번으로 확인했습니다.
- **문서**: README의 대시보드 실행 명령을 `bun run dev:web`으로 되돌리고, 문제 해결 표에서 이 항목을 지웠습니다.

### 11. 판단 방식 3가지 지원 (mock, jev, 사용자 지정 전략)

**배경**: 거래가 잦은 이유를 분석했습니다(로그 대부분은 주문 표시이고, mock 모델의 판단은 틱 번호로 정해지는 노이즈라 모든 코인이 함께 움직임). 이어서 사용자가 TradingView 파인 스크립트 "[GaYang] Maginga 15Ho - v5.4"를 기준으로 한 사용자 지정 전략을 요청했습니다.

**파인 스크립트 분석**

- 실제로 주문을 내는 조건은 EMA(125) 채널 규칙뿐입니다.
  - 숏 라인: `ema(high,125) × 1.01618`
  - 롱 라인: `ema(low,125) × (1-0.01619)`
  - 진입은 포지션이 없을 때만, 청산은 반대쪽 라인에 닿을 때입니다.
- 계산만 하고 주문 조건에 쓰이지 않는 것: Squeeze Momentum, CMF, DEMA, 2차 라인(3.82%), 손절과 목표가(`set_targets`는 호출되지 않음). 그래서 옮기지 않았습니다.
- 원본에는 손절이 없습니다.

**구현**

- `src/strategy.ts` (신규)
  - Pine 방식 EMA: SMA로 시작값을 잡은 뒤 지수 이동평균
  - 채널 라인 계산(`magingaLines`), 판단(`magingaDecision`)
  - 형성 중인 봉에 현재가를 반영하는 `withLiveBar`
- `src/model.ts`: `StrategyModel`을 추가했습니다. `createModel(market)`이 `MODEL` 값에 따라 mock, Jev, strategy 중 하나를 고릅니다. 판단 이유가 바뀔 때마다 현재 라인 값을 로그에 남깁니다.
- `src/config.ts`: `MODEL`을 `mock`, `jev`, `strategy` 중 하나로 검증합니다. `STRATEGY_TIMEFRAME`(15m 또는 1m, 기본값 15m)과 `STRATEGY_LEVERAGE`(기본값 3)를 추가했습니다.
- 15분 캔들 실시간 반영: `src/chart.ts`에 `bars()`를 추가하고, `src/bybit-feed.ts`에서 `kline.15`를 구독합니다. 예전에는 시작할 때 불러온 15분 캔들이 갱신되지 않았습니다. `VenueMarket`과 `BybitMarket`에도 `bars()`를 추가했습니다.
- 대시보드 상단에 판단 주체를 표시합니다(`by Jev`, `by mock model`, `by TradingView strategy`). `web/src/lib/mode.ts`의 `deciderLabel`이 이 문구를 정하고, Jev가 아니면 테두리로 강조합니다.

**원본과 다른 점**

- 판단 시점: 원본은 봉 마감 기준이고, 이 봇은 매 틱 형성 중인 봉에 현재가를 반영합니다(`calc_on_every_tick`과 같음).
- 주문 크기: 원본의 `qty = 1` 대신 `QUOTE_USD`를 씁니다(Bybit 최소 수량 이상).
- 주문 방식: 원본은 시장가 진입이고, 이 봇은 PostOnly 지정가로 진입합니다.

**문서**: `.env`, `.env.example`, README("판단 방식" 섹션과 환경 변수 표), CLAUDE.md(`MODEL=jev`만 핵심 원칙을 만족한다는 점과 판단 주체 표시 규칙)

**검증**

- `test/strategy.test.ts` (신규, 9개)
  - 설정 검증, Pine EMA, 라인 계산, 진입과 청산 조건
  - 저가 꼬리만으로는 롱 진입하지 않는지(종가 기준)
  - 형성 중인 봉 처리, `StrategyModel`의 매 틱 판단
- `bun test` 결과: 81개 통과
- 실행 확인(dry run)
  - 15m: BTC 84,756이 채널(83,350 ~ 86,204) 안에 있어 매 틱 hold
  - 1m: BTC와 DOGE 정상 동작
- 브라우저 확인: 상단에 "Dry run  Bybit demo prices, simulated fills  by mock model"로 표시됩니다.
- 봇의 타입 오류는 기존 Jev 관련 코드에 있던 5개 그대로이고, 새로 생긴 오류는 없습니다.

**확인 필요**

- 상단 소개 문구 "Live Jev trading bot"과 페이지 제목은 바꾸지 않았습니다. `MODEL=strategy`로 공개 데모를 운영한다면 문구를 바꿀지 결정이 필요합니다.

### 12. 전략 채널 라인을 차트에 표시

**요청**: 봇 로그의 `inside the channel (long < ..., short > ...)` 라인을 대시보드 차트에 표시

**구현**

- 와이어 타입: `src/types.ts`와 `web/src/lib/bot-types.ts`에 `StrategyLevels`(`long`, `short`, `timeframe`)를 추가하고, `BlockEvent.levels`에 담았습니다. 두 파일은 동일하게 유지합니다.
- 봇
  - `StrategyModel`이 판단할 때 사용한 라인 값을 `ModelDecision.levels`로 돌려줍니다.
  - `Trader`가 이 값을 매 틱 이벤트에 실어 보냅니다. 늦은 틱(late)에는 싣지 않습니다.
  - 틱 기록에 함께 남기 때문에, 대시보드가 연결되는 즉시(봇 시작 직후 포함) 라인이 보입니다.
- 차트 (`FlowChart.tsx`, `CandlePane.tsx`)
  - 숏 라인은 빨간 점선, 롱 라인은 초록 점선으로 그리고, 오른쪽 축에 가격 라벨을 붙였습니다.
  - 범례에 `strategy 15m`을 표시합니다.
  - 라인이 화면 밖으로 잘리지 않도록 가격 축 범위에 라인을 포함시켰습니다. 1s 봉에서는 캔들이 납작해지므로 포함하지 않습니다.
  - 늦은 틱에는 라인 값이 없으므로, 마지막으로 받은 라인을 계속 표시합니다.
- mock과 jev 모드에서는 라인 값이 없으므로 아무것도 그리지 않습니다.
- 함께 수정: 관망 중에도 CALL 패널에 `long 100%`로 보이던 것을 관망일 때 long과 short 각 50%로 바꿨습니다.

**검증**

- `test/strategy.test.ts`에 라인 값 반환 테스트를 추가했습니다. `bun test` 82개 통과, 대시보드 타입 검사 통과, 두 타입 파일 동일 확인.
- 브라우저 확인: 3099번 포트에 strategy 봇을 띄우고, 대시보드 복사본을 3005번 포트에서 실행했습니다. Next가 같은 폴더에서 dev 서버를 두 개 띄우지 못하기 때문입니다.
  - BTC 5m 차트에 short 86,203.8(빨강)과 long 83,349.3(초록) 점선이 표시되었습니다.
  - 상단에는 "by TradingView strategy"가 표시되었습니다.
  - 확인 후 테스트 서버를 종료하고 복사본을 삭제했습니다.

## 남은 작업

**우선**

- [ ] Bybit 데모 서브계정 키로 실제 주문 경로 검증: 주문 생성, 정정, 취소, 레버리지 설정, 비공개 웹소켓 인증, 체결 수신
- [ ] 배포된 데모(https://www.jev-trade.com/)의 봇을 Bybit 설정으로 다시 배포
- [ ] `assets/desk.png` 스크린샷을 현재 화면으로 교체

**보안 (3번 검토에서 보류한 항목)**

- [ ] 봇 API 접근 제한: 로컬에서는 `127.0.0.1`에만 바인딩하는 옵션, SSE 연결 수 상한
- [ ] `.bybit-keys.json`이나 `BYBIT_KEYS_JSON`의 JSON 오류를 시작할 때 경고로 표시
- [ ] `BYBIT_API_KEY`가 붙는 코인을 명시적으로 지정 (지금은 `COINS`의 첫 번째 코인)
- [ ] Dockerfile에 `USER bun` 추가

**전략**

- [ ] `MODEL=strategy` 실제 키로 검증 (진입은 PostOnly라 급변 시 미체결 가능)
- [ ] (선택) 원본처럼 봉 마감 기준 판단 옵션, 손절 옵션
- [ ] (선택) mock 노이즈를 코인별로 분리, dry run에서 같은 주문 로그 생략

**기타**

- [x] `package.json`의 `dev:web` 스크립트 수정 (10번)
- [ ] 기존 Jev 관련 코드(`config.ts`, `model.ts`)의 타입 오류 5개 정리
- [ ] (선택) Bybit 레이트 리밋 대응 보강
