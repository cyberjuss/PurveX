import { z } from "zod";

/**
 * Shared Zod schemas used across forms. Centralizing them keeps error copy and
 * constraints consistent — "Username" means the same thing in /setup,
 * /settings/users and any future flow.
 */

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(50, "Username is too long.")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Use letters, numbers, dot, underscore, or hyphen only.",
  );

export const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.");

export const optionalEmailSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Enter a valid email address.",
  );

/**
 * Password rules kept modest and honest: long enough to resist casual brute
 * force without forcing users into write-it-on-a-sticky-note territory. The
 * backend enforces the hard rule; this mirrors it for fast feedback.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password is too long.")
  .refine((v) => /[a-z]/.test(v), "Add a lowercase letter.")
  .refine((v) => /[A-Z]/.test(v), "Add an uppercase letter.")
  .refine((v) => /[0-9]/.test(v), "Add a number.");

export const httpUrlSchema = z
  .string()
  .trim()
  .url("Enter a full URL, e.g. https://splunk.example.com:8089.")
  .refine(
    (v) => /^https?:\/\//i.test(v),
    "URL must start with http:// or https://.",
  );

export const mitreTechniqueSchema = z
  .string()
  .trim()
  .regex(
    /^T\d{4}(\.\d{3})?$/,
    "Use a MITRE technique ID like T1059 or T1059.001.",
  );

/**
 * Cron expression with 5 fields. We don't attempt to fully parse cron here —
 * anything more exotic than a format sanity check belongs server-side.
 */
export const cronSchema = z
  .string()
  .trim()
  .regex(
    /^(\S+\s+){4}\S+$/,
    "Cron must be 5 whitespace-separated fields, e.g. 0 6 * * 1.",
  );

export const nonEmptyString = (label = "This field") =>
  z.string().trim().min(1, `${label} is required.`);

export const safeNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(120, "Name is too long.");
