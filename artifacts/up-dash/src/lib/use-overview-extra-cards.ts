import { useCallback, useState } from "react";
import { OVERVIEW_STORAGE_KEY, sanitizeChoice, type ExtraCardChoice } from "@/lib/overview-layout";

// Escolha de cards extras por bloco, guardada só neste navegador (ver lib/overview-layout.ts).
function readStored(): ExtraCardChoice {
  try {
    return sanitizeChoice(JSON.parse(localStorage.getItem(OVERVIEW_STORAGE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

function writeStored(choice: ExtraCardChoice): void {
  try {
    if (Object.keys(choice).length === 0) localStorage.removeItem(OVERVIEW_STORAGE_KEY);
    else localStorage.setItem(OVERVIEW_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // sem armazenamento (janela privada): a escolha vale só até recarregar
  }
}

export function useOverviewExtraCards() {
  const [choice, setChoice] = useState<ExtraCardChoice>(readStored);
  const toggle = useCallback((sectionId: string, key: string) => {
    setChoice((previous) => {
      const current = previous[sectionId] ?? [];
      const nextList = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      const next = { ...previous };
      if (nextList.length > 0) next[sectionId] = nextList;
      else delete next[sectionId];
      writeStored(next);
      return next;
    });
  }, []);
  const reset = useCallback((sectionId?: string) => {
    setChoice((previous) => {
      const next = { ...previous };
      if (sectionId) delete next[sectionId];
      else for (const key of Object.keys(next)) delete next[key];
      writeStored(next);
      return next;
    });
  }, []);
  return { choice, toggle, reset };
}
