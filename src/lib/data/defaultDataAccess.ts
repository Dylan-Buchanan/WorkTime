import { SupabaseDataAccess } from "./SupabaseDataAccess";
import { supabase } from "../supabase";

export const defaultDataAccess = new SupabaseDataAccess(supabase);
