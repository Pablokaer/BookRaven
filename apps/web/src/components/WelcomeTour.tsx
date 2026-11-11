import { ArrowLeft, ArrowRight, Link2, RefreshCw, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLibraryActions } from "../lib/libraryStore";
import { Medallion, type Vignette } from "./ui/Ornaments";
import { Modal } from "./ui/Modal";

type Step = { title: string; text: string; plate: Vignette; alt: string; seal: ReactNode };

export const WELCOME_STEPS: Step[] = [
  {
    title: "Bring your books",
    text: "Upload EPUBs, PDFs and comics with Upload Book, or import a whole Calibre library. They wait for you on your shelves, ready to open.",
    plate: "shelves",
    alt: "Leather-bound books stacked on a draped table.",
    seal: <Upload />,
  },
  {
    title: "Read on every device",
    text: "Your place, bookmarks, highlights and notes sync between the browser, the Android app and KOReader. Start a chapter on your computer and finish it on your phone.",
    plate: "lamp",
    alt: "A reader leaning on his desk beside a lamp.",
    seal: <RefreshCw />,
  },
  {
    title: "Share with a link",
    text: "Tap the share icon on any book to get a link. Whoever opens it can add a copy to their own library, while your reading progress stays yours. Whole collections can be shared too.",
    plate: "flight",
    alt: "A raven at a shuttered window, its shadow cast across an ivy-covered wall.",
    seal: <Link2 />,
  },
];

/** A short introduction for a new account (lib/welcome.ts): uploading, syncing and sharing, one step at a time. */
export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const { pickFiles } = useLibraryActions();
  const step = WELCOME_STEPS[index]!;
  const last = index === WELCOME_STEPS.length - 1;

  return (
    <Modal
      title="Welcome to BookRaven"
      onClose={onClose}
      footer={
        last ? (
          // Phones: Upload a book across the width, with Back and Explore on one row under it.
          // Wider: one row, Back on the left and the two actions on the right.
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center justify-between sm:contents">
              <button className="btn-ghost" onClick={() => setIndex(index - 1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button className="btn-ghost sm:ml-auto" onClick={onClose}>
                Explore
              </button>
            </div>
            <button
              className="btn w-full sm:w-auto"
              onClick={() => {
                pickFiles(); // still inside the click, so the browser opens the file picker
                onClose();
              }}
            >
              <Upload className="h-4 w-4" /> Upload a book
            </button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            {index > 0 ? (
              <button className="btn-ghost" onClick={() => setIndex(index - 1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <button className="btn-ghost" onClick={onClose}>
                Skip
              </button>
            )}
            <button className="btn" onClick={() => setIndex(index + 1)}>
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )
      }
    >
      <section aria-live="polite" aria-label={step.title} className="flex flex-col items-center text-center">
        <Medallion key={step.plate} plate={step.plate} alt={step.alt} seal={step.seal} className="h-28 w-28 animate-fade" />
        <p className="eyebrow mt-5 text-accent">
          {index + 1} of {WELCOME_STEPS.length}
        </p>
        <h3 className="mt-1 font-display text-2xl font-semibold leading-tight">{step.title}</h3>
        <p className="mt-2 min-h-[6.5rem] text-sm leading-relaxed text-muted">{step.text}</p>
      </section>

      <div className="flex justify-center gap-2" role="tablist" aria-label="Steps">
        {WELCOME_STEPS.map((s, i) => (
          <button
            key={s.title}
            role="tab"
            aria-selected={i === index}
            aria-label={s.title}
            onClick={() => setIndex(i)}
            className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-accent" : "w-2 bg-line hover:bg-muted"}`}
          />
        ))}
      </div>
    </Modal>
  );
}
