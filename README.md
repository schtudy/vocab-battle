# 영단어 3초 배틀

수능 필수 영단어 15 Unit(× 200단어) 3초 4지선다 퀴즈. 닉네임+비밀번호 로그인, Unit별/전체 랭킹, 댓글, 개인 오답노트.

- 프론트: `src/index.html` (단일 파일)
- 서버: `src/worker.js` (Cloudflare Worker, `/api/*`)
- DB: Cloudflare D1 `vocab-battle-db` (스키마 `schema.sql`)

## 배포
Cloudflare 대시보드 → Workers & Pages → `vocab-battle` → Settings → Builds에서 이 저장소를 연결하면 `main`에 push할 때마다 자동 배포됩니다.
