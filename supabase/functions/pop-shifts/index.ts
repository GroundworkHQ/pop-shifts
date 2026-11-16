// Pop's Shift Board API.
// GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD   -> list shifts (public read)
// POST {action:"check"}                 -> validate the family code
// POST {action:"save", shift:{...}}     -> create or update (needs x-family-code)
// POST {action:"delete", id}            -> remove (needs x-family-code)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), POP_FAMILY_CODE (secret).

import { createClient } from "jsr:@supabase/supabase-js@2";

const HOUSEHOLD = "pop";
const ALLOWED_ORIGINS = new Set([
  "https://pop.miguelloza.com",
  "http://pop.miguelloza.com",
  "http://localhost:8787",
]);

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://pop.miguelloza.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-family-code",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function sha(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function codeOk(given: string | null): Promise<boolean> {
  const expected = Deno.env.get("POP_FAMILY_CODE");
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([sha(given.trim().toLowerCase()), sha(expected.trim().toLowerCase())]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function shape(r: Record<string, unknown>) {
  return {
    id: r.id,
    date: r.shift_date,
    start: String(r.start_time).slice(0, 5),
    end: String(r.end_time).slice(0, 5),
    name: r.name,
    note: r.note ?? "",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) return json({ error: "from and to must be YYYY-MM-DD" }, 400, origin);
      const { data, error } = await db
        .from("pop_shifts")
        .select("id, shift_date, start_time, end_time, name, note")
        .eq("household_id", HOUSEHOLD)
        .gte("shift_date", from)
        .lte("shift_date", to)
        .order("shift_date")
        .order("start_time")
        .limit(500);
      if (error) throw error;
      return json({ shifts: (data ?? []).map(shape) }, 200, origin);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Bad request" }, 400, origin);

    if (!(await codeOk(req.headers.get("x-family-code")))) {
      return json({ error: "wrong_code" }, 401, origin);
    }

    if (body.action === "check") return json({ ok: true }, 200, origin);

    if (body.action === "save") {
      const s = body.shift ?? {};
      const name = String(s.name ?? "").trim().slice(0, 60);
      const note = String(s.note ?? "").trim().slice(0, 200);
      const date = String(s.date ?? "");
      const start = String(s.start ?? "");
      const end = String(s.end ?? "");
      if (!name) return json({ error: "Name is required" }, 400, origin);
      if (!DATE_RE.test(date) || !TIME_RE.test(start) || !TIME_RE.test(end)) return json({ error: "Bad date or time" }, 400, origin);
      if (toMin(end) <= toMin(start)) return json({ error: "End must be after start" }, 400, origin);
      if (toMin(start) < 540 || toMin(end) > 1260) return json({ error: "Shifts run 9 AM to 9 PM" }, 400, origin);

      const row = {
        household_id: HOUSEHOLD, shift_date: date, start_time: start, end_time: end,
        name, note, updated_at: new Date().toISOString(),
      };
      if (s.id) {
        if (!UUID_RE.test(String(s.id))) return json({ error: "Bad id" }, 400, origin);
        const { data, error } = await db.from("pop_shifts").update(row)
          .eq("id", s.id).eq("household_id", HOUSEHOLD).select().maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "Shift not found" }, 404, origin);
        return json({ shift: shape(data) }, 200, origin);
      }
      const { data, error } = await db.from("pop_shifts").insert(row).select().single();
      if (error) throw error;
      return json({ shift: shape(data) }, 200, origin);
    }

    if (body.action === "delete") {
      if (!UUID_RE.test(String(body.id ?? ""))) return json({ error: "Bad id" }, 400, origin);
      const { error } = await db.from("pop_shifts").delete().eq("id", body.id).eq("household_id", HOUSEHOLD);
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "Unknown action" }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500, origin);
  }
});
