/**
 * generate-sitemap.js — Dynamic sitemap generation for Nearify
 *
 * Queries Supabase for all public (non-deleted) events and generates
 * a sitemap.xml that includes individual event pages.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/generate-sitemap.js > sitemap.xml
 *
 * Or via package.json script:
 *   npm run generate:sitemap
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://unndeygygkgodmmdnlup.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || "";

if (!SUPABASE_KEY) {
  console.error("Error: SUPABASE_SERVICE_KEY or SUPABASE_KEY environment variable is required.");
  console.error("Usage: SUPABASE_SERVICE_KEY=<key> node scripts/generate-sitemap.js");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toISOString().split("T")[0];
  } catch {
    return null;
  }
}

async function generateSitemap() {
  const { data: events, error } = await supabase
    .from("events")
    .select("id, slug, starts_at, created_at")
    .is("deleted_at", null)
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) {
    console.error("Supabase query error:", error.message);
    process.exit(1);
  }

  const staticPages = [
    { loc: "https://nearify.org/", priority: "1.0", changefreq: "weekly" },
    { loc: "https://nearify.org/events/", priority: "0.9", changefreq: "daily" },
    { loc: "https://nearify.org/join/", priority: "0.6", changefreq: "monthly" },
    { loc: "https://nearify.org/privacy.html", priority: "0.3", changefreq: "yearly" },
  ];

  const eventPages = (events || []).map((event) => {
    const slug = event.slug || event.id;
    const lastmod = formatDate(event.starts_at || event.created_at);
    return {
      loc: `https://nearify.org/events/event.html?slug=${encodeURIComponent(slug)}`,
      priority: "0.7",
      changefreq: "weekly",
      lastmod,
    };
  });

  const allUrls = [...staticPages, ...eventPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map((u) => {
    let entry = `  <url>\n    <loc>${escapeXml(u.loc)}</loc>`;
    if (u.lastmod) entry += `\n    <lastmod>${u.lastmod}</lastmod>`;
    entry += `\n    <changefreq>${u.changefreq}</changefreq>`;
    entry += `\n    <priority>${u.priority}</priority>`;
    entry += `\n  </url>`;
    return entry;
  })
  .join("\n")}
</urlset>`;

  process.stdout.write(xml + "\n");
}

generateSitemap();
