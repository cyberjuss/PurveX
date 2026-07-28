import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library's auto-cleanup only self-registers for Jest; under
// Vitest it has to be wired up explicitly or every test's rendered output
// piles up in the same jsdom document across the whole file.
afterEach(() => {
  cleanup();
});
