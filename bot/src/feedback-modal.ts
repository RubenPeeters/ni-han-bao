// /feedback and the Feedback button under the bot's replies (#244): the same form for both.
import {
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIModalInteractionResponseCallbackData,
} from "discord.js";
import { DESCRIPTION_MAX, FEEDBACK_KINDS, TITLE_MAX } from "./feedback.js";
import type { V2 } from "./riftbound-reply.js";

export const FEEDBACK_COMMAND = {
  name: "feedback",
  description: "Send an idea or a problem to the people who make the bot",
} as const;

/** The button's and its form's id: the reply's command and its card or deck, so a click works after a restart. */
export const feedbackId = (command: string | null = null, id: string | null = null) =>
  ["feedback", command, command && id].filter(Boolean).join(":");
export function parseFeedbackId(customId: string): { command: string | null; id: string | null } | null {
  const m = /^feedback(?::([\w-]+)(?::(.+))?)?$/.exec(customId);
  return m ? { command: m[1] ?? null, id: m[2] ?? null } : null;
}

/** The form: idea or problem, a title and a description. */
export function feedbackModal(customId: string): APIModalInteractionResponseCallbackData {
  return {
    custom_id: customId,
    title: "Send feedback",
    components: [
      {
        type: ComponentType.Label,
        label: "Idea or problem?",
        component: {
          type: ComponentType.StringSelect,
          custom_id: "kind",
          options: FEEDBACK_KINDS.map((k) => ({ label: k.label, value: k.value })),
          min_values: 1,
          max_values: 1,
        },
      },
      {
        type: ComponentType.Label,
        label: "Title",
        component: { type: ComponentType.TextInput, custom_id: "title", style: TextInputStyle.Short, max_length: TITLE_MAX, required: true },
      },
      {
        type: ComponentType.Label,
        label: "Description",
        description: "What happened, or what you would like. Only the bot's makers read it.",
        component: { type: ComponentType.TextInput, custom_id: "description", style: TextInputStyle.Paragraph, max_length: DESCRIPTION_MAX, required: true },
      },
    ],
  };
}

/** The reply with a Feedback button: in its last row of buttons when that has room, else in a row of its own. */
export function withFeedback(message: V2, command: string, id: string | null = null): V2 {
  const button: APIButtonComponent = { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Feedback", custom_id: feedbackId(command, id) };
  const last = message.components.at(-1);
  if (last?.type === ComponentType.ActionRow && last.components.length < 5 && last.components.every((c) => c.type === ComponentType.Button)) {
    const row = { ...last, components: [...last.components, button] } as APIActionRowComponent<APIButtonComponent>;
    return { ...message, components: [...message.components.slice(0, -1), row] };
  }
  return { ...message, components: [...message.components, { type: ComponentType.ActionRow, components: [button] }] };
}

/** The context a form from a Feedback button carries: the reply's command, its card or deck, and its message. */
export function feedbackContext(from: { command: string | null; id: string | null }, messageUrl: string | null): Record<string, string | null> {
  return { command: from.command, [from.command === "deck" ? "deck" : "card"]: from.id, message: messageUrl };
}
