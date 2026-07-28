import { describe, expect, it } from "vitest";
import { toneClasses, scoreToTone, TONE_CLASSES } from "./status-tone";

describe("toneClasses", () => {
  it("returns the class set for every defined tone", () => {
    for (const tone of Object.keys(TONE_CLASSES) as (keyof typeof TONE_CLASSES)[]) {
      const classes = toneClasses(tone);
      expect(classes).toEqual(TONE_CLASSES[tone]);
      expect(classes.text).toBeTruthy();
      expect(classes.bg).toBeTruthy();
      expect(classes.border).toBeTruthy();
      expect(classes.icon).toBeTruthy();
    }
  });
});

describe("scoreToTone", () => {
  it("returns muted for a missing/non-numeric score", () => {
    expect(scoreToTone(undefined)).toBe("muted");
    expect(scoreToTone(null)).toBe("muted");
  });
  it("returns success at and above 80", () => {
    expect(scoreToTone(80)).toBe("success");
    expect(scoreToTone(100)).toBe("success");
  });
  it("returns warning between 50 and 79", () => {
    expect(scoreToTone(50)).toBe("warning");
    expect(scoreToTone(79)).toBe("warning");
  });
  it("returns danger below 50", () => {
    expect(scoreToTone(49)).toBe("danger");
    expect(scoreToTone(0)).toBe("danger");
  });
});
