import HTML from "./index.html";

const MAX_SCORE = 20 * 200; // 20문제 × 최대 200점
const UNITS = 15;
const SESSION_DAYS = 180;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const err = (msg, status = 400) => json({ error: msg }, status);

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return hex(bits);
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function checkNick(n) {
  n = String(n || "").trim();
  if (n.length < 2 || n.length > 12) return [null, "닉네임은 2~12자로 정해주세요"];
  if (!/^[0-9A-Za-z가-힣_.\-]+$/.test(n)) return [null, "닉네임은 한글·영문·숫자·_ . - 만 쓸 수 있어요"];
  return [n, null];
}

async function auth(req, env) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.nick, u.plays, s.created FROM sessions s JOIN users u ON u.id = s.uid WHERE s.token = ?"
  )
    .bind(token)
    .first();
  if (!row) return null;
  if (Date.now() - row.created > SESSION_DAYS * 864e5) return null;
  return row;
}

async function newSession(env, uid) {
  const token = randHex(32);
  await env.DB.prepare("INSERT INTO sessions(token, uid, created) VALUES (?, ?, ?)").bind(token, uid, Date.now()).run();
  return token;
}

async function me(env, u) {
  const best = await env.DB.prepare("SELECT unit, score FROM best WHERE uid = ?").bind(u.id).all();
  const wrong = await env.DB.prepare("SELECT word, cnt FROM wrong WHERE uid = ? ORDER BY cnt DESC").bind(u.id).all();
  const b = {};
  for (const r of best.results) b[r.unit] = r.score;
  return { id: u.id, nick: u.nick, plays: u.plays, best: b, wrong: wrong.results };
}

async function api(req, env, path) {
  const m = req.method;

  if (path === "/api/signup" && m === "POST") {
    const { nick, pw } = await body(req);
    const [n, e] = checkNick(nick);
    if (e) return err(e);
    if (String(pw || "").length < 4) return err("비밀번호는 4자 이상으로 정해주세요");
    const exists = await env.DB.prepare("SELECT 1 FROM users WHERE nick = ?").bind(n).first();
    if (exists) return err("이미 쓰는 닉네임이에요. 다른 이름을 골라주세요", 409);
    const salt = randHex(16);
    const r = await env.DB.prepare("INSERT INTO users(nick, pw, salt, created) VALUES (?, ?, ?, ?)")
      .bind(n, await hashPw(pw, salt), salt, Date.now())
      .run();
    const token = await newSession(env, r.meta.last_row_id);
    return json({ token });
  }

  if (path === "/api/login" && m === "POST") {
    const { nick, pw } = await body(req);
    const u = await env.DB.prepare("SELECT id, pw, salt FROM users WHERE nick = ?").bind(String(nick || "").trim()).first();
    if (!u || (await hashPw(String(pw || ""), u.salt)) !== u.pw) return err("닉네임 또는 비밀번호가 맞지 않아요", 401);
    return json({ token: await newSession(env, u.id) });
  }

  if (path === "/api/rank" && m === "GET") {
    const unit = Math.max(0, Math.min(UNITS, parseInt(new URL(req.url).searchParams.get("unit") || "0", 10) || 0));
    const q = unit
      ? env.DB.prepare(
          "SELECT u.nick, b.score FROM best b JOIN users u ON u.id = b.uid WHERE b.unit = ? ORDER BY b.score DESC, b.at ASC LIMIT 50"
        ).bind(unit)
      : env.DB.prepare(
          "SELECT u.nick, SUM(b.score) AS score FROM best b JOIN users u ON u.id = b.uid GROUP BY b.uid ORDER BY score DESC LIMIT 50"
        );
    return json({ rows: (await q.all()).results });
  }

  if (path === "/api/comments" && m === "GET") {
    const r = await env.DB.prepare(
      "SELECT c.id, c.unit, c.text, c.at, c.uid, u.nick FROM comments c JOIN users u ON u.id = c.uid ORDER BY c.at DESC LIMIT 100"
    ).all();
    return json({ rows: r.results });
  }

  // 이하 로그인 필요
  const u = await auth(req, env);
  if (!u) return err("로그인이 필요해요", 401);

  if (path === "/api/me" && m === "GET") return json(await me(env, u));

  if (path === "/api/logout" && m === "POST") {
    const token = req.headers.get("authorization").slice(7);
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return json({ ok: true });
  }

  if (path === "/api/nick" && m === "POST") {
    const [n, e] = checkNick((await body(req)).nick);
    if (e) return err(e);
    const dup = await env.DB.prepare("SELECT 1 FROM users WHERE nick = ? AND id != ?").bind(n, u.id).first();
    if (dup) return err("이미 쓰는 닉네임이에요. 다른 이름을 골라주세요", 409);
    await env.DB.prepare("UPDATE users SET nick = ? WHERE id = ?").bind(n, u.id).run();
    return json({ nick: n });
  }

  if (path === "/api/score" && m === "POST") {
    const { unit, score, wrong = [], right = [] } = await body(req);
    const un = parseInt(unit, 10);
    const sc = parseInt(score, 10);
    // unit 0 = 오답 복습(랭킹에 안 올라감)
    if (!(un >= 0 && un <= UNITS) || !(sc >= 0 && sc <= MAX_SCORE)) return err("잘못된 점수예요");
    const now = Date.now();
    const words = (a) => (Array.isArray(a) ? a.slice(0, 40).map((w) => String(w).slice(0, 40)) : []);
    const stmts = [];
    if (un > 0)
      stmts.push(env.DB.prepare(
        "INSERT INTO best(uid, unit, score, at) VALUES (?, ?, ?, ?) ON CONFLICT(uid, unit) DO UPDATE SET score = excluded.score, at = excluded.at WHERE excluded.score > best.score"
      ).bind(u.id, un, sc, now));
    stmts.push(
      env.DB.prepare("UPDATE users SET plays = plays + 1 WHERE id = ?").bind(u.id),
      ...words(wrong).map((w) =>
        env.DB.prepare(
          "INSERT INTO wrong(uid, word, cnt) VALUES (?, ?, 1) ON CONFLICT(uid, word) DO UPDATE SET cnt = cnt + 1"
        ).bind(u.id, w)
      ),
      ...words(right).map((w) => env.DB.prepare("DELETE FROM wrong WHERE uid = ? AND word = ?").bind(u.id, w))
    );
    await env.DB.batch(stmts);
    return json(await me(env, u));
  }

  if (path === "/api/comments" && m === "POST") {
    const { text, unit } = await body(req);
    const t = String(text || "").trim().slice(0, 300);
    if (!t) return err("내용을 입력하세요");
    const un = Math.max(0, Math.min(UNITS, parseInt(unit, 10) || 0));
    const last = await env.DB.prepare("SELECT at FROM comments WHERE uid = ? ORDER BY at DESC LIMIT 1").bind(u.id).first();
    if (last && Date.now() - last.at < 5000) return err("댓글은 5초에 한 번만 쓸 수 있어요", 429);
    await env.DB.prepare("INSERT INTO comments(uid, unit, text, at) VALUES (?, ?, ?, ?)").bind(u.id, un, t, Date.now()).run();
    return json({ ok: true });
  }

  const del = path.match(/^\/api\/comments\/(\d+)$/);
  if (del && m === "DELETE") {
    await env.DB.prepare("DELETE FROM comments WHERE id = ? AND uid = ?").bind(+del[1], u.id).run();
    return json({ ok: true });
  }

  return err("없는 주소예요", 404);
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/")) {
      try {
        return await api(req, env, path);
      } catch (e) {
        return err("서버 오류가 났어요. 잠시 후 다시 시도하세요", 500);
      }
    }
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
