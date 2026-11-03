import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, the check that the person signing up is not a bot. It stays invisible
 * unless Cloudflare wants an interaction (a checkbox). `onToken` gets the token to send with the
 * request (x-captcha-response), or null while there is none or it expired. A token works once:
 * remount the widget (change its `key`) after each attempt.
 */

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Turnstile did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string | null) => void; onError: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // The latest callbacks, without rendering the widget again when they change.
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    let widget: string | null = null;
    let gone = false;
    loadTurnstile()
      .then((api) => {
        if (gone || !box.current) return;
        widget = api.render(box.current, {
          sitekey: siteKey,
          theme: "dark",
          appearance: "interaction-only",
          callback: (token: string) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => {
            handlers.current.onToken(null);
            handlers.current.onError();
          },
        });
      })
      .catch(() => !gone && handlers.current.onError());
    return () => {
      gone = true;
      if (widget) window.turnstile?.remove(widget);
      handlers.current.onToken(null);
    };
  }, [siteKey]);

  return <div ref={box} className="flex justify-center empty:hidden" />;
}
