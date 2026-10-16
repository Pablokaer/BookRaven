import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Landscape } from "../components/dashboard/Landscape";
import logoIcon from "../assets/logo.webp";
import wordmark from "../assets/wordmark.webp";
import { Field, PasswordField } from "../components/ui/Field";
import { API_BASE, apiJson, isNative, type ServerConfig } from "../lib/api";
import { authClient } from "../lib/auth";

/**
 * Centered card over the landscape, shared by the sign-in and password-reset screens. Headings are centered; form fields read left to right.
 * `homeLink` adds a link back to the landing page (only inside a router).
 */
export function AuthLayout({ children, homeLink = false }: { children: ReactNode; homeLink?: boolean }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <Landscape className="absolute inset-0 h-full w-full opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-b from-app/40 via-app/70 to-app" />
      {homeLink && (
        <Link
          to="/"
          className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-elevated hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
      )}
      <div className="relative w-full max-w-sm animate-rise rounded-3xl border border-line/80 bg-card/85 p-7 text-center shadow-pop backdrop-blur-xl">
        <div className="mb-7 flex flex-col items-center gap-3">
          <img src={logoIcon} alt="" className="h-16 w-16 rounded-2xl" />
          <img src={wordmark} alt="BookRaven" className="h-9 w-auto" />
          <p className="text-sm text-muted">Your books, on every device.</p>
        </div>
        {children}
      </div>
    </main>
  );
}

/** The link under an auth card, back to the sign-in form. */
export function AuthFooterLink({ onClick, children = "Back to sign in" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <p className="mt-6 text-center text-sm">
      <button className="font-medium text-accent hover:text-accent-hover" onClick={onClick}>
        {children}
      </button>
    </p>
  );
}

export type LoginMode = "signin" | "signup" | "forgot";

export function LoginPage({
  onSignedIn,
  initialMode = "signin",
  onModeChange,
  homeLink = false,
}: {
  onSignedIn: () => void;
  initialMode?: "signin" | "signup";
  /** Called when the form switches between sign-in, sign-up and reset (to keep the address in step). */
  onModeChange?: (mode: LoginMode) => void;
  homeLink?: boolean;
}) {
  const [mode, setMode] = useState<LoginMode>(initialMode);
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

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError(null);
    setSent(false);
    setVerify(false);
    onModeChange?.(next);
  };

  // A sign-up link on a server that takes no new accounts: show the sign-in form instead.
  const signupClosed = cfg?.allowSignup === false;
  useEffect(() => {
    if (signupClosed && mode === "signup") switchMode("signin");
  }, [signupClosed, mode]);

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
      <AuthLayout homeLink={homeLink}>
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
        <AuthFooterLink onClick={() => switchMode("signin")} />
      </AuthLayout>
    );
  }

  if (verify) {
    return (
      <AuthLayout homeLink={homeLink}>
        <h2 className="mb-2 font-semibold">Confirm your email</h2>
        <p className="text-sm text-muted">
          We sent a confirmation link to <span className="text-fg">{email}</span>. Open it to finish signing in. Check your spam folder if it does not
          arrive.
        </p>
        <AuthFooterLink onClick={() => switchMode("signin")} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout homeLink={homeLink}>
      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <Field label="Name">
            <input className="input h-11 w-full" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        {emailInput}
        <PasswordField
          label="Password"
          placeholder="At least 8 characters"
          minLength={8}
          value={password}
          onValue={setPassword}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
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
