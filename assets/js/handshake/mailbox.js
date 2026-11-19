/**
 * Handshakes: the mailbox on the server. Plain fetch, no sign-in,
 * no cookies. It carries only box ids and sealed payloads.
 */
import { supabaseUrl, supabaseKey } from "../supabaseConfig.js";

async function rpc(name, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mailbox ${name} failed (${res.status})`);
  return res.status === 204 ? null : res.json();
}

export const mailbox = {
  post: (box, payload) => rpc("handshake_post", { p_box: box, p_payload: payload }),
  async take(boxes) {
    const out = [];
    for (let i = 0; i < boxes.length; i += 100) out.push(...((await rpc("handshake_take", { p_boxes: boxes.slice(i, i + 100) })) || []));
    return out;
  },
};
