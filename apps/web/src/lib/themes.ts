import { Atom, BookHeart, Brain, Church, Cpu, Feather, Landmark, ScrollText, Smile, TrendingUp, Wrench } from "lucide-react";
import type { ComponentType } from "react";

/** Sections of the public library (the API assigns them; see apps/api/src/lib/themes.ts). */
export const THEME_INFO: Record<string, { label: string; icon: ComponentType<{ className?: string }>; blurb: string }> = {
  philosophy: { label: "Philosophy", icon: Brain, blurb: "From the Greeks to the Enlightenment and beyond" },
  politics: { label: "Politics", icon: Landmark, blurb: "Government, power, rights and revolutions" },
  economics: { label: "Economics", icon: TrendingUp, blurb: "Wealth, trade, labour and money" },
  technology: { label: "Technology", icon: Wrench, blurb: "Engineering, inventions and machines" },
  computing: { label: "Computing", icon: Cpu, blurb: "The early history of computers" },
  science: { label: "Science", icon: Atom, blurb: "Physics, biology, astronomy, mathematics" },
  history: { label: "History", icon: ScrollText, blurb: "Events, biographies and civilizations" },
  literature: { label: "Literature", icon: BookHeart, blurb: "Novels, stories and plays" },
  poetry: { label: "Poetry", icon: Feather, blurb: "Verse, epics and sonnets" },
  religion: { label: "Religion", icon: Church, blurb: "Faith, scripture and theology" },
  children: { label: "Children", icon: Smile, blurb: "Fairy tales and young readers" },
};

export const THEME_ORDER = Object.keys(THEME_INFO);
