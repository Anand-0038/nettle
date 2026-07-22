import { createServer } from "node:http";

export function startHealthServer(port: number) {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ status: "ok", service: "nettle-keeper" })
      );
      return;
    }

    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("Nettle Keeper");
  });

  server.listen(port, () => {
    console.log(`[keeper] health server listening on ${port}`);
  });

  return server;
}
