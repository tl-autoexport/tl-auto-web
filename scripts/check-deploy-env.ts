import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Missing deployment variables: ${missing.join(", ")}`);
}

const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
if (
  supabaseUrl.protocol !== "https:" ||
  !supabaseUrl.hostname.endsWith(".supabase.co")
) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an HTTPS Supabase URL");
}

const siteValue =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_URL;

if (!siteValue) {
  throw new Error(
    "Set NEXT_PUBLIC_SITE_URL or use the Vercel-provided production URL",
  );
}

const siteUrl = new URL(
  /^https?:\/\//i.test(siteValue) ? siteValue : `https://${siteValue}`,
);
if (
  siteUrl.protocol !== "https:" ||
  ["localhost", "127.0.0.1"].includes(siteUrl.hostname)
) {
  throw new Error("The deployment site URL must be a public HTTPS URL");
}

console.log(
  `Deployment environment is valid: ${siteUrl.origin} → ${supabaseUrl.hostname}`,
);
