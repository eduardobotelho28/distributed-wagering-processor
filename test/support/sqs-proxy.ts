export interface SqsProxy {
  endpoint: string;
  // Requisições dessa ação ficam penduradas para sempre (ex.: "DeleteMessage" = ack).
  hang(action: string): void;
  // Simula o SQS fora do ar: toda requisição responde 503.
  setDown(down: boolean): void;
  stop(): void;
}

// O SDK v3 do SQS usa o protocolo JSON: a ação vem no header x-amz-target.
function actionOf(request: Request): string {
  return (request.headers.get("x-amz-target") ?? "").replace("AmazonSQS.", "");
}

// DECISION: proxy HTTP só de teste entre o app e o LocalStack. Os testes rodam dentro do
// container e não podem pausar o LocalStack nem acertar o instante do kill; travar o ack ou
// derrubar o "SQS" pelo proxy reproduz essas falhas de forma determinística.
export function startSqsProxy(target: string): SqsProxy {
  const hanging = new Set<string>();
  let down = false;
  const server = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    async fetch(request) {
      if (down) return new Response("service unavailable", { status: 503 });
      if (hanging.has(actionOf(request))) return new Promise<Response>(() => {});
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("host");
      return fetch(`${target}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    hang: (action) => hanging.add(action),
    setDown: (value) => {
      down = value;
    },
    stop: () => server.stop(true),
  };
}
