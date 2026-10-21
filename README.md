# Jev Trade

[![Live desk](https://img.shields.io/badge/live-jev--trade.com-111)](https://www.jev-trade.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

Jev로 만든 트레이딩 봇입니다. Jev가 매 틱마다 Bybit 호가를 읽고 매수(buy), 매도(sell), 관망(hold) 중 하나를 답하면, 봇이 그 주문을 냅니다. 코인 5개, 서브계정 5개, 실제 체결입니다.

**[라이브 데스크 보기](https://www.jev-trade.com/)**

[![Jev Trade live desk](assets/desk.png)](https://www.jev-trade.com/)

판단은 Jev가 합니다. 관망(hold)도 Jev의 답 중 하나이므로 주문 없이 끝나는 틱도 있습니다. 포지션, 잔고, 손익은 Bybit에서 가져옵니다.

Jarrod Watts의 [jev-trader](https://github.com/jarrodwatts/jev-trader) (MIT)를 기반으로 합니다. 거래소는 Bybit USDT 무기한 선물입니다.

## 화면 구성

- 서로 분리된 슬리브(sleeve) 5개: BTC, ETH, SOL, DOGE, BNB. 슬리브마다 Bybit 서브계정과 Jev 호출이 따로 있습니다.
- 상단: 현재 거래 모드(Live, Testnet, Demo, Dry run)와 잔고, 손익을 표시합니다. 모드는 `.env` 설정과 선택한 코인의 키 유무로 정해집니다.
- 왼쪽: 실시간 호가를 캔들로 표시합니다. 초록/빨강 표시는 체결, 진입선은 현재 포지션입니다.
- 오른쪽: 최신 Jev 판단과 매 틱의 기록(tape)입니다.
- 아래 표: 선물 데스크처럼 포지션(Positions)과 체결(Trades)로 나뉩니다.

키를 넣으면 데모든 테스트넷이든 메인넷이든 실제 주문이 나갑니다. 처음에는 dry run으로 시작하세요.

## 구조

| 구성 | 위치 | 런타임 | 포트 | 역할 |
| --- | --- | --- | --- | --- |
| 봇 | 루트 `src/` | Bun | 3000 | 호가 수신, Jev 판단, 주문, SSE 송출 |
| 대시보드 | `web/` | Next.js | 3001 | `/events` SSE를 받아 차트와 체결을 표시 |

키, 판단(evaluate), 주문은 모두 Bun 프로세스에만 있습니다. 대시보드는 읽기만 합니다.

```
src/           Bun 봇
test/          bun 테스트
web/           Next 대시보드
assets/        README용 라이브 데스크 스크린샷
```

주요 파일:

- `src/bybit-feed.ts`: Bybit 호가, 체결, 캔들, 티커 웹소켓
- `src/bybit-market.ts`: 주문, 취소, 레버리지, 포지션, 비공개 웹소켓
- `src/bybit-api.ts`: V5 REST 서명과 환경별 주소
- `src/model.ts`: 판단 모델 3가지(mock, Jev, 사용자 지정 전략)와 선택
- `src/strategy.ts`: 사용자 지정 전략(TradingView "Maginga 15Ho") 규칙
- `src/plan.ts`: Jev의 답을 주문 한 건으로 변환
- `src/trader.ts`: 틱 루프
- `src/venue.ts`: Trader가 쓰는 거래소 인터페이스
- `src/server.ts`: 대시보드용 HTTP / SSE API

## 한 틱의 동작

1. 봇이 호가를 읽습니다.
2. Jev가 롱/숏을 고르고, 진입(open), 청산(close), 관망(hold) 중 하나를 고릅니다.
3. 진입은 호가 안쪽 한 틱에 PostOnly 지정가로 걸어 메이커로 체결을 기다립니다. 같은 방향이면 다음 틱에 가격과 수량을 정정(amend)합니다.
4. 청산은 호가를 넘겨 IOC로 즉시 체결합니다.
5. 관망이면 주문을 내지 않고, Jev가 더 이상 원하지 않는 대기 주문은 취소합니다.

## 로컬 실행 (dry run)

[Bun](https://bun.sh) 1.2 이상이 필요합니다. Bybit 키를 비워 두면 dry run입니다. 실제 호가로 실제 판단을 하되 체결만 시뮬레이션합니다. 기본값 `MODEL=mock`은 모멘텀 기반 대역 모델이라 API 키가 필요 없습니다.

```sh
# 1. 의존성 설치
bun install
cd web && bun install && cd ..

# 2. 환경 변수 파일 준비
cp .env.example .env
cp web/.env.example web/.env.local

# 3. 테스트
bun test
```

터미널 두 개에서 각각 실행합니다.

```sh
# 터미널 1: 봇 (http://localhost:3000)
bun run start

# 터미널 2: 대시보드 (http://localhost:3001)
bun run dev:web
```

브라우저에서 http://localhost:3001 을 엽니다. 대시보드는 `$NEXT_PUBLIC_API_URL/events`(기본값 `http://localhost:3000`)를 읽습니다.

정상이라면 봇 로그에 코인마다 `bybit`로 시작하고 `DRY RUN`으로 끝나는 줄이 나오고, 이어서 매 틱의 판단이 출력됩니다.

### 문제 해결

| 증상 | 원인과 해결 |
| --- | --- |
| `Failed to start server. Is port 3000 in use?` | 이미 다른 봇이 3000번 포트를 쓰고 있습니다. `lsof -nP -iTCP:3000 -sTCP:LISTEN`으로 프로세스를 찾아 종료하거나 `PORT`를 바꾸세요. |
| `MODEL=jev ... needs TYPESAFE_API_KEY` | `MODEL=jev`인데 Jev 키가 없습니다. 키를 넣거나 `MODEL=mock`으로 바꾸세요. |
| `bybit auth failed` | API 키나 시크릿이 틀렸거나, 키가 다른 환경용입니다. 데모 키는 데모 트레이딩 모드에서 발급한 키여야 합니다. |

## Bybit 환경 (`BYBIT_ENV`)

| 값 | 의미 | 상단 표시 (키 있음) |
| --- | --- | --- |
| `demo` (기본값) | Bybit 데모 트레이딩. 메인넷 시세에 가상 자금으로 거래합니다. | Demo |
| `testnet` | Bybit 테스트넷. 시세도 테스트넷입니다. | Testnet |
| `mainnet` | 실제 자금. 정말로 실거래할 때만 쓰세요. | Live (빨간색) |

키가 없는 코인은 어느 환경이든 Dry run으로 표시됩니다.

## 실제 주문 (코인별 서브계정)

1. Bybit에서 코인마다 서브계정을 만들고, 각 서브계정에서 API 키를 발급합니다. 데모 트레이딩용 키는 데모 트레이딩 모드에서 따로 발급해야 합니다.
2. 키 권한은 **Contract 거래(주문, 포지션)만** 켜고, **출금 권한은 절대 켜지 마세요.** 가능하면 IP 제한도 거세요.
3. 계정은 통합 거래 계정(UTA), 포지션 모드는 단방향(One-Way)이어야 합니다.
4. 첫 번째 코인(BTC)의 키는 `BYBIT_API_KEY`, `BYBIT_API_SECRET`에 넣습니다.
5. 나머지 코인은 `.bybit-keys.json` 파일이나 `BYBIT_KEYS_JSON`에 넣습니다.
   ```json
   {"sleeves":[{"coin":"ETH","apiKey":"...","apiSecret":"..."},{"coin":"SOL","apiKey":"...","apiSecret":"..."}]}
   ```
6. `DRY_RUN=false`를 유지합니다. 키가 없는 코인은 그 코인만 dry run으로 돕니다. 시작 로그에서 코인마다 `DRY RUN`인지 `account bybit:<UID>`인지 확인하세요.
7. 처음에는 아래 [리스크 한도](#리스크-한도)를 설정해 두는 것을 권장합니다.

**알아둘 점**

- **최소 주문 수량**: 코인별 최소 수량이 있습니다(예: BTC 0.001개, 약 $85). `QUOTE_USD`가 그보다 작으면 최소 수량으로 올려서 주문합니다. 시작 로그의 `min order`에 실제 금액이 나옵니다.
- **최대 레버리지가 높습니다**: BTC, ETH는 최대 100x 이상입니다. `MAX_LEVERAGE`를 설정하는 것을 강하게 권장합니다.
- **체결 링크 없음**: Bybit 체결에는 공개 트랜잭션이 없어서 대시보드에 탐색기 링크가 표시되지 않습니다.
- **증거금**: 각 서브계정의 통합 계정 자산(`totalEquity`)이 그 코인의 계정 가치로 표시됩니다.

## 판단 방식 (`MODEL`)

| 값 | 누가 판단하나 | 필요한 것 | 대시보드 상단 표시 |
| --- | --- | --- | --- |
| `mock` (기본값) | 모멘텀 기반 대역 모델. 테스트용이라 판단이 대부분 노이즈입니다. | 없음 | by mock model |
| `jev` | Jev | TypeSafe 또는 Gateway 키 | by Jev |
| `strategy` | 사용자 지정 전략 (아래) | 없음 | by TradingView strategy |

`mock`과 `strategy`는 Jev가 아니라 코드가 판단합니다. 그래서 대시보드 상단에 누가 판단하는지 항상 표시합니다.

### 사용자 지정 전략 (`MODEL=strategy`)

TradingView 파인 스크립트 "[GaYang] Maginga 15Ho - v5.4"에서 **실제로 주문을 내는 규칙만** 옮겼습니다(`src/strategy.ts`).

**15분봉 기준으로만 동작합니다.** 다른 시간봉(1m, 5m, 1H 등)은 전략에 쓰지 않습니다.

- 채널: `EMA(high, 125)`와 `EMA(low, 125)`
- 숏 라인: `EMA(high) × 1.01618`, 롱 라인: `EMA(low) × (1 - 0.01619)`
- 포지션이 없을 때
  - 고가가 숏 라인 위면 숏 진입
  - 종가가 롱 라인 아래면 롱 진입
- 롱 보유 중 고가가 숏 라인 위면 롱 청산, 숏 보유 중 종가가 롱 라인 아래면 숏 청산
- 그 밖에는 관망. 원본은 포지션이 있을 때 추가 진입하지 않습니다(아래 "추가 진입" 설정으로 바꿀 수 있음).

```sh
MODEL=strategy
STRATEGY_LEVERAGE=3      # 원본 스크립트 라벨의 "Leverage x3"
```

**원본과 다른 점, 알아둘 점**

- **판단 시점**: 원본은 봉이 마감될 때 판단합니다(TradingView 기본값). 이 봇은 기본으로 매 틱(`TICK_MS`)마다, 형성 중인 15분봉에 현재가를 반영해 판단합니다(TradingView의 `calc_on_every_tick`과 같음). `STRATEGY_ON_BAR_CLOSE=true`면 매 틱 판단하되 마지막으로 마감된 15분봉을 읽으므로, 신호는 15분봉이 마감될 때만 바뀝니다.
- **실시간 익절**: `STRATEGY_EXIT_LIVE=true`면 포지션이 있을 때 매 틱 현재가로 반대 라인을 확인해, 롱은 현재가가 숏 라인 이상, 숏은 현재가가 롱 라인 이하이면 봉 마감을 기다리지 않고 바로 시장가로 익절합니다. 라인은 판단에 쓰는 봉(봉 마감 판단이면 마지막 마감 봉)의 값입니다. 판단 사이(`TICK_MS`)에 잠깐 닿았다 돌아온 가격은 잡지 못하며, 그 경우에도 봉 마감 기준 익절은 그대로 동작합니다. 진입은 바뀌지 않습니다.
- **부분 익절**: `STRATEGY_PARTIAL_TP_PCT=70`이면 1차 진입만 들어간 상태에서 현재가가 채널 중간(EMA 고가와 EMA 저가의 가운데)에 닿을 때(롱은 이상, 숏은 이하) 보유 수량의 70%를 시장가로 한 번 익절합니다. 수량은 거래소 수량 단위로 내림하고, 70%가 최소 단위보다 작거나 남는 수량이 최소 단위보다 작으면 전부 청산합니다. 남은 30%는 반대 라인 익절이나 손절로 청산하며, 부분 익절 뒤에는 추가 진입을 하지 않습니다. 2차 진입이 이미 들어간 포지션은 부분 익절하지 않습니다. 봇은 같은 방향 포지션이 줄어든 것을 보고 부분 익절이 끝났다고 판단합니다.
- **빠진 계산**: Squeeze Momentum, CMF, DEMA, 2차 라인(3.82%), 손절과 목표가는 원본에서 계산만 하고 주문 조건에 쓰이지 않아 옮기지 않았습니다.
- **손절**: 원본에는 손절이 없습니다. `STRATEGY_STOP_PCT`를 설정하면 봇이 매 틱 현재가로 확인해 진입가 대비 그만큼 불리하면 청산합니다(Bybit 서버 손절이 아니라서 봇이 꺼져 있으면 동작하지 않음). 손절 뒤에는 같은 방향 신호가 한 번 꺼질 때까지 다시 진입하지 않습니다.
- **추가 진입(물타기)**: `STRATEGY_MAX_ADDS=2`면 1차 진입 뒤 같은 방향으로 최대 2번 더 진입합니다(한 포지션에 최대 3번). 추가 진입은 그 방향의 진입 신호(롱은 종가가 롱 라인 아래, 숏은 고가가 숏 라인 위)가 다시 나왔을 때, 직전 진입 후 15분봉 `STRATEGY_ADD_GAP_BARS`개가 지난 경우에만 합니다. 추가 진입마다 따로 쉼표로 정할 수 있어서, `50,70`이면 1차 후 50봉(12.5시간) 전에는 2차, 2차 후 70봉(17.5시간) 전에는 3차를 하지 않습니다. 숫자 하나면 모든 추가 진입에 같은 값을 씁니다(기본 50). 수량은 매번 `QUOTE_USD`이고, 손절과 채널 중간 청산은 평균 진입가 기준, 청산은 전체 포지션을 한 번에 정리합니다. 청산하면 횟수는 처음부터 다시 셉니다. 봇은 포지션 크기가 늘어난 것을 보고 진입 횟수를 세므로, 포지션을 가진 채 봇이 재시작되면 그 시점을 1차 진입으로 봅니다. 비우면 원본처럼 추가 진입하지 않습니다.
- **변형 설정**: 아래 `STRATEGY_*` 값으로 원본 규칙을 바꿀 수 있습니다. 비우면 원본 그대로입니다. 백테스트(`bun run backtest`, `bun run sweep`)와 차트 전략 라인도 같은 설정을 씁니다.
- **주문 크기**: 원본의 `qty = 1`(1코인) 대신 `QUOTE_USD`(Bybit 최소 수량 이상)로 주문합니다.
- **주문 방식**: 원본은 시장가로 진입하지만, 이 봇은 진입을 PostOnly 지정가로 걸어 둡니다. 가격이 빠르게 지나가면 체결되지 않을 수 있고, 신호가 사라지면 주문을 취소합니다.
- **시작 직후**: EMA 계산에 봉 125개가 필요합니다. 시작할 때 Bybit에서 캔들 1000개를 불러오므로 바로 판단합니다.
- **차트 표시**: 숏 라인(빨간 점선)과 롱 라인(초록 점선)이 가격을 따라 과거까지 그려집니다(봇의 `GET /levels`). 모든 주기에서 보이며, 값은 항상 15분봉으로 계산합니다. 1H, 4H, 1D 봉에는 그 봉이 끝나는 15분봉의 값을, 1m, 5m 봉에는 그 봉이 속한 15분봉의 값을 씁니다. 가장 최근 봉은 매 틱 판단에 쓴 값입니다. `MODEL=strategy`일 때만 표시합니다.
- 봇 로그에 판단 이유가 바뀔 때마다 `BTC strategy 15m: inside the channel (long < ..., short > ...)`처럼 현재 라인 값이 출력됩니다.

### 백테스트 (과거 데이터로 전략 실행)

`MODEL=strategy` 규칙을 과거 Bybit 1분봉으로 다시 돌려 봅니다. 주문은 내지 않습니다.

```sh
bun run backtest                               # 최근 3개월, .env의 COINS
bun run backtest --months=6
bun run backtest --from=2026-07-01 --coins=BTC,ETH
```

- 1분봉 마감마다 한 번 판단합니다(`TICK_MS=60000`과 같음). 형성 중인 15분봉은 그때까지의 1분봉으로 만들고, 판단은 실제 봇과 같은 `magingaRule`이 합니다.
- EMA는 실제 봇처럼 시작 전 15분봉 1000개로 미리 계산합니다.
- 진입은 판단 시점 가격에 PostOnly로 걸고, 다음 1분 동안 그 가격을 뚫고 지나가야 체결됩니다(메이커 수수료). 신호가 이어지면 다음 틱에 새 가격으로 다시 걸고, 관망이 되면 취소합니다. 청산은 판단 시점 가격에 바로 체결합니다(테이커 수수료).
- 주문 크기, 레버리지는 실제 봇과 같습니다(`QUOTE_USD`, `STRATEGY_LEVERAGE`, `MAX_LEVERAGE`).
- 수수료는 Bybit 기본값 메이커 0.02%, 테이커 0.055%입니다. `BACKTEST_MAKER_FEE`, `BACKTEST_TAKER_FEE`(퍼센트)로 바꿀 수 있습니다.
- **반영하지 않는 것**: 스프레드와 슬리피지, 펀딩비, 청산(강제 청산). 그래서 손실 거래는 청산 없이 끝까지 버틴 것으로 계산합니다. 결과의 `liquidation risk (isolated)`는 격리 마진이었다면 청산됐을 만큼 불리하게 움직인 거래 수입니다.
- 결과 요약은 화면에, 거래 내역은 `backtest-results/<시작일>_<종료일>.csv`(시각은 UTC)에 저장합니다. 받은 캔들은 `.backtest-cache/`에 저장해 다음 실행이 빠릅니다.
- **차트 표시**: 마지막 실행 결과는 `backtest-results/latest.json`에도 저장되고, 봇이 `GET /backtest`로 내보냅니다. 대시보드 차트에 파란 표시로 나옵니다(진입 `BT long` / `BT short`, 청산 `BT +$1.26`처럼 손익, 보유 중이면 `BT long open`). 실제 체결(초록, 빨강 화살표)과 구분되고, 범례에 "strategy backtest (simulated)"로 표시됩니다. 차트 아래 `BT` 버튼으로 끄고 켭니다. 아래쪽 **History** 탭에도 청산된 백테스트 거래가 봇 거래와 함께 날짜순으로 나오고(Source 열 `backtest`, 파란색), 위쪽에 기간, 거래 수, 승률, 수수료 뺀 손익 요약이 표시됩니다. History의 `Backtest` 버튼으로 숨길 수 있습니다. 백테스트를 다시 돌린 뒤에는 봇 재시작 후 반영됩니다(페이지는 봇 시작 시점마다 한 번 읽음).

### 전략 변형 비교 (sweep)

전략 라인 규칙의 여러 변형을 과거 데이터로 비교합니다. 주문은 내지 않습니다.

```sh
bun run sweep                        # 12개월: 앞 9개월로 고르고, 뒤 3개월로 확인
bun run sweep --months=12 --test-months=6
```

- 변형 192가지: EMA 길이(75, 125, 200), 밴드 폭(1%, 1.618%, 2.5%, 3.82%), 손절(없음, 2%, 3%, 5%), 청산(반대 라인, 채널 중간), 판단 시점(매 1분, 15분봉 마감).
- 앞 구간(train)에서 성적이 좋은 변형을 고른 뒤, 고를 때 보지 않은 뒤 구간(test)에서도 이익이 나는지 봅니다. 과거에만 맞춘 변형을 걸러내기 위해서입니다.
- 주문 방식과 수수료는 `bun run backtest`와 같습니다. 결과는 `backtest-results/sweep_<시작일>_<종료일>_test<N>m.csv`에 저장됩니다.
- 실제 봇의 설정은 바꾸지 않습니다. `손절`, `채널 중간 청산`, `15분봉 마감 판단`은 아직 백테스트에만 있습니다.

## 전략 봇과 Jev 봇 나란히 비교

같은 코드로 봇을 두 개 띄워 같은 시간 동안 비교합니다. 두 번째 봇은 항상 dry run이라 실제 주문을 내지 않습니다.

```sh
bun run start          # 전략 봇 (.env 설정), :3000, 대시보드 bun run dev:web → :3001
bun run start:jev      # Jev 봇 (MODEL=jev, DRY_RUN=true), :3002
bun run dev:web:jev    # Jev 봇 대시보드 → :3003
bun run compare        # 두 봇의 balance, 손익, 수수료, 체결, Jev 비용을 한 표로
```

- Jev 봇에는 `.env`에 `TYPESAFE_API_KEY`(또는 `JEV_PROVIDER=gateway`와 `AI_GATEWAY_API_KEY`)가 필요합니다. 없으면 시작하자마자 이유를 알려 주고 멈춥니다. 전략 봇은 이 키를 쓰지 않습니다.
- 두 봇 모두 `BANKROLL_USD`($500)로 시작합니다. 전략 봇의 balance에는 백테스트 손익도 들어 있으므로(Jev 봇에는 없음), 비교는 `compare`의 `live pnl`(각 봇이 시작한 뒤의 수수료 뺀 손익)로 합니다. 두 봇을 같은 시각에 시작하면 공정합니다.
- 다른 주소의 봇을 비교하려면 `COMPARE_A`, `COMPARE_B`에 주소를 넣습니다.

## 실제 Jev 사용

`MODEL=jev`로 바꾸고 API를 고릅니다. 기본은 공식 TypeSafe입니다.

```sh
MODEL=jev
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=
# JEV_MODEL_ID 기본값은 jev-latest
```

키는 [docs.typesafe.ai](https://docs.typesafe.ai/)에서 발급받습니다.

Vercel AI Gateway도 지원합니다.

```sh
MODEL=jev
JEV_PROVIDER=gateway
AI_GATEWAY_API_KEY=
# JEV_MODEL_ID 기본값은 typesafe-ai/jev
```

`JEV_PROVIDER`가 비어 있으면 `TYPESAFE_API_KEY`가 있을 때 TypeSafe를, 없고 `AI_GATEWAY_API_KEY`가 있으면 Gateway를 씁니다.

## 리스크 한도

기본값은 한도가 없습니다. Jev가 계속 진입을 고르면 체결될 때마다 주문 금액만큼 포지션이 커지고, 레버리지는 코인별 최대치까지 고를 수 있습니다. 실제 키를 쓸 때는 `.env`에 한도를 설정하세요.

```sh
# 코인별 최대 포지션 금액(USD). 넘게 되는 진입은 주문을 내지 않습니다.
MAX_POSITION_USD=200
# Jev가 고를 수 있는 레버리지 상한. 코인 최대치보다 낮을 때만 적용됩니다.
MAX_LEVERAGE=5
```

- 비워 두거나 `0`이면 한도가 없습니다.
- `MAX_LEVERAGE`는 Jev에게 보여주는 레버리지 선택지 자체를 줄입니다. 선택은 여전히 Jev가 합니다.
- `MAX_POSITION_USD`는 포지션을 키우는 진입에만 걸립니다. 반대 방향 진입과 청산은 막지 않습니다. 한도에 걸리면 봇 로그에 `open held at MAX_POSITION_USD`가 출력되고 대기 주문은 취소됩니다.

## 보안 주의사항

- **API 키를 커밋하지 마세요.** `.env`, `.env.*`, `.bybit-keys.json`은 루트 `.gitignore`에 포함되어 있습니다. 저장소를 만들거나 올리기 전에 `git status`로 이 파일들이 빠져 있는지 확인하세요.
- **Bybit API 키에는 출금 권한을 주지 마세요.** 봇에 필요한 것은 Contract 주문과 포지션 권한뿐입니다.
- **봇 API는 인증이 없습니다.** 봇은 모든 네트워크 인터페이스의 `PORT`에서 대기하고 CORS는 `*`입니다. 같은 네트워크에 있는 누구나 서브계정 UID, 포지션, 손익, 판단 기록을 볼 수 있습니다. 주문을 조작할 수는 없습니다. 공용 와이파이에서는 방화벽으로 막으세요.
- **키가 나가지 않는 경로:** API 키와 시크릿은 로그, 대시보드 API, Jev 요청 어디에도 포함되지 않습니다. 대시보드에 노출되는 것은 서브계정 UID뿐입니다.
- **설정 오류는 조용히 dry run이 됩니다.** `.bybit-keys.json`이나 `BYBIT_KEYS_JSON`에 JSON 오류가 있으면 오류 없이 무시되고 해당 코인은 dry run으로 돕니다. 시작 로그와 상단 표시에서 확인하세요.
- **`BYBIT_API_KEY`는 `COINS`의 첫 번째 코인에 붙습니다.** `COINS` 순서를 바꾸면 그 키가 다른 코인을 거래합니다.
- **의존성 점검:** `bun audit`와 `cd web && bun audit`로 확인할 수 있습니다.

## 환경 변수

전체 목록은 [`.env.example`](.env.example)을 보세요. 동작에 영향을 주는 것들:

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `COINS` | `BTC,ETH,SOL,DOGE,BNB` | 실행할 슬리브. `BTCUSDT`처럼 USDT 무기한으로 거래 |
| `BYBIT_ENV` | `demo` | `demo`, `testnet`, `mainnet` |
| `BYBIT_API_KEY`, `BYBIT_API_SECRET` | 비어 있음 | 첫 번째 코인의 서브계정 키. 비어 있으면 dry run |
| `BYBIT_KEYS_JSON` | 비어 있음 | 나머지 코인의 키(`.bybit-keys.json`과 같은 형식) |
| `DRY_RUN` | `false` | `true`면 모든 슬리브를 시뮬레이션 |
| `MODEL` | `mock` | `mock`, `jev`, `strategy`. `jev`는 TypeSafe 또는 Gateway 키 필요 |
| `STRATEGY_LEVERAGE` | `3` | `MODEL=strategy`의 진입 레버리지 |
| `STRATEGY_EMA_LEN` | `125` | 채널 EMA 길이 |
| `STRATEGY_STOP_PCT` | 비어 있음 | 손절 %. 비우면 손절 없음 |
| `STRATEGY_EXIT` | `opposite` | 청산 위치. `opposite`(반대 라인) 또는 `mid`(채널 중간) |
| `STRATEGY_ON_BAR_CLOSE` | `false` | `true`면 마감된 15분봉으로 판단 |
| `STRATEGY_PARTIAL_TP_PCT` | 비어 있음 | 1차 진입만 들어간 포지션이 채널 중간에 닿으면 이 %만큼 한 번 익절. 비우면 사용 안 함 |
| `STRATEGY_EXIT_LIVE` | `false` | `true`면 봉 마감을 기다리지 않고 현재가가 반대 라인에 닿을 때 익절 |
| `JEV_PROVIDER` | `typesafe` | `typesafe` 또는 `gateway` |
| `TYPESAFE_API_KEY` | 비어 있음 | 공식 TypeSafe 키 |
| `AI_GATEWAY_API_KEY` | 비어 있음 | Vercel AI Gateway 키 |
| `TICK_MS` | `2000` | 판단과 재호가 주기 |
| `PRICE_MS` | `200` | 차트와 중간가 갱신 주기. Jev를 호출하지 않음 |
| `BANKROLL_USD` | `500` | dry run 시작 잔액(전체). 코인 수로 똑같이 나눔. 상단 balance는 이 금액에 청산된 백테스트 거래의 손익(`backtest-results/latest.json`, 봇 시작 때 읽음)과 봇의 수수료 뺀 손익을 더한 값이고, 상단 `backtest`에 포함된 금액이 따로 표시됨. 실제 키가 있으면 Bybit 계좌 잔액(백테스트 미포함) |
| `CHART_DAYS` | `92` | 시작할 때 불러오는 15분봉 기간(일). 차트의 15m, 1H, 4H, 1D 화면이 이만큼 과거까지 보임. 1m, 5m은 최근 약 16시간 |
| `QUOTE_USD` | `40` | 틱당 진입 주문 금액. Bybit 최소 수량보다 작으면 최소 수량으로 주문 |
| `CLOSE_SLIPPAGE_BPS` | `5` | 청산 주문이 호가를 넘기는 정도 |
| `MAX_POSITION_USD` | 비어 있음 | 코인별 최대 포지션 금액. 비어 있으면 한도 없음 |
| `MAX_LEVERAGE` | 비어 있음 | Jev가 고를 수 있는 레버리지 상한. 비어 있으면 코인 최대치 |
| `PORT` | `3000` | 봇 SSE 포트 |
| `HOST` | `0.0.0.0` | 봇이 대기할 인터페이스. nginx 뒤 서버에서는 `127.0.0.1` |

## 엔드포인트

- `GET /` 스냅샷: 모델, 거래소, 네트워크, 슬리브, 코인별 최신 판단(`latestByCoin`)
- `GET /history` 코인별 최근 1000틱
- `GET /tape` 코인별 전체 중간가 시계열과 체결 표시
- `GET /events` SSE: 연결 시 `snapshot`(`historyByCoin`, `tapeByCoin`), 이후 코인별 `block`, `quote`, `fill`

## 테스트

```sh
bun test
```

CI는 push와 pull request마다 같은 명령을 실행합니다.

## 라이선스

MIT. Copyright 2026 aowang. Jarrod Watts가 jev-trader로 공개한 MIT 코드를 포함합니다.
