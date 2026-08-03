import { describe, expect, it } from "vitest";
import { DataAccessAuthError } from "./DataAccess";

describe("DataAccessAuthError", () => {
    it("builds a code-first error with the mapped message", () => {
        const error = new DataAccessAuthError("DATA_ACCESS_REFRESH_FAILED");
        expect(error.code).toBe("DATA_ACCESS_REFRESH_FAILED");
        expect(error.name).toBe("DataAccessAuthError");
        expect(error.message).toBe("The Supabase session could not be refreshed");
    });

    it("keeps the supplied code and overrides the message", () => {
        const error = new DataAccessAuthError("DATA_ACCESS_NO_SESSION", "custom message");
        expect(error.code).toBe("DATA_ACCESS_NO_SESSION");
        expect(error.message).toBe("custom message");
    });

    it("treats a legacy message-first call as a message with the default code", () => {
        const error = new DataAccessAuthError("An authenticated Supabase session is required");
        expect(error.code).toBe("DATA_ACCESS_NO_SESSION");
        expect(error.message).toBe("An authenticated Supabase session is required");
    });

    it("defaults to the no-session code", () => {
        const error = new DataAccessAuthError();
        expect(error.code).toBe("DATA_ACCESS_NO_SESSION");
        expect(error.message).toBe("An authenticated Supabase session is required");
    });
});
