// Jarvis → Shopify relay (Supabase Edge Function "shopify-stats").
// Shopify blocks browsers from reading store data directly, so Jarvis asks this function instead.
// Only the Sleek Auto owner login can call it. Shopify keys live in Supabase secrets, never in the website code.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SHOPIFY_STORE          e.g. niche-co-store   (the part before .myshopify.com)
//   SHOPIFY_CLIENT_ID      } from the Shopify Dev Dashboard app (Settings), or instead:
//   SHOPIFY_CLIENT_SECRET  }
//   SHOPIFY_TOKEN          an Admin API access token (shpat_...) from an older custom app
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHOP = (Deno.env.get("SHOPIFY_STORE") ?? "niche-co-store").replace(/\.myshopify\.com$/, "");
const API = "2025-10";
const TZ_OFFSET = "+02:00"; // South Africa, no daylight saving
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

let cached: { t: string; exp: number } | null = null;
async function shopToken(): Promise<string> {
  const fixed = Deno.env.get("SHOPIFY_TOKEN");
  if (fixed) return fixed;
  if (cached && cached.exp > Date.now() + 60_000) return cached.t;
  const id = Deno.env.get("SHOPIFY_CLIENT_ID"), secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Shopify keys are missing. Add SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Supabase secrets.");
  const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`Shopify refused the app login (${r.status}). Check the app is installed on the store and the keys are right.`);
  const j = await r.json();
  cached = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86_000) * 1000 };
  return cached.t;
}

const QUERY = `query($q:String!,$after:String){orders(first:50,after:$after,query:$q,sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{createdAt cancelledAt test currentTotalPriceSet{shopMoney{amount currencyCode}} lineItems(first:10){nodes{title quantity}}}}}`;

// South African calendar date of an instant
const saDay = (d: Date) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // owner check: the caller must be signed in to Sleek Auto as the owner
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Sign in to Sleek Auto in Jarvis first." }, 401);
    const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
    if (prof?.role !== "owner") return json({ error: "Only the owner can see store sales." }, 403);

    const today = saDay(new Date());
    const monthStart = today.slice(0, 8) + "01";
    const weekStart = saDay(new Date(Date.now() - 6 * 864e5));
    const since = weekStart < monthStart ? weekStart : monthStart;

    const token = await shopToken();
    const orders: any[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const r = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: QUERY, variables: { q: `created_at:>='${since}T00:00:00${TZ_OFFSET}'`, after } }),
      });
      if (r.status === 401 || r.status === 403) { cached = null; throw new Error("Shopify said no. Give the app the read_orders permission and reinstall it."); }
      if (!r.ok) throw new Error(`Shopify error ${r.status}`);
      const j = await r.json();
      if (j.errors) throw new Error("Shopify: " + (j.errors[0]?.message ?? "query failed"));
      const o = j.data.orders;
      orders.push(...o.nodes);
      if (!o.pageInfo.hasNextPage) break;
      after = o.pageInfo.endCursor;
    }

    let currency = "ZAR";
    const days: Record<string, { sales: number; orders: number }> = {};
    for (let i = 6; i >= 0; i--) days[saDay(new Date(Date.now() - i * 864e5))] = { sales: 0, orders: 0 };
    const month = { sales: 0, orders: 0 }, top: Record<string, number> = {};
    for (const o of orders) {
      if (o.test || o.cancelledAt) continue;
      const amt = Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0);
      currency = o.currentTotalPriceSet?.shopMoney?.currencyCode ?? currency;
      const d = saDay(new Date(o.createdAt));
      if (days[d]) { days[d].sales += amt; days[d].orders++; }
      if (d >= monthStart) {
        month.sales += amt; month.orders++;
        for (const li of o.lineItems?.nodes ?? []) top[li.title] = (top[li.title] ?? 0) + (li.quantity ?? 0);
      }
    }
    return json({
      currency,
      today: days[today] ?? { sales: 0, orders: 0 },
      yesterday: days[saDay(new Date(Date.now() - 864e5))] ?? { sales: 0, orders: 0 },
      month,
      days: Object.entries(days).map(([day, v]) => ({ day, ...v })),
      top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, qty]) => ({ title, qty })),
      updated: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
