// Windsor spend for the RAC planning tools. Runs on Vercel, never in the
// browser, because it needs the secret Windsor key.
//
// Same shape as EM-Budget-Monitor's refresh-spend.mjs: same auth rule, same
// Windsor call. The difference is what happens to the rows. Budget Monitor
// matches Windsor campaigns to rows a user linked by hand. Here the campaign
// name already carries role, location and platform:
//
//   RAC | Conversion | SMR Mechanics | South East | GS | February 26 | 2936
//
// so there is nothing to link and nothing to match. This just hands the rows
// back and the tool parses them exactly as it parses a pasted export.
//
// GET /api/windsor-spend?from=2026-07-01&to=2026-07-25
// Returns one row per campaign per day: { date, campaign, spend, apps }
//
// Env vars (Vercel, never the frontend):
//   WINDSOR_API_KEY            - from onboard.windsor.ai
//   SUPABASE_URL               - RAC Tools project URL (public)
//   SUPABASE_SERVICE_ROLE_KEY  - RAC Tools service role key (secret)
//   CRON_SECRET                - optional, for a scheduled pull

import { createClient } from "@supabase/supabase-js";

const WINDSOR_BASE = "https://connectors.windsor.ai";
const ENHANCE_DOMAIN = "@enhancemedia.co.uk";

// RAC's accounts. Only these two: Indeed and Appcast are not Windsor
// connectors and keep coming in by paste.
// The two connectors RAC runs. Indeed and Appcast are not Windsor sources
// and keep coming in by paste.
//
// They are asked for different things, matching how the Excel pacing doc
// pulls them, which is the setup that has been trusted to date:
//   Google - conversions come out per conversion action, so applications are
//            the rows named exactly "Application Submitted".
//   Meta   - has a dedicated applications field, so spend and applications
//            come back on the same row.
const CONNECTORS = [
  { id: "google_ads", apps: "conversion_action" },
  { id: "facebook", apps: "actions_application_submitted" },
];

const APP_ACTION = "application submitted";

async function windsor(connector, apiKey, from, to, fields) {
  const url = `${WINDSOR_BASE}/${connector}?api_key=${encodeURIComponent(apiKey)}` +
    `&date_from=${from}&date_to=${to}` +
    `&fields=${fields.join(",")}&_renderer=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Windsor ${connector} returned ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.data || []);
}

async function pull(c, apiKey, from, to) {
  const out = new Map();
  const add = (date, campaign, spend, apps) => {
    if (!campaign) return;
    const k = date + "|" + campaign;
    const e = out.get(k) || { date, campaign, spend: 0, apps: 0 };
    e.spend += spend; e.apps += apps;
    out.set(k, e);
  };

  if (c.apps === "actions_application_submitted") {
    // One call: Meta reports both on the same row.
    const rows = await windsor(c.id, apiKey, from, to, ["date", "campaign", "spend", c.apps]);
    for (const x of rows) add(x.date, x.campaign, Number(x.spend) || 0, Number(x[c.apps]) || 0);
    return { rows: [...out.values()], appsError: null };
  }

  // Google: spend first, then applications separately. Asking for both at
  // once repeats the spend against every conversion action on that campaign.
  const spendRows = await windsor(c.id, apiKey, from, to, ["date", "campaign", "spend"]);
  for (const x of spendRows) add(x.date, x.campaign, Number(x.spend) || 0, 0);
  try {
    const convRows = await windsor(c.id, apiKey, from, to,
      ["date", "campaign", "conversion_action_name", "all_conversions"]);
    for (const x of convRows) {
      // Exactly "Application Submitted". The role-specific actions sit
      // alongside it and are not added in, matching the Excel doc.
      if (String(x.conversion_action_name || "").trim().toLowerCase() !== APP_ACTION) continue;
      add(x.date, x.campaign, 0, Number(x.all_conversions) || 0);
    }
  } catch (e) {
    // Spend is the important half. Hand back what we have and say so.
    return { rows: [...out.values()], appsError: String(e.message || e) };
  }
  return { rows: [...out.values()], appsError: null };
}

export default async function handler(req, res) {
  try {
    const { WINDSOR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!WINDSOR_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Server is missing WINDSOR_API_KEY, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
    }

    // Same rule as Budget Monitor: the cron secret, or a signed-in Enhance
    // Media address, or an address on the allow list.
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const isCron = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
    if (!isCron) {
      if (!token) return res.status(401).json({ error: "Not signed in." });
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      const email = userData?.user?.email || "";
      if (userErr || !email) return res.status(401).json({ error: "Sign-in could not be verified." });
      let allowed = email.toLowerCase().endsWith(ENHANCE_DOMAIN);
      if (!allowed) {
        const { data: allow } = await admin.from("allowed_emails").select("email").eq("email", email.toLowerCase()).maybeSingle();
        allowed = !!allow;
      }
      if (!allowed) return res.status(403).json({ error: "This account isn't allowed." });
    }

    const q = req.query || {};
    const from = (q.from || "").trim();
    const to = (q.to || "").trim();
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "Give from and to as yyyy-mm-dd." });

    const rows = [];
    const errors = [];
    for (const c of CONNECTORS) {
      try {
        const got = await pull(c, WINDSOR_API_KEY, from, to);
        rows.push(...got.rows);
        if (got.appsError) errors.push({ connector: c.id, error: "Spend came through, applications did not: " + got.appsError });
      } catch (e) { errors.push({ connector: c.id, error: String(e.message || e) }); }
    }
    if (!rows.length && errors.length) return res.status(502).json({ error: errors[0].error, errors });

    // ponytail: rows straight back, no shaping. The tool already knows how to
    // read this exact shape because it is what a Windsor export looks like.
    return res.status(200).json({
      from, to, rows,
      spend: Math.round(rows.reduce((s, r) => s + r.spend, 0) * 100) / 100,
      apps: Math.round(rows.reduce((s, r) => s + r.apps, 0) * 10) / 10,
      errors,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
