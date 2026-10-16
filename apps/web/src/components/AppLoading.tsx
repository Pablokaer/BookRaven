import logoIcon from "../assets/logo.webp";

/** Full-screen placeholder while the app starts: the app logo, gently pulsing. */
export function AppLoading() {
  return (
    <div className="flex h-dvh items-center justify-center" role="status" aria-label="Loading">
      <img src={logoIcon} alt="" className="h-24 w-24 rounded-3xl motion-safe:animate-pulse" />
    </div>
  );
}
