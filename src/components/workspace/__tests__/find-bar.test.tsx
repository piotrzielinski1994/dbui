import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Shared presentational find bar - reused by the grid and (styled) by the editor search panel.
// Purely driven by props; it computes nothing. Design.md compliant: no rounded corners, theme
// tokens, IDE density, 1px dividers.
import { FindBar } from "@/components/workspace/find-bar";

const noop = () => {};

describe("FindBar", () => {
  // behavior: the input reflects the query prop (AC-005)
  it("should show the current query in its input", () => {
    render(
      <FindBar
        query="ada"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("ada");
  });

  // side-effect-contract: typing streams out through onQueryChange (AC-005)
  it("should call onQueryChange when the user types", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(
      <FindBar
        query=""
        onQueryChange={onQueryChange}
        activeIndex={0}
        total={0}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    await user.type(screen.getByRole("textbox"), "x");

    expect(onQueryChange).toHaveBeenCalled();
    expect(onQueryChange.mock.calls.at(-1)?.[0]).toContain("x");
  });

  // behavior: the count reads activeIndex/total (e.g. "1/3") (AC-005)
  it("should render the active/total count", () => {
    const { container } = render(
      <FindBar
        query="ada"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(container.textContent).toMatch(/1\s*\/\s*3/);
  });

  // behavior: an empty/no-match state reads 0/0 (AC-005, UI states table)
  it("should render 0/0 when there are no matches", () => {
    const { container } = render(
      <FindBar
        query="zzz"
        onQueryChange={noop}
        activeIndex={0}
        total={0}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(container.textContent).toMatch(/0\s*\/\s*0/);
  });

  // side-effect-contract: the next button steps forward (AC-006)
  it("should call onNext when the next button is clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={onNext}
        onPrev={noop}
        onClose={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // side-effect-contract: the previous button steps back (AC-006)
  it("should call onPrev when the previous button is clicked", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={onPrev}
        onClose={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /prev/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  // side-effect-contract: the close button dismisses the bar (AC-007)
  it("should call onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // design: no rounded corners anywhere in the bar (AC-012, TC-010)
  it("should not use any rounded-* class", () => {
    const { container } = render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    const withRounded = container.querySelectorAll('[class*="rounded"]');
    expect(withRounded.length).toBe(0);
  });

  // design: uses theme-token utility classes, not hard-coded hex colors (AC-012, TC-010)
  it("should style with theme tokens and no hard-coded hex color", () => {
    const { container } = render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();

    const allClasses = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .flatMap((el) => Array.from(el.classList))
      .join(" ");
    // at least one recognizable theme-token utility is present
    expect(allClasses).toMatch(/bg-background|border|text-foreground|bg-muted/);
    // no raw hex color leaked into a class (e.g. text-[#fff] / bg-[#000000])
    expect(allClasses).not.toMatch(/\[#([0-9a-fA-F]{3,8})\]/);
  });
});
