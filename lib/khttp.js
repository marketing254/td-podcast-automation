// ============================================================
// kfetch — fetch with a curl fallback. On this dev machine,
// Node's TLS to api.convertkit.com is blocked by local security
// software (curl works fine). On Vercel, plain fetch works and
// the fallback never triggers.
// ============================================================
const { execFile } = require("child_process");

function curlFallback(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "45", "-w", "\n__HTTP_STATUS__:%{http_code}"];
    if (opts.method && opts.method !== "GET") { args.push("-X", opts.method); }
    for (const [k, v] of Object.entries(opts.headers || {})) args.push("-H", `${k}: ${v}`);
    if (opts.body) args.push("-d", typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    args.push(url);
    execFile("curl", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error("curl fallback failed: " + err.message));
      const i = stdout.lastIndexOf("\n__HTTP_STATUS__:");
      const body = i >= 0 ? stdout.slice(0, i) : stdout;
      const status = i >= 0 ? parseInt(stdout.slice(i + 17), 10) : 0;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
        json: async () => JSON.parse(body),
      });
    });
  });
}

async function kfetch(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(45000) });
  } catch (e) {
    const code = e?.cause?.code || e?.name || "";
    if (/TIMEOUT|TimeoutError|ECONNRESET|UND_ERR/i.test(String(code) + e.message)) {
      return curlFallback(url, opts);
    }
    throw e;
  }
}

module.exports = { kfetch };
