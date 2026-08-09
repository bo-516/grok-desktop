/**
 * Credential source priority visualization (F-AUTH-10).
 * model.api_key > env_key > session token > XAI_API_KEY
 */

export type CredentialSource =
  | "model.api_key"
  | "env_key"
  | "session_token"
  | "xai_api_key"
  | "none";

/**
 * Resolve effective credential source from presence flags (no secret values).
 * @param flags Which sources exist.
 */
export function resolveCredentialSource(flags: {
  modelApiKey?: boolean;
  envKey?: boolean;
  sessionToken?: boolean;
  xaiApiKey?: boolean;
}): CredentialSource {
  if (flags.modelApiKey) {
    return "model.api_key";
  }
  if (flags.envKey) {
    return "env_key";
  }
  if (flags.sessionToken) {
    return "session_token";
  }
  if (flags.xaiApiKey) {
    return "xai_api_key";
  }
  return "none";
}

/**
 * Human label for settings display.
 */
export function credentialSourceLabel(source: CredentialSource): string {
  switch (source) {
    case "model.api_key":
      return "Model config api_key";
    case "env_key":
      return "Model env_key";
    case "session_token":
      return "Session token";
    case "xai_api_key":
      return "XAI_API_KEY env";
    default:
      return "None detected";
  }
}
