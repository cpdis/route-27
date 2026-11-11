import { describe, expect, it } from "vitest";
import { cleanTitle } from "../src/components/AlertBanner";

describe("cleanTitle", () => {
  it("drops a leading route list", () => {
    expect(cleanTitle("Routes 24, 27, 32, 33, 39, 72, 73, 160, 176, 177, 178, 270, 910, 930, 935 and 940 Bus Stop Disruption")).toBe("Bus Stop Disruption");
    expect(cleanTitle("Route 27 Detour")).toBe("Detour");
    expect(cleanTitle("1 November Service Changes")).toBe("1 November Service Changes");
    expect(cleanTitle("Routes 27 and 28")).toBe("Routes 27 and 28");
  });
});
