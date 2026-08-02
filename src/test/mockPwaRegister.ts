export function registerSW(_options?: {
    immediate?: boolean;
    onRegisterError?: (error: unknown) => void;
}): () => Promise<void> {
    return async () => undefined;
}
