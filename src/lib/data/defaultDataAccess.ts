import { DataAccessAuthError, type DataAccess } from "./DataAccess";
import { LocalStagingStore } from "./staging/LocalStagingStore";
import { SupabaseDataAccess } from "./SupabaseDataAccess";
import { SyncCoordinator } from "./sync/SyncCoordinator";
import { StagedDataAccess } from "./StagedDataAccess";
import { supabase } from "../supabase";

/**
 * Builds the production owner-scoped data graph: one per-owner staging store,
 * the Supabase transport, and the serialized sync coordinator, all composed into
 * a local-first `StagedDataAccess`. A user change must produce a new graph and
 * owner key; never share a graph across owners.
 */
export function createDefaultDataAccess(ownerId: string): DataAccess {
    if (typeof window === "undefined" || !window.localStorage) {
        throw new DataAccessAuthError(
            "DATA_ACCESS_NO_SESSION",
            "localStorage is required for the local-first staging store",
        );
    }
    const store = new LocalStagingStore(window.localStorage);
    const remote = new SupabaseDataAccess(supabase);
    const coordinator = new SyncCoordinator(ownerId, store, remote);
    return new StagedDataAccess(ownerId, store, coordinator);
}
