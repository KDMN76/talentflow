import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatRelativeDate } from "@/lib/utils";

describe("date-formatters null-guard (regressie: geen 1970 bij null)", () => {
  it("formatDate geeft een streepje voor null/undefined/leeg i.p.v. 1 jan 1970", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("formatDateTime geeft een streepje voor null/ongeldig", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("garbage")).toBe("—");
  });

  it("formatRelativeDate geeft een streepje voor null/ongeldig", () => {
    expect(formatRelativeDate(null)).toBe("—");
    expect(formatRelativeDate(undefined)).toBe("—");
    expect(formatRelativeDate("nope")).toBe("—");
  });

  it("formatteert een geldige datum wél (geen streepje)", () => {
    const out = formatDate("2026-07-13T10:00:00Z");
    expect(out).not.toBe("—");
    expect(out).toMatch(/2026/);
  });

  it("formatDateTime bevat een tijd-component voor een geldige datum", () => {
    const out = formatDateTime("2026-07-13T10:30:00Z");
    expect(out).not.toBe("—");
    // Bevat een uur:minuut-achtige component
    expect(out).toMatch(/\d{1,2}[:.]\d{2}/);
  });
});
