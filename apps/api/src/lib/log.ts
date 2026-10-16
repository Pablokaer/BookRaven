import { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import { pino } from "pino";
import { config } from "../config.js";

// Share and invite links, and the links in password-reset and verification emails, carry their
// key in the URL: whoever reads the log could use them.
const SECRET_PATH = /^(\/api\/(?:shares|collection-shares|clubs\/invite|auth\/reset-password)\/)[^/?]+/;
const SECRET_QUERY = /([?&]token=)[^&]*/g;

/** The URL with every key in it replaced by "[redacted]". */
export const redactUrl = (url: string) => url.replace(SECRET_PATH, "$1[redacted]").replace(SECRET_QUERY, "$1[redacted]");

export const serializers = {
  req: (req: FastifyRequest) => ({ method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip }),
};

/**
 * The server's logger: Fastify logs requests with it, and code outside a request (email,
 * background jobs) logs through it too, so every line reaches the same JSON output.
 */
export const log = pino({ level: process.env.LOG_LEVEL ?? (config.isProd ? "info" : "debug"), serializers });

/** Requests too frequent to log at info: health checks and the readers' range requests for a book. */
const isRoutine = (request: FastifyRequest) => request.routeOptions.url === "/api/health" || request.headers.range !== undefined;

/** Fastify's request lines, at debug for routine requests; errors are still logged as usual. */
export class RequestLogController extends LogController {
  override incomingRequest(request: FastifyRequest, reply: FastifyReply) {
    if (isRoutine(request)) request.log.debug({ req: request }, "incoming request");
    else super.incomingRequest(request, reply);
  }

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    if (!error && isRoutine(request)) reply.log.debug({ res: reply, responseTime: reply.elapsedTime }, "request completed");
    else super.requestCompleted(error, request, reply);
  }
}
