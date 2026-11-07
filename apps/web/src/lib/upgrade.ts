import { useEffect, useState } from "react";
import { isNative, serverConfig } from "./api";
import { useLibrary } from "./libraryStore";

/** The Google Play build sells nothing outside Google Play: no plans, no link to them. */
export const plansHidden = isNative && import.meta.env.VITE_STORE === "play";

/** Where the storage plans are: Profile → Storage plans. */
export const PLANS_PATH = "/profile#plans";

/** Whether the server sells storage plans (STRIPE_* set), and this build may show them. */
export function usePlansOnSale() {
  const [onSale, setOnSale] = useState(false);
  useEffect(() => {
    if (plansHidden) return;
    let live = true;
    serverConfig()
      .then((c) => live && setOnSale(Boolean(c.billingEnabled)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return onSale;
}

/**
 * Whether to offer an upgrade: plans on sale and an account on the free storage (not an
 * administrator, who is unlimited, nor one with a plan already).
 */
export function useUpgradeOffer() {
  const { me } = useLibrary();
  const onSale = usePlansOnSale();
  return onSale && !!me && me.quotaBytes !== null && !me.plan;
}
