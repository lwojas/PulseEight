import { useCallback, useEffect, useRef } from "react";
import { listenPlayhead, registerCell } from "../engine/playhead";

/** Ref callback that lets the playhead module light this element when step `abs` is audible. */
export function usePlayheadCell(abs: number) {
  const off = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (el: HTMLElement | null) => {
      off.current?.();
      off.current = el ? registerCell(abs, el) : undefined;
    },
    [abs],
  );
}

/** Follow the visible playhead step without re-rendering: `apply` writes to the DOM directly. */
export function usePlayheadEffect(apply: (visibleStep: number) => void) {
  const fn = useRef(apply);
  fn.current = apply;
  useEffect(() => listenPlayhead((s) => fn.current(s)), []);
}
