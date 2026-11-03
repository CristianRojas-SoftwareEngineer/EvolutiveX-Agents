// Guard del transcript enriquecido (guard.ts) con el kit oficial.
// Estas pruebas ejercen los handlers YA REGISTRADOS por index.ts (con su guard).
// No registran handlers adicionales; solo disparan eventos y observan.

import { describe, expect, test } from "claude-code/testing";
import { isDisabled } from "./guard.js";
import { ENABLED } from "./test-support.js";

describe("isDisabled expuesto", () => {
  test("empieza en false", ENABLED, async () => {
    expect(isDisabled()).toBe(false);
  });
});
