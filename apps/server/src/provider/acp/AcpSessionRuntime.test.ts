import { describe, expect, it } from "vite-plus/test";

import { getProvenanceLiveSessionId } from "./AcpSessionRuntime.ts";

describe("getProvenanceLiveSessionId", () => {
  it("returns the live head from a Hermes compression provenance", () => {
    const result = getProvenanceLiveSessionId({
      _meta: {
        hermes: {
          sessionProvenance: {
            acpSessionId: "acp-1",
            currentHermesSessionId: "20260822_165353_99f904",
            sessionKind: "continuation",
            compressionDepth: 2,
          },
        },
      },
      sessionId: "stale-root",
    });
    expect(result).toBe("20260822_165353_99f904");
  });

  it("returns undefined when no hermes provenance is present", () => {
    expect(getProvenanceLiveSessionId({ sessionId: "s1" })).toBeUndefined();
    expect(getProvenanceLiveSessionId({ _meta: {}, sessionId: "s1" })).toBeUndefined();
    expect(
      getProvenanceLiveSessionId({
        _meta: { hermes: { somethingElse: true } },
        sessionId: "s1",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the reported id is not a non-empty string", () => {
    expect(
      getProvenanceLiveSessionId({
        _meta: {
          hermes: {
            sessionProvenance: { currentHermesSessionId: 42 },
          },
        },
        sessionId: "s1",
      }),
    ).toBeUndefined();
    expect(
      getProvenanceLiveSessionId({
        _meta: {
          hermes: {
            sessionProvenance: { currentHermesSessionId: "" },
          },
        },
        sessionId: "s1",
      }),
    ).toBeUndefined();
    expect(
      getProvenanceLiveSessionId({
        _meta: { hermes: { sessionProvenance: null } },
        sessionId: "s1",
      }),
    ).toBeUndefined();
  });
});
