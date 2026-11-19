import { describe, it, expect } from "vitest";
import * as P from "../assets/js/handshake/protocol.js";
import { encryptBackup, decryptBackup } from "../assets/js/handshake/crypto.js";

function memoryMailbox() {
  const boxes = new Map();
  return {
    boxes,
    async post(box, payload) { if (!boxes.has(box)) boxes.set(box, []); boxes.get(box).push(payload); },
    async take(ids) {
      const out = [];
      for (const box of ids) { for (const payload of boxes.get(box) || []) out.push({ box, payload }); boxes.delete(box); }
      return out;
    },
    dump() { return JSON.stringify([...boxes]); },
  };
}

async function person(name, building, reach) {
  return P.setUp(P.emptyState(), { name, building }, reach);
}

async function connect(a, b, mail) {
  const link = P.createInvite(a, "https://nearify.org");
  await P.answerInvite(b, mail, P.parseInvite(new URL(link).hash));
  await P.check(a, mail);
  await P.acceptRequest(a, mail, b.me.pub);
  await P.check(b, mail);
}

describe("handshakes", () => {
  it("connects two people only after the card owner accepts", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex", "plant sensor");
    const sam = await person("Sam");
    const link = P.createInvite(alex, "https://nearify.org");
    expect(link.startsWith("https://nearify.org/handshake/#")).toBe(true);
    await P.answerInvite(sam, mail, P.parseInvite(new URL(link).hash));
    expect(sam.people[alex.me.pub].status).toBe("sent");
    expect(await P.check(alex, mail)).toBe(true);
    expect(alex.people[sam.me.pub]).toMatchObject({ status: "request", card: { name: "Sam" } });
    await P.acceptRequest(alex, mail, sam.me.pub);
    await P.check(sam, mail);
    expect(sam.people[alex.me.pub].status).toBe("connected");
    expect(alex.people[sam.me.pub].status).toBe("connected");
  });

  it("never puts names or public keys on the server", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alexandria", "orchid greenhouse");
    const sam = await person("Samwise", "tidal model");
    const link = P.createInvite(alex, "https://nearify.org");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(link).hash));
    const seen = mail.dump();
    for (const secret of ["Alexandria", "Samwise", "tidal", sam.me.pub, alex.me.pub]) expect(seen).not.toContain(secret);
  });

  it("forgets a declined request and sends nothing", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex");
    const sam = await person("Sam");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash));
    await P.check(alex, mail);
    P.forget(alex, sam.me.pub);
    expect(mail.boxes.size).toBe(0);
    await P.check(sam, mail);
    expect(sam.people[alex.me.pub].status).toBe("sent");
  });

  it("connects when two people scan each other", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex");
    const sam = await person("Sam");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash));
    await P.answerInvite(alex, mail, P.parseInvite(new URL(P.createInvite(sam, "https://nearify.org")).hash));
    await P.check(alex, mail);
    await P.check(sam, mail);
    expect(alex.people[sam.me.pub].status).toBe("connected");
    expect(sam.people[alex.me.pub].status).toBe("connected");
  });

  it("introduces two people only when both say yes, in either order", async () => {
    for (const order of [["b", "c"], ["c", "b"]]) {
      const mail = memoryMailbox();
      const a = await person("Ana");
      const b = await person("Ben", "drones");
      const c = await person("Cy", "embedded");
      await connect(a, b, mail);
      await connect(a, c, mail);
      await P.introduce(a, mail, b.me.pub, c.me.pub);
      await P.check(b, mail);
      await P.check(c, mail);
      expect(b.people[c.me.pub]).toMatchObject({ status: "offered", card: { name: "Cy", building: "embedded" }, via: { name: "Ana" } });
      const who = { b, c };
      const [first, second] = order.map((k) => who[k]);
      const other = (p) => (p === b ? c : b);
      await P.acceptIntro(first, mail, other(first).me.pub);
      expect(first.people[other(first).me.pub].status).toBe("accepted");
      await P.check(second, mail);
      expect(second.people[other(second).me.pub].theyAccepted).toBe(true);
      await P.acceptIntro(second, mail, other(second).me.pub);
      expect(second.people[other(second).me.pub].status).toBe("connected");
      await P.check(first, mail);
      expect(first.people[other(first).me.pub].status).toBe("connected");
    }
  });

  it("an introduction declined by one side never connects", async () => {
    const mail = memoryMailbox();
    const a = await person("Ana");
    const b = await person("Ben");
    const c = await person("Cy");
    await connect(a, b, mail);
    await connect(a, c, mail);
    await P.introduce(a, mail, b.me.pub, c.me.pub);
    await P.check(b, mail);
    await P.check(c, mail);
    await P.acceptIntro(b, mail, c.me.pub);
    P.forget(c, b.me.pub);
    await P.check(c, mail);
    await P.check(b, mail);
    expect(b.people[c.me.pub].status).toBe("accepted");
    expect(c.people[b.me.pub]).toBeUndefined();
  });

  it("refuses to introduce people you aren't connected to", async () => {
    const mail = memoryMailbox();
    const a = await person("Ana");
    const b = await person("Ben");
    await connect(a, b, mail);
    await expect(P.introduce(a, mail, b.me.pub, "x".repeat(87))).rejects.toThrow();
  });

  it("drops forged and malformed messages", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex");
    const link = P.createInvite(alex, "https://nearify.org");
    const r = P.parseInvite(new URL(link).hash).r;
    await mail.post(r, "garbage.data");
    await mail.post(r, "A".repeat(87) + ".AAAA");
    expect(await P.check(alex, mail)).toBe(false);
    expect(Object.keys(alex.people)).toHaveLength(0);
  });

  it("rejects bad invite links and your own card", async () => {
    expect(P.parseInvite("#v=1&k=short&r=x&n=A")).toBeNull();
    expect(P.parseInvite("#v=2")).toBeNull();
    const mail = memoryMailbox();
    const alex = await person("Alex");
    const inv = P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash);
    await expect(P.answerInvite(alex, mail, inv)).rejects.toThrow();
  });

  it("expires invites after 30 minutes", async () => {
    const alex = await person("Alex");
    P.createInvite(alex, "https://nearify.org", 0);
    await P.check(alex, memoryMailbox(), 31 * 60000);
    expect(alex.invites).toHaveLength(0);
  });

  it("cleans names: trims, removes control characters, limits length", () => {
    expect(P.cleanCard({ name: "  Al\u0000ex\n " })).toEqual({ name: "Alex" });
    expect(P.cleanCard({ name: "x".repeat(99) }).name).toHaveLength(40);
    expect(P.cleanCard({ name: "   " })).toBeNull();
  });

  it("backs up and restores with a passphrase", async () => {
    const mail = memoryMailbox();
    const a = await person("Ana");
    const b = await person("Ben");
    await connect(a, b, mail);
    const file = await encryptBackup("correct horse", a.me.privateKey, { pub: a.me.pub, people: a.people });
    expect(file).not.toContain("Ben");
    await expect(decryptBackup("wrong", file)).rejects.toThrow();
    const restored = await decryptBackup("correct horse", file);
    const a2 = { me: { privateKey: restored.privateKey, pub: restored.data.pub, card: a.me.card }, invites: [], people: restored.data.people };
    const c = await person("Cy");
    await connect(a2, c, mail);
    await P.introduce(a2, mail, b.me.pub, c.me.pub);
    await P.check(b, mail);
    expect(b.people[c.me.pub].status).toBe("offered");
  });
});

describe("how to reach me", () => {
  it("is shared only after the card owner accepts, in both directions", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex", "", "alex@example.com");
    const sam = await person("Sam", "", "843-555-0100");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash));
    expect(mail.dump()).not.toContain("843");
    await P.check(alex, mail);
    expect(alex.people[sam.me.pub].reach).toBeUndefined();
    await P.acceptRequest(alex, mail, sam.me.pub);
    await P.check(sam, mail);
    expect(sam.people[alex.me.pub]).toMatchObject({ status: "connected", reach: "alex@example.com" });
    await P.check(alex, mail);
    expect(alex.people[sam.me.pub].reach).toBe("843-555-0100");
  });

  it("is never sent to someone you decline", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex", "", "alex@example.com");
    const sam = await person("Sam", "", "sam@example.com");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash));
    await P.check(alex, mail);
    P.forget(alex, sam.me.pub);
    await P.check(sam, mail);
    expect(sam.people[alex.me.pub].reach).toBeUndefined();
    expect(alex.people[sam.me.pub]).toBeUndefined();
  });

  it("is swapped when two people scan each other", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex", "", "alex@example.com");
    const sam = await person("Sam", "", "sam@example.com");
    await P.answerInvite(sam, mail, P.parseInvite(new URL(P.createInvite(alex, "https://nearify.org")).hash));
    await P.answerInvite(alex, mail, P.parseInvite(new URL(P.createInvite(sam, "https://nearify.org")).hash));
    await P.check(alex, mail);
    await P.check(sam, mail);
    await P.check(alex, mail);
    expect(alex.people[sam.me.pub].reach).toBe("sam@example.com");
    expect(sam.people[alex.me.pub].reach).toBe("alex@example.com");
  });

  it("goes with an introduction only once both say yes", async () => {
    for (const firstIsB of [true, false]) {
      const mail = memoryMailbox();
      const a = await person("Ana");
      const b = await person("Ben", "", "ben@example.com");
      const c = await person("Cy", "", "cy@example.com");
      await connect(a, b, mail);
      await connect(a, c, mail);
      await P.introduce(a, mail, b.me.pub, c.me.pub);
      await P.check(b, mail);
      await P.check(c, mail);
      const [first, second] = firstIsB ? [b, c] : [c, b];
      await P.acceptIntro(first, mail, second.me.pub);
      await P.check(second, mail);
      expect(second.people[first.me.pub].reach).toBeUndefined();
      expect(mail.dump()).not.toContain("example.com");
      await P.acceptIntro(second, mail, first.me.pub);
      expect(second.people[first.me.pub].status).toBe("connected");
      await P.check(first, mail);
      expect(first.people[second.me.pub]).toMatchObject({ status: "connected", reach: second.me.reach });
      await P.check(second, mail);
      expect(second.people[first.me.pub].reach).toBe(first.me.reach);
    }
  });

  it("updates and clears for everyone you're connected with", async () => {
    const mail = memoryMailbox();
    const a = await person("Ana");
    const b = await person("Ben");
    const c = await person("Cy");
    await connect(a, b, mail);
    await connect(a, c, mail);
    expect(await P.setReach(a, mail, "linkedin.com/in/ana")).toBe(2);
    await P.check(b, mail);
    await P.check(c, mail);
    expect(b.people[a.me.pub].reach).toBe("linkedin.com/in/ana");
    expect(c.people[a.me.pub].reach).toBe("linkedin.com/in/ana");
    await P.setReach(a, mail, "");
    await P.check(b, mail);
    expect(b.people[a.me.pub].reach).toBeUndefined();
  });

  it("ignores reach from someone you aren't connected with", async () => {
    const mail = memoryMailbox();
    const alex = await person("Alex");
    const sam = await person("Sam", "", "sam@example.com");
    await P.answerInvite(alex, mail, P.parseInvite(new URL(P.createInvite(sam, "https://nearify.org")).hash));
    // Sam hasn't accepted. A forged "reach" from Sam must not land.
    await P.setReach(sam, mail, "spam@example.com");
    await P.check(alex, mail);
    expect(alex.people[sam.me.pub]).toMatchObject({ status: "sent" });
    expect(alex.people[sam.me.pub].reach).toBeUndefined();
  });
});
