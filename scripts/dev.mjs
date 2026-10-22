// Serves the site on http://localhost:8766 and keeps products.json in sync with the Telegram channel.
// Run: npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8766;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = urlPath === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    });
});

server.listen(PORT, () => console.log(`Site: http://localhost:${PORT}`));

const sync = spawn(process.execPath, [path.join(ROOT, 'scripts', 'sync-products.mjs'), '--loop'], { stdio: 'inherit' });
sync.on('exit', code => console.log(`Sync process exited with code ${code}`));

const shutdown = () => { sync.kill(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
