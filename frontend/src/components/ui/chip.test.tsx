import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "./chip";

describe("Chip", () => {
  it("renders its children", () => {
    render(<Chip tone="success">Passed</Chip>);
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("does not render a status dot by default", () => {
    render(<Chip tone="danger">Failed</Chip>);
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("renders a status dot when dot is set", () => {
    render(
      <Chip tone="warning" dot>
        Degraded
      </Chip>,
    );
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("forwards a ref to the underlying span", () => {
    let node: HTMLSpanElement | null = null;
    render(
      <Chip ref={(el) => { node = el; }} tone="info">
        Info
      </Chip>,
    );
    expect(node).toBeInstanceOf(HTMLSpanElement);
  });

  it("merges a caller-supplied className with the variant classes", () => {
    render(
      <Chip tone="success" className="my-custom-class">
        Passed
      </Chip>,
    );
    expect(screen.getByText("Passed").className).toContain("my-custom-class");
  });
});
