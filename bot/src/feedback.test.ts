import { afterEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTION_MAX, feedbackRequest, issueUrl, sendFeedback, TITLE_MAX } from "./feedback.js";

const input = {
  kind: "bug",
  title: "  Card page is empty ",
  description: "It shows nothing.\n\nOn my phone.",
  submitter: { name: "Ruben", id: "123" },
  context: { command: "card", card: "ogn-001-298", deck: null, message: "https://discord.com/channels/1/2/3" },
};

describe("feedbackRequest", () => {
  it("builds the intake's body: the description, then the context in a fenced block", () => {
    expect(feedbackRequest(input)).toEqual({
      repo: "RubenPeeters/ni-han-bao",
      kind: "bug",
      title: "Card page is empty",
      body: "It shows nothing.\n\nOn my phone.\n\n```text\ncommand: card\ncard: ogn-001-298\nmessage: https://discord.com/channels/1/2/3\n```",
      submitter: "Ruben (123)",
    });
  });

  it("leaves the block out without context", () => {
    expect(feedbackRequest({ ...input, context: { page: "" } })).toMatchObject({ body: "It shows nothing.\n\nOn my phone." });
  });

  it("cuts the title and description to the limits", () => {
    const request = feedbackRequest({ ...input, title: "t".repeat(150), description: "d".repeat(5000), context: {} });
    expect(request).toMatchObject({ title: "t".repeat(TITLE_MAX), body: "d".repeat(DESCRIPTION_MAX) });
  });

  it("keeps context values on one line inside the block", () => {
    const request = feedbackRequest({ ...input, context: { page: "/cards?q=```\nx" } });
    expect(request).toMatchObject({ body: "It shows nothing.\n\nOn my phone.\n\n```text\npage: /cards?q= x\n```" });
  });

  it("asks for what is missing", () => {
    expect(feedbackRequest({ ...input, kind: "praise" })).toBe("Pick whether it is an idea or a problem.");
    expect(feedbackRequest({ ...input, title: "  " })).toBe("Give it a title and a description.");
    expect(feedbackRequest({ ...input, description: "" })).toBe("Give it a title and a description.");
  });
});

describe("issueUrl", () => {
  it("takes the link from the answer, https only", () => {
    expect(issueUrl({ html_url: "https://github.com/o/r/issues/1" })).toBe("https://github.com/o/r/issues/1");
    expect(issueUrl({ issue: { html_url: "https://github.com/o/r/issues/2" } })).toBe("https://github.com/o/r/issues/2");
    expect(issueUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(issueUrl(null)).toBeNull();
  });
});

describe("sendFeedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts with the bearer token and returns the issue link", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ url: "https://github.com/o/r/issues/3" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const request = feedbackRequest(input);
    if (typeof request === "string") throw new Error(request);
    expect(await sendFeedback("https://forge.example/", "secret", request)).toBe("https://github.com/o/r/issues/3");
    expect(fetch).toHaveBeenCalledWith(
      "https://forge.example/api/feedback",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer secret" }), body: JSON.stringify(request) }),
    );
  });

  it("throws with the status, never the token", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    const request = feedbackRequest(input);
    if (typeof request === "string") throw new Error(request);
    await expect(sendFeedback("https://forge.example", "secret", request)).rejects.toThrow("forge intake answered 401: nope");
    await expect(sendFeedback("https://forge.example", "secret", request)).rejects.not.toThrow("secret");
  });
});
