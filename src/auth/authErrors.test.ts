import { describe, expect, it } from "vitest";
import { mapAuthError } from "./authErrors";

describe("mapAuthError", () => {
    it("distinguishes an invalid invite from an existing account", () => {
        const invalidInvite = mapAuthError({ context: { status: 403 } }, "inviteSignup");
        const existingAccount = mapAuthError({ context: { status: 409 } }, "inviteSignup");

        expect(invalidInvite.code).toBe("INVALID_INVITE");
        expect(invalidInvite.message).toBe("That invite code is invalid.");
        expect(existingAccount.code).toBe("ACCOUNT_EXISTS");
        expect(existingAccount.message).toBe("An account already exists for that email.");
    });
});
