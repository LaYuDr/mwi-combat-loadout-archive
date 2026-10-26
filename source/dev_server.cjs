"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const project = path.resolve(__dirname, "..");
const port = 4178;
const routes = new Set(["runtime.js", "mwi_combat_loadout_archive.dev.user.js", "mwi_combat_loadout_archive.user.js", "mwi_combat_loadout_archive.meta.js"]);
const allowedOrigins = new Set(["https://mwi-combatsi-mulator.pages.dev", "https://azhu949.github.io"]);
function build() {
  execFileSync(process.execPath, [path.join(__dirname, "build.cjs")], { cwd: project, env: { ...process.env, MWI_ARCHIVE_RELEASE: "0" }, stdio: "pipe", timeout: 30000 });
}
function createServer(buildProject = build) {
  return http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}` ||
      (request.headers.origin && !allowedOrigins.has(request.headers.origin))) {
      response.writeHead(403).end("Forbidden"); return;
    }
    if (request.method !== "GET") { response.writeHead(405).end("Method not allowed"); return; }
    const filename = new URL(request.url, `http://127.0.0.1:${port}`).pathname.slice(1);
    if (!routes.has(filename)) { response.writeHead(404).end("Not found"); return; }
    try {
      buildProject();
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" })
        .end(fs.readFileSync(path.join(project, "deliverables", filename)));
    } catch (error) {
      console.error(error.message);
      response.writeHead(503).end("Build failed; see development server log");
    }
  });
}
if (require.main === module) {
  build();
  const server = createServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`安装加载器：http://127.0.0.1:${port}/mwi_combat_loadout_archive.dev.user.js`));
}
module.exports = { createServer };
