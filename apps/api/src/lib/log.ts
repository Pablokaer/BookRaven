import { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import { pino } from "pino";
import { config } from "../config.js";

// Share and invite links, and the links in password-reset and verification emails, carry their
// key in the URL: whoever reads the log could use them. Routes name that key `:token`, and
// learnSecretRoute learns their paths; Better Auth's reset link is not a route of ours.
const secretPrefixes = new Set(["/api/auth/reset-password/"]);
const SECRET_QUERY = /([?&]token=)[^&]*/g;

/** A path prefix as a regex source: its other parameters match any one segment. */
const prefixPattern = (prefix: string) =>
  prefix
    .split("/")
    .map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
const compileSecretPath = () => new RegExp(`^(${[...secretPrefixes].map(prefixPattern).join("|")})[^/?]+`);
let secretPath = compileSecretPath();

/**
 * onRoute hook: remembers the path of every route with a `:token` parameter, so its key is
 * redacted (also when a request near it matches no route).
 */
export function learnSecretRoute({ url }: { url: string }) {
  const at = url.indexOf("/:token");
  if (at === -1 || secretPrefixes.has(url.slice(0, at + 1))) return;
  secretPrefixes.add(url.slice(0, at + 1));
  secretPath = compileSecretPath();
}

/** The URL with every key in it replaced by "[redacted]". */
export const redactUrl = (url: string) => url.replace(secretPath, "$1[redacted]").replace(SECRET_QUERY, "$1[redacted]");

export const serializers = {
  req: (req: FastifyRequest) => ({ method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip }),
};

/**
 * The server's logger: Fastify logs requests with it, and code outside a request (email,
 * background jobs) logs through it too, so every line reaches the same JSON output.
 * An empty LOG_LEVEL means the default, as it did with Fastify's own logger.
 */
export const log = pino({ level: process.env.LOG_LEVEL || (config.isProd ? "info" : "debug"), serializers });

/**
 * The logger of security-relevant events; exported for the tests. It writes at info whatever
 * LOG_LEVEL says (except "silent"), so lowering the noise with "warn" keeps the trail.
 */
export const auditLog = log.child({ audit: true }, { level: log.level === "silent" ? "silent" : "info" });

/**
 * Logs a security-relevant event: sign-ins, account changes, admin actions. Every line has
 * `audit: true` and an `event` name, so the trail is easy to filter out of the log.
 */
export function audit(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" = "info") {
  auditLog[level]({ event, ...fields }, event);
}

/**
 * Requests too frequent to log at info: health checks and the readers' range requests for a
 * book's file (the routes ending in /file).
 */
const isRoutine = (request: FastifyRequest) =>
  request.routeOptions.url === "/api/health" || (request.headers.range !== undefined && request.routeOptions.url?.endsWith("/file") === true);

/** Fastify's request lines, at debug for routine requests that succeed, with keys redacted. */
export class RequestLogController extends LogController {
  override incomingRequest(request: FastifyRequest, reply: FastifyReply) {
    if (isRoutine(request)) request.log.debug({ req: request }, "incoming request");
    else super.incomingRequest(request, reply);
  }

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    if (error || !isRoutine(request)) super.requestCompleted(error, request, reply);
    // An error answer (e.g. a book file missing from storage) still shows at info, with the
    // request, since its "incoming request" line was at debug.
    else if (reply.statusCode >= 400) reply.log.info({ req: request, res: reply, responseTime: reply.elapsedTime }, "request completed");
    else reply.log.debug({ res: reply, responseTime: reply.elapsedTime }, "request completed");
  }

  // Fastify's own line puts the raw URL in the message.
  override routeNotFound(request: FastifyRequest) {
    if (this.isLogDisabled(request)) return;
    request.log.info(`Route ${request.raw.method}:${redactUrl(request.raw.url ?? "")} not found`);
  }
}
