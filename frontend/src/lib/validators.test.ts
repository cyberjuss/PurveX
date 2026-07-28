import { describe, expect, it } from "vitest";
import {
  usernameSchema,
  emailSchema,
  optionalEmailSchema,
  passwordSchema,
  httpUrlSchema,
  mitreTechniqueSchema,
  cronSchema,
  nonEmptyString,
  safeNameSchema,
} from "./validators";

describe("usernameSchema", () => {
  it("accepts letters, numbers, dot, underscore, hyphen", () => {
    expect(usernameSchema.safeParse("alice.smith-99_x").success).toBe(true);
  });
  it("rejects too short", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
  });
  it("rejects spaces and special characters", () => {
    expect(usernameSchema.safeParse("alice smith!").success).toBe(false);
  });
  it("trims whitespace before validating", () => {
    const result = usernameSchema.safeParse("  alice  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("alice");
  });
});

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });
  it("rejects a malformed email", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("optionalEmailSchema", () => {
  it("accepts an empty/undefined value", () => {
    expect(optionalEmailSchema.safeParse(undefined).success).toBe(true);
    expect(optionalEmailSchema.safeParse("").success).toBe(true);
  });
  it("still rejects a malformed non-empty value", () => {
    expect(optionalEmailSchema.safeParse("nope").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  // Mirrors backend/app/security.py:validate_password_complexity — these
  // cases matter because a mismatch here means the frontend accepts a
  // password the backend will reject (or vice versa), a poor UX at best.
  it("accepts a password meeting all rules", () => {
    expect(passwordSchema.safeParse("GoodPassword123").success).toBe(true);
  });
  it("rejects under 12 characters", () => {
    expect(passwordSchema.safeParse("Short1a").success).toBe(false);
  });
  it("rejects missing an uppercase letter", () => {
    expect(passwordSchema.safeParse("lowercase123456").success).toBe(false);
  });
  it("rejects missing a lowercase letter", () => {
    expect(passwordSchema.safeParse("UPPERCASE123456").success).toBe(false);
  });
  it("rejects missing a number", () => {
    expect(passwordSchema.safeParse("NoNumbersHereAtAll").success).toBe(false);
  });
});

describe("httpUrlSchema", () => {
  it("accepts https URLs", () => {
    expect(httpUrlSchema.safeParse("https://splunk.example.com:8089").success).toBe(true);
  });
  it("accepts http URLs", () => {
    expect(httpUrlSchema.safeParse("http://localhost:8000").success).toBe(true);
  });
  it("rejects non-http(s) schemes", () => {
    expect(httpUrlSchema.safeParse("ftp://example.com").success).toBe(false);
    expect(httpUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
  });
  it("rejects a bare hostname with no scheme", () => {
    expect(httpUrlSchema.safeParse("example.com").success).toBe(false);
  });
});

describe("mitreTechniqueSchema", () => {
  it("accepts a bare technique id", () => {
    expect(mitreTechniqueSchema.safeParse("T1059").success).toBe(true);
  });
  it("accepts a sub-technique id", () => {
    expect(mitreTechniqueSchema.safeParse("T1059.001").success).toBe(true);
  });
  it("rejects malformed ids", () => {
    expect(mitreTechniqueSchema.safeParse("1059").success).toBe(false);
    expect(mitreTechniqueSchema.safeParse("T105").success).toBe(false);
    expect(mitreTechniqueSchema.safeParse("T1059.01").success).toBe(false);
  });
});

describe("cronSchema", () => {
  it("accepts a 5-field cron expression", () => {
    expect(cronSchema.safeParse("0 6 * * 1").success).toBe(true);
  });
  it("rejects fewer than 5 fields", () => {
    expect(cronSchema.safeParse("0 6 * *").success).toBe(false);
  });
  it("rejects more than 5 fields", () => {
    expect(cronSchema.safeParse("0 6 * * 1 2").success).toBe(false);
  });
});

describe("nonEmptyString", () => {
  it("rejects an empty string with a label-specific message", () => {
    const result = nonEmptyString("Detection name").safeParse("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Detection name is required.");
    }
  });
  it("accepts a non-empty string", () => {
    expect(nonEmptyString().safeParse("value").success).toBe(true);
  });
});

describe("safeNameSchema", () => {
  it("accepts a reasonable name", () => {
    expect(safeNameSchema.safeParse("Production SIEM").success).toBe(true);
  });
  it("rejects a single character", () => {
    expect(safeNameSchema.safeParse("a").success).toBe(false);
  });
});
