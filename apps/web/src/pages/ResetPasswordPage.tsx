import { useState } from "react";
import { authClient } from "../lib/auth";
import { AuthLayout } from "./LoginPage";

/** "/reset-password?token=…" — opened from the password-reset email. */
export function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token: token! });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "This link is invalid or has expired.");
    else setDone(true);
  };

  const finish = () => {
    window.history.replaceState(null, "", "/");
    onDone();
  };

  return (
    <AuthLayout>
      <h2 className="mb-3 font-semibold">Choose a new password</h2>
      {!token || linkError ? (
        <p className="text-sm text-muted">This reset link is invalid or has expired. Ask for a new one from the sign-in screen.</p>
      ) : done ? (
        <p className="text-sm text-muted">Your password was changed and other devices were signed out.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            className="input h-11 w-full"
            type="password"
            placeholder="New password (min. 8 characters)"
            aria-label="New password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <input
            className="input h-11 w-full"
            type="password"
            placeholder="Repeat the new password"
            aria-label="Repeat the new password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <button className="btn h-11 w-full" disabled={busy}>
            {busy ? "Please wait…" : "Save new password"}
          </button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <button className="font-medium text-accent hover:text-accent-hover" onClick={finish}>
          {done ? "Continue" : "Back to sign in"}
        </button>
      </p>
    </AuthLayout>
  );
}
