import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Páginas organizadas juntam várias páginas inteiras (cada uma com as próprias buscas). Esta seção só
 * monta o conteúdo quando chega perto da tela, então as buscas das seções de baixo não competem com as de cima.
 * Sem IntersectionObserver (ou com `eager`), renderiza na hora.
 */
export function LazySection({
  children,
  eager = false,
  minHeight = 320,
  rootMargin = "600px 0px",
}: {
  children: ReactNode;
  eager?: boolean;
  minHeight?: number;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);
  return visible ? <>{children}</> : <div ref={ref} style={{ minHeight }} aria-hidden="true" />;
}
