/**
 * Local-only helper for browser journey tests: GET /as/<label> sets the saved
 * session cookie for that synthetic account and redirects to the app. Cookies
 * are shared across ports on localhost, so the app on :3001 sees the session.
 * Binds to 127.0.0.1 only. Stop it when the journey is done.
 *
 *   node test/journey/cookie-helper.mjs <dir-with-cookies-*.json> [port]
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, port = "3999"] = process.argv.slice(2);

createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/go/invite") {
    // The invitation link captured from the outbox for the synthetic coach.
    res.writeHead(302, { Location: readFileSync(join(dir, "invite-url.txt"), "utf8").trim() }).end();
    return;
  }
  const m = /^\/as\/(admin|coach|customer|signed-out)$/.exec(url.pathname);
  if (!m) {
    res.writeHead(404).end("not found");
    return;
  }
  const next = url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next") : "/account";
  let cookies = [];
  if (m[1] === "signed-out") {
    cookies = ["sb-lbqgucirksrafxscgkzg-auth-token=; Path=/; Max-Age=0; SameSite=Lax"];
  } else {
    const saved = JSON.parse(readFileSync(join(dir, `cookies-${m[1]}.json`), "utf8"));
    cookies = saved.map((c) => `${c.name}=${c.value}; Path=/; SameSite=Lax`);
  }
  res.writeHead(302, { "Set-Cookie": cookies, Location: `http://localhost:3001${next}` }).end();
}).listen(Number(port), "127.0.0.1", () => console.log(`cookie helper on http://localhost:${port}`));
