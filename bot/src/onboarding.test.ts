import { ButtonStyle, ComponentType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  addRole,
  diffText,
  MAX_OFFERED,
  onboardingDm,
  parseOnboardingId,
  removeRole,
  roleDiff,
  roleProblem,
  rolePicker,
} from "./onboarding.js";

const bot = { canManageRoles: true, position: 10 };
const plain = { name: "Mid", position: 3, managed: false, everyone: false, permissions: 0n };

describe("roleProblem", () => {
  it("accepts a plain role below the bot's", () => expect(roleProblem(plain, bot)).toBeNull());
  it("refuses a role with Manage Messages, saying why", () => {
    expect(roleProblem({ ...plain, permissions: PermissionFlagsBits.ManageMessages | PermissionFlagsBits.SendMessages }, bot)).toMatch(
      /^Mid cannot be offered: it has Manage Messages, and a role members pick themselves must never grant power/,
    );
  });
  it("names every dangerous permission", () => {
    expect(roleProblem({ ...plain, permissions: PermissionFlagsBits.Administrator | PermissionFlagsBits.BanMembers }, bot)).toMatch(
      /it has Administrator, Ban Members,/,
    );
  });
  it("refuses @everyone, managed roles and roles at or above the bot's", () => {
    expect(roleProblem({ ...plain, everyone: true }, bot)).toMatch(/@everyone/);
    expect(roleProblem({ ...plain, managed: true }, bot)).toMatch(/managed by an integration/);
    expect(roleProblem({ ...plain, position: 10 }, bot)).toMatch(/My role must be above Mid/);
  });
  it("needs Manage Roles", () => expect(roleProblem(plain, { ...bot, canManageRoles: false })).toMatch(/Manage Roles permission/));
});

describe("addRole and removeRole", () => {
  const top = { role_id: "1", label: "Top" };
  it("adds a role with its name as the label by default", () => {
    expect(addRole([top], { id: "2", name: "Mid" }, null, null)).toEqual([top, { role_id: "2", label: "Mid" }]);
    expect(addRole([top], { id: "2", name: "Mid" }, " Middle ", null)).toEqual([top, { role_id: "2", label: "Middle" }]);
  });
  it("relabels a role offered already, in place", () => {
    expect(addRole([top], { id: "1", name: "Top" }, "Top lane", null)).toEqual([{ role_id: "1", label: "Top lane" }]);
  });
  it("passes the eligibility problem through", () => expect(addRole([], { id: "2", name: "Mid" }, null, "no")).toBe("no"));
  it("offers at most 25 roles", () => {
    const full = Array.from({ length: MAX_OFFERED }, (_, i) => ({ role_id: String(i + 100), label: `R${i}` }));
    expect(addRole(full, { id: "2", name: "Mid" }, null, null)).toMatch(/At most 25/);
    expect(addRole(full, { id: "100", name: "R0" }, "again", null)).toHaveLength(MAX_OFFERED);
  });
  it("removes an offered role, and says so when it was not", () => {
    expect(removeRole([top], { id: "1", name: "Top" })).toEqual([]);
    expect(removeRole([top], { id: "2", name: "Mid" })).toBe("Mid is not offered.");
  });
});

describe("the picker", () => {
  const roles = [{ role_id: "1", label: "Top" }, { role_id: "2", label: "Mid" }];
  it("ticks the roles the member has, and carries the server id", () => {
    const select = rolePicker("42", roles, new Set(["2"])).components[0];
    expect(select).toMatchObject({ type: ComponentType.StringSelect, custom_id: "onboard-roles:42", min_values: 0, max_values: 2 });
    expect("options" in select && select.options.map((o) => o.default)).toEqual([false, true]);
    expect(parseOnboardingId("onboard-roles:42")).toEqual({ kind: "roles", guildId: "42" });
    expect(parseOnboardingId("onboard-no:42")).toEqual({ kind: "no", guildId: "42" });
    expect(parseOnboardingId("borrow-accept:1")).toBeNull();
  });
  it("DMs a welcome naming the server, a champion link to Settings and No thanks", () => {
    const dm = onboardingDm({ id: "42", name: "Demo_server" }, roles, new Set(), "https://nexus.example");
    expect(dm.content).toMatch(/Welcome to \*\*Demo\\_server\*\*/);
    expect(dm.components[1].components).toEqual([
      { type: ComponentType.Button, style: ButtonStyle.Link, label: "Pick your favourite champion", url: "https://nexus.example/settings" },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "No thanks", custom_id: "onboard-no:42" },
    ]);
    expect(onboardingDm({ id: "42", name: "x" }, roles, new Set(), null).components[1].components).toHaveLength(1);
  });
});

describe("roleDiff", () => {
  const offered = ["top", "mid"];
  it("adds the chosen and removes the offered ones not chosen", () => {
    expect(roleDiff(offered, ["mid"], new Set())).toEqual({ add: ["mid"], remove: [] });
    expect(roleDiff(offered, ["top"], new Set(["mid"]))).toEqual({ add: ["top"], remove: ["mid"] });
    expect(roleDiff(offered, ["top", "mid"], new Set(["mid"]))).toEqual({ add: ["top"], remove: [] });
  });
  it("never touches a role that is not offered, even when chosen", () => {
    expect(roleDiff(offered, ["admin"], new Set(["admin", "top"]))).toEqual({ add: [], remove: ["top"] });
  });
  it("says what changed", () => {
    const labels = new Map([["top", "Top"], ["mid", "Mid"]]);
    expect(diffText({ add: ["top"], remove: ["mid"] }, labels)).toBe("Added Top. Removed Mid.");
    expect(diffText({ add: [], remove: [] }, labels)).toMatch(/Nothing changed/);
  });
});
