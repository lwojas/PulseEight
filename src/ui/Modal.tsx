// Generic small modal: a titled dialog over a dimmed backdrop. Closes on Escape, backdrop click or
// the close button, and returns focus to whatever opened it.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Pin the modal next to an element instead of centring it. Top/bottom line the modal's right edge
 * up with the element's; left/right line the tops up. `offset` is the gap in px. */
export interface ModalAnchor {
  to: RefObject<HTMLElement | null>;
  placement: "top" | "right" | "bottom" | "left";
  offset?: number;
}

function anchorStyle({ to, placement, offset = 8 }: ModalAnchor): CSSProperties | undefined {
  const r = to.current?.getBoundingClientRect();
  if (!r) return undefined;
  const { innerWidth: w, innerHeight: h } = window;
  switch (placement) {
    case "bottom": return { top: r.bottom + offset, right: Math.max(8, w - r.right) };
    case "top": return { bottom: h - r.top + offset, right: Math.max(8, w - r.right) };
    case "right": return { top: r.top, left: r.right + offset };
    case "left": return { top: r.top, right: w - r.left + offset };
  }
}

interface ModalProps {
  anchor?: ModalAnchor;
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, onClose, anchor, children }: ModalProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>();
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const place = () => setPos(anchorStyle(anchorRef.current!));
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, button:not(.modal-x)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" data-anchored={!!anchor} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} style={anchor ? pos : undefined}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn sm modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
