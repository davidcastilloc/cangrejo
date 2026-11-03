import type { IncomingMessage, ServerResponse } from 'node:http';
import { cangrejoHonoApp } from './honoApp.js';

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

/**
 * Bridges Node/Vite HTTP requests into the Web-Standard `cangrejoHonoApp` (`Request` -> `Response`).
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) {
    return false;
  }

  const method = req.method ?? 'GET';
  const fullUrl = `http://127.0.0.1:5173${url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') {
      headers.set(k, v);
    } else if (Array.isArray(v)) {
      headers.set(k, v.join(', '));
    }
  }

  const bodyBuf =
    method !== 'GET' && method !== 'HEAD' ? await readRequestBody(req) : undefined;

  const webReq = new Request(fullUrl, {
    method,
    headers,
    body: bodyBuf && bodyBuf.byteLength > 0 ? new Uint8Array(bodyBuf) : undefined,
  });

  const webRes = await cangrejoHonoApp.fetch(webReq);
  if (webRes.status === 404) {
    return false;
  }

  res.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    res.setHeader(key, val);
  });
  const arrayBuf = await webRes.arrayBuffer();
  res.end(Buffer.from(arrayBuf));
  return true;
}
