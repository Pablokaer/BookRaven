import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import logoIcon from "../assets/logo.webp";
import wordmark from "../assets/wordmark.webp";
import { Field, PasswordField } from "../components/ui/Field";
import { ArchedPlate, Fleuron } from "../components/ui/Ornaments";
import { API_BASE, apiJson, isNative, type ServerConfig } from "../lib/api";
import { authClient } from "../lib/auth";

/**
 * The sign-in, sign-up and password screens: the raven's arched plate beside the form on wide
 * screens, above it on phones, and the form on a card framed like a bookplate. Headings are
 * centered; form fields read left to right. `homeLink` adds a link back to the landing page (only
 * inside a router).
 */
export function AuthLayout({
  children,
  heading,
  lead,
  homeLink = false,
}: {
  children: ReactNode;
  heading: string;
  lead?: ReactNode;
  homeLink?: boolean;
}) {
  return (
    <main className="lit lit-grain lit-grain-night relative min-h-dvh overflow-x-clip lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Moonlight from above, a candle's warmth low on the left. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(50% 40% at 30% 0%, rgb(170 184 198 / 0.16), transparent 70%), radial-gradient(40% 40% at 0% 100%, rgb(201 164 116 / 0.12), transparent 70%), linear-gradient(180deg, #0b1d2e, #071521 50%)",
        }}
      />
      <aside
        aria-hidden="true"
        className="relative flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] lg:items-center lg:border-r lg:border-gold/15 lg:p-12"
      >
        <figure className="w-[min(58vw,250px)] lg:w-[min(30vw,400px)]">
          <ArchedPlate sizes="(min-width: 1024px) 30vw, 58vw" priority />
          <figcaption className="-mt-4 hidden text-center font-literary text-[16px] italic leading-snug text-silver lg:block">
            &ldquo;Deep into that darkness peering, long I stood there wondering&hellip;&rdquo;
            <span className="mt-2 block font-sans text-[10.5px] not-italic uppercase tracking-[0.2em] text-silver/70">Plate after Gustave Doré, 1884</span>
          </figcaption>
        </figure>
      </aside>

      {homeLink && (
        <Link
          to="/"
          className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] z-20 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-silver transition hover:bg-navy hover:text-ivory"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
      )}

      <div className="relative z-10 -mt-24 flex justify-center px-4 pb-[max(3rem,env(safe-area-inset-bottom))] lg:mt-0 lg:items-center lg:px-10 lg:py-16">
        <div className="relative w-full max-w-sm animate-rise rounded-md border border-gold/25 bg-navy/90 px-6 pb-8 pt-8 text-center shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] backdrop-blur-md sm:px-8">
          <span aria-hidden="true" className="pointer-events-none absolute inset-[6px] rounded-[3px] border border-gold/10" />
          <div className="flex items-center justify-center gap-3">
            <img src={logoIcon} alt="" className="h-11 w-11 rounded-[11px]" />
            <img src={wordmark} alt="BookRaven" className="h-7 w-auto" />
          </div>
          <h1 className="mt-7 font-literary text-[2.1rem] font-medium leading-[1.05] text-ivory text-balance">{heading}</h1>
          <Fleuron className="mx-auto mt-4 w-20 text-gold/60" />
          {lead && <p className="mt-4 text-sm leading-relaxed text-silver">{lead}</p>}
          <div className="mt-7">{children}</div>
        </div>
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
      <AuthLayout homeLink={homeLink} heading="Reset your password">
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
      <AuthLayout homeLink={homeLink} heading="Confirm your email">
        <p className="text-sm text-muted">
          We sent a confirmation link to <span className="text-fg">{email}</span>. Open it to finish signing in. Check your spam folder if it does not
          arrive.
        </p>
        <AuthFooterLink onClick={() => switchMode("signin")} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      homeLink={homeLink}
      heading={mode === "signin" ? "Welcome back, reader." : "Begin your library."}
      lead={mode === "signin" ? "Sign in and your books open where you left them." : "One account for every book you own, on every device."}
    >
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
