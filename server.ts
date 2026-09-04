import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiBridgeMiddleware } from './server/geminiBridge';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPublicDir = path.join(currentDir, '..', 'dist');
const sourcePublicDir = path.join(currentDir, 'dist');
const publicDir = existsSync(bundledPublicDir) ? bundledPublicDir : sourcePublicDir;
const port = Number.parseInt(process.env.PORT || '3000', 10);
const bridge = createGeminiBridgeMiddleware();
const mimeTypes: Readonly<Record<string, string>> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const serveFrontend = (requestUrl: string | undefined, response: import('node:http').ServerResponse): void => {
    const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname;
    const decoded = decodeURIComponent(pathname);
    const requested = path.resolve(publicDir, `.${decoded}`);
    const safeRequested = requested === publicDir || requested.startsWith(`${publicDir}${path.sep}`);
    const candidate = safeRequested && existsSync(requested) && statSync(requested).isFile()
        ? requested
        : path.join(publicDir, 'index.html');
    if (!existsSync(candidate)) {
        response.statusCode = 404;
        response.end('Not found');
        return;
    }
    response.statusCode = 200;
    response.setHeader('content-type', mimeTypes[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream');
    createReadStream(candidate).pipe(response);
};

createServer((request, response) => {
    void bridge(request, response, () => serveFrontend(request.url, response));
}).listen(Number.isFinite(port) ? port : 3000, '0.0.0.0');
