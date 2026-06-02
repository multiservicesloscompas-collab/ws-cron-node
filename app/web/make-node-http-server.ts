import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

export interface MakeNodeHttpServerDeps {
  port: number;
  handleRequest: (req: Request) => Promise<Response>;
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  onListen?: (port: number) => void;
}

export interface StartedNodeHttpServer {
  stop: () => Promise<void>;
}

const readRequestBody = async (
  request: IncomingMessage,
): Promise<Uint8Array | undefined> => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (!chunks.length) return undefined;
  return Buffer.concat(chunks);
};

const makeWebRequest = async (
  request: IncomingMessage,
): Promise<Request> => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = request.method ?? "GET";
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await readRequestBody(request);

  return new Request(url, { method, headers, body });
};

const writeWebResponse = async (
  response: ServerResponse,
  webResponse: Response,
): Promise<void> => {
  response.statusCode = webResponse.status;

  for (const [name, value] of webResponse.headers.entries()) {
    response.setHeader(name, value);
  }

  if (!webResponse.body) {
    response.end();
    return;
  }

  const body = Buffer.from(await webResponse.arrayBuffer());
  response.end(body);
};

const stopServer = async (server: NodeHttpServer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const makeNodeHttpServer = async (
  deps: MakeNodeHttpServerDeps,
): Promise<StartedNodeHttpServer> => {
  const server = createServer((request, response) => {
    void (async () => {
      const webRequest = await makeWebRequest(request);
      const webResponse = await deps.handleRequest(webRequest);
      await writeWebResponse(response, webResponse);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }

      response.end(JSON.stringify({ ok: false, error: `Error interno: ${message}` }));
    });
  });

  server.on("upgrade", (request, socket, head) => {
    deps.handleUpgrade(request, socket, head);
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      const address = server.address();

      if (address && typeof address !== "string") {
        deps.onListen?.(address.port);
      }

      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(deps.port);
  });

  return {
    stop: () => stopServer(server),
  };
};
