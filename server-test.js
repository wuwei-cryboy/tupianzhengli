const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8083;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
  console.log('Serving from: ' + ROOT);
});

// Keep process alive
setInterval(() => {}, 1000);