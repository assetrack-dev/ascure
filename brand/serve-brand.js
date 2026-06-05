// Minimal zero-dependency static server for previewing the ASCURE brand board.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT ? Number(process.env.PORT) : 4789;
const file = path.join(__dirname, 'ascure-brand-concepts.html');

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  })
  .listen(port, () => {
    console.log('ASCURE brand preview running on http://localhost:' + port);
  });
