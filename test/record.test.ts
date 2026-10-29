import { describe, expect, it } from "vitest";
import { gateForHeld, recordStep } from "../src/engine/record";
import { GATES } from "../src/engine/state";

describe("realtime recording", () => {
  it("quantises to the nearest step and wraps at the pattern end", () => {
    expect(recordStep(4, 0.2, 16)).toBe(4);
    expect(recordStep(4, 0.7, 16)).toBe(5);
    expect(recordStep(15, 0.9, 16)).toBe(0);
    expect(recordStep(3, 2, 16)).toBe(4); // a late event is clamped to the next step
  });

  it("maps a held time to the nearest gate", () => {
    expect(GATES[gateForHeld(0.3)].label).toBe("DEF");
    expect(GATES[gateForHeld(1.1)].label).toBe("1");
    expect(GATES[gateForHeld(2.4)].label).toBe("2");
    expect(GATES[gateForHeld(3.9)].label).toBe("1/4");
    expect(GATES[gateForHeld(9)].label).toBe("1/2");
    expect(GATES[gateForHeld(40)].label).toBe("BAR");
  });
});
