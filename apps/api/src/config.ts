import path from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  publicUrl: required("PUBLIC_URL", isProd ? undefined : "http://localhost:5173").replace(/\/$/, ""),
  databaseUrl: required(
    "DATABASE_URL",
    isProd ? undefined : "postgres://readsync:readsync@localhost:5432/readsync",
  ),
  authSecret: required(
    "BETTER_AUTH_SECRET",
    isProd ? undefined : "dev-only-secret-do-not-use-in-production-0000",
  ),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  allowSignup: (process.env.ALLOW_SIGNUP ?? "true").toLowerCase() !== "false",
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./data"),
  /** "local" keeps files in STORAGE_DIR; "s3" uses an S3-compatible bucket (STORAGE_DIR then only holds temp uploads). */
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") === "s3" ? ("s3" as const) : ("local" as const),
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "readsync",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    /** Garage and MinIO need path-style URLs (endpoint/bucket/key). */
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  /** Total size of the books each account may keep. Administrators have no limit. */
  quotaBytes: Number(process.env.UPLOAD_QUOTA_MB ?? 2048) * 1024 * 1024,
  /** Emails of administrator accounts (comma-separated): unlimited storage, can moderate the public library. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** Origins used by the Capacitor Android/iOS shells. */
  nativeOrigins: ["https://localhost", "http://localhost", "capacitor://localhost"],
};

export const isAdmin = (user: { email: string }) => config.adminEmails.includes(user.email.toLowerCase());

export const googleEnabled = Boolean(config.google.clientId && config.google.clientSecret);

export const allowedOrigins = Array.from(
  new Set([
    config.publicUrl,
    ...config.nativeOrigins,
    ...(isProd ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"]),
    ...(process.env.EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ]),
);
