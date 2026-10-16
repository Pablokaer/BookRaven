import logoIcon from "../assets/logo.webp";
import { Fleuron } from "./ui/Ornaments";

/** Full-screen placeholder while the app starts: the app logo, gently pulsing, over a fleuron. */
export function AppLoading() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6" role="status" aria-label="Loading">
      <img src={logoIcon} alt="" className="h-24 w-24 rounded-[22px] shadow-[0_20px_50px_-20px_rgb(0_0_0/0.9)] motion-safe:animate-pulse" />
      <Fleuron className="w-24 text-gold/50" />
    </div>
  );
}
