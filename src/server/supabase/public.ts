import { createClient } from "@supabase/supabase-js";

export function createSupabasePublic() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase public env variables are not configured");
  }

  return createClient(supabaseUrl, publishableKey);
}
