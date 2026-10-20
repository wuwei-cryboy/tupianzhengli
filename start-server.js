// 启动本地 HTTP 服务器，让用户能直接访问 pmndrs-cards 应用
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'

const PORT = 8080
const ROOT = join(process.cwd(), 'pmndrs-cards')
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
}

createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  const file = join(ROOT, path)

  if (!existsSync(file)) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.end(readFileSync(file))
}).listen(PORT, () => {
  console.log(`Local server running at http://localhost:${PORT}/`)
  console.log(`Serving from: ${ROOT}`)
})
