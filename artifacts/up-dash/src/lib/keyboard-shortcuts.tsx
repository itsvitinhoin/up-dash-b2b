import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface Shortcut {
  combo: string;
  description: string;
}

interface ShortcutsContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  shortcuts: Shortcut[];
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

const NAV_SHORTCUTS: Shortcut[] = [
  { combo: "g d", description: "Go to Dashboard" },
  { combo: "g f", description: "Go to Funnel" },
  { combo: "g c", description: "Go to Customers" },
  { combo: "g p", description: "Go to Products" },
  { combo: "g s", description: "Go to Sellers" },
  { combo: "g g", description: "Go to Geography" },
  { combo: "g l", description: "Go to Clients (admin)" },
  { combo: "g n", description: "Open Notifications" },
];

const ACTION_SHORTCUTS: Shortcut[] = [
  { combo: "?", description: "Open this help" },
  { combo: "/", description: "Focus search" },
  { combo: "t", description: "Toggle dark / light theme" },
  { combo: "Esc", description: "Dismiss panel or dialog" },
];

const NAV_MAP: Record<string, string> = {
  d: "/dashboard",
  f: "/funnel",
  c: "/customers",
  p: "/products",
  s: "/sellers",
  g: "/geography",
  l: "/clients",
  n: "/notifications",
};

interface ShortcutsProviderProps {
  children: ReactNode;
  onToggleTheme?: () => void;
  onFocusSearch?: () => void;
}

export function KeyboardShortcutsProvider({
  children,
  onToggleTheme,
  onFocusSearch,
}: ShortcutsProviderProps) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [pendingPrefix, setPendingPrefix] = useState<string | null>(null);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        onFocusSearch?.();
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        onToggleTheme?.();
        return;
      }
      if (e.key === "g") {
        setPendingPrefix("g");
        window.setTimeout(() => setPendingPrefix(null), 1200);
        return;
      }
      if (pendingPrefix === "g") {
        const dest = NAV_MAP[e.key];
        if (dest) {
          e.preventDefault();
          setLocation(dest);
        }
        setPendingPrefix(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingPrefix, onFocusSearch, onToggleTheme, setLocation]);

  const value = useMemo<ShortcutsContextValue>(
    () => ({ open, setOpen, shortcuts: [...NAV_SHORTCUTS, ...ACTION_SHORTCUTS] }),
    [open],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      <ShortcutsDialog />
    </ShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useKeyboardShortcuts must be used inside KeyboardShortcutsProvider");
  return ctx;
}

function ShortcutsDialog() {
  const ctx = useContext(ShortcutsContext);
  const setOpen = useCallback((open: boolean) => ctx?.setOpen(open), [ctx]);
  if (!ctx) return null;
  return (
    <Dialog open={ctx.open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" data-testid="keyboard-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around UP Dash without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 mt-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Navigate</p>
            <ul className="space-y-1.5">
              {NAV_SHORTCUTS.map((s) => (
                <li key={s.combo} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.description}</span>
                  <ShortcutKey combo={s.combo} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Actions</p>
            <ul className="space-y-1.5">
              {ACTION_SHORTCUTS.map((s) => (
                <li key={s.combo} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.description}</span>
                  <ShortcutKey combo={s.combo} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutKey({ combo }: { combo: string }) {
  return (
    <span className="flex items-center gap-1">
      {combo.split(" ").map((part, i) => (
        <kbd
          key={i}
          className="px-1.5 py-0.5 text-[11px] font-mono bg-muted border border-border rounded text-foreground"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}
