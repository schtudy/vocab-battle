# 영단어 3초 배틀 (VOCAB BATTLE)

수능 필수 영단어 15 Unit(× 200단어) 3초 4지선다 퀴즈. 닉네임+비밀번호 로그인, Unit별/전체 랭킹, 댓글, 개인 오답노트·오답 복습.

## 구조
```
public/                 정적 파일 (Cloudflare Workers Static Assets)
  index.html
  css/fonts.css         로컬 글꼴 @font-face (Lato=영문, NanumSquare=한글)
  css/theme.css         경북일고 테마 (네이비·골드, 라이트/다크 변수)
  css/app.css           화면 레이아웃: 메인·퀴즈·결과·랭킹·댓글
  js/theme.js           라이트/다크 전환 버튼(헤더)
  js/passages.js        수능형 지문(2026 최신 이슈) — 단어장 단어 자동 각주
  js/words.js           단어 3,000개 데이터
  js/vocab-battle-ui.js 연출 유틸 (Design Kit 기반: 피드백·등장·카운트업 등)
  js/app.js             앱 로직 (퀴즈·점수·API 호출)
  images/               logo-mark, grid-glow, combo-spark, medal (SVG)
  fonts/                woff2 서브셋 + LICENSE.txt
  _headers              보안·캐시 헤더
src/worker.js           /api/* (Cloudflare Worker) — 나머지 주소는 / 로 이동
schema.sql              D1 스키마
```

## 배포
`main`에 push하면 Cloudflare Workers Builds가 `npx wrangler deploy`로 자동 배포합니다.

## 로컬 실행
```
npx wrangler d1 execute vocab-battle-db --local --file=schema.sql
npx wrangler dev --local
```

## 점수 규칙
정답 100점 + 남은 시간 보너스(남은 ms ÷ 30, 최대 100점). 3초 초과 시 오답. 콤보는 연출만 하고 점수에는 영향 없음(기존 기록과 공정성 유지).

## 관리자 모드
화면 맨 아래 `관리자 모드`(또는 주소 끝 `#admin`). 기본 비밀번호는 코드의 해시값과 같은 값이며,
Cloudflare Worker 설정 > 변수 및 비밀에 `ADMIN_PW`를 넣으면 그 값으로 바뀝니다.
- 기능 추가: `public/js/app.js`의 `ADMIN_SECTIONS` + `src/worker.js`의 `SETTINGS`에 같은 key로 한 항목씩 추가
- 출석 이벤트: 기간 내 출석한 학생 중 합산 점수 상위 N명(기본 2명) 보상, 마감 후 결과 고정
