import { describe, expect, it } from "vitest";
import {
  validateOptimizeIntOption,
  validateOptimizeFormatOption
} from "../../src/commands/optimize.js";
import { validatePickIntOption, validatePickEnumOption } from "../../src/commands/pick.js";
import { validateListIntOption, validateListEnumOption } from "../../src/commands/list.js";

describe("optimize numeric flag validation", () => {
  it("rejects a blank width with invalid_input", () => {
    const err = validateOptimizeIntOption("", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
    expect(err!.message).toContain("width");
  });

  it("rejects a whitespace-only width with invalid_input", () => {
    const err = validateOptimizeIntOption("   ", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a non-integer width", () => {
    const err = validateOptimizeIntOption("12.5", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a zero width", () => {
    const err = validateOptimizeIntOption("0", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a negative width", () => {
    const err = validateOptimizeIntOption("-5", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a non-numeric width", () => {
    const err = validateOptimizeIntOption("abc", "width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("accepts a valid positive integer width", () => {
    expect(validateOptimizeIntOption("100", "width")).toBeUndefined();
  });

  it("accepts undefined (flag not provided)", () => {
    expect(validateOptimizeIntOption(undefined, "width")).toBeUndefined();
  });

  it("accepts a boolean (flag without value)", () => {
    expect(validateOptimizeIntOption(true, "width")).toBeUndefined();
  });
});

describe("pick numeric flag validation", () => {
  it("rejects a blank height with invalid_input", () => {
    const err = validatePickIntOption("", "height");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a whitespace-only height", () => {
    const err = validatePickIntOption("  ", "height");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("accepts a valid positive integer height", () => {
    expect(validatePickIntOption("200", "height")).toBeUndefined();
  });
});

describe("list numeric flag validation", () => {
  it("rejects a blank min-width with invalid_input", () => {
    const err = validateListIntOption("", "min-width");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("rejects a whitespace-only min-height", () => {
    const err = validateListIntOption("\t", "min-height");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
  });

  it("accepts a valid positive integer min-width", () => {
    expect(validateListIntOption("50", "min-width")).toBeUndefined();
  });

  it("accepts undefined (flag not provided)", () => {
    expect(validateListIntOption(undefined, "min-width")).toBeUndefined();
  });
});

describe("optimize format enum validation", () => {
  it("rejects an invalid format with invalid_input", () => {
    const err = validateOptimizeFormatOption("tiff");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
    expect(err!.message).toContain("format");
  });

  it("accepts a valid format", () => {
    expect(validateOptimizeFormatOption("webp")).toBeUndefined();
  });

  it("accepts undefined (flag not provided)", () => {
    expect(validateOptimizeFormatOption(undefined)).toBeUndefined();
  });

  it("accepts a boolean (flag without value)", () => {
    expect(validateOptimizeFormatOption(true)).toBeUndefined();
  });
});

describe("pick enum flag validation", () => {
  it("rejects an invalid orientation with invalid_input", () => {
    const err = validatePickEnumOption("orientation", "sideways");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
    expect(err!.message).toContain("orientation");
  });

  it("accepts a valid orientation", () => {
    expect(validatePickEnumOption("orientation", "landscape")).toBeUndefined();
  });

  it("rejects an invalid format with invalid_input", () => {
    const err = validatePickEnumOption("format", "gif");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
    expect(err!.message).toContain("format");
  });

  it("accepts a valid format", () => {
    expect(validatePickEnumOption("format", "avif")).toBeUndefined();
  });

  it("accepts undefined (flag not provided)", () => {
    expect(validatePickEnumOption("orientation", undefined)).toBeUndefined();
    expect(validatePickEnumOption("format", undefined)).toBeUndefined();
  });
});

describe("list orientation enum validation", () => {
  it("rejects an invalid orientation with invalid_input", () => {
    const err = validateListEnumOption("diagonal", "orientation");
    expect(err).toBeDefined();
    expect(err!.reason).toBe("invalid_input");
    expect(err!.message).toContain("orientation");
  });

  it("accepts a valid orientation", () => {
    expect(validateListEnumOption("portrait", "orientation")).toBeUndefined();
  });

  it("accepts undefined (flag not provided)", () => {
    expect(validateListEnumOption(undefined, "orientation")).toBeUndefined();
  });
});
