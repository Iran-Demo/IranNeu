const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
server.listen(PORT);


let online = 0;

function broadcast() {
  const msg = JSON.stringify({ type: "count", online });
  for (const client of wss.clients) {
    try { client.send(msg); } catch {}
  }
}

wss.on("connection", (ws) => {
  online++;
  broadcast();

  ws.on("close", () => {
    online = Math.max(0, online - 1);
    broadcast();
  });
});

server.listen(3000, () => {
  console.log("Open: http://localhost:3000");
});

