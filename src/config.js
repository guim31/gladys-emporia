// -----------------------------------------------------------------------------
// Integration configuration, filled in by the user from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes what Gladys sends, so the rest of the code never sees `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // Language of the feature names and of the texts the container produces
  // (a device integration does not receive the user's language).
  language: 'fr',
  // Chargers are read-only unless the user explicitly allows control.
  charger_control: false,
};

/**
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const language = String(raw.language ?? DEFAULT_CONFIG.language);
  return {
    email: String(raw.email ?? DEFAULT_CONFIG.email).trim(),
    password: String(raw.password ?? DEFAULT_CONFIG.password),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
    charger_control: raw.charger_control === true || raw.charger_control === 'true',
  };
}

/** The account can be used once the email and password are set. */
export function isConfigured(config) {
  return Boolean(config.email && config.password);
}
