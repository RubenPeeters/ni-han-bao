import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { feedbackContext, feedbackId, feedbackModal, parseFeedbackId, withFeedback } from "./feedback-modal.js";
import type { V2 } from "./riftbound-reply.js";

const text = { type: ComponentType.TextDisplay as const, content: "hi" };
const button = (label: string) => ({ type: ComponentType.Button as const, style: ButtonStyle.Secondary as const, label, custom_id: label });

describe("feedback ids", () => {
  it("round-trip the command and its card or deck", () => {
    expect(feedbackId()).toBe("feedback");
    expect(parseFeedbackId(feedbackId())).toEqual({ command: null, id: null });
    expect(parseFeedbackId(feedbackId("deck", "0d5e7c1a-1111-2222-3333-444455556666"))).toEqual({ command: "deck", id: "0d5e7c1a-1111-2222-3333-444455556666" });
    expect(parseFeedbackId(feedbackId("lend"))).toEqual({ command: "lend", id: null });
    expect(parseFeedbackId("feedbackx")).toBeNull();
    expect(parseFeedbackId("card-page:x:1")).toBeNull();
  });
});

describe("withFeedback", () => {
  it("joins the last row of buttons when it has room", () => {
    const message: V2 = { components: [text, { type: ComponentType.ActionRow, components: [button("Next")] }], flags: MessageFlags.IsComponentsV2 };
    expect(withFeedback(message, "card", "ogn-1").components[1]).toEqual({
      type: ComponentType.ActionRow,
      components: [button("Next"), { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Feedback", custom_id: "feedback:card:ogn-1" }],
    });
  });

  it("gets a row of its own otherwise", () => {
    const full = { type: ComponentType.ActionRow as const, components: ["a", "b", "c", "d", "e"].map(button) };
    for (const components of [[text], [text, full]]) {
      const out = withFeedback({ components, flags: MessageFlags.IsComponentsV2 }, "trade");
      expect(out.components).toHaveLength(components.length + 1);
      expect(out.components.at(-1)).toMatchObject({ type: ComponentType.ActionRow, components: [{ custom_id: "feedback:trade" }] });
    }
  });
});

describe("feedbackContext", () => {
  it("names the id after the command", () => {
    expect(feedbackContext({ command: "deck", id: "d1" }, "https://discord.com/channels/1/2/3")).toEqual({ command: "deck", deck: "d1", message: "https://discord.com/channels/1/2/3" });
    expect(feedbackContext({ command: "card", id: "c1" }, null)).toEqual({ command: "card", card: "c1", message: null });
    expect(feedbackContext({ command: "lend", id: "d1" }, null)).toEqual({ command: "lend", deck: "d1", message: null });
    expect(feedbackContext({ command: "collection", id: "c1" }, null)).toEqual({ command: "collection", card: "c1", message: null });
  });
});

describe("feedbackModal", () => {
  it("asks for the kind, a title and a description within the limits", () => {
    const modal = feedbackModal("feedback:card:c1");
    expect(modal.custom_id).toBe("feedback:card:c1");
    expect(modal.components.map((c) => ("component" in c ? c.component.custom_id : null))).toEqual(["kind", "title", "description"]);
    expect(modal.components[1]).toMatchObject({ component: { max_length: 100 } });
    expect(modal.components[2]).toMatchObject({ component: { max_length: 4000 } });
  });
});
