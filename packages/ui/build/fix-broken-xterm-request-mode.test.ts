import { describe, expect, it } from "vitest";
import { repairBrokenXtermRequestMode } from "./fix-broken-xterm-request-mode";

describe("repairBrokenXtermRequestMode", () => {
  it("restores the missing enum temp declaration in requestMode", () => {
    const broken =
      'requestMode(e,i8){(P=>(P[P.NOT_RECOGNIZED=0]="NOT_RECOGNIZED"))(void 0||(r={}));let n=this._coreService}';

    const result = repairBrokenXtermRequestMode(broken);

    expect(result.patched).toBe(true);
    expect(result.code).toContain("requestMode(e,i8){let r;");
    expect(result.code).toContain('(r||(r={}))');
    expect(result.code).not.toContain("void 0||(r={})");
  });

  it("leaves valid requestMode output unchanged", () => {
    const valid =
      'requestMode(e,i8){let r;(P=>(P[P.NOT_RECOGNIZED=0]="NOT_RECOGNIZED"))(r||(r={}));let n=this._coreService}';

    const result = repairBrokenXtermRequestMode(valid);

    expect(result).toEqual({ code: valid, patched: false });
  });
});
