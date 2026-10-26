import { createClient } from "npm:@supabase/supabase-js@2";
import { createLinearSyncHandler } from "./handler.ts";

Deno.serve(createLinearSyncHandler({
    createClient,
    env: (name) => Deno.env.get(name),
}));
