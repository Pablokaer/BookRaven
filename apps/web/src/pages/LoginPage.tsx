import { useEffect, useState, type ReactNode } from "react";
import { Landscape } from "../components/dashboard/Landscape";
import wordmark from "../assets/wordmark.png";
import { Field } from "../components/ui/Field";
import { API_BASE, apiJson, isNative, type ServerConfig } from "../lib/api";
import { authClient } from "../lib/auth";

/** Centered card over the landscape, shared by the sign-in and password-reset screens. Headings are centered; form fields read left to right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <Landscape className="absolute inset-0 h-full w-full opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-b from-app/40 via-app/70 to-app" />
      <div className="relative w-full max-w-sm animate-rise rounded-3xl border border-line/80 bg-card/85 p-7 text-center shadow-pop backdrop-blur-xl">
        <div className="mb-7 flex flex-col items-center gap-3">
          <img src={wordmark} alt="BookRaven" className="h-11 w-auto" />
          <p className="text-sm text-muted">Your books, on every device.</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [verify, setVerify] = useState(false);
  const [cfg, setCfg] = useState<ServerConfig | null>(null);

  useEffect(() => {
    apiJson<ServerConfig>("/api/config").then(setCfg).catch(() => setError("Cannot reach the server"));
  }, []);

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setSent(false);
    setVerify(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "forgot") {
      // The link must open the web app, also when requested from the Android app.
      const res = await authClient.requestPasswordReset({ email, redirectTo: `${API_BASE || window.location.origin}/reset-password` });
      setBusy(false);
      if (res.error) setError(res.error.message ?? "Something went wrong");
      else setSent(true);
      return;
    }
    const res =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
    setBusy(false);
    if (res.error) {
      // Signing in before verifying the email: Better Auth sends a 403.
      if (res.error.status === 403 && cfg?.requireEmailVerification) setVerify(true);
      else setError(res.error.message ?? "Something went wrong");
    } else if (mode === "signup" && cfg?.requireEmailVerification) {
      // No session yet: the account must confirm its email first.
      setVerify(true);
    } else onSignedIn();
  }

  async function google() {
    setError(null);
    const res = await authClient.signIn.social({ provider: "google", callbackURL: window.location.href });
    if (res?.error) setError(res.error.message ?? "Google sign-in failed");
  }

  // Google blocks OAuth inside embedded WebViews; the app needs a native flow (see README).
  const showGoogle = cfg?.googleEnabled && !isNative;

  const emailInput = (
    <Field label="Email">
      <input
        className="input h-11 w-full"
        type="email"
        placeholder="you@example.com"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
    </Field>
  );

  if (mode === "forgot") {
    return (
      <AuthLayout>
        <h2 className="mb-2 font-semibold">Reset your password</h2>
        {sent ? (
          <p className="text-sm text-muted">
            If an account exists for <span className="text-fg">{email}</span>, we sent it a link to choose a new password. The link works for one
            hour.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted">Enter your email and we will send you a link.</p>
            {emailInput}
            {error && <p className="text-sm text-rose-300">{error}</p>}
            <button className="btn h-11 w-full" disabled={busy}>
              {busy ? "Please wait…" : "Send reset link"}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm">
          <button className="font-medium text-accent hover:text-accent-hover" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        </p>
      </AuthLayout>
    );
  }

  if (verify) {
    return (
      <AuthLayout>
        <h2 className="mb-2 font-semibold">Confirm your email</h2>
        <p className="text-sm text-muted">
          We sent a confirmation link to <span className="text-fg">{email}</span>. Open it to finish signing in. Check your spam folder if it does not
          arrive.
        </p>
        <p className="mt-6 text-center text-sm">
          <button className="font-medium text-accent hover:text-accent-hover" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <Field label="Name">
            <input className="input h-11 w-full" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        {emailInput}
        <Field label="Password">
          <input
            className="input h-11 w-full"
            type="password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </Field>
        {mode === "signin" && cfg?.passwordResetEnabled && (
          <div className="-mt-2 text-right">
            <button type="button" className="text-xs text-muted hover:text-accent" onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
          </div>
        )}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <button className="btn h-11 w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {showGoogle && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
          </div>
          <button className="btn-outline h-11 w-full" onClick={google}>
            Continue with Google
          </button>
        </>
      )}

      {cfg?.allowSignup !== false && (
        <p className="mt-6 text-center text-sm text-muted">
          {mode === "signin" ? "No account yet? " : "Already have an account? "}
          <button className="font-medium text-accent hover:text-accent-hover" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      )}
    </AuthLayout>
  );
}
