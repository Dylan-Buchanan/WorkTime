import { createClient } from "npm:@supabase/supabase-js@2";

interface InviteSignupRequest {
    email: string;
    password: string;
    inviteCode: string;
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let payload: Partial<InviteSignupRequest>;
    try {
        const parsed: unknown = await request.json();
        if (!parsed || typeof parsed !== "object") {
            return jsonResponse({ error: "Invalid request" }, 400);
        }
        payload = parsed as Partial<InviteSignupRequest>;
    } catch {
        return jsonResponse({ error: "Invalid request" }, 400);
    }

    if (!isNonEmptyString(payload.email) || !isNonEmptyString(payload.password) || !isNonEmptyString(payload.inviteCode)) {
        return jsonResponse({ error: "Invalid request" }, 400);
    }

    const expectedInviteCode = Deno.env.get("SIGNUP_INVITE_CODE");
    if (!expectedInviteCode) {
        return jsonResponse({ error: "Signup is unavailable" }, 500);
    }

    if (payload.inviteCode !== expectedInviteCode) {
        return jsonResponse({ error: "Invalid invite" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "Signup is unavailable" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data, error } = await supabase.auth.admin.createUser({
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
        email_confirm: true,
    });

    if (error) {
        const status = error.status === 422 || error.code === "email_exists" ? 409 : 400;
        return jsonResponse({ error: status === 409 ? "Account already exists" : "Unable to create account" }, status);
    }

    return jsonResponse({ user: { id: data.user.id, email: data.user.email } }, 201);
});
