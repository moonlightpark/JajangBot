# Bot 작업 로그

## 다음 작업 시작하기 (인수인계, 2026-10-23 기준)

이 섹션만 읽으면 이어서 작업할 수 있게 정리했습니다. 작업이 끝날 때마다 이 섹션과 아래 작업 기록을 함께 갱신합니다.

### 새 세션에서 처음 할 일

1. 이 파일(`Bot_Job_Log.md`)의 이 섹션과 맨 아래 "남은 작업"을 읽습니다. CLAUDE.md에도 같은 안내가 있습니다.
2. 상태를 확인합니다.
   ```sh
   git log --oneline -5      # 최신 커밋: "Deploy to gpurent.io with GitHub Actions, rerun backtest at startup" (45번)
   git status                # 커밋 안 된 변경 확인
   bun test                  # 115개 통과가 정상
   ```
3. 실행합니다(터미널 2개).
   ```sh
   bun run start             # 봇 http://localhost:3000
   bun run dev:web           # 대시보드 http://localhost:3001
   ```
   포트가 사용 중이면 `lsof -nP -iTCP:3000 -sTCP:LISTEN`으로 확인합니다.

### 현재 상태

| 항목 | 상태 |
| --- | --- |
| 거래소 | Bybit USDT 무기한 선물만 지원 (Hyperliquid 제거, 9번) |
| 기본 환경 | `BYBIT_ENV=demo` (메인넷 시세, 가상 자금) |
| 키 | 코인별 서브계정 키. 없으면 그 코인은 dry run. 지금은 키가 없어 전부 dry run |
| 판단 방식 | `MODEL=mock` / `jev` / `strategy`. strategy는 TradingView Maginga 15Ho 채널 규칙, 15분봉 전용, 매 틱 판단 (11번, 16번) |
| 리스크 한도 | `MAX_POSITION_USD`, `MAX_LEVERAGE` (비우면 한도 없음) |
| 대시보드 | 한국어 UI, 업비트풍(상승 빨강, 하락 파랑, Pretendard, 네이비 섹션 머리). 로고와 타이틀 없음(46번). 코인 선택 줄 없음, 기본 BTC(73번). 좌측 문구 "실시간 트레이딩 봇"(48번). 상단에 거래 모드(실거래 / 테스트넷 / 데모 / 모의거래)와 판단 주체(Jev / TradingView 전략 / 모의 모델 판단) 표시. 15m 차트에서 전략 라인 표시 |
| 백테스트 | `MODEL=strategy`면 봇이 시작할 때 최근 3개월 백테스트를 시작 시각까지 다시 돌려 `latest.json` 갱신(42번, 약 13초). 실패하면 저장된 결과 유지. 수동은 `bun run backtest` (22번) |
| 차트 | 15분봉 3개월(`CHART_DAYS`, 기본 92일)을 불러옴. 주기 1s, 1m, 5m, 15m, 1H, 4H, 1D (24번) |
| 백테스트 표시 | 진입은 파란 `BT Long/Short 수량`, 청산은 손익(수익 초록, 손실 주황빨강), 호버하면 상세 카드(38번). 차트에 `BT` 표시, `BT` 버튼으로 끄고 켬. 데이터는 `backtest-results/latest.json` → `GET /backtest` (26번) |
| 차트 기본 주기 | 15m (28번, 전에는 5m) |
| 차트 시간대 | 기본 UTC+9, 버튼으로 UTC 전환. 봉 경계는 UTC 그대로 (40번) |
| 전략 라인 | 과거 3개월부터 가격을 따라 그림, 모든 주기에서 표시(`GET /levels`, 27번) |
| 전략 비교 | `bun run sweep`. 12개월, 변형 192가지. 결과와 후보는 29번 (라이브 설정은 그대로) |
| 전략 변형 | EMA 200, 손절은 3차 진입 뒤 2차~3차 사이 최저/최고점 이탈(72번, 5% 손절 없앰. 서버는 배포 때 적용), 반대 라인 청산(원본, 58번. 전에는 채널 중간), 반대 라인은 현재가로 실시간 익절(60번), 부분 익절은 꺼 둠(62번 기능, 68번에 끔), 봉 마감 판단 (`.env` `STRATEGY_*`, 30번). 추가 진입(물타기) 최대 2번, 2차는 1차 후 70봉, 3차는 2차 후 70봉 (52, 61, 71번). 3차까지 들어가면 1차 진입가에서 2/3 익절, 나머지는 1차로 간주해 다음 진입 신호가 2차(74, 79번). 그렇게 들어간 2차에서 2/3를 익절한 가격에 다시 닿으면 50% 익절, 나머지는 다시 1차(80번, `STRATEGY_RETAKE_TP=50`) |
| History 탭 | 봇 거래와 백테스트 거래(3개월)를 함께 표시, Source 열로 구분 (31번) |
| dry run 잔액 | 시작 $10000(`BANKROLL_USD`, 56번. 64번부터 BTC 하나라 BTC에 전액) + 청산된 백테스트 손익 + 봇 손익(수수료 뺌). 상단 balance, backtest에 표시 (32, 33번). 미청산 백테스트 포지션은 "백테스트 평가손익"으로 따로 표시, 잔고에 미포함 (57번) | 85번부터 백테스트의 미청산 포지션을 dry run 봇이 이어받음(`carried`).
| Jev 비교 | `bun run start:jev`(:3002, dry run), `bun run dev:web:jev`(:3003), `bun run compare`. Jev 키가 없어 아직 Jev 실행 안 함 (35번) |
| 가상매매 스위치 | 상단 메뉴바 "가상매매 On/Off"(88번). 관리자 비밀번호(`ADMIN_TOKEN`) 필요, 바꾸면 `.runtime.json`에 저장하고 봇 재시작. 서버에 `ADMIN_TOKEN`과 Bybit 데모 키 설정 완료(90번), 지금 On |
| 테스트 | `bun test` 155개 통과. 봇 타입 오류 5개는 기존 Jev 관련 코드 문제 |
| 저장소 | https://github.com/moonlightpark/JajangBot (`main`, 98번까지 커밋 푸시(1e0392b), 서버 배포와 서버 `.env` `STRATEGY_RETAKE_TP=50` 적용 완료) |
| 서버 배포 | `220.76.214.201`(Ubuntu 24.04, 사용자 `mineos`, shipgo와 같이 쓰는 서버). `~/jevtrade`에서 systemd `jevtrade-bot`(:3000), `jevtrade-web`(:3001), 둘 다 127.0.0.1에만 바인딩. nginx가 `www.gpurent.io`, `api.gpurent.io`를 HTTPS로 연결, 인증서 자동 갱신 (43, 44번) |
| 자동 배포 | `.github/workflows/deploy.yml`: main에 push하면 `bun test` 후 SSH로 `deploy/deploy.sh` 실행. Secrets 4개 등록 완료. (43, 45번) |
| 미검증 | 실제 키로 주문하는 경로 전체 |

### 현재 `.env` 주요 값 (비밀값 제외, 2026-10-10 확인)

| 변수 | 값 | 비고 |
| --- | --- | --- |
| `COINS` | `BTC` | BTC만 거래, 백테스트도 BTC만 (64번) |
| `TICK_MS` | `150000` | 2.5분마다 판단 (49번, 전에는 60000. 기본값은 2000) |
| `CHART_DAYS` | 비어 있음 | 기본값 92일 (24번) |
| `BANKROLL_USD` | `10000` | dry run 시작 잔액, 코인 수로 나눔. 지금 BTC에 전액 (56, 64번) |
| `BYBIT_ENV` | `demo` | |
| `BYBIT_API_KEY` 등 | 비어 있음 | 그래서 dry run |
| `MODEL` | `strategy` | |
| `STRATEGY_LEVERAGE` | `15` | 그대로 15x 적용 (21번) |
| `STRATEGY_EMA_LEN` | `200` | 후보 B (30번) |
| `STRATEGY_STOP_PCT` | `5` | 후보 B (30번) |
| `STRATEGY_EXIT` | `mid` | 후보 B (30번) |
| `STRATEGY_ON_BAR_CLOSE` | `true` | 후보 B (30번) |
| `STRATEGY_MAX_ADDS` | `2` | 추가 진입(물타기) 최대 2번 (52번) |
| `STRATEGY_ADD_GAP_BARS` | `50` | 직전 진입 후 15분봉 50개가 지나야 다음 진입 (52번) |
| `MAX_LEVERAGE` | `20` | |
| `MAX_POSITION_USD` | 비어 있음 | 한도 없음 |

`.env`는 git에 올라가지 않습니다. 다른 PC에서 이어서 작업할 때는 `.env.example`을 복사한 뒤 위 값을 다시 넣어야 합니다.

### 코드 지도

| 파일 | 역할 |
| --- | --- |
| `src/index.ts` | 시작점. 코인별로 시세, 주문, 판단 모델, Trader를 묶음 |
| `src/config.ts` | `.env` 읽기와 검증 (`MODEL`, `BYBIT_ENV` 등) |
| `src/sleeves.ts` | `COINS`와 코인별 Bybit 키 로딩 |
| `src/bybit-api.ts` | Bybit V5 REST 서명, 환경별 주소 |
| `src/bybit-feed.ts` | 호가, 체결, 캔들(1m, 15m), 티커 웹소켓 |
| `src/bybit-market.ts` | 주문, 정정, 취소, 레버리지, 포지션, 비공개 웹소켓 |
| `src/venue.ts` | Trader가 쓰는 거래소 인터페이스 `VenueMarket` |
| `src/model.ts` | 판단 모델 3가지(`MockModel`, `JevModel`, `StrategyModel`)와 `createModel` |
| `src/strategy.ts` | 사용자 지정 전략 규칙(EMA 125 채널, 15분봉) |
| `src/plan.ts` | 판단을 주문 한 건으로 변환, 레버리지 단계, 포지션 상한 |
| `src/trader.ts` | 매 틱 루프 |
| `src/backtest.ts` | 백테스트 시뮬레이션 (네트워크 없음, 테스트 대상) |
| `src/backtest-run.ts` | `bun run backtest`. 결과 출력, CSV와 `latest.json` 저장 |
| `src/backtest-report.ts` | 코인별 백테스트 실행(`backtestCoins`)과 봇 시작 시 갱신(`refreshBacktest`). CLI와 봇이 함께 씀 (42번) |
| `src/backtest-data.ts` | 백테스트 공용: 인자, 수수료, 1분봉 다운로드와 캐시(`.backtest-cache/`) |
| `src/backtest-sweep.ts` | `bun run sweep`. 전략 변형 비교 (train/test 구간) |
| `src/types.ts` | 봇과 대시보드 사이 데이터 타입. `web/src/lib/bot-types.ts`와 **똑같이 유지** |
| `web/src/lib/mode.ts` | 상단의 거래 모드와 판단 주체 문구 |
| `web/src/components/FlowChart/` | 차트, 전략 라인 |
| `test/` | 테스트 (소스 옆이 아니라 여기에 둠) |

### 지켜야 할 결정 사항

- 거래소는 Bybit만 씁니다. Hyperliquid 코드는 삭제했습니다(9번).
- strategy는 15분봉만 쓰고, 매 틱 형성 중인 15분봉에 현재가를 반영해 판단합니다(16번, 사용자 확인). 전략 라인은 27번부터 모든 주기에 표시합니다(값은 항상 15분봉 기준, 사용자 요청).
- `mock`과 `strategy`는 코드가 판단합니다. 대시보드가 Jev가 판단한 것처럼 보이면 안 되므로, 판단 주체 표시를 유지합니다(CLAUDE.md).
- 화면 문구에 가운뎃점, em 대시, en 대시를 쓰지 않고, 깜빡이는 표시도 쓰지 않습니다(CLAUDE.md).
- 관망(hold)을 없애거나 강제로 주문을 내게 바꾸지 않습니다(CLAUDE.md).
- 작업 방식
  - 사용자와는 한국어로 소통합니다.
  - 모든 작업은 이 파일에 번호를 붙여 기록합니다.
  - 커밋과 푸시는 사용자가 요청할 때만 합니다.
  - 커밋 메시지 끝에는 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙입니다.

### 알려진 문제와 결정이 필요한 것

1. (해결, 21번) `STRATEGY_LEVERAGE=15`가 10x로 적용되던 문제. 이제 strategy는 설정값을 그대로 씁니다(코인 최대, `MAX_LEVERAGE` 이하로 제한).
2. 실제 키로 주문하는 경로는 한 번도 실행해 보지 않았습니다.
3. 손절은 봇이 매 틱 현재가로 확인합니다(30번, 5%). Bybit 서버 손절은 아직 없어서, 봇이 꺼져 있으면 손절이 동작하지 않습니다. 실제 키로 운영하기 전에 서버 손절을 추가하는 것이 좋습니다.
4. 상단 소개 문구 "Live Jev trading bot"과 페이지 제목은 strategy 모드에서도 그대로입니다. 바꿀지 결정이 필요합니다.
5. 대시보드 GitHub 아이콘과 `web/public/llms.txt` 링크가 원본 저장소(aowang-ai/jev-trade)를 가리킵니다.
6. 봇 코드에 타입 오류 5개가 있습니다(`src/config.ts`, `src/model.ts`의 Jev 관련 코드, 이번 작업 전부터 있던 것). 테스트와 실행에는 영향이 없습니다.
7. 주문 크기는 레버리지와 관계없이 `QUOTE_USD`(기본 $40, 거래소 최소 주문 이상) 명목가로 고정입니다. 레버리지는 증거금만 바꾸고 포지션 크기는 키우지 않습니다(19번에서 확인).

할 일 전체 목록은 맨 아래 "남은 작업"에 있습니다.

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
13. GitHub 저장소에 커밋, 푸시
14. 차트 오류 수정: "Cannot update oldest data"
15. 차트 오류 수정분 커밋, 푸시
16. strategy를 15분봉 전용으로 고정, 전략 라인은 15m 차트에서만 표시
17. 15분봉 고정 작업 커밋, 푸시
18. 인수인계 정리 (2026-10-07)
19. 프로젝트 재분석 (2026-10-10)
20. 로컬 실행 (봇 3000, 대시보드 3001)
21. 판단 주기 1분으로 변경, strategy 레버리지 15x 문제 수정
22. 과거 3개월 데이터 백테스트 추가
23. 서버 재시작
24. 차트를 3개월 전부터 표시, 4H와 1D 주기 추가
25. 봇 재시작 후 차트가 10월 9일부터만 보이는 문제 수정
26. 백테스트 거래를 차트에 표시
27. 전략 라인을 과거부터 모든 주기 차트에 표시
28. 차트 기본 주기를 15m으로 변경
29. 전략 라인으로 수익을 높이는 방법 찾기 (변형 192가지 비교)
30. 후보 B로 봇 수정 (EMA 200, 손절 5%, 채널 중간 청산, 봉 마감 판단)
31. History 탭에 백테스트 거래 기록 표시
32. dry run 시작 잔액 $500, 가상 체결에 수수료 반영
33. 백테스트 수익을 balance에 반영
34. Jev로 수익 극대화가 되는지 검토 (질문 답변, 코드 변경 없음)
35. 전략 봇과 Jev 봇을 나란히 비교하는 구성

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

### 13. GitHub 저장소에 커밋, 푸시

- 저장소: https://github.com/moonlightpark/JajangBot (푸시 전에는 비어 있었습니다)
- 로컬 폴더를 git 저장소로 만들고(`main` 브랜치), 첫 커밋 `f2a0286`을 `origin/main`으로 푸시했습니다.
- 커밋 전 확인
  - 파일 94개가 들어갔습니다.
  - `.env`, `web/.env.local`, `.bybit-keys.json`, `node_modules`, `.next`는 들어가지 않았습니다.
  - diff에 API 키 형태의 값이 없었습니다.
  - `bun test` 82개 통과
- 이 기록(13번)은 커밋 이후에 추가해서, 15번의 두 번째 커밋 `72cc239`에 포함되었습니다.

### 14. 차트 오류 수정: "Cannot update oldest data"

- **증상**: 브라우저 콘솔에 `Uncaught Error: Cannot update oldest data`가 발생했습니다(`CandlePane.tsx`의 `series.update`).
- **원인**
  - 차트는 첫 봉 시각(stem)이 같으면 마지막 봉만 `update()`로 갱신했습니다.
  - 1m과 5m은 같은 1분 캔들로 만들고, 15m과 1H는 같은 과거 15분 캔들을 포함합니다. 그래서 첫 봉의 정렬에 따라 주기를 바꿔도 첫 봉 시각이 같을 수 있습니다.
  - 이때 새 마지막 봉 시각이 차트가 가진 마지막 봉보다 이르면, lightweight-charts가 예외를 던집니다. 예를 들어 5m에서 1m으로 바꾸는 경우입니다.
  - 이 문제는 이번 작업 전부터 있던 코드의 버그입니다.
- **수정**
  - `web/src/lib/ohlc.ts`에 `canUpdateInPlace()`를 추가했습니다. 다음 조건을 모두 만족할 때만 `update()`를 쓰고, 아니면 `setData()`로 전체를 다시 그립니다.
    - 같은 화면(코인과 주기), 같은 첫 봉
    - 봉 개수가 같거나 1개만 늘어남
    - 마지막 봉 시각이 뒤로 가지 않음
  - 봉이 한 번에 2개 이상 늘어날 때도 다시 그려서, 중간 봉이 빠지는 문제도 함께 막았습니다.
- **검증**
  - `test/ohlc.test.ts`에 테스트를 추가했습니다(주기 전환, 시각 역행, 2개 추가, 감소, 첫 봉 변경). `bun test` 83개 통과, 대시보드 타입 검사 통과.
  - 브라우저: 1m, 5m, 1m, 1H, 15m, 1s, 1m 순서로 전환하는 동안 콘솔 오류가 없었습니다.
  - 원래 오류는 첫 봉 정렬이 맞을 때만 나기 때문에, 브라우저에서 같은 상황을 재현했다고 확인할 수는 없습니다. 해당 조건은 단위 테스트로 직접 검증했습니다.

### 15. 차트 오류 수정분 커밋, 푸시

- 커밋 `72cc239` "Fix "Cannot update oldest data" when switching chart intervals"를 `origin/main`에 푸시했습니다(`f2a0286..72cc239`).
- 포함한 파일은 4개입니다.
  - 차트 오류 수정: `web/src/components/FlowChart/CandlePane.tsx`, `web/src/lib/ohlc.ts`
  - 테스트: `test/ohlc.test.ts`
  - 작업 기록: `Bot_Job_Log.md`(13번, 14번)
- 커밋 전 `bun test` 83개 통과
- 이 기록(15번)은 별도의 작업 기록 커밋 "Log the chart fix push in Bot_Job_Log.md"로 푸시했습니다.

### 16. strategy를 15분봉 전용으로 고정

**요청**: strategy 전략은 15분봉 기준으로 실행하고, 다른 시간봉은 전략에 쓰지 않습니다.

**사용자 확인 사항**

- 판단 시점: 지금처럼 매 틱 판단합니다. 형성 중인 15분봉에 현재가를 반영합니다.
- 차트의 전략 라인은 15m 화면에서만 표시합니다.

**변경**

- `src/strategy.ts`: `MAGINGA.timeframe = "15m"`, `MAGINGA.periodMs`(15분)를 추가했습니다.
- `src/model.ts`: `StrategyModel`이 시간봉 인자 없이 15분 캔들만 받습니다. `createModel`은 `market.bars("15m")`만 전달합니다.
- `src/config.ts`: `STRATEGY_TIMEFRAME` 설정과 `resolveTimeframe`을 삭제했습니다. 1m을 선택하는 방법은 더 이상 없습니다.
- `src/index.ts`: 시작 로그를 `model=strategy 15m 3x`로 고정했습니다.
- `web/src/components/FlowChart/FlowChart.tsx`: 차트 주기가 15m일 때만 전략 라인을 전달합니다. 가격 축 확장도 라인이 있을 때만 합니다. 그 결과 5m 등에서 캔들이 납작해지던 현상이 없어졌습니다.
- `.env`, `.env.example`: `STRATEGY_TIMEFRAME`을 삭제하고, 주석에 "15분봉 기준"을 명시했습니다.
- README: "15분봉 기준으로만 동작" 문구와 차트 표시 설명(15m에서만)을 추가했습니다. 환경 변수 표에서 `STRATEGY_TIMEFRAME`을 지웠습니다.

**검증**

- `test/strategy.test.ts`: 시간봉 설정 테스트를 `MAGINGA.timeframe`과 `periodMs` 확인으로 바꾸고, 모델 테스트를 15분 간격 봉으로 바꿨습니다. `bun test` 83개 통과, 대시보드 타입 검사 통과, 봇의 기존 타입 오류 5개 외에 새 오류 없음.
- 브라우저(실행 중인 strategy 봇):
  - 5m: 라인이 없고 캔들이 정상 높이로 표시됩니다.
  - 15m: short 86,197.6(빨강), long 83,364.4(초록)가 표시됩니다.
  - 다시 5m: 라인이 사라집니다. 콘솔 오류는 없었습니다.

### 17. 15분봉 고정 작업 커밋, 푸시

- 커밋 `7ff27e3` "Run the TradingView strategy on 15m candles only"를 `origin/main`에 푸시했습니다(`dce9d4d..7ff27e3`).
- 파일 10개를 커밋했습니다. 커밋 전 `bun test` 83개 통과를 확인했고, `.env`와 키 파일은 포함되지 않았습니다.

## 2026-10-07

### 18. 인수인계 정리

**요청**: 작업 내역을 기록하고, 다음에 이어서 작업할 수 있게 해 달라는 요청입니다.

**변경**

- `Bot_Job_Log.md`
  - 맨 위에 "다음 작업 시작하기" 섹션을 추가했습니다(처음 할 일, 현재 상태, `.env` 주요 값, 코드 지도, 결정 사항, 알려진 문제).
  - 17번과 18번 기록을 추가하고 "남은 작업"을 갱신했습니다.
- `CLAUDE.md`: 새 세션에서 이 파일을 먼저 읽고, 작업마다 기록하라는 "Session handoff" 섹션을 추가했습니다. Claude Code는 CLAUDE.md를 세션 시작 때 자동으로 읽습니다.
- 이 정리 내용은 커밋 "Add session handoff to Bot_Job_Log.md and CLAUDE.md"로 `origin/main`에 푸시했습니다.
- Claude 메모리(이 PC의 `~/.claude/projects/.../memory/`)에 작업 방식과 프로젝트 상태 위치를 저장했습니다. 이 메모리는 git에 올라가지 않고 이 PC에서만 쓰입니다.

**확인한 것**

- 저장소: 최신 커밋 `7ff27e3`, 커밋 안 된 변경 없음(정리 전 기준)
- 실행 중: 봇 3000, 대시보드 3001
- `.env`: `MODEL=strategy`, `STRATEGY_LEVERAGE=15`, `MAX_LEVERAGE=20`
- 발견: `STRATEGY_LEVERAGE=15`가 실제로는 10x로 적용됩니다. 실행 중인 봇의 판단 기록도 모두 10x였습니다. 코드는 바꾸지 않고 "알려진 문제" 첫 번째 항목으로 기록했습니다.

## 2026-10-10

### 19. 프로젝트 재분석

**요청**: 현재 프로젝트 분석.

**확인한 것**

- 저장소: 최신 커밋 `a795db8`, 커밋 안 된 변경 없음
- `bun test`: 83개 통과
- `tsc --noEmit`: 기존 타입 오류 5개 그대로 (`src/config.ts`, `src/model.ts`의 Jev 관련 코드)
- `src/types.ts`와 `web/src/lib/bot-types.ts`: 동일
- 새로 확인: 주문 크기는 `QUOTE_USD` 명목가 고정이고 레버리지는 증거금만 바꿉니다. "알려진 문제" 7번에 기록했습니다.
- 코드는 바꾸지 않았습니다.

### 20. 로컬 실행

**요청**: 로컬에서 서버 실행.

- `bun run start`(봇 3000)와 `bun run dev:web`(대시보드 3001)을 실행했습니다. 두 포트 모두 200 응답을 확인했습니다.
- 시작 로그: `bybit demo BTC ETH SOL DOGE BNB model=strategy 15m 15x tick 2000ms quote $40`, 코인 5개 모두 DRY RUN(키 없음)
- 시작 직후 5개 코인 모두 채널 안이라 관망(NO ORDER)입니다. 오류는 없었습니다.

### 21. 판단 주기 1분으로 변경, strategy 레버리지 15x 문제 수정

**요청**: 1분마다 판단하게 수정하고, 레버리지 15x 문제 수정.

**변경**

- `.env`: `TICK_MS=2000`을 `TICK_MS=60000`으로 바꿨습니다. 틱 자체가 1분이므로 "매 틱 판단"은 그대로이고, 판단과 재호가가 1분에 한 번 일어납니다. 15분봉 전략과 차트 갱신(`PRICE_MS=200`)은 그대로입니다. `.env`는 git에 올라가지 않으므로 코드 기본값(2000)과 `.env.example`은 바꾸지 않았습니다.
- `src/plan.ts`: `clampLeverage`를 추가했습니다. 설정값을 반올림해 1 이상, 코인 최대 레버리지(`MAX_LEVERAGE` 반영) 이하로만 제한합니다.
- `src/model.ts`: `StrategyModel`이 레버리지 단계(`parseLeverage`) 대신 `clampLeverage`를 씁니다. Jev와 mock은 기존 단계 그대로입니다.
- `test/strategy.test.ts`: 15는 15, 7은 7, 80은 코인 최대 50으로 나오는지 확인하는 테스트를 추가했습니다.

**확인한 것**

- `bun test` 84개 통과, 타입 오류는 기존 5개 그대로
- 봇 재시작 후 시작 로그 `tick 60000ms`, `/snapshot`의 `tickMs` 60000, BTC 틱 간격 실측 60초
- 지금은 5개 코인 모두 채널 안이라 관망이고, 15x 진입은 아직 실제 판단 로그로 보지 못했습니다(테스트로 확인).

**참고**

- 1분 틱이면 진입 PostOnly 주문의 재호가와 청산 반응도 1분 간격입니다. 급변 시 진입이 빠지거나 청산이 늦을 수 있습니다.
- `MODEL=jev`일 때 `HORIZON_BLOCKS=100`은 100틱(100분)이 되고, 계정 새로고침(5틱마다)은 5분마다가 됩니다.

### 22. 과거 3개월 데이터 백테스트 추가

**요청**: 과거 데이터 3개월 전부터 거래를 진행하고 싶다는 요청입니다. 과거 데이터로 전략을 돌려 보는 백테스트로 이해하고 진행했습니다(실제 주문 없음).

**변경**

- `src/strategy.ts`: 주문 규칙 부분을 `magingaRule(lines, last, side)`로 분리했습니다. 실제 봇(`magingaDecision`)과 백테스트가 같은 규칙을 씁니다. 동작은 그대로입니다.
- `src/backtest.ts` (새 파일): 1분봉을 하나씩 넣으며 매 1분 판단합니다.
  - 형성 중인 15분봉을 1분봉으로 만들고, EMA는 `EmaStep`으로 한 봉씩 계산합니다(파인 `ema`와 같은 값, 테스트로 확인).
  - 진입: 판단 가격에 PostOnly, 다음 1분봉이 그 가격을 뚫으면 체결, 메이커 수수료. 신호가 이어지면 새 가격으로 다시 걸고, 관망이면 취소(놓친 진입으로 집계).
  - 청산: 판단 가격에 바로 체결, 테이커 수수료.
  - 반영 안 함: 스프레드, 슬리피지, 펀딩비, 강제 청산.
- `src/backtest-run.ts` (새 파일): `bun run backtest [--months=3] [--from=YYYY-MM-DD] [--coins=BTC,ETH]`. 시작 전 15분봉 1000개 분량을 EMA 준비용으로 더 받습니다. 캔들은 `.backtest-cache/`, 거래 내역은 `backtest-results/*.csv`(UTC).
- `package.json`: `backtest` 스크립트 추가. `.gitignore`: `.backtest-cache/`, `backtest-results/` 추가.
- `test/backtest.test.ts`: 6개 테스트(EMA 일치, 주문 크기, 숏 진입부터 청산까지, 미체결 취소, 시작 전 거래 없음, 끝까지 보유한 포지션 평가).
- `README.md`: "백테스트" 섹션 추가.

**결과** (2026-07-09 ~ 2026-10-09 UTC, 15x, 주문 $40, 첫 실행 약 1분 35초)

| 코인 | 거래 | 승률 | 손익 | 수수료 | 최대 낙폭 | 격리 마진 청산 위험 거래 |
| --- | --- | --- | --- | --- | --- | --- |
| BTC | 15 | 87% | -$2.42 | $0.84 | $17.85 | 2 |
| ETH | 30 | 87% | $2.56 | $0.68 | $13.61 | 5 |
| SOL | 29 | 76% | -$3.77 | $0.78 | $13.05 | 6 |
| DOGE | 36 | 67% | $1.65 | $1.09 | $16.24 | 10 |
| BNB | 15 | 67% | -$2.01 | $0.43 | $10.13 | 2 |
| 합계 | 125 | | -$3.98 | $3.82 | | |

- 이긴 거래 평균 +$0.84, 진 거래 평균 -$2.47. 승률은 높지만 손절이 없어서, 8월 중순 상승장의 숏 몇 건이 21~41% 불리하게 움직이며 이익을 대부분 깎았습니다(예: BTC 숏 -$13.59, 26% 불리).
- 15x 격리 마진이면 약 6% 불리할 때 청산됩니다. 시뮬레이션은 청산 없이 버틴 것으로 계산했으므로 실제 결과와 다를 수 있습니다.
- 손절 방식 결정(알려진 문제 3번)이 중요하다는 근거입니다.

### 23. 서버 재시작

**요청**: 서버 재시작.

- 봇(3000)과 대시보드(3001)를 모두 끄고 다시 실행했습니다. 두 주소 모두 200 응답을 확인했습니다.
- 시작 로그: `model=strategy 15m 15x tick 60000ms quote $40`, 5개 코인 모두 DRY RUN, 채널 안이라 관망. 오류 없음.
- 22번의 `src/strategy.ts` 분리가 실제 봇에 반영된 상태입니다.

### 24. 차트를 3개월 전부터 표시, 4H와 1D 주기 추가

**요청**: 차트가 3개월 전부터 보이지 않는다는 요청입니다.

**원인**: 봇이 시작할 때 Bybit에서 15분봉을 1000개(약 10일)만 받았습니다. 대시보드는 받은 15분봉을 모두 보관하지만 받은 것이 10일치뿐이었습니다. 또 화면에는 최근 80개 봉만 보여서, 1H로도 약 3일만 보였습니다.

**변경**

- `src/bybit-feed.ts`: 15분봉을 1000개씩 과거로 넘겨 가며 `CHART_DAYS`(기본 92일)까지 받습니다. 1분봉은 전처럼 1000개만 받습니다.
- `src/config.ts`: `chartDays` 추가. `.env.example`에 `CHART_DAYS=92` 추가.
- `web/src/lib/ohlc.ts`: 주기에 `4H`, `1D`를 추가했습니다. 1H, 4H, 1D는 1분봉 이전 구간의 15분봉과 1분봉을 한 번에 묶어, 경계의 봉이 일부 시간만 담기지 않게 했습니다(기존 1H 테스트 결과는 그대로).
- `web/src/components/FlowChart/FlowChart.tsx`: 4H, 1D 버튼 추가.
- `test/ohlc.test.ts`: 1D, 4H 묶음 테스트 추가.
- `README.md`: 설정 표에 `CHART_DAYS` 추가.

**확인한 것**

- 봇 재시작 후 `/tape`: 코인마다 15분봉 9000개, 2026-07-07부터. gzip 약 0.8MB.
- 전략 라인 값은 재시작 전과 소수점 넷째 자리까지 같았습니다(EMA 시작점이 달라져도 수렴).
- 브라우저에서 1D를 누르면 약 3개월이 한 화면에 보이고, 8월 중순 상승장(BTC 약 64k에서 78k)이 보였습니다. 콘솔 오류 없음.
- `bun test` 91개 통과. 대시보드 타입 검사 통과.

**참고**: 1m, 5m 화면은 1분봉 1000개(약 16시간)만 있습니다. 15m, 1H는 화면을 끌어서 과거로 이동하면 3개월까지 보입니다.

### 25. 봇 재시작 후 차트가 10월 9일부터만 보이는 문제 수정

**요청**: 차트가 10월 9일부터만 표시된다는 요청입니다.

**원인**: 대시보드(`web/src/lib/useFeed.ts`)는 전체 캔들(`/tape`)을 페이지를 처음 열 때 한 번만 받았습니다. 봇이 재시작되면 페이지가 다시 연결하면서 스냅샷을 받는데, 스냅샷에는 최근 1분봉 400개 정도만 있고 이것이 차트 데이터를 덮어씁니다. 그 뒤 전체 캔들을 다시 받지 않아서, 열어 둔 탭은 10월 9일부터만 보였습니다. 24번에서 봇을 재시작할 때 사용자 탭이 이 상태가 됐습니다.

**변경**: `web/src/lib/useFeed.ts`에서 스냅샷을 받을 때마다 전체 캔들을 다시 받게 했습니다.

**확인한 것**

- 브라우저로 페이지를 연 상태에서 봇을 재시작하고, 새로고침 없이 1D를 눌러 7월 말부터 보이는 것을 확인했습니다.
- `bun test` 91개 통과, 대시보드 타입 검사 통과.

### 26. 백테스트 거래를 차트에 표시

**요청**: 백테스트 거래도 차트에 표시.

**변경**

- `src/types.ts`, `web/src/lib/bot-types.ts`: `BacktestTrade`, `BacktestReport` 타입 추가(두 파일 동일). `src/backtest.ts`는 이 타입을 씁니다.
- `src/backtest-run.ts`: 실행 결과를 `backtest-results/latest.json`에도 저장합니다(파일 경로 상수 `BACKTEST_LATEST`는 `src/backtest.ts`).
- `src/server.ts`: `GET /backtest`가 그 파일을 돌려줍니다. 없으면 404.
- `web/src/lib/backtest.ts`: 거래를 차트 표시로 바꾸는 `backtestMarks`(보기 주기의 봉에 맞춤, 차트에 없는 봉은 생략), `parseBacktest`.
- `web/src/lib/useBacktest.ts`: 봇 시작 시점(`meta.startedAt`)마다 `/backtest`를 한 번 읽습니다.
- `web/src/components/FlowChart/CandlePane.tsx`: 파란색(`#1f5fd6`) 표시. 진입은 화살표와 `BT long` / `BT short`, 청산은 원과 손익(`BT -$13.59`), 보유 중은 `BT long open`.
- `web/src/components/FlowChart/FlowChart.tsx`, `FlowChart.module.css`, `web/src/app/globals.css`, `web/src/app/page.tsx`: `BT` 켜기/끄기 버튼(기본 켬, 설명 툴팁), 범례 "strategy backtest (simulated)".
- `test/backtest-marks.test.ts`: 3개 테스트 추가.
- `README.md`: 백테스트 섹션에 차트 표시 설명 추가.

**지킨 것 (CLAUDE.md)**: 실제 체결(초록, 빨강 화살표)과 다른 색과 모양을 쓰고, 범례에 "strategy backtest (simulated)"로 적어 Jev나 실제 거래로 보이지 않게 했습니다. 문구에 가운뎃점, em/en 대시를 쓰지 않았고 깜빡임도 없습니다.

**확인한 것**

- 백테스트를 다시 실행해 `latest.json` 생성(합계 125건, -$3.65. 22번과 약간 다른 것은 실행 시점에 따라 마지막 열린 포지션 평가가 달라서), 봇 재시작 후 `/backtest`에서 코인별 거래 수 확인.
- 브라우저 1D 화면에서 BTC 표시 확인(8월 17일 `BT short`, 8월 28일 `BT -$13.59`, 10월 8일 `BT long open`). `BT` 버튼을 끄면 사라짐.
- `bun test` 94개 통과, 봇 타입 오류는 기존 5개 그대로, 대시보드 타입 검사 통과.

### 27. 전략 라인을 과거부터 모든 주기 차트에 표시

**요청**: 차트에 전략 라인 표시.

**변경**: 전에는 15m 화면에서만, 현재 값을 가로선 하나로 표시했습니다. 이제 과거 3개월부터 가격을 따라 움직이는 점선 두 개로, 모든 주기에서 표시합니다. 16번의 "15m에서만 표시" 결정은 이번 요청으로 바뀌었습니다. 값은 여전히 15분봉으로 계산합니다.

- `src/strategy.ts`: `magingaChannel(bars)` 추가. 15분봉마다 그 봉 마감 시점의 롱, 숏 라인(전략과 같은 `emaSeries`).
- `src/types.ts`, `web/src/lib/bot-types.ts`: `ChannelPoint` 타입 추가(두 파일 동일).
- `src/server.ts`: `GET /levels`. 코인별로 15분봉 전체의 채널(유효숫자 8자리). `MODEL=strategy`가 아니면 빈 객체. gzip 약 0.5MB.
- `web/src/lib/levels.ts`: `channelForView`(보기 주기의 봉마다 그 봉이 끝나는 15분봉 값, 가장 최근 봉은 이번 틱의 값), `parseLevels`.
- `web/src/lib/useLevels.ts`: 봇 시작마다 읽고 5분마다 다시 읽음.
- `web/src/components/FlowChart/CandlePane.tsx`: 가로선(price line) 대신 점선 라인 시리즈 두 개. 오른쪽 축에 현재 값 표시. 자동 축 범위에 포함.
- `web/src/components/FlowChart/FlowChart.tsx`, `web/src/app/page.tsx`: 15m 제한 제거, 연결. 가격이 바뀔 때마다가 아니라 봉이 추가되거나 주기가 바뀔 때만 다시 계산.
- `test/strategy.test.ts` 1개, `test/levels.test.ts` 5개 테스트 추가.
- `README.md`: 차트 표시 설명 수정.

**확인한 것**

- `/levels`의 BTC 마지막 값(롱 81107.07, 숏 84004.74)이 봇 로그의 전략 라인과 같음.
- 브라우저 5m 화면과 1D 화면에서 점선 두 개 확인. 1D에서 3개월 채널과 BT 표시가 함께 보이고, 8월 17일 숏 진입이 빨간 선에서 일어난 것이 보임.
- `bun test` 100개 통과, 봇 타입 오류는 기존 5개 그대로, 대시보드 타입 검사 통과.

### 28. 차트 기본 주기를 15m으로 변경

**요청**: 차트를 처음 열 때 5분봉 대신 15분봉으로 표시.

- `web/src/components/FlowChart/FlowChart.tsx`: `DEFAULT_INTERVAL`을 `"5m"`에서 `"15m"`으로 바꿨습니다. 다른 코인 탭을 누를 때도 15m으로 돌아갑니다(기존 동작 그대로).
- 확인: 브라우저에서 페이지를 새로 열면 15m 버튼이 켜진 상태로, 15분봉과 전략 라인이 보임. `bun test` 100개 통과, 대시보드 타입 검사 통과.

### 29. 전략 라인으로 수익을 높이는 방법 찾기

**요청**: 15분봉 전략 라인을 이용해 수익을 극대화할 방법 찾기.

**방법**

- `src/backtest.ts`에 변형 옵션 추가(생략하면 라이브와 같음): `stopPct`(분 안에서 닿으면 손절, 갭이면 시가 체결. 손절 뒤 같은 방향은 신호가 한 번 꺼질 때까지 재진입 안 함), `exit: "mid"`(채널 중간에서 청산), `onBarClose`(15분봉 마감 때만 판단). 결과에 `stops` 추가.
- `src/strategy.ts`: `MagingaParams` 타입. 백테스트가 EMA 길이와 밴드 폭을 바꿔 볼 수 있게 했습니다. 라이브는 `MAGINGA` 그대로.
- `src/backtest-data.ts`: 다운로드와 캐시 코드를 `backtest-run.ts`에서 분리.
- `src/backtest-sweep.ts`, `bun run sweep`: 192가지 변형 x 5개 코인. 12개월(2025-10-09 ~ 2026-10-09) 1분봉, 앞 구간으로 고르고 뒤 구간으로 확인. 두 가지 나누기(9개월/3개월, 6개월/6개월)로 실행. 첫 실행 4분 43초(다운로드 포함), 이후 약 30초.
- `test/backtest.test.ts`: 손절, 중간 청산, 봉 마감 판단 테스트 3개 추가.

**결과** (코인당 1회 $40, 5개 코인 합계, 수수료 포함, 슬리피지와 펀딩비 제외)

| 변형 | 9개월 | 뒤 3개월 | 앞 6개월 | 뒤 6개월 | 격리 청산 위험 거래 |
| --- | --- | --- | --- | --- | --- |
| 지금 라이브 (EMA 125, 1.618%, 손절 없음, 반대 라인 청산, 매 1분) | -$50.84 | -$4.02 | -$35.31 | -$17.09 | 189 |
| 라이브 + 손절 5% | -$86.14 | +$18.13 | -$44.63 | -$20.80 | 9 |
| 후보 A: EMA 200, 2.5%, 손절 5%, 중간 청산, 매 1분 | +$18.23 | +$7.12 | +$24.48 | +$1.70 | 9 |
| 후보 B: EMA 200, 1.618%, 손절 5%, 중간 청산, 봉 마감 | +$5.12 | +$10.26 | -$0.57 | +$16.64 | 9 |

- 지금 라이브 규칙은 12개월 내내 손실이었습니다.
- 앞 구간 1위들(밴드 3.82%, 손절 없음)은 뒤 구간에서 모두 크게 손실: 과거에만 맞춘 결과입니다.
- 손절 2~3%는 앞 구간 중앙값 약 -$80으로 오히려 나빴습니다(잦은 손절).
- 손절 5%는 격리 마진 청산 위험 거래를 약 190건에서 9건으로 줄였습니다.
- 네 구간 모두 이익인 변형은 후보 A 하나뿐(192개 중). 이익 규모는 작고(12개월 약 +$25, 명목가 $200 기준 약 13%), 192개 중 하나라 우연일 수 있습니다.

**라이브 설정은 바꾸지 않았습니다.** 사용자 결정 대기: 후보 A를 dry run으로 먼저 돌려볼지, 더 긴 기간(2년)으로 검증할지, 추세 필터 같은 다른 아이디어를 더 시험할지.

### 30. 후보 B로 봇 수정

**요청**: 29번 후보 B로 봇 수정.

**적용한 설정** (`.env`, 비우면 원본 스크립트 그대로)

| 변수 | 값 | 뜻 |
| --- | --- | --- |
| `STRATEGY_EMA_LEN` | `200` | 채널 EMA 길이 (원본 125) |
| `STRATEGY_STOP_PCT` | `5` | 진입가 대비 5% 불리하면 청산 (원본 없음) |
| `STRATEGY_EXIT` | `mid` | 채널 중간에서 청산 (원본은 반대 라인) |
| `STRATEGY_ON_BAR_CLOSE` | `true` | 마지막으로 마감된 15분봉으로 판단 |

밴드 폭(1.618%), 레버리지(15x), 주문 크기($40), 판단 주기(1분)는 그대로입니다.

**변경**

- `src/strategy.ts`: `StrategyRules`, `SCRIPT_RULES`, `strategyCall`(손절, 원본 라인 규칙, 채널 중간 청산 순서), `rearm`(손절 뒤 같은 방향은 신호가 한 번 꺼질 때까지 재진입 안 함), `closedBars`. 라이브와 백테스트가 같은 함수를 씁니다.
- `src/config.ts`: `STRATEGY_EMA_LEN`, `STRATEGY_STOP_PCT`, `STRATEGY_EXIT`, `STRATEGY_ON_BAR_CLOSE` 읽기와 검증.
- `src/model.ts`: `liveStrategy`(설정에서 만든 변형), `describeStrategy`. `StrategyModel`이 이 변형으로 판단합니다. 봉 마감 모드에서도 매 틱 판단하되(CLAUDE.md의 "매 틱 판단" 유지) 마감된 봉을 읽어 신호가 15분 동안 유지되고, 진입 주문은 매 틱 현재 호가로 다시 겁니다.
- `src/backtest.ts`: 라이브와 똑같이 맞췄습니다. 손절은 분 안의 고가/저가가 아니라 매 틱 가격으로 확인, 봉 마감 모드는 마감 사이에도 매 틱 다시 호가. 29번의 백테스트 구현과 이 두 가지가 달랐습니다.
- `src/server.ts`(`/levels`), `src/index.ts`(시작 로그), `src/backtest-run.ts`, `src/backtest-sweep.ts`: 같은 변형을 씁니다. sweep은 "script as written"과 "live (now)"를 함께 보여 줍니다.
- `.env`, `.env.example`, `README.md`: 설정 설명 추가.
- 테스트: `test/strategy.test.ts`에 5개 추가(손절과 재진입 대기, 중간 청산, 봉 마감 판단, EMA 길이, 설정 검증). `test/backtest.test.ts` 손절 테스트를 매 틱 가격 기준으로 수정.

**확인한 것**

- 라이브와 같은 규칙으로 다시 비교(`bun run sweep`): 후보 B는 앞 9개월 +$5.59 / 뒤 3개월 +$7.90(5개 코인 모두 이익), 앞 6개월 -$4.78 / 뒤 6개월 +$18.96. 29번과 비슷합니다. 원본 스크립트는 같은 구간에서 -$50.08 / -$3.71, -$34.56 / -$16.65.
- 최근 3개월 백테스트(`bun run backtest`): 209건, +$7.74(원본 규칙은 -$3.65). 차트의 BT 표시도 이 결과로 바뀌었습니다. 손절이 틱 가격 기준이라 분 안에서 6% 넘게 밀린 거래가 3건 있었습니다(15x 격리 마진이면 청산 위험).
- 봇 재시작: 시작 로그 `model=strategy 15m 15x (EMA 200, stop 5%, exit mid, bar close)`. 시작 직후 SOL, DOGE가 롱 진입 신호로 가상 매수 주문(백테스트 마지막 상태와 같음). `/levels`도 EMA 200 라인.
- `bun test` 108개 통과, 봇 타입 오류는 기존 5개 그대로.

**참고**: 대시보드 상단은 계속 "by TradingView strategy"로 표시됩니다. 판단은 코드가 하고 규칙의 출처가 TradingView 채널 전략이라 사실과 맞지만, 원본에서 바꾼 변형이라는 점은 표시하지 않습니다.

### 31. History 탭에 백테스트 거래 기록 표시

**요청**: 3개월 전부터 현재까지의 백테스트 거래 기록을 History 메뉴에 표시.

**변경**

- `web/src/lib/backtest.ts`: `backtestLots`(청산된 백테스트 거래를 History 행으로. 손익은 봇 행과 같이 수수료 전, 수수료는 별도 열. 끝까지 보유 중인 거래는 제외), `lotSummary`(거래 수, 승률, 수수료 뺀 손익).
- `web/src/lib/format.ts`: `fmtDateTime`("07/09 04:37"). 3개월에 걸친 기록이라 시각만으로는 부족해서 날짜를 붙였습니다.
- `web/src/components/Book/Book.tsx`, `Book.module.css`: History에 백테스트 행 추가. Source 열(`backtest` 파란색 / `bot`), 위쪽 요약 줄 "backtest (simulated) 기간, 거래 수, 승률, net", `Backtest` 켜기/끄기 버튼(BTC / All 옆). 시간 칸에 마우스를 올리면 진입 시각. 표시 상한 200행에서 2000행으로.
- `web/src/app/page.tsx`: Book에 백테스트 결과 전달.
- 테스트 2개 추가. 그리고 30번에서 `.env`에 후보 B를 넣은 뒤 기존 StrategyModel 테스트 2개가 실패했습니다. Bun이 테스트에서도 `.env`를 읽어서 원본 규칙을 확인하던 테스트가 후보 B로 돌았기 때문입니다. 해당 테스트에 원본 규칙(`SCRIPT`)을 명시해 `.env`와 무관하게 했습니다.

**확인한 것**

- 브라우저 History 탭(BTC): 요약 "2026-07-09 to 2026-10-09, 28 closed, win 68%, net +$0.28", 날짜와 함께 `backtest` 행 표시.
- `bun test` 110개 통과, 대시보드 타입 검사 통과.

**참고**: 차트 시간축은 UTC, 표의 시각은 브라우저 현지 시각(한국이면 UTC+9)입니다(기존부터 그랬음). 같은 거래가 차트에서는 11:45, 표에서는 20:45로 보입니다.

### 32. dry run 시작 잔액 $500, 가상 체결에 수수료 반영

**요청**: 봇 초기 잔액을 500달러로 시작.

**전 상태**: dry run(키 없음)에는 잔액이 없어서 상단 balance가 비어 있었습니다. `BANKROLL_USD=200`은 손익 %를 계산할 때만 쓰였습니다. 가상 체결은 수수료도 내지 않았습니다.

**변경**

- `src/config.ts`: `BANKROLL_USD` 기본값 500(전체 금액). 가상 체결 수수료 `simMakerFee` 0.02%, `simTakerFee` 0.055%(Bybit 기본, 백테스트와 같음).
- `src/index.ts`: 코인마다 `BANKROLL_USD / 코인 수`로 시작(5개면 $100씩).
- `src/trader.ts`: 지갑이 없으면(dry run) 잔액 = 시작 금액 + 수수료 뺀 손익, 출금 가능 = 잔액 - 보유 포지션 증거금(명목가 / 레버리지). 진입(대기 주문) 가상 체결은 메이커 수수료, 청산(IOC) 가상 체결은 테이커 수수료. 손익 %도 코인별 시작 금액 기준. 실제 키가 있으면 전처럼 Bybit 계좌 잔액.
- `src/trades.ts`: `aggregateFills`가 합친 체결들의 수수료를 유지.
- `.env`(`BANKROLL_USD=500`), `.env.example`, `README.md`.
- 테스트 2개 추가(dry run 잔액, 수수료 합치기).

**확인한 것**

- 봇 재시작 후 코인별 balance 100, 합계 500.
- 재시작으로 가상 포지션은 초기화됐고, SOL, DOGE가 같은 롱 신호로 다시 진입. SOL 진입 수수료 $0.0066(0.3 x 109.48 x 0.02%), 출금 가능 $97.81(100 - 32.84 / 15).
- `bun test` 112개 통과, 봇 타입 오류는 기존 5개 그대로.

**참고**: dry run 잔액은 봇 메모리에만 있어서 봇을 재시작하면 다시 $500부터 시작합니다. 실제 키로 운영하면 Bybit 서브계정에 $500을 넣어야 합니다(봇이 바꿀 수 없음).

### 33. 백테스트 수익을 balance에 반영

**요청**: 백테스트의 수익도 balance 수익에 반영.

**방식**: dry run일 때 코인별 시작 잔액을 `BANKROLL_USD / 코인 수 + 그 코인의 청산된 백테스트 거래 손익(수수료 뺌)`으로 합니다. 3개월 전 $500으로 시작해 백테스트 거래를 하고, 그 잔액에서 봇이 이어서 거래하는 셈입니다.

- 실제 키가 있는 코인은 Bybit 실제 잔액을 쓰고 백테스트를 더하지 않습니다(실제 돈처럼 보이면 안 되므로).
- 백테스트가 끝날 때 보유 중이던 포지션은 넣지 않습니다. 봇이 지금 같은 신호로 자기 포지션을 다시 잡으므로, 넣으면 같은 움직임을 두 번 셉니다.
- 상단에 `backtest` 항목을 따로 보여 줘서 balance에 얼마가 들어 있는지 알 수 있게 했습니다(마우스를 올리면 설명).

**변경**

- `src/backtest.ts`: `closedNetByCoin`, `readBacktestReport`.
- `src/index.ts`: 시작할 때 `latest.json`을 읽어 dry run 코인의 시작 잔액에 더함. 시작 로그에 `balance $100.28 (start $100.00 + backtest $0.28)`처럼 표시.
- `src/types.ts`, `web/src/lib/bot-types.ts`: `SleeveMeta.backtestUsd`(봇이 실제로 더한 금액, 두 파일 동일).
- `web/src/lib/useFeed.ts`: 이 값을 읽도록 수정(모르는 필드는 버리는 구조였음).
- `web/src/components/Header/Header.tsx`, `web/src/app/page.tsx`: 상단 `backtest` 항목.
- 테스트 1개 추가. `README.md` 설정 표 수정.

**확인한 것**

- 백테스트를 다시 실행(현재까지, 209건, 열린 포지션 포함 +$7.80)하고 봇 재시작. 청산된 거래 기준 BTC +0.28, ETH +2.73, SOL +0.98, DOGE +2.71, BNB +1.27.
- 브라우저 상단: `balance $507.97`, `backtest +$7.97`.
- `bun test` 113개 통과, 봇 타입 오류는 기존 5개 그대로, 대시보드 타입 검사 통과.

**참고**

- 봇은 시작할 때만 `latest.json`을 읽습니다. 백테스트를 다시 돌리면 봇을 재시작해야 반영되고, 재시작하면 dry run 손익과 포지션은 초기화됩니다(32번).
- 백테스트가 끝난 시점과 봇이 시작한 시점 사이의 거래는 어느 쪽에도 들어가지 않습니다. 백테스트를 돌린 직후 봇을 재시작하면 이 틈이 짧아집니다.

### 34. Jev로 수익 극대화가 되는지 검토

**요청**: Jev 기능을 쓰면 트레이딩 수익이 극대화될지 질문.

**답변 요지** (코드 변경 없음)

- 알 수 없음. Jev의 성과 자료가 없고, Jev는 호가창과 체결 기록을 보는데 과거 호가 데이터가 없어 공정한 백테스트가 어렵습니다(3개월이면 약 65만 번 호출).
- Jev는 15분봉 채널 규칙이나 손절을 모르고, 매 틱 레버리지까지 직접 고릅니다(`MAX_LEVERAGE=20` 상한). 1분 판단은 수수료 부담이 큽니다.
- 호출 비용: 1회 1~3천 토큰 가정 시 5개 코인 1분 판단으로 하루 약 $0.3~$0.9(코드 단가 100만 토큰당 $0.042 기준, 실제 토큰 수는 미확인).
- `.env`에 Jev 키가 없어 바로 실행할 수 없음.
- 제안: 같은 기간 dry run으로 두 봇을 나란히 비교.

### 35. 전략 봇과 Jev 봇을 나란히 비교하는 구성

**요청**: Jev 봇도 나란히 비교할 수 있게 구성.

**변경**

- `package.json`: `start:jev`(`PORT=3002 MODEL=jev DRY_RUN=true`, 명령줄 값이 `.env`보다 우선), `dev:web:jev`, `compare`.
- `web/package.json`: `dev:jev`(`NEXT_PUBLIC_API_URL=http://localhost:3002`, 포트 3003). `web/next.config.ts`: `NEXT_DIST_DIR`로 빌드 폴더를 나눠 두 대시보드를 동시에 실행. `web/.gitignore`에 `.next-*`.
- `src/index.ts`: 백테스트 손익은 `MODEL=strategy`일 때만 시작 잔액에 더함(Jev 봇은 $500부터, 공정한 비교). Jev 키가 없으면 코인마다 재시도하지 않고 처음에 이유를 알리고 멈춤.
- `src/server.ts`: `GET /backtest`는 `MODEL=strategy`일 때만(Jev 화면에 전략 백테스트가 Jev 것처럼 보이지 않게).
- `src/compare.ts`(새 파일): 두 봇의 `/`를 읽어 판단 주체, 실행 시간, balance, 그중 백테스트, 시작 뒤 손익(실현, 미실현, 수수료), 체결, 판단 수, 지연 틱, Jev 비용, 보유 포지션을 한 표로.
- `README.md`: "전략 봇과 Jev 봇 나란히 비교" 섹션.

**확인한 것**

- Jev 키가 없어서 `bun run start:jev`는 "needs TYPESAFE_API_KEY" 메시지로 바로 멈춤(의도대로).
- 연결 확인은 두 번째 봇을 잠시 `MODEL=mock`으로 띄워서 함: :3002 봇과 :3003 대시보드 동작, :3001 대시보드도 그대로, :3002의 `/backtest`는 404, 두 번째 봇 balance $500에서 시작, `bun run compare` 표 정상, 대시보드 상단 "by mock model". 확인 후 mock 봇은 종료.
- `bun test` 113개 통과, 봇 타입 오류는 기존 5개 그대로.

**남은 것**: Jev API 키를 `.env`에 넣고 `bun run start:jev` 실행. 공정하게 비교하려면 전략 봇도 같은 시각에 재시작.

## 2026-10-15

### 36. 프로젝트 분석 후 로컬 서버 실행

**요청**: 프로젝트를 분석하고 로컬 서버 실행.

**변경**: 코드 변경 없음.

**확인한 것**

- `bun run start`(봇 :3000), `bun run dev:web`(대시보드 :3001, Next 16.3.8) 실행.
- `.env`는 `MODEL=strategy`, `BYBIT_ENV=demo`, `DRY_RUN=false`지만 Bybit 키가 없어 5개 코인 모두 DRY RUN(실제 주문 없음, `SIM` 체결).
- 대시보드 `/` 200, 봇 `/backtest` 200, `/events` SSE 스냅샷 정상. 시작 직후 5개 코인 모두 15x 롱 가상 진입.
- `git status`에 커밋 안 된 변경이 많음(19번 이후 작업). 인수인계 표의 "커밋 안 된 변경 없음"은 18번 기준이라 맞지 않음.

### 37. 대시보드 상단 타이틀을 "ChoRong Jev Trade"로 변경

**요청**: 대시보드 상단 Jev Trade 타이틀을 "ChoRong Jev Trade"로 수정.

**변경**

- `web/src/components/Header/Header.tsx`: 상단 `h1`을 `ChoRong Jev Trade`로.
- 브라우저 탭 제목, 메타 정보(`web/src/app/layout.tsx`), 로고 `aria-label`(`Logo.tsx`)은 그대로 `Jev Trade`.

**확인한 것**: 실행 중인 :3001 대시보드 HTML에 `ChoRong Jev Trade` 표시됨.

## 2026-10-16

### 38. 차트의 백테스트 거래 표시를 읽기 쉽게

**요청**: 차트에 표시하는 백테스트 거래 기록을 Long/Short, 수량, PnL 등이 보이게 가독성 있게.

**변경**

- `web/src/lib/backtest.ts`: 진입 표시 `BT Long 0.001`(방향과 수량, 열린 거래는 `open`), 청산 표시 `BT +$0.67`(수수료 뺀 손익). 표시에 거래 원본과 수익 여부를 담음. 호버 카드용 `backtestDetail`(수량, 레버리지, 진입/청산 시각과 가격, 보유 시간, PnL과 ROE, 수수료, 최대 역행), `fmtSize`, `roePct`, `fmtHeld` 추가.
- `web/src/components/FlowChart/CandlePane.tsx`: 진입은 파란 화살표, 청산 원은 수익이면 초록(#0a7a3a), 손실이면 주황빨강(#c2410c). 백테스트 표시가 있는 봉에 마우스를 올리면 거래 상세 카드 표시("simulated by the strategy backtest, not a real fill" 문구 포함).
- `FlowChart.tsx`, `FlowChart.module.css`: 범례에 BT entry / BT win / BT loss, 카드 스타일. 코인별 백테스트 레버리지를 카드에 전달.
- `test/backtest-marks.test.ts`: 새 문구와 카드 내용 테스트.

**확인한 것**

- `bun test` 114개 통과, `web` 타입 검사 통과.
- 브라우저 4H 차트에서 표시와 호버 카드 확인(예: BT Short BTC 0.001 15x, 10/05 07:30 86210.0 → 10/06 00:15 85479.7, +$0.67 ROE +11.6%).
- 처음에는 가격이 들어올 때마다 표시가 다시 만들어져 카드가 바로 닫혔음. 다시 만들 때 호버를 지우지 않게 고침.

### 39. 봇과 대시보드 재시작

**요청**: 서버 재시작.

**변경**: 코드 변경 없음. :3000 봇과 :3001 대시보드를 내렸다가 다시 실행.

**확인한 것**: 대시보드 `/` 200, 봇 `/backtest` 200. 재시작 후 첫 틱은 5개 코인 모두 hold(채널 안). dry run 상태는 재시작하면 초기화되어 그전 가상 포지션(DOGE 롱)은 사라짐.

### 40. 차트 시간을 UTC+9 기본으로

**요청**: 차트 시간을 UTC+9 기본으로.

**변경**

- `web/src/lib/chartTime.ts`(새 파일): 시간축 라벨(`tickLabel`), 십자선 라벨(`crosshairLabel`, `2026-10-15 15:30`), 호버 카드 시각(`zonedDateTime`). 봉은 그대로 UTC 경계에 두고 라벨만 시차만큼 옮김(1D 봉은 UTC 00:00 = KST 09:00 시작, 거래소 기준과 같음).
- `CandlePane.tsx`: `tickMarkFormatter`, `timeFormatter`에 연결. 백테스트 호버 카드 시각도 차트 시간대를 따름.
- `FlowChart.tsx`, `FlowChart.module.css`: 주기 버튼 옆에 `UTC+9` / `UTC` 전환 버튼(기본 UTC+9). 새로고침하면 UTC+9로 돌아감.
- `backtest.ts`: `backtestDetail`에 시각 형식 함수 인자(기본은 기존 현지 시각).
- `test/backtest-marks.test.ts`: 시간대 라벨 테스트.

**확인한 것**: `bun test` 115개 통과, `web` 타입 검사 통과. 브라우저에서 같은 봉이 UTC+9는 15:30, UTC는 06:30으로 9시간 차이로 표시됨.

### 41. 커밋과 푸시

**요청**: 커밋하고 푸시.

**변경**: 19번부터 40번까지 쌓인 변경(백테스트, sweep, 전략 변형, 전략 라인, Jev 비교, 백테스트 표시, UTC+9 차트 등)을 한 커밋으로 `origin/main`에 푸시. 이 기록도 같은 커밋에 포함.

**확인한 것**: 커밋 전 `bun test` 115개 통과. 비밀값 검사에서 걸린 것 없음. `.env`, `web/.env.local`, `backtest-results/`, `.backtest-cache/`는 git에서 제외되어 올라가지 않음.

## 2026-10-18

### 42. 서버 실행, 백테스트를 서버 시작 시각까지

**요청**: 서버 실행. 백테스트가 10월 9일까지만 되어 있으니 서버가 동작한 시점까지 백테스트하도록.

**원인**: `backtest-results/latest.json`은 10월 10일 01:47(KST)에 `bun run backtest`를 손으로 돌린 결과였고, 봇은 시작할 때 이 파일을 읽기만 했습니다. 그래서 10월 9일 이후 거래가 차트와 dry run 잔액에 없었습니다.

**변경**

- `src/backtest-report.ts`(새 파일): `backtest-run.ts`의 코인별 실행 부분을 `backtestCoins`로 분리. `refreshBacktest`는 최근 3개월부터 봇 시작 시각(분 단위)까지 돌려 `latest.json`에 저장. 한 코인이라도 실패하면 저장하지 않고 기존 파일을 그대로 둠(그 코인 거래가 차트에서 사라지지 않게).
- `src/index.ts`: `MODEL=strategy`면 시작할 때 `refreshBacktest` 실행 후 그 결과로 dry run 잔액 계산. 실패하면 저장된 결과를 읽고 그 끝 시각을 로그에 남김.
- `src/backtest-run.ts`: `backtestCoins`를 쓰도록 정리. 출력과 CSV는 그대로.

**확인한 것**: `bun test` 115개 통과, 타입 오류는 기존 Jev 관련 5개뿐. 재시작 로그 `backtest: 2026-07-17 to 2026-10-17T18:47 UTC in 12820ms`(KST 10/18 03:47까지). 캔들 캐시가 있어 빠진 9일만 받아옴. `GET /backtest`의 `to`가 시작 시각, 코인별 마지막 진입은 10/14~10/16. dry run 잔액도 새 결과 기준(BTC $101.62, ETH $103.12, SOL $100.63, DOGE $99.86, BNB $101.38).

**참고**: 백테스트 끝에 열려 있는 거래(지금은 DOGE)는 잔액에 넣지 않고, 봇은 포지션 없이 시작합니다(기존과 같음).

## 2026-10-21

### 43. 220.76.214.201 서버 배포와 자동 배포 설정

**요청**: `www.gpurent.io`는 대시보드, `api.gpurent.io`는 봇 API로, 두 도메인 모두 nginx로 `220.76.214.201`에 연결하고, 자동 배포되게 설정.

**구성**

| 항목 | 내용 |
| --- | --- |
| 서버 | Ubuntu 24.04, 사용자 `mineos`(접속 키 `/Users/mac/keyfile/www.pem`), sudo 비밀번호 필요. shipgo 사이트, MySQL, Redis가 같이 돌고 있음 |
| 앱 위치 | `~/jevtrade` (GitHub에서 clone), bun은 `~/.bun/bin/bun` (1.4.3). Node 없이 `bun --bun next`로 대시보드 실행 |
| 서비스 | systemd `jevtrade-bot`(`bun run src/index.ts`, :3000), `jevtrade-web`(`next start`, :3001). 둘 다 127.0.0.1에만 바인딩하고 부팅 시 자동 시작 |
| nginx | `/etc/nginx/sites-available/gpurent.conf`. `gpurent.io`는 www로 리다이렉트, www는 :3001, api는 :3000. SSE를 위해 api는 버퍼링 끄고 타임아웃 24시간 |
| 서버 `.env` | 로컬과 같은 값(demo, strategy, 키 없음 = dry run)에 `HOST=127.0.0.1` 추가. `backtest-results/`도 복사 |
| 자동 배포 | main에 push하면 GitHub Actions가 `bun test`를 돌리고, 통과하면 SSH로 해당 커밋을 checkout하고 `deploy/deploy.sh` 실행(설치, `NEXT_PUBLIC_API_URL=https://api.gpurent.io`로 빌드, 재시작, 헬스 체크) |
| 배포 키 | CI 전용 ed25519 키를 새로 만들어 서버 `authorized_keys`에 `restrict` 옵션으로 추가. 개인키는 GitHub Secrets에만 있음(`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) |
| sudo | `/etc/sudoers.d/jevtrade`: `mineos`가 두 서비스 restart, status만 비밀번호 없이 실행 가능 |

**새 파일**: `deploy/deploy.sh`, `deploy/setup-server.sh`(최초 1회, `sudo bash deploy/setup-server.sh`), `deploy/nginx/gpurent.conf`, `deploy/systemd/jevtrade-{bot,web}.service`, `.github/workflows/deploy.yml`

**코드 변경**: `HOST` 환경변수 추가(`src/config.ts`, `src/server.ts`, 기본 `0.0.0.0`). 서버에서는 `127.0.0.1`로 두어 :3000이 nginx를 거치지 않고 외부에 열리지 않게 함. `.env.example`, README에 설명 추가.

**확인**: 서버에서 nginx를 거쳐 www 200, api `/` JSON, `/events` SSE 스트림 정상. 기존 shipgo 사이트 응답 그대로. 로컬 `bun test` 115개 통과.

**참고**
- setup의 `apt-get install`이 이미 설치된 nginx, git, curl을 Ubuntu 최신 패치 버전으로 올림(nginx는 무중단 교체).
- 지금 서버 코드는 41번 커밋에 43번 파일을 복사한 상태. 42번(시작 시 백테스트 재실행)은 커밋 전이라 서버에 없음. 커밋하고 push하면 CI가 서버를 그 커밋으로 맞춤.
- DNS가 아직 없음(`gpurent.io` 조회 결과 비어 있음). DNS 연결 후 HTTPS 인증서 발급 필요(44번에서 처리).

### 44. DNS 연결 확인과 HTTPS 인증서 발급

- DNS: Route 53(`ns-1359.awsdns-41.org`)에 `gpurent.io`, `www`, `api` A 레코드 모두 `220.76.214.201`. CAA 없음.
- `sudo certbot --nginx --redirect -d www.gpurent.io -d gpurent.io -d api.gpurent.io`로 인증서 발급. 만료 2027-01-18, `certbot.timer`로 자동 갱신. 이메일 없이 등록.
- certbot이 서버의 `gpurent.conf`에 443 블록과 HTTP에서 HTTPS로 가는 리다이렉트를 추가함. 저장소의 `deploy/nginx/gpurent.conf`는 certbot 적용 전 HTTP 버전 그대로(최초 설정용).
- `gpurent.io`가 `http://www`로 보내던 것을 `https://www`로 수정(서버와 저장소 둘 다).
- 확인: `https://www.gpurent.io` 200, `https://api.gpurent.io` 200, `/events` SSE 스트림, CORS 헤더 정상. 대시보드 번들에 `https://api.gpurent.io`가 들어가 있음. shipgo 사이트 HTTPS 200 그대로.

### 45. 커밋과 푸시

42번에서 44번까지 커밋하고 `origin/main`에 push. 이 push가 자동 배포 워크플로(GitHub Actions Deploy)의 첫 실행.

### 46. 대시보드를 한국식(업비트풍) 디자인과 한국어 UI로, 상단 로고와 타이틀 삭제

**요청**: 대시보드 디자인을 한국식으로, 상단 좌측 로고와 "ChoRong Jev Trade" 텍스트 삭제. 범위는 업비트풍 스타일과 한국어 UI로 결정.

| 항목 | 내용 |
| --- | --- |
| 헤더 | 로고(`components/Logo` 삭제)와 "ChoRong Jev Trade" 삭제. 좌측에는 "실시간 Jev 트레이딩 봇"(네이비 굵은 글씨)과 GitHub 링크만 남김(GitHub 링크는 47번에서 삭제) |
| 색 | 한국 거래소 관례: 상승, 매수, 롱, 수익은 빨강 `#c84a31`. 하락, 매도, 숏, 손실은 파랑 `#1261c4`. 캔들도 양봉 빨강, 음봉 파랑(채움). 전략 채널선도 롱 빨강, 숏 파랑 |
| 백테스트 색 | 파랑이 매도와 겹쳐 보라 `#7b3fd1`로 변경. BT 수익은 연한 빨강, BT 손실은 연한 파랑 |
| 스타일 | Pretendard 폰트(jsDelivr CDN, dynamic subset), IBM Plex Mono 제거. 검정 테두리 대신 연회색 `#dfe2e8`, 섹션 머리(현재 판단, 판단 기록)는 네이비 `#093687`, 하단 탭은 밑줄형, 차트 버튼 선택은 네이비. `html lang="ko"` |
| 문구 | 화면 문구 전부 한국어. 잔고, 백테스트, 평가손익, 실현손익 / 모의거래, 데모, 테스트넷, 실거래 / "TradingView 전략 판단", "Jev 판단" / 롱 진입, 숏 청산, 관망, 지연, 매수, 매도 / 포지션, 체결, 거래기록 탭과 표 머리 / 주기 1초~1일, 한국시간과 UTC / 백테스트 상세 카드 |
| 날짜 표기 | `07/09 04:37` → `07.09 04:37`, 십자선 `2026-10-15` → `2026.10.15` |
| 판단 주체 | `deciderLabel`이 "Jev", "TradingView 전략", "모의 모델"을 반환하고 헤더가 "… 판단"으로 표시. strategy 모드에서 Jev가 판단한 것처럼 보이지 않게 유지 |

**테스트**: 라벨이 바뀐 `test/mode.test.ts`, `test/backtest-marks.test.ts` 수정, 판단 주체 라벨 테스트 1개 추가. `bun test` 116개 통과. `bun run build` 성공.

**참고**
- 로컬 bun 1.3.6에서 `bun --bun next build`는 bun 내부 오류("Expected CommonJS module to have a function wrapper")로 실패. 코드 문제가 아니며, 서버의 bun 1.4.3에서는 같은 방식으로 빌드됨(43번).
- CLAUDE.md의 모드 표기 설명을 한국어 라벨과 색 관례에 맞게 갱신.
- 페이지 `<title>`과 검색용 메타 설명은 영어 그대로.

### 47. 상단 좌측 GitHub 아이콘과 링크 삭제

헤더 좌측 "실시간 Jev 트레이딩 봇" 옆의 GitHub 아이콘(`GitHubMark`)과 링크, 관련 CSS(`.links`, `.link`)를 삭제. 좌측에는 소개 문구만 남음. 검색용 구조화 데이터(`layout.tsx`의 `codeRepository`)는 화면에 보이지 않아 그대로 둠.

### 48. 상단 좌측 문구를 "실시간 트레이딩 봇"으로

헤더 좌측 문구를 "실시간 Jev 트레이딩 봇"에서 "실시간 트레이딩 봇"으로 변경(`Header.tsx`). 누가 판단하는지는 헤더의 판단 주체 표시("TradingView 전략 판단" 등)가 그대로 알려줌.

### 49. 판단 주기를 1분에서 2.5분으로

`.env`의 `TICK_MS`를 `60000`에서 `150000`으로 변경. 로컬과 서버(`~/jevtrade/.env`) 둘 다 바꾸고 봇 재시작. 시작 로그 `tick 150000ms`, API `/`의 `tickMs: 150000` 확인. 코드 변경 없음.

- `.env`는 git에 없으므로 서버 값은 자동 배포로 바뀌지 않음. 앞으로도 서버 `.env`는 직접 고쳐야 함.
- 재시작하면 dry run 포지션과 봇 손익은 초기화됨(기존 동작). 잔고는 시작 잔액에 백테스트 손익을 더한 값에서 다시 시작.
- `STRATEGY_ON_BAR_CLOSE=true`라 신호는 15분봉 마감 때만 바뀜. 2.5분 주기면 봉 마감 후 최대 2.5분 뒤에 반영됨(전에는 최대 1분).
- 백테스트(`bun run backtest`)는 여전히 1분봉마다 판단하므로 라이브와 판단 시점이 조금 다름.

### 50. 차트 범례를 위로 20px

차트 우측 하단 범례(상승, 하락, 매수, 매도, 진입가, 전략 채널, BT 표시)를 20px 위로 올림. `FlowChart.module.css`의 `.legend` `bottom: 22px` → `42px`. 좌측 하단 주기 버튼은 그대로. 모바일에서는 범례가 원래 숨겨져 있어 영향 없음.

### 51. 차트 범례를 왼쪽으로 40px

50번에서 올린 범례를 왼쪽으로 40px 이동. `.legend` `right: 16px` → `56px` (`bottom: 42px`는 그대로).

### 52. 전략에 추가 진입(물타기) 병합: 최대 2번, 직전 진입 후 50봉

**요청**: 전략 진입 + 추가 진입(물타기) 2번. 1차 진입 후 봉 50개 전에는 2차 금지, 2차 진입 후 봉 50개 전에는 3차 금지. 50봉이 지나면 전략 조건에 따라 진입.

**규칙** (`src/strategy.ts` `strategyCall`, 라이브와 백테스트 공용)

- 포지션을 가진 상태에서 같은 방향 진입 신호(롱: 종가 < 롱 라인, 숏: 고가 > 숏 라인)가 다시 나오면 추가 진입.
- 직전 진입 후 15분봉 `STRATEGY_ADD_GAP_BARS`개(50개, 12.5시간)가 지나야 함. 봉 경계로 셈.
- 한 포지션에 진입은 최대 `1 + STRATEGY_MAX_ADDS`번(3번).
- 순서는 손절, 원본 청산, 채널 중간 청산이 먼저이고 그다음 추가 진입.
- 수량은 매번 `QUOTE_USD`. 손절과 청산 기준은 평균 진입가. 청산은 전체를 한 번에. 청산 후 횟수 초기화.
- 라이브 봇은 포지션 크기가 늘면 한 번 진입한 것으로 셈(`trackEntries`). 재시작 때 포지션이 이미 있으면 그 시각을 1차 진입으로 봄.

**설정**: `STRATEGY_MAX_ADDS`(기본 0 = 원본처럼 추가 진입 없음), `STRATEGY_ADD_GAP_BARS`(기본 50). 로컬과 서버 `.env`에 `2`, `50` 설정. 시작 로그에 `adds 2 every 50 bars` 표시.

**백테스트**: 추가 진입이 체결되면 평균가로 합침. `BacktestTrade.entries`(진입별 시각, 가격, 수량)를 추가(`src/types.ts`, `web/src/lib/bot-types.ts` 동일). CSV에 `entries` 열, 콘솔에 `adds` 수.

**대시보드**: 백테스트 차트에 2차, 3차 진입을 `BT 롱 2차 0.39`처럼 표시. 호버 카드에 1차, 2차, 3차 진입 시각과 가격, 평균가.

**최근 3개월 백테스트 비교** (5개 코인, 코인당 $40, 15x, 수수료 포함)

| | 추가 진입 없음 | 추가 진입 2번, 50봉 |
| --- | --- | --- |
| 청산 거래 | 214 | 210 |
| 승률 | 71% | 81% |
| 순손익 | +$9.22 | +$37.44 |
| 코인별 최대 낙폭 중 최대 | $9.85 (BTC) | $13.47 (DOGE) |
| 격리 마진 청산 위험 거래 | 4 | 1 |

추가 진입은 같은 손절 5%가 평균가 기준이라 포지션이 커진 만큼 손실 금액도 커질 수 있음. 코인별로는 BNB만 +$2.03 → -$0.55로 나빠짐.

**테스트**: `trackEntries`, 라이브 판단(50봉 전 대기, 2차, 3차, 3번 뒤 중단, 청산 후 초기화, 원본 설정은 추가 진입 없음), 백테스트 평균가와 진입 목록, 대시보드 2차 표시와 카드. `bun test` 121개 통과.

**배포**: 서버 `.env`는 바꿨지만 서버 코드는 아직 이전 버전이라, 커밋하고 push해야 서버에 적용됨.

## 남은 작업

**우선**

- [x] 42~44번 커밋, push (45번)
- [x] DNS 연결과 HTTPS 인증서 (44번)
- [ ] 서버 sudo 비밀번호 변경 권장 (대화에 평문으로 공유됨)
- [x] 88번 커밋, 배포 (89번)
- [x] 서버 `.env`에 `ADMIN_TOKEN` 설정 (90번)
- [ ] 서버 `ADMIN_TOKEN`을 더 긴 비밀번호로 바꾸기 권장(지금 9자, 공개 API라 병렬 대입 가능)

- [ ] Bybit 데모 서브계정 키로 실제 주문 경로 검증: 주문 생성, 정정, 취소, 레버리지 설정, 비공개 웹소켓 인증, 체결 수신
- [ ] 배포된 데모(https://www.jev-trade.com/)의 봇을 Bybit 설정으로 다시 배포
- [ ] `assets/desk.png` 스크린샷을 현재 화면으로 교체

**보안 (3번 검토에서 보류한 항목)**

- [ ] 봇 API 접근 제한: SSE 연결 수 상한 (`127.0.0.1` 바인딩 옵션 `HOST`는 43번에서 추가)
- [ ] `.bybit-keys.json`이나 `BYBIT_KEYS_JSON`의 JSON 오류를 시작할 때 경고로 표시
- [ ] `BYBIT_API_KEY`가 붙는 코인을 명시적으로 지정 (지금은 `COINS`의 첫 번째 코인)
- [ ] Dockerfile에 `USER bun` 추가

**전략**

- [x] `STRATEGY_LEVERAGE=15`가 10x로 적용되는 문제 (21번, 설정값 그대로 사용)
- [x] 봇 판단 손절 (30번, `STRATEGY_STOP_PCT=5`)
- [ ] Bybit 서버 손절 추가 (봇이 꺼져도 동작하도록. 실제 키 운영 전 권장)
- [x] 29번 후보 B 적용 (30번). dry run으로 실제 판단과 체결 지켜보기
- [ ] (선택) 더 긴 기간(2년) sweep, 추세 필터 시험
- [ ] (선택) 백테스트에 강제 청산, 펀딩비 반영
- [x] 차트 시간축 UTC+9 기본 (40번). 표 시각은 브라우저 현지 시각 그대로
- [ ] (선택) dry run 잔액과 포지션을 재시작 후에도 이어가기(지금은 재시작하면 $500부터)
- [ ] Jev 키를 `.env`에 넣고 `start:jev`로 1~2주 비교 (35번), `bun run compare`로 확인
- [x] 백테스트 거래를 차트에 표시 (26번)
- [ ] `MODEL=strategy` 실제 키로 검증 (진입은 PostOnly라 급변 시 미체결 가능)
- [ ] (선택) 원본처럼 봉 마감 기준 판단 옵션, 손절 옵션
- [ ] (선택) mock 노이즈를 코인별로 분리, dry run에서 같은 주문 로그 생략

**기타**

- [x] `package.json`의 `dev:web` 스크립트 수정 (10번)
- [ ] 기존 Jev 관련 코드(`config.ts`, `model.ts`)의 타입 오류 5개 정리
- [ ] strategy 모드일 때 상단 소개 문구와 페이지 제목 처리 결정
- [x] 대시보드 GitHub 링크 삭제 (47번)
- [ ] `llms.txt` 링크(`layout.tsx`)와 구조화 데이터의 저장소 주소를 바꿀지 결정
- [ ] (선택) Bybit 레이트 리밋 대응 보강

### 53. 46~52번 커밋, push, 서버 자동 배포

**요청**: 커밋 / 배포.

- 커밋 `0afc76b` "Korean exchange-style dashboard, 2.5 min decisions, and strategy scale-in"를 `origin/main`에 push. 커밋 전 `bun test` 121개 통과, `.env`는 git 제외 확인.
- GitHub Actions 배포 성공. https://www.gpurent.io 200, 상단 문구 "실시간 트레이딩 봇" 확인.
- 서버 봇 시작 로그: `model=strategy 15m 15x (EMA 200, stop 5%, exit mid, bar close, adds 2 every 50 bars) tick 150000ms`. 2.5분 판단과 추가 진입이 서버에 적용됨.
- 이 53번 기록은 다음 커밋에 포함.

### 54. 거래기록 행을 클릭하면 차트가 그 거래 시점으로 이동

**요청**: 거래기록 리스트에서 행을 클릭하면 거래한 시점의 차트로 이동.

- 거래기록(봇, 백테스트 모두) 행을 클릭하면 그 코인을 선택하고, 차트를 진입부터 청산까지가 가운데 오도록 이동. 최소 80봉 폭, 긴 거래는 거래 구간의 1.5배 폭. 클릭한 행은 회색으로 표시.
- 차트가 1초봉이면 15분봉으로 바꿈(1초봉에는 과거가 없음). 다른 주기에서는 그 주기 그대로 이동.
- 봉이 아직 그 시점까지 안 불러와졌으면 불러온 뒤 이동. 과거 봉이 더 불러와져 차트가 최신으로 돌아가면 같은 거래로 다시 이동.
- 코드: `focusRange`, `ChartFocus`(`web/src/lib/ohlc.ts`), `page.tsx`의 `focusTrade`, `Book`의 `onFocusTrade`, `CandlePane`의 `focus`.
- 개발 모드에서 StrictMode가 차트를 두 번 만들어 첫 차트에만 적용되던 문제를 찾아, 차트를 정리할 때 적용 기록도 초기화하도록 고침.
- 테스트 `test/ohlc-focus.test.ts` 추가. `bun test` 123개 통과. 로컬 브라우저에서 BTC, SOL, ETH 행 클릭으로 확인.

### 55. 54번 커밋, push, 서버 자동 배포

- 커밋 `fff2890` "Jump the chart to a trade when its history row is clicked"(53, 54번 기록 포함)를 `origin/main`에 push. 커밋 전 `bun test` 123개 통과.
- GitHub Actions 배포 성공. https://www.gpurent.io 200, 서버 `jevtrade-bot`, `jevtrade-web` 둘 다 active.
- 이 55번 기록은 다음 커밋에 포함.

### 56. 모의거래 시작 잔고 BANKROLL_USD=10000, 서버와 로컬 재시작

- 사용자가 로컬 `.env`를 `BANKROLL_USD=10000`으로 수정. 서버 `.env`(`/home/mineos/jevtrade/.env`)는 500이라 같은 값으로 맞춤.
- 서버는 `sudo -n /usr/bin/systemctl restart jevtrade-bot jevtrade-web`(허용된 명령 그대로)로 재시작. 서비스 이름 하나만 주면 sudo 암호를 물음.
- 코인 5개라 코인당 시작 $2000 + 청산된 백테스트 손익. 시작 로그 예: BTC `balance $2013.99 (start $2000.00 + backtest $13.99)`. 재시작으로 모의거래 포지션은 초기화.
- 로컬 봇도 재시작. 시작 중 SOL 캔들 요청이 Bybit `10016 Get kline failed`로 한 번 실패했지만 봇은 정상 시작.

### 57. 상단에 "백테스트 평가손익" 추가 (잔고와 별도)

**배경**: 상단 "백테스트"는 청산된 백테스트 거래 손익만, "평가손익"은 봇 실제 포지션만 계산. 백테스트의 미청산 포지션(지금 5개 코인 모두 숏, DOGE는 2차 진입 포함)은 어디에도 계산되지 않았음.

- `backtestOpenPnl`(`web/src/lib/backtest.ts`): 미청산 백테스트 거래를 각 코인의 현재가(`latest.mid`)로 평가. 진입 수수료 뺌(백테스트의 미청산 손익과 같은 방식). 현재가가 없는 코인은 백테스트가 끝난 시점 손익 사용. 미청산 거래가 없으면 표시 안 함.
- 상단 "백테스트" 다음에 "백테스트 평가손익" 표시. 시세가 바뀔 때마다 갱신. 잔고에는 더하지 않음. 마우스를 올리면 설명.
- 모바일 상단 점수 줄은 넘치면 다음 줄로 내려가게 `flex-wrap`. 브라우저 창 크기 조절이 안 돼서 모바일 화면은 직접 확인하지 못함.
- 테스트 1개 추가. `bun test` 124개 통과. 로컬 화면에서 `+$0.72` → `+$0.69`처럼 시세에 따라 바뀌는 것 확인.
- 참고: 로컬 `.env`에는 BTC 데모 키가 있어 BTC는 dry run이 아니고 데모 계좌(잔액 $0)라 로컬 상단 잔고가 $2000 적게 나옴. 서버는 5개 코인 모두 dry run이라 정상.

### 58. 익절 기준을 반대 라인(원본)으로 변경: STRATEGY_EXIT=opposite

**요청**: 익절 기준 확인 후, 2번(반대 라인) 기준으로 익절하도록 수정.

**익절 기준 정리**: 미리 걸어두는 주문이 아니라 판단 때마다 조건을 보고 시장가(IOC 테이커)로 전체 청산. 순서는 손절 5%(현재가, 평균 진입가 기준), 반대 라인(롱: 마감 봉 고가 > 숏 라인, 숏: 마감 봉 종가 < 롱 라인), 그리고 `exit=mid`일 때 채널 중간.

- 로컬과 서버 `.env`의 `STRATEGY_EXIT`를 `mid`에서 `opposite`로 바꿈. 코드 변경 없음. 서버와 로컬 봇 재시작. 시작 로그에서 `exit mid`가 빠진 것 확인(`EMA 200, stop 5%, bar close, adds 2 every 50 bars`).

**최근 3개월 백테스트 비교** (5개 코인, 코인당 $40, 15x, EMA 200, 손절 5%, 봉 마감, 추가 진입 2번 50봉)

| | 채널 중간 (mid) | 반대 라인 (opposite) |
| --- | --- | --- |
| 청산 거래 | 210 | 123 |
| 순손익 | +$38.33 | +$65.28 |
| 코인별 최대 낙폭 중 최대 | $13.47 (DOGE) | $26.80 (BTC) |
| 격리 마진 청산 위험 거래 | 1 | 3 (BTC, SOL, DOGE) |

반대 라인은 수익을 더 길게 가져가 손익은 커졌지만, 보유 시간이 길어져 낙폭과 청산 위험 거래가 늘어남. BNB는 -$0.74 → -$6.33으로 나빠짐.

### 59. 57, 58번 커밋, push, 서버 자동 배포

- 커밋 `8c749c3`(55~58번 기록과 백테스트 평가손익)을 `origin/main`에 push. 커밋 전 `bun test` 124개 통과.
- GitHub Actions 배포 성공. 서버 빌드에 "백테스트 평가손익" 포함 확인. 서버 `.env`는 `BANKROLL_USD=10000`, `STRATEGY_EXIT=opposite` 유지, 시작 로그 `EMA 200, stop 5%, bar close, adds 2 every 50 bars`.
- 이 59번 기록은 다음 커밋에 포함.

### 60. 반대 라인 실시간 익절: STRATEGY_EXIT_LIVE

**요청**: 2번(반대 라인) 익절이 마감된 15분봉만 봐서, 봉 중간에 라인을 넘었다 돌아오면 익절하지 않는 점을 수정. 선택: 반대 라인 실시간 익절.

- 새 규칙 `exitLive`(`STRATEGY_EXIT_LIVE=true`): 포지션이 있으면 매 판단 때 현재가로 반대 라인 확인. 롱은 현재가 ≥ 숏 라인, 숏은 현재가 ≤ 롱 라인이면 봉 마감을 기다리지 않고 바로 시장가 익절. 라인은 판단에 쓰는 봉(봉 마감 판단이면 마지막 마감 봉) 값.
- 순서: 손절, 실시간 익절, 봉 기준 익절(원본), 채널 중간(mid일 때), 추가 진입. 봉 기준 익절은 그대로 남아 판단 사이(2.5분)에 잠깐 닿았다 돌아온 경우를 봉 마감 때 잡음. 진입 규칙은 그대로.
- 코드: `src/strategy.ts`(`StrategyRules.exitLive`, `strategyCall`), `src/config.ts`, `src/model.ts`(시작 로그에 `live take profit`), `src/backtest.ts`. 문서 `.env.example`, README.
- 로컬 `.env`와 서버 `.env`에 `STRATEGY_EXIT_LIVE=true` 추가. 로컬 봇 재시작. 서버는 코드가 배포되어야 적용.
- 테스트 2개 추가(라이브 판단, 백테스트 봉 중간 익절). `bun test` 126개 통과.

**최근 3개월 백테스트 비교** (반대 라인 익절, 그 외 설정 같음)

| | 봉 마감 익절 (58번) | 실시간 익절 |
| --- | --- | --- |
| 청산 거래 | 123 | 130 |
| 순손익 | +$65.28 | +$71.17 |
| 코인별 최대 낙폭 중 최대 | $26.80 (BTC) | $26.15 (BTC) |
| 격리 마진 청산 위험 거래 | 3 | 3 |

BNB가 -$6.33 → +$0.20으로 좋아짐. 백테스트는 1분마다 판단하고 라이브는 2.5분마다라 라이브는 잠깐 닿는 가격을 일부 놓칠 수 있음.

### 61. 3차 진입은 2차 진입 후 70봉 이상: STRATEGY_ADD_GAP_BARS=50,70

**요청**: 3차 진입은 70봉 이상으로 수정.

- `STRATEGY_ADD_GAP_BARS`를 추가 진입마다 쉼표로 정할 수 있게 바꿈. `50,70`이면 2차는 1차 후 50봉, 3차는 2차 후 70봉(17.5시간). 숫자 하나면 모든 추가 진입에 같은 값(기존 설정 그대로 동작). 값이 모자라면 마지막 값을 반복.
- 코드: `StrategyRules.addGapBars`를 `number[]`로, `addGap`(`src/strategy.ts`), `resolveGaps`(`src/config.ts`), 시작 로그 `adds 2 after 50/70 bars`. 문서 `.env.example`, README.
- 로컬 `.env`를 `50,70`으로 바꾸고 로컬 봇 재시작.
- **서버 `.env`는 아직 50**: 지금 서버 코드는 `50,70`을 읽지 못해 봇이 시작하지 못하므로, 코드 배포와 함께 바꿔야 함.
- 테스트 2개 추가(차수별 간격, 설정 파싱). `bun test` 128개 통과.

**최근 3개월 백테스트 비교** (반대 라인 실시간 익절, 그 외 설정 같음)

| | 50, 50 (60번) | 50, 70 |
| --- | --- | --- |
| 청산 거래 | 130 | 132 |
| 순손익 | +$71.17 | +$59.48 |
| 코인별 최대 낙폭 중 최대 | $26.15 (BTC) | $24.96 (BTC) |
| 격리 마진 청산 위험 거래 | 3 | 3 |

3차 진입이 늦어져 낙폭은 조금 줄었지만 순손익도 줄어듦(SOL $17.05 → $10.24, DOGE $29.88 → $26.57, BNB +$0.20 → -$1.02).

### 62. 부분 익절: 1차 진입 후 채널 중간에서 보유 수량 70%

**요청**: 1차 진입하고 가운데 라인에 닿으면 보유 수량의 70%를 익절.

**규칙** (`STRATEGY_PARTIAL_TP_PCT=70`, 비우면 사용 안 함)
- 1차 진입만 들어간 포지션에서 현재가가 채널 중간((EMA 고가 + EMA 저가) / 2)에 닿으면(롱은 이상, 숏은 이하) 보유 수량의 70%를 시장가(IOC 테이커)로 한 번 익절. 봉 마감을 기다리지 않음.
- 순서: 손절, 반대 라인 실시간 익절, 부분 익절, 봉 기준 익절, 추가 진입.
- 남은 30%는 반대 라인 익절이나 손절로 청산. 부분 익절 뒤에는 추가 진입 안 함. 2차 진입이 이미 들어간 포지션은 부분 익절 안 함.
- 수량은 거래소 수량 단위로 내림. 70%가 최소 단위보다 작거나 남는 수량이 최소 단위보다 작으면 전부 청산(`closeSize`, `src/plan.ts`).
- 라이브 봇은 같은 방향 포지션이 줄어든 것을 보고 부분 익절 완료로 봄(`EntryLog.trimmed`). IOC가 체결되지 않으면 다음 판단에서 다시 시도.

**코드**: `StrategyRules.partialTp`, `MagingaCall.closeFraction`, `strategyCall`(`src/strategy.ts`), `resolvePartialTp`(`src/config.ts`), `ModelDecision.closeFraction`(`src/model.ts`), `planQuote`/`closeSize`(`src/plan.ts`), `Trader`가 `closeFraction`과 수량 단위를 넘김. 백테스트는 부분 익절을 따로 한 거래(`BacktestTrade.partial`)로 기록하고 진입 수수료를 비율로 나눔, 남은 거래는 처음 진입 수량을 `entries`로 유지. `Decision.closeFraction`(두 타입 파일 동일). 대시보드: 판단 기록 "부분 익절", 차트 오른쪽 위 "롱 70% 익절 15x", 백테스트 차트 `BT 부분 +$0.70`, 호버 카드 "부분 익절" 행. CSV `partial` 열, 콘솔 `partial take profits N`.

- 로컬 `.env`에 `STRATEGY_PARTIAL_TP_PCT=70` 추가, 로컬 봇 재시작. 서버 `.env`는 배포 때 `STRATEGY_ADD_GAP_BARS=50,70`과 함께 바꿀 예정.
- 테스트 7개 추가. `bun test` 134개 통과. 타입 오류는 기존 5개 그대로.

**최근 3개월 백테스트 비교** (반대 라인 실시간 익절, 추가 진입 50/70봉, 그 외 같음)

| | 부분 익절 없음 (61번) | 부분 익절 70% |
| --- | --- | --- |
| 거래 (부분 익절 포함) | 132 | 204 (부분 익절 57) |
| 순손익 | +$59.48 | +$42.36 |
| 코인별 최대 낙폭 중 최대 | $24.96 (BTC) | $22.55 (BTC) |
| 격리 마진 청산 위험 거래 | 3 | 2 |

승률은 오르고(코인별 81~88%) 낙폭은 줄었지만 순손익은 줄어듦. **BTC 주의**: `QUOTE_USD=$40`이면 BTC 주문이 최소 수량 0.001이라 70%(0.0007)를 나눌 수 없어 채널 중간에서 전부 청산됨. 그래서 BTC는 $11.28 → $0.79로 크게 줄었음. BTC를 나누려면 진입 수량이 0.003 이상(약 $250, 67% 익절)이어야 하고, 정확히 70%는 0.01(약 $830)부터.

### 63. 60~62번 커밋, push, 서버 배포와 서버 .env 변경

- 커밋 `d182c16`(실시간 익절, 추가 진입별 간격, 부분 익절, 59~62번 기록)을 `origin/main`에 push. 커밋 전 `bun test` 134개 통과. GitHub Actions 배포 성공.
- 배포 뒤 서버 `.env`에 `STRATEGY_ADD_GAP_BARS=50,70`, `STRATEGY_PARTIAL_TP_PCT=70` 적용하고 재시작(이전 코드는 `50,70`을 읽지 못해 배포 뒤에 바꿈). 시작 로그 `EMA 200, stop 5%, bar close, live take profit, take 70% at middle, adds 2 after 50/70 bars`.
- 사용자 문의 "백테스트에서 비트코인을 제외한 나머지 코인들은 거래하지 않습니다" 확인: 서버 `GET /backtest`에 5개 코인 모두 거래가 있음(BTC 21, ETH 44, SOL 51, DOGE 65, BNB 28, 부분 익절 ETH 4, SOL 18, DOGE 24, BNB 11). gpurent.io에서 ETH 차트에 BT 표시 확인, 상단 백테스트 +$42.94. 사용자가 본 화면이 무엇인지 확인 필요.
- 이 63번 기록은 다음 커밋에 포함.

### 64. BTC만 거래: COINS=BTC (백테스트와 봇 모두)

**요청**: 백테스트에서 BTC만 거래, 실제 거래도 BTC만.

- 로컬과 서버 `.env`의 `COINS`를 `BTC,ETH,SOL,DOGE,BNB`에서 `BTC`로 바꿈. 봇(`src/sleeves.ts`)과 시작할 때 다시 돌리는 백테스트(`refreshBacktest`), `bun run backtest`가 모두 `COINS`를 씀. 코드 변경 없음.
- 서버와 로컬 봇 재시작. 서버 시작 로그 `jev-trade bybit demo BTC model=strategy ...`, `GET /backtest`에 BTC 거래 21개만, 대시보드 코인도 BTC만.
- `BANKROLL_USD=10000`이 코인 하나에 모두 가서 BTC 시작 잔고 $10000(전에는 코인당 $2000).
- `QUOTE_USD=$40`이면 BTC 주문은 최소 수량 0.001이라, 62번 부분 익절 70%가 나뉘지 않고 채널 중간에서 전부 청산됨. 3개월 백테스트 BTC 순손익 +$0.97.
- 로컬 `.env`의 BTC는 데모 키가 있어 dry run이 아니라 데모 계좌(잔액 $0)로 동작. 서버는 dry run.

### 65. 주문 금액 QUOTE_USD=1000

**요청**: 사용자가 로컬 `.env`를 `QUOTE_USD=1000`으로 수정(전에는 40). 서버 `.env`도 같게 맞추고 서버와 로컬 봇 재시작.

- BTC 주문 0.012 BTC(약 $998). 시작 로그 `quote $1000`. 이제 70% 부분 익절이 실제로 나뉨(0.012 → 0.008 익절, 0.004 보유).
- 시작 때 다시 돌린 3개월 백테스트가 **-$149.79**로 바뀜(서버). BTC 잔고 $9850.21.

**BTC 3개월 백테스트, QUOTE_USD=1000** (반대 라인 실시간 익절, 추가 진입 50/70봉, 손절 5%)

| | 부분 익절 70% (지금) | 부분 익절 없음 |
| --- | --- | --- |
| 거래 (부분 포함) | 23 (부분 9) | 14 |
| 승률 | 83% | 79% |
| 순손익 | -$152.88 | +$100.95 |
| 최대 낙폭 | $286.47 | $352.82 |
| 수수료 | $16.96 | $22.67 |

원인: 이기는 거래는 1차 진입만 들어간 상태라 채널 중간에서 70%를 일찍 익절해 수익이 작아지고, 지는 거래는 2차, 3차 추가 진입이 들어간 뒤라 부분 익절 없이 3배 수량으로 손절됨. 가장 큰 손실 두 건은 3번 진입한 숏(2026-08-17 -$220.33, 2026-09-18 -$151.73). 격리 마진 청산 위험 거래 1건(8월 숏, 최대 역행 7.8%, 15배면 약 6.7%에서 청산).

### 66. 레버리지 STRATEGY_LEVERAGE=5

**요청**: 사용자가 로컬 `.env`를 `STRATEGY_LEVERAGE=5`로 수정(전에는 15). 서버 `.env`도 맞추고 서버와 로컬 봇 재시작. 시작 로그 `15m 5x ... quote $1000`.

- 주문 크기 확인: `QUOTE_USD`는 증거금이 아니라 **포지션 금액**. `quoteSize`(`src/bybit-market.ts`)가 `QUOTE_USD / 현재가`를 수량 단위로 내림해 주문(BTC 0.012개, 약 $1000). 레버리지는 주문 전에 거래소에 설정만 하므로, 5배면 한 번 진입에 증거금 약 $200, 15배면 약 $67.
- 그래서 손익은 레버리지와 상관없이 같음. 3개월 백테스트 -$152.30(15배 때와 수수료, 거래 같음). 바뀐 것은 격리 마진 청산 위험: 15배 1건 → 5배 0건(청산 기준이 약 6.7% → 약 20%).

### 67. 주문 금액 QUOTE_USD=300

**요청**: 사용자가 로컬 `.env`를 `QUOTE_USD=300`으로 수정(전에는 1000). 서버 `.env`도 맞추고 서버와 로컬 봇 재시작. 시작 로그 `5x ... quote $300`.

- BTC 주문은 $300 / 현재가를 0.001 단위로 내림해 **0.003 BTC(약 $249)**. 5배라 한 번 진입 증거금 약 $50.
- 70% 부분 익절은 0.003의 70%(0.0021)를 내림해 0.002개(67%)를 익절하고 0.001개 보유.
- 서버 시작 백테스트 -$39.24, BTC 잔고 $9960.76.

**BTC 3개월 백테스트, QUOTE_USD=300, 5배**

| | 부분 익절 70% (지금) | 부분 익절 없음 |
| --- | --- | --- |
| 거래 (부분 포함) | 23 (부분 9) | 14 |
| 승률 | 83% | 79% |
| 순손익 | -$39.68 | +$24.20 |
| 최대 낙폭 | $75.75 | $92.65 |

$1000 때와 같은 흐름: 부분 익절을 켜면 손실, 끄면 이익. 격리 마진 청산 위험 거래 0건.

### 68. 부분 익절 끔: STRATEGY_PARTIAL_TP_PCT 비움

**요청**: 부분 익절 꺼주세요.

- 로컬과 서버 `.env`의 `STRATEGY_PARTIAL_TP_PCT`를 비움(62번 기능은 코드에 남아 있고, 값을 넣으면 다시 켜짐). 서버와 로컬 봇 재시작. 시작 로그에서 `take 70% at middle`이 빠짐: `15m 5x (EMA 200, stop 5%, bar close, live take profit, adds 2 after 50/70 bars) ... quote $300`.
- 서버 시작 백테스트 +$24.57, BTC 잔고 $10024.57.
- 지금 전략: BTC만, 15분봉 마감 판단, EMA 200 채널, 진입 $300(0.003 BTC) 5배, 추가 진입 2번(50봉, 70봉), 반대 라인 익절(실시간 + 봉 마감), 손절 5%(평균 진입가).

### 69. 거래기록에 잔액 열 추가, 잔고 미표시 원인 확인

**요청**: 잔고가 표시되지 않음. 거래기록 리스트에서 손익 오른쪽에 현재 잔액 필드 추가.

**잔고 미표시**: 서버(gpurent.io)는 `accountValue` $10024.57로 정상. 로컬은 `.env`에 Bybit 데모 키(`BYBIT_API_KEY`)가 있고 `DRY_RUN=false`라 BTC가 dry run이 아닌 데모 계좌로 동작하고, 데모 계좌 잔고를 못 받아(`equity $0.00`) `accountValue`가 null이라 상단 잔고가 비어 있음. 로컬도 서버처럼 보려면 `DRY_RUN=true`로 하거나 데모 계좌에 잔고를 넣어야 함(사용자 결정 필요, 키는 건드리지 않음).

**잔액 열**
- 거래기록 표에서 손익 다음에 "잔액". 그 거래가 청산된 뒤의 잔액 = 시작 금액 + 그때까지 청산된 거래의 손익(수수료 뺌)을 오래된 순서로 더한 값(`withBalance`, `web/src/lib/fills.ts`).
- 시작 금액은 봇이 새로 보내는 `SleeveMeta.startUsd`(dry run일 때 `BANKROLL_USD / 코인 수`, 두 타입 파일 동일, `useFeed`에서 읽음). 실제 지갑 슬리브는 시작 금액을 몰라 "-".
- 백테스트 버튼으로 백테스트 행을 숨겨도 잔액에는 백테스트 손익이 포함됨(dry run 잔고가 백테스트에서 이어지므로). "전체"면 범위 안 코인의 시작 금액 합.
- 로컬에서 `DRY_RUN=true`로 잠깐 띄워 확인: 맨 위 행 잔액 $10024.78이 상단 잔고와 같음. 확인 뒤 로컬 봇은 원래 설정으로 재시작.
- 테스트 1개 추가. `bun test` 135개 통과.

### 70. 로컬 DRY_RUN=true: 로컬 대시보드 잔고와 잔액 표시

**요청**: 거래기록에 잔액이 안 보이고 상단에도 잔고가 안 보임.

- 사용자가 보던 화면은 로컬(localhost:3001). 서버(gpurent.io) 상단 잔고는 $10024.57로 정상이었음.
- 로컬은 Bybit 데모 키가 있고 `DRY_RUN=false`라 데모 계좌(잔고를 못 받음)로 동작해 상단 잔고가 비고, 지갑 슬리브라 `startUsd`가 없어 잔액 열도 "-"였음.
- 로컬 `.env`를 `DRY_RUN=true`로 바꿔 서버와 같은 모의거래로 맞춤(키는 그대로 두었고 주문은 시뮬레이션). 로컬 봇 재시작. 상단 잔고 $10024.65, 거래기록 잔액 열 표시 확인.
- 서버는 69번 코드가 배포되어야 잔액 열이 나옴(아직 커밋 전).

### 71. 2차 진입도 70봉: STRATEGY_ADD_GAP_BARS=70

**요청**: 2차 진입도 봉 70개로 수정.

- 로컬과 서버 `.env`의 `STRATEGY_ADD_GAP_BARS`를 `50,70`에서 `70`으로(숫자 하나면 모든 추가 진입에 같은 값). 2차는 1차 후 70봉, 3차는 2차 후 70봉(각 17.5시간). 서버와 로컬 봇 재시작, 시작 로그 `adds 2 after 70 bars`. 서버 시작 백테스트 +$22.34.

**BTC 3개월 백테스트** (진입 $300, 5배, 반대 라인 실시간 익절, 손절 5%, 부분 익절 끔)

| | 50, 70봉 | 70, 70봉 |
| --- | --- | --- |
| 청산 거래 | 14 | 14 |
| 승률 | 79% | 86% |
| 순손익 | +$23.97 | +$21.65 |
| 최대 낙폭 | $92.65 | $92.65 |
| 추가 진입 | 17 | 16 |

차이는 작음(추가 진입 1건 차이). 거래가 14건뿐이라 의미 있는 차이로 보기 어려움.

### 72. 손절 기준 변경: 3차 진입 뒤 2차~3차 사이 최저점/최고점 이탈 (스윙 손절)

**요청**: 3차까지 진입하고 직전 최저점 또는 최고점이 깨질 때 손절. 선택: 기준점은 2차~3차 사이 최저/최고점, 5% 손절은 없앰, 현재가가 넘으면 바로.

**규칙** (`STRATEGY_SWING_STOP=true`, `STRATEGY_STOP_PCT` 비움)
- 마지막 추가 진입(3차)이 들어가면, 2차 진입부터 3차 진입까지 15분봉의 최저 저가(롱) / 최고 고가(숏)를 손절 기준으로 한 번 정함(`swingLevel`, `EntryLog.level`). 봇 로그 `swing stop set at ...`.
- 매 판단 때 현재가가 기준 아래(롱) / 위(숏)면 바로 시장가로 전부 손절. 손절 뒤에는 기존처럼 같은 방향 신호가 한 번 꺼질 때까지 재진입 안 함.
- 1차, 2차만 들어간 동안에는 손절 없음(5% 손절을 비웠으므로). 익절은 그대로 반대 라인.
- 봇이 재시작되면 열린 포지션을 1차 진입으로 보므로 그 포지션에는 스윙 손절이 걸리지 않음(손절 없는 포지션이 됨).
- 백테스트는 1분봉으로 2차 체결 분부터 3차 체결 분까지 극값을 추적(라이브는 15분봉 기준, 차이는 작음).

**코드**: `StrategyRules.swingStop`, `EntryLog.prevTs`/`level`, `swingLevel`, `strategyCall`(`src/strategy.ts`), `StrategyModel`이 3차 진입 때 기준 설정(`src/model.ts`), `src/config.ts`, `src/backtest.ts`. 문서 `.env.example`, README. 테스트 3개 추가, `bun test` 138개 통과.

**설정 반영**: 로컬 `.env` 적용, 로컬 봇 재시작(`swing stop after entry 3`, `stop 5%` 빠짐). **서버 `.env`는 아직 그대로(5% 손절)**: 지금 서버 코드는 스윙 손절을 몰라서 5%를 먼저 비우면 손절이 아예 없어짐. 배포할 때 함께 바꿔야 함.

**BTC 3개월 백테스트** ($300, 5배, 추가 진입 70/70봉, 반대 라인 실시간 익절)

| | 손절 5% (71번) | 스윙 손절 |
| --- | --- | --- |
| 청산 거래 | 14 | 15 |
| 승률 | 86% | 73% |
| 순손익 | +$22.04 | +$50.77 |
| 최대 낙폭 | $92.65 | $55.90 |

가장 크게 불리했던 거래는 9월 21일 숏(3번 진입, 5.84%). 5배라 청산 기준(약 20%)과는 거리가 있음.

### 73. 상단 코인 선택 줄 삭제, 기본 BTC

**요청**: 페이지 상단과 차트 사이의 코인 종류 선택 메뉴 영역 삭제. 기본으로 BTC만 보여줌.

- `page.tsx`에서 `SleeveStrip` 제거, 컴포넌트 폴더 `web/src/components/SleeveStrip/` 삭제, 이것만 쓰던 `lastMeaningfulCall`(`web/src/lib/format.ts`)도 삭제. 헤더 바로 아래에 차트.
- 기본 코인은 BTC(목록에 있으면), 없으면 첫 코인. 다른 코인은 포지션 표나 거래기록 행을 눌러 고를 수 있음(지금은 `COINS=BTC`라 BTC만).
- 로컬 화면에서 확인. `bun test` 138개 통과, 대시보드 타입 검사 통과.

### 74. 3차 진입 포지션은 1차 진입가에서 2/3 익절

**요청**: 3차까지 진입했을 때는 1차 진입 가격에 도달하면 보유 수량의 2/3를 익절.

**규칙** (`STRATEGY_FIRST_PRICE_TP=2/3`, `2/3` 또는 % 입력, 비우면 사용 안 함)
- 마지막 추가 진입(3차)까지 들어간 포지션에서 현재가가 1차 진입가에 닿으면(롱은 이상, 숏은 이하) 보유 수량의 2/3를 시장가로 한 번 익절. 수량은 거래소 단위로 내림(62번 `closeSize`, `closeFraction` 그대로 사용).
- 남은 1/3은 반대 라인 익절이나 스윙 손절(72번, 기준점 그대로)로 청산.
- 순서: 스윙 손절, 반대 라인 실시간 익절, 1차 진입가 익절, 봉 기준 익절.
- 라이브는 첫 진입 때 포지션 평균 진입가(= 1차 진입가)를 `EntryLog.firstPx`로 기억하고 추가 진입 때도 유지. 포지션을 가진 채 재시작하면 그때 평균 진입가를 1차 진입가로 봄.

**코드**: `StrategyRules.firstPriceTp`, `EntryLog.firstPx`, `strategyCall`(`src/strategy.ts`), `resolveShare`(`src/config.ts`), `src/model.ts`(시작 로그 `take 66.67% at entry 1 price after entry 3`), `src/backtest.ts`. 백테스트 요약의 `adds`가 부분 익절 거래와 나머지 거래에서 두 번 세지던 것 수정(`src/backtest-run.ts`). 문서 `.env.example`, README. 테스트 3개 추가, `bun test` 141개 통과.

**설정 반영**: 로컬 `.env` 적용, 로컬 봇 재시작. 서버 `.env`는 72번(스윙 손절)과 함께 배포 때 적용.

**BTC 3개월 백테스트** ($300, 5배, 추가 진입 70/70봉, 스윙 손절, 반대 라인 실시간 익절)

| | 1차 진입가 익절 없음 (72번) | 1차 진입가 2/3 익절 |
| --- | --- | --- |
| 거래 (부분 포함) | 15 | 17 (2/3 익절 2) |
| 승률 | 73% | 76% |
| 순손익 | +$50.98 | +$66.63 |
| 최대 낙폭 | $55.90 | $55.90 |

3개월 동안 이 규칙이 실제로 쓰인 것은 2번뿐이라 표본이 작음.

### 75. 상단 메뉴바 업비트처럼 네이비, 파비콘 파란 B

**요청**: 탑 메뉴바 배경색을 업비트 메뉴바처럼 수정. 파비콘도 B, 파란색으로.

- 헤더 배경을 네이비(`--navy` #093687)로, 글자는 흰색, 보조 글자는 반투명 흰색. 판단 주체 표시 테두리도 흰색. 수익(빨강)과 손실(파랑)은 네이비 위에서 읽히도록 헤더 안에서만 밝은 색(#ff8f7a, #8cc4ff)으로 바꿈. 연결 점은 밝은 초록, 로딩 자리 표시는 반투명 흰색. `themeColor`도 #093687(모바일 브라우저 상단 색).
- 파비콘: 네이비 둥근 사각형에 흰색 B(`web/src/app/icon.svg`). `favicon.ico`(16, 32px)와 `apple-icon.png`(180px, 모서리 없는 사각형)도 같은 그림으로 다시 만듦(scratchpad에서 `sips`로 PNG, ICO는 PNG를 묶어 작성).
- 로컬 화면에서 확인. `bun test` 141개 통과.

### 76. 63~75번 커밋, push, 서버 배포와 서버 .env 변경

- 커밋 `1a3aacf`(스윙 손절, 1차 진입가 2/3 익절, 거래기록 잔액 열, 코인 선택 줄 삭제, 네이비 헤더, 파란 B 파비콘, 63~75번 기록)를 `origin/main`에 push. 커밋 전 `bun test` 141개 통과. GitHub Actions 배포 성공.
- 배포 뒤 서버 `.env`: `STRATEGY_STOP_PCT=`(5% 손절 끔), `STRATEGY_SWING_STOP=true`, `STRATEGY_FIRST_PRICE_TP=2/3` 적용하고 재시작. 시작 로그 `15m 5x (EMA 200, bar close, live take profit, take 66.67% at entry 1 price after entry 3, swing stop after entry 3, adds 2 after 70 bars) ... quote $300`. 시작 백테스트 +$67.06, 잔고 $10067.06. `GET /`의 `startUsd` 10000 확인(잔액 열).
- 서버 `.env` 요약: `COINS=BTC`, `QUOTE_USD=300`, `BANKROLL_USD=10000`, `STRATEGY_LEVERAGE=5`, `STRATEGY_EXIT=opposite`, `STRATEGY_ON_BAR_CLOSE=true`, `STRATEGY_EXIT_LIVE=true`, `STRATEGY_MAX_ADDS=2`, `STRATEGY_ADD_GAP_BARS=70`, `STRATEGY_PARTIAL_TP_PCT=`(끔). 서버는 키가 없어 dry run.

### 77. 상단 메뉴바 아래 2px 여백

**요청**: 탑 메뉴바 하단에 2px 여백.

- `.header`에 `margin-bottom: 2px`(`web/src/components/Header/Header.module.css`). 헤더와 아래 영역 사이에 흰 줄 2px. 로컬 화면에서 확인.

### 78. 76~77번 커밋, push, 서버 배포

- 메뉴바 아래 2px 여백과 76~77번 기록을 커밋해 `origin/main`에 push. 커밋 전 `bun test` 141개 통과. 서버 `.env` 변경 없음.

### 79. 1차 진입가 2/3 익절 뒤 남은 수량을 1차 진입으로 간주

**요청**: 3차까지 진입했으면 1차 진입가에 닿을 때 보유 수량의 2/3를 익절(74번). 다시 진입 라인에 닿으면 진입. 2/3를 익절했으므로 그 진입은 2차 진입으로 간주.

- 전에는 2/3 익절 뒤 포지션이 `trimmed`가 되어 추가 진입이 막혔음. 이제 익절 뒤 남은 1/3을 1차 진입으로 되돌림(`firstPriceRestart`, `src/strategy.ts`): 진입 수 1, `trimmed`와 스윙 손절 기준가 지움, 1차 진입가는 원래 값 유지.
- 그래서 다음 진입 신호가 2차, 그다음이 3차. 다시 3차까지 들어가면 같은 1차 진입가에서 또 2/3 익절(반복). 스윙 손절은 새 2차~3차 구간으로 다시 잡음.
- 재진입 간격은 기존 규칙 그대로 `STRATEGY_ADD_GAP_BARS`(70봉)를 마지막 진입(3차) 시각부터 셈. 익절 시각부터 세려면 바꿔야 함.
- 라이브(`src/model.ts`)와 백테스트(`src/backtest.ts`)가 같은 함수를 씀. 백테스트 포지션에 `count`(전략이 세는 진입 번호)를 따로 둠. 재진입은 `entries[].round`(2, 3)로 기록(`src/types.ts`, `web/src/lib/bot-types.ts`). 차트 표시는 `BT 롱 2차`, 상세 카드는 `2차 재진입`.
- 3개월 BTC 백테스트(로컬 `.env` `QUOTE_USD=500`): 바꾸기 전 +$126.25, 추가 진입 18, 최대 낙폭 $103.22 → 바꾼 뒤 +$122.11, 추가 진입 20(재진입 2번), 최대 낙폭 $103.22. 3개월 동안 2/3 익절이 2번뿐이라 차이가 작음.
- 테스트 3개 추가, `bun test` 144개 통과. 로컬 봇 재시작. 서버 배포는 82번.

### 80. 재진입한 2차는 2/3 익절 가격에서 50% 익절

**요청**: 79번처럼 2/3 익절 뒤 다시 진입 라인에서 들어간 진입을 2차로 간주. 그렇게 2차 진입이 되고, 2/3를 익절한 가격에 도달하면 50% 익절.

- 새 규칙 `retakeTp`(`.env` `STRATEGY_RETAKE_TP=50`, `50` 또는 `1/2`, 비우면 끔). 2/3 익절 때 청산 가격을 `tpPx`로 기억(라이브는 익절을 결정한 틱의 현재가, 백테스트는 그 분봉 종가). 재진입으로 2차가 들어가 있고(3차 전) 현재가가 `tpPx`에 닿으면(롱은 이상, 숏은 이하) 보유 수량의 50% 익절.
- 50% 익절 뒤 남은 수량도 다시 1차로 간주(내가 정한 방식). 다음 신호가 또 2차이고, 같은 `tpPx`에서 다시 50% 익절. 3차까지 들어가면 1차 진입가 2/3 익절이 다시 적용되고 `tpPx`가 새 값으로 바뀜.
- 2/3 익절이 없던 포지션의 2차에는 적용 안 됨. 채널 중간 부분 익절(꺼 둠)은 `tpPx`가 있는 포지션에는 적용 안 함.
- `firstPriceRestart`가 두 익절 모두 처리(`src/strategy.ts`). 라이브 `src/model.ts`, 백테스트 `src/backtest.ts`, 설정 `src/config.ts`, `.env.example`, README.
- 로컬 `.env`에 `STRATEGY_RETAKE_TP=50` 추가. 3개월 BTC 백테스트(`QUOTE_USD=500`): 끈 상태 +$119.94, 부분 익절 2번 → 켠 상태 +$128.60, 부분 익절 3번(50% 익절 1번), 최대 낙폭 $103.22 그대로. 표본이 작음.
- 테스트 2개 추가, `bun test` 146개 통과. 로컬 봇 재시작.

### 81. 거래기록 수량 옆에 주문금액

**요청**: 거래기록 리스트 수량 `0.012`를 `0.012($300)`처럼 주문금액과 함께 표시.

- `web/src/components/Book/Book.tsx` `fmtSizeUsd`: 수량 × 진입가(평균 진입가, 없으면 청산가)를 달러 정수로 반올림, 천 단위 쉼표. 봇 거래와 백테스트 거래 모두 적용.
- 물타기한 거래는 전체 수량의 금액(예: 3번 진입하면 약 3배), 부분 익절 행은 익절한 수량의 금액. 수량을 거래소 단위로 내림하므로 $500 설정에서도 `0.006($481)`처럼 조금 작게 나옴.
- 로컬 화면에서 확인. 웹 타입 검사 통과.

### 82. 79~81번 커밋, push, 서버 배포와 서버 .env 변경

- 79~81번(2/3 익절 뒤 나머지를 1차로 간주, 재진입 2차의 50% 익절, 거래기록 주문금액)을 커밋해 `origin/main`에 push. 커밋 전 `bun test` 146개 통과.
- 배포 뒤 서버 `.env`에 `STRATEGY_RETAKE_TP=50` 추가하고 재시작. 서버 `QUOTE_USD`는 300 그대로(로컬은 500).

### 83. 브라우저 탭 제목을 "실시간 트레이딩봇"으로

**요청**: `<title>Jev Trade | Live Jev trading bot on crypto and other assets</title>`를 `<title>실시간 트레이딩봇</title>`로.

- `web/src/app/layout.tsx`의 `title` 상수 변경. 같은 상수를 쓰는 공유 미리보기(OpenGraph, Twitter) 제목과 미리보기 이미지 alt도 함께 바뀜. 설명(description)과 구조화 데이터는 그대로.
- 로컬 `curl`로 `<title>실시간 트레이딩봇</title>` 확인. 커밋, push, 서버 배포(서버 `.env` 변경 없음).

## 2026-10-22

### 84. 10월 21일 23시 숏 2차 추가 진입이 안 된 원인 분석

**요청**: 10월 21일 23시 부근에 숏 2차 추가 진입이 되었어야 하는데 분석.

- 백테스트(서버 `latest.json`): 숏 1차 10-20 23:31(82964.2)이 열린 채로 끝남. 백테스트는 봇 시작 시각까지만 돌므로 마지막 재시작(10-21 21:11)에서 멈춤. 지금까지 이어 돌리면(로컬, `QUOTE_USD=300`) 10-21 23:30에 83861.4로 2차가 들어감(1차 후 약 96봉, 70봉 조건 충족). 즉 규칙상으로는 2차가 맞음.
- 실제 봇(서버, dry run): 백테스트 포지션을 모름. dry run 포지션은 메모리에만 있고 10-21에 배포로 여러 번 재시작(17:00~21:11)되어 매번 포지션 없이 시작. 10-20 23:31 숏도 실제 봇에는 없었음. 그래서 10-21 23:31 숏 신호를 1차 진입으로 처리(`#57 open short`), 이후 `entry 2 waits n/70 bars` 로그. 실제 봇의 2차는 10-22 약 17:00 이후 신호에서 가능.
- 원인: 백테스트와 실제 봇이 별개 장부이고, 백테스트는 시작 시각에서 멈추고, dry run 포지션은 재시작하면 사라짐.
- 해결 방안(85번에서 1번으로 진행): (1) dry run 시작 때 백테스트의 미청산 포지션(진입 내역 포함)을 이어받기, (2) 백테스트를 시작 뒤에도 15분마다 다시 돌려 차트 BT 표시를 이어가기, (3) dry run 포지션을 파일에 저장해 재시작 뒤 복원.

### 85. dry run 봇이 백테스트의 미청산 포지션을 이어받음

**요청**: 84번 해결 방안 1번(백테스트 포지션 이어받기)으로 진행.

- 백테스트 결과에 끝날 때 열려 있던 포지션과 전략 상태를 담음: `BacktestResult.open`, `latest.json`의 `openByCoin`(`BacktestOpen`: 방향, 수량, 평균 진입가, 남은 진입 수수료, 첫 진입 시각, 진입 차수 `count`, 마지막과 그 전 진입 시각, `trimmed`, 스윙 손절가 `level`, 1차 진입가 `firstPx`, 2/3 익절가 `tpPx`). `src/types.ts`, `web/src/lib/bot-types.ts` 같이 수정.
- 봇 시작(`src/index.ts`): dry run이고 백테스트가 이번 시작 시각까지 돈 결과일 때만(저장본으로 대체된 오래된 결과는 제외) `Trader.carry`로 포지션을 넣고, `StrategyModel.carry`로 진입 기록(차수, 1차 진입가, 스윙 손절가, 익절가)을 넣음. 그래서 재시작해도 다음 추가 진입은 백테스트의 마지막 진입부터 70봉을 세고 차수도 이어짐. 진입 수수료는 백테스트에서 이미 냈으므로 시작 잔액에서 뺌. 로그 `BTC carried the backtest's open short ...`.
- 대시보드: `SleeveMeta.carried`. 거래기록은 이어받은 포지션을 시작 포지션으로 계산해, 봇이 청산하면 백테스트 진입가, 진입 시각, 진입 수수료가 들어간 행이 나옴(`closedLots(fills, carried)`). 상단 "백테스트 평가손익"은 이어받은 코인을 빼서 봇 손익과 두 번 세지 않음.
- 실제 키가 있으면 이어받지 않음(거래소 포지션이 기준).
- 지금 로컬은 백테스트 숏(10-20 23:31 1차, 10-21 23:30 2차)이 10-22 18:13에 롱 라인에서 청산되어(+$30.70, 주문금액 $500) 이어받을 포지션이 없음. 로컬 봇 재시작해 정상 시작 확인.
- 테스트 5개 추가(백테스트 open 상태, 모델 carry 뒤 2차 진입, Trader carry 손익, 거래기록 carried, 평가손익 제외). `bun test` 151개 통과.

### 86. 84~85번 커밋, push, 서버 배포

- 84~85번(분석 기록, 백테스트 미청산 포지션 이어받기)을 커밋해 `origin/main`에 push. 커밋 전 `bun test` 151개 통과. 서버 `.env` 변경 없음.
- 재시작으로 서버 봇이 들고 있던 dry run 숏(10-21 23:31, 0.003 @ 83960.7, 18:13 익절을 2.5분 판단 주기 때문에 놓친 것)은 사라지고, 백테스트 끝 상태에서 다시 시작.

### 87. 서버 .env를 로컬과 같게

**요청**: 서버 `.env`도 로컬 `.env`와 동일하게 설정.

- 키 이름으로 비교(비밀값은 출력하지 않음). 다른 항목: `DRY_RUN`(로컬 true, 서버 false), `MAX_LEVERAGE`(5, 20), `QUOTE_USD`(800, 300), `BYBIT_API_KEY`/`SECRET`(로컬만 있음), `HOST`(서버만 127.0.0.1).
- 서버에 `DRY_RUN=true`, `MAX_LEVERAGE=5`, `QUOTE_USD=800` 적용하고 재시작. 백업 `~/jevtrade/.env.bak-20261022`.
- 그대로 둔 것: Bybit 키(로컬도 `DRY_RUN=true`라 키를 쓰지 않으므로 서버에 비밀값을 복사하지 않음), `HOST=127.0.0.1`(서버는 nginx 뒤에서 외부에 직접 열리지 않게 하는 설정).
- 시작 로그: `DRY RUN, balance $10225.02 (start $10000.00 + backtest $225.02)`, 주문금액 $800 기준 백테스트. 이어받은 포지션 없음.

## 2026-10-23

### 88. 상단 메뉴바에 가상매매 On/Off 스위치

**요청**: 상단 메뉴바에 토글 스위치로 가상매매 On/Off. On이면 실제 거래 없이 백테스트 후 실시간 가상매매를 계속.

- 봇: `src/runtime.ts`(`.runtime.json`, gitignore). `config.dryRun`은 이 파일 값이 있으면 그것, 없으면 `DRY_RUN`. `POST /virtual {on}`은 `Authorization: Bearer <ADMIN_TOKEN>` 필요(sha256 후 상수시간 비교, 틀리면 1초 지연 후 401). `ADMIN_TOKEN`이 없으면 403, 키 없이 끄려 하면 409, 값이 같으면 재시작 안 함. 저장 후 0.3초 뒤 `process.exit(0)`, systemd `Restart=always`가 다시 띄워 백테스트부터 다시 시작. CORS에 `authorization` 헤더와 POST 허용.
- meta에 `virtual: {on, toggle, keys}` 추가(`src/types.ts`, `web/src/lib/bot-types.ts` 동일).
- 대시보드: `web/src/components/Header/VirtualSwitch.tsx`. 상태 표시 옆 스위치(On 초록, Off 파랑 글씨). 누르면 안내 문구, 관리자 비밀번호 입력, 확인/취소 패널. 성공하면 비밀번호를 브라우저 localStorage에 저장, 봇의 시작 시각이 바뀔 때까지 "재시작 중". 켤 때 "지금 가진 실제 포지션은 정리되지 않습니다" 안내.
- 로컬은 `bun run start`라 끄면 봇이 종료만 되고 다시 뜨지 않음(서버는 systemd가 재시작).
- 확인: 로컬에서 임시 비밀번호로 401, 같은 값 200(재시작 없음), 잘못된 본문 400, OPTIONS 헤더 확인. 브라우저에서 스위치와 패널 확인. 실제로 끄는 동작은 실행하지 않음(로컬이 데모 실주문으로 바뀌므로).
- 테스트 `test/runtime.test.ts` 4개 추가, 155개 통과. 타입 오류는 기존 5개 그대로.

### 89. 88번 커밋, push, 서버 배포

- 커밋 `95def6f`, GitHub Actions 배포 성공. 서버 봇 재시작 확인: `DRY RUN, balance $10224.87`, meta `virtual {on: true, toggle: false, keys: false}`.
- 서버에 `ADMIN_TOKEN`이 없어 `POST /virtual`은 403, 대시보드 스위치는 On 상태만 표시. 웹 200.

### 90. 서버에 ADMIN_TOKEN과 Bybit 키 설정 확인

- 사용자가 서버 `.env`에 `ADMIN_TOKEN`(9자)과 `BYBIT_API_KEY`/`SECRET`을 직접 넣고 재시작. 값은 길이만 확인.
- 서버 meta `virtual {on: true, toggle: true, keys: true}`, `DRY_RUN=true`, `BYBIT_ENV=demo`, `.runtime.json` 없음. 틀린 비밀번호는 401.
- 스위치 Off(데모 실주문)는 아직 누르지 않음. 키로 주문하는 경로는 아직 미검증.

### 91. 포지션 수량 옆에 진입금액

**요청**: 포지션 리스트 수량 `0.0090 BTC`를 `0.0090 BTC / $100`처럼 진입금액과 함께 표시.

- `web/src/components/Book/Book.tsx` 포지션 수량 칸: 수량 × 평균 진입가를 달러 정수로 붙임. 진입가가 없으면 수량만.
- 로컬 확인: `0.0090 BTC / $731`. 웹 타입 검사 통과.

### 92. 91번 커밋, push, 서버 배포

- 커밋 `faa1548`, GitHub Actions 배포 성공. 서버 봇 재시작: 가상매매 On, 스위치 사용 가능, 키 있음. 백테스트의 롱 0.009 @ 81237.2(1차, 10-22 17:00 UTC부터)를 이어받음. 웹 200.

### 93. 수량 열 제목을 "수량/주문금액"으로

**요청**: 리스트 제목 수량 -> 수량/주문금액.

- `web/src/components/Book/Book.tsx`: 포지션 탭과 거래기록 탭(로딩 중 표 포함)의 열 제목 변경. 두 탭 모두 금액을 함께 표시하므로 같이 바꿈. 체결 탭은 수량만 표시하므로 그대로.

### 94. 92~93번 커밋, push, 서버 배포

- 커밋 `942aa86`, GitHub Actions 배포 성공. 서버 봇 재시작 후 가상매매 On, 웹 200.

### 95. 하단(포지션 / 체결 / 거래기록) 영역 크기 조절

**요청**: 하단 영역과 차트 영역의 크기를 조절할 수 있게.

- `web/src/components/Book/BookSplitter.tsx`: 차트와 하단 사이 7px 막대(가운데 손잡이). 위아래로 드래그, 포커스 후 위/아래 화살표(24px씩), 더블클릭하면 기본 220px.
- 최소 120px, 차트 행은 최소 200px 남김. 높이는 브라우저 localStorage(`jevtrade.bookHeight`)에 저장, 다시 열 때 창 크기에 맞춰 줄임.
- `Book`에 `height` prop과 `data-book`, 하단 위 테두리는 막대가 대신함.
- 브라우저 확인: 드래그로 220 → 607px, 끝까지 올리면 차트 200px에서 멈춤, 새로고침 후 유지, 더블클릭으로 220px.

### 96. 94~95번 커밋, push, 서버 배포

- 커밋 `6a3fd20`, GitHub Actions 배포 성공. 서버 봇 재시작 후 가상매매 On, 웹 200.

## 2026-10-25

### 97. 차트가 UTC+9로 표시되는지 확인

**요청**: 차트 표시가 UTC+9인지 확인.

- 코드: `web/src/lib/chartTime.ts` 기본 시간대 "한국시간"(+9), 축과 십자선 라벨, 백테스트 상세 카드 시각에 적용. 봉 경계는 UTC 그대로(15분봉은 KST에서도 같은 경계).
- 운영 사이트(www.gpurent.io)에서 확인: 01:54 KST(16:54 UTC)에 마지막 15분봉 십자선이 `2026.10.25 01:45`, 축 끝 `01:45`. UTC 버튼을 누르면 `2026.10.24 16:45`로 9시간 차이. 다시 한국시간으로 돌려 둠.
- 참고: 판단 기록, 표의 시각은 차트 설정이 아니라 브라우저 현지 시각(한국 브라우저면 KST). 변경 없음.

### 98. 25일 00시~01시35분 롱 2차 진입이 안 보인 원인

**요청**: 25일 00시부터 1시35분 사이 롱 2차 진입이 왜 안 됐는지 조사.

- 서버 로그(서버 시간대 KST): 2차 진입은 됐음. `00:15:27 entry 2 of 3, long signal after 185 bars`, 판단 `open long 5x` @ 79678.15, `00:17:57 FILL buy 0.01 @ 79678.1 (sim)`. 포지션 0.009 @ 81237.2(1차, 백테스트에서 이어받음) → 0.019 @ 80416.6. 이후 3차는 70봉 대기 중(01:30에 5/70).
- 원인(표시 문제): dry run 체결은 봇 기록(history의 해당 블록 `fill`)에만 남고, 차트 테이프와 SSE `fill`로 나가지 않음. 대시보드의 차트 매수 표시, 체결 탭, 거래기록은 테이프의 체결만 읽으므로 모의 체결이 하나도 보이지 않음. 포지션 수량과 평균가만 바뀜.
- 수정: `BybitMarket.markSimFill(fill)`(키 없는 dry run만)로 모의 체결을 차트 테이프에 넣고 실제 체결과 같은 경로로 방송. `src/index.ts` `onFill`에서 `fill.simulated`면 호출, 방송의 `simulated`는 키 없을 때 true. 새로고침해도 `/tape`, 스냅샷에 남음.
- 테스트 1개 추가(같은 체결 두 번이면 한 번만 표시), 156개 통과. 타입 오류는 기존 5개.
- 참고: 이번 00:17 체결은 서버 메모리의 테이프에 없어서 배포 후에도 봇 체결로는 안 보임. 재시작하면 백테스트의 미청산 포지션(2차 포함)을 다시 이어받음.

### 99. 97~98번 커밋, push, 서버 배포

- 커밋 `1e0392b`, GitHub Actions 배포 성공. 이후 모의 체결은 차트, 체결 탭에 표시됨(실제 화면 확인은 다음 체결 때).

### 100. 이어받은 포지션의 진입내역을 체결 탭에

**요청**: 이어받은 포지션 진입내역도 체결 탭에 표시.

- `BacktestOpen.entries`(`src/types.ts`, `web/src/lib/bot-types.ts` 동일): 포지션에 남은 진입 각각의 시각, 가격, 수량, 회차. `src/backtest.ts`가 미청산 포지션에서 채움.
- `web/src/components/Book/Book.tsx` 체결 탭: `sleeve.carried.entries`를 행으로 추가. 유형 "N차 진입", 거래 ID 칸에 "백테스트에서 이어받음"(툴팁: 백테스트 1분 단위 기준 시각과 가격).
- 체결 탭 시각을 `MM.DD HH:MM`으로(이전에는 시각만, 툴팁에 초까지). 이어받은 1차처럼 며칠 전 행을 구분하려고.
- 로컬 확인: `10.25 00:15 매수 2차 진입 79683.0 0.01`, `10.23 02:00 매수 1차 진입 81237.2 0.009`, 둘 다 "백테스트에서 이어받음".
- 백테스트 테스트에 진입 목록 검사 추가, 156개 통과.
- 참고: 부분 익절로 일부 청산한 뒤 이어받은 경우, 그 부분 청산은 체결 탭에 없음(백테스트 거래로 거래기록에 표시).

### 101. 차트를 열면 45일치 캔들 표시

**요청**: 기본 차트의 캔들은 45일치씩 표시.

- `web/src/components/FlowChart/FlowChart.tsx`: 15분, 1시간, 4시간, 1일 주기는 차트를 열거나 주기를 바꿀 때 최근 45일(`START_DAYS`)을 표시(15분 4320봉, 1시간 1080봉, 4시간 270봉, 1일 45봉). 1초, 1분, 5분은 데이터가 며칠치라 이전처럼 80봉.
- `CandlePane`에 `startBars` prop 추가(거래기록에서 거래를 고를 때의 최소 범위는 그대로 80봉). `minBarSpacing: 0.1`로 낮춤(기본 0.5px면 15분 45일이 잘림).
- 로컬 확인: 15분 차트 축이 9월 10일 무렵부터 10월 25일까지.
