// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted". Vocabulary of the Gladys
// front (front/src/config/i18n/*.json); brand names are never translated.
// test/i18n.test.js checks that nothing is missing, empty or too long.
// -----------------------------------------------------------------------------

// Feature names, fixed by Gladys when the device is created (in the language
// of the configuration at that time). `{name}` is the circuit name set in the
// Emporia app, `{n}` a circuit number.
export const NAMES = {
  en: {
    totalPower: 'Total power',
    totalIndex: 'Total index',
    gridPower: 'Grid power',
    gridImportIndex: 'Grid import index',
    gridExportIndex: 'Grid export index',
    balancePower: 'Unmonitored power',
    circuit: 'Circuit {n}',
    circuitPower: '{name} power',
    circuitIndex: '{name} index',
    productionPower: '{name} production',
    productionIndex: '{name} production index',
    outletSwitch: 'On/Off',
    outletPower: 'Power',
    outletIndex: 'Index',
    chargerConnector: 'Connector',
    chargerState: 'Charging state',
    chargerSwitch: 'Charger enabled',
    chargerCurrent: 'Target current',
    chargerPower: 'Charging power',
    chargerIndex: 'Index',
  },
  fr: {
    totalPower: 'Puissance totale',
    totalIndex: 'Index total',
    gridPower: 'Échange réseau',
    gridImportIndex: 'Index import réseau',
    gridExportIndex: 'Index export réseau',
    balancePower: 'Puissance non suivie',
    circuit: 'Circuit {n}',
    circuitPower: '{name} – puissance',
    circuitIndex: '{name} – index',
    productionPower: '{name} – production',
    productionIndex: '{name} – index production',
    outletSwitch: 'Marche/arrêt',
    outletPower: 'Puissance',
    outletIndex: 'Index',
    chargerConnector: 'Connecteur',
    chargerState: 'État de la charge',
    chargerSwitch: 'Borne activée',
    chargerCurrent: 'Intensité de consigne',
    chargerPower: 'Puissance de charge',
    chargerIndex: 'Index',
  },
  de: {
    totalPower: 'Gesamtleistung',
    totalIndex: 'Gesamtindex',
    gridPower: 'Netzleistung',
    gridImportIndex: 'Netzbezugszähler',
    gridExportIndex: 'Netzeinspeisezähler',
    balancePower: 'Nicht erfasste Leistung',
    circuit: 'Stromkreis {n}',
    circuitPower: '{name} – Leistung',
    circuitIndex: '{name} – Index',
    productionPower: '{name} – Produktion',
    productionIndex: '{name} – Produktionsindex',
    outletSwitch: 'Ein/Aus',
    outletPower: 'Leistung',
    outletIndex: 'Index',
    chargerConnector: 'Anschluss',
    chargerState: 'Ladevorgangsstatus',
    chargerSwitch: 'Ladestation aktiv',
    chargerCurrent: 'Sollstrom',
    chargerPower: 'Ladeleistung',
    chargerIndex: 'Index',
  },
  es: {
    totalPower: 'Potencia total',
    totalIndex: 'Índice total',
    gridPower: 'Potencia de la red',
    gridImportIndex: 'Índice de importación',
    gridExportIndex: 'Índice de exportación',
    balancePower: 'Potencia no medida',
    circuit: 'Circuito {n}',
    circuitPower: '{name} – potencia',
    circuitIndex: '{name} – índice',
    productionPower: '{name} – producción',
    productionIndex: '{name} – índice de producción',
    outletSwitch: 'Encendido/apagado',
    outletPower: 'Potencia',
    outletIndex: 'Índice',
    chargerConnector: 'Conector',
    chargerState: 'Estado de carga',
    chargerSwitch: 'Cargador activado',
    chargerCurrent: 'Corriente objetivo',
    chargerPower: 'Potencia de carga',
    chargerIndex: 'Índice',
  },
};

// Longest feature name Gladys shows comfortably: user circuit names are cut
// so that "{name} – index production" still fits.
export const MAX_FEATURE_NAME = 40;

/**
 * A feature name in the configured language.
 * @param {string} language
 * @param {keyof NAMES['en']} key
 * @param {{ name?: string, n?: string }} [values]
 */
export function featureName(language, key, values = {}) {
  const template = (NAMES[language] ?? NAMES.fr)[key];
  const fixed = template.replace('{name}', '').replace('{n}', values.n ?? '').length;
  let name = values.name ?? '';
  if (fixed + name.length > MAX_FEATURE_NAME) {
    name = `${name.slice(0, Math.max(1, MAX_FEATURE_NAME - fixed - 1)).trimEnd()}…`;
  }
  return template.replace('{name}', name).replace('{n}', values.n ?? '');
}

// Messages: connection status of the Configuration screen, errors, widgets.
export const TEXT = {
  notConfigured: {
    en: 'Enter the email and password of your Emporia account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Emporia.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Emporia-Kontos ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta Emporia.',
  },
  accountRefused: {
    en: 'Emporia refused this email or password. Check them, then save again.',
    fr: 'Emporia refuse cet e-mail ou ce mot de passe. Vérifiez-les, puis enregistrez à nouveau.',
    de: 'Emporia lehnt diese E-Mail-Adresse oder dieses Passwort ab. Prüfe sie und speichere erneut.',
    es: 'Emporia rechaza este correo o esta contraseña. Compruébelos y guarde de nuevo.',
  },
  signInUnsupported: {
    en: 'Your Emporia account asks for a step this integration cannot do (MFA, new password). Sign in once in the Emporia app.',
    fr: 'Votre compte Emporia demande une étape que l’intégration ne sait pas faire (MFA, nouveau mot de passe). Connectez-vous une fois dans l’appli Emporia.',
    de: 'Dein Emporia-Konto verlangt einen Schritt, den die Integration nicht kann (MFA, neues Passwort). Melde dich einmal in der Emporia-App an.',
    es: 'Su cuenta Emporia pide un paso que la integración no sabe hacer (MFA, nueva contraseña). Inicie sesión una vez en la app Emporia.',
  },
  cloudUnreachable: {
    en: 'The Emporia cloud does not answer. The integration tries again every minute.',
    fr: 'Le cloud Emporia ne répond pas. L’intégration réessaie chaque minute.',
    de: 'Die Emporia-Cloud antwortet nicht. Die Integration versucht es jede Minute erneut.',
    es: 'La nube de Emporia no responde. La integración lo vuelve a intentar cada minuto.',
  },
  publishFailed: {
    en: 'Gladys refused the list of Emporia devices. See the integration logs.',
    fr: 'Gladys a refusé la liste des appareils Emporia. Consultez les journaux de l’intégration.',
    de: 'Gladys hat die Liste der Emporia-Geräte abgelehnt. Sieh in den Protokollen der Integration nach.',
    es: 'Gladys rechazó la lista de dispositivos Emporia. Consulte los registros de la integración.',
  },
  chargerControlDisabled: {
    en: 'Charger control is disabled in the integration configuration.',
    fr: 'Le pilotage des bornes est désactivé dans la configuration de l’intégration.',
    de: 'Die Steuerung der Ladestationen ist in der Konfiguration der Integration deaktiviert.',
    es: 'El control de los cargadores está desactivado en la configuración de la integración.',
  },
  deviceUnknown: {
    en: 'This Emporia device is no longer in the account.',
    fr: 'Cet appareil Emporia n’est plus dans le compte.',
    de: 'Dieses Emporia-Gerät ist nicht mehr im Konto.',
    es: 'Este dispositivo Emporia ya no está en la cuenta.',
  },
  noDevice: {
    en: 'No Emporia device in this account.',
    fr: 'Aucun appareil Emporia dans ce compte.',
    de: 'Kein Emporia-Gerät in diesem Konto.',
    es: 'Ningún dispositivo Emporia en esta cuenta.',
  },
  // Widget
  widgetTotal: { en: 'Total', fr: 'Total', de: 'Gesamt', es: 'Total' },
  widgetSolar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  widgetGrid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  widgetPickVue: {
    en: 'Pick an Emporia Vue in the widget settings.',
    fr: 'Choisissez un Emporia Vue dans les réglages du widget.',
    de: 'Wähle in den Widget-Einstellungen einen Emporia Vue.',
    es: 'Elija un Emporia Vue en los ajustes del widget.',
  },
  widgetNoData: {
    en: 'No reading yet: the first one comes within a minute.',
    fr: 'Pas encore de mesure : la première arrive dans la minute.',
    de: 'Noch keine Messung: Die erste kommt innerhalb einer Minute.',
    es: 'Todavía no hay medición: la primera llega en un minuto.',
  },
  widgetAllIdle: {
    en: 'No circuit draws power right now.',
    fr: 'Aucun circuit ne consomme en ce moment.',
    de: 'Gerade verbraucht kein Stromkreis Leistung.',
    es: 'Ningún circuito consume en este momento.',
  },
};

const KIND = {
  monitor: { en: 'Vue', fr: 'Vue', de: 'Vue', es: 'Vue' },
  outlet: { en: 'outlet', fr: 'prise', de: 'Steckdose', es: 'enchufe' },
  charger: { en: 'charger', fr: 'borne', de: 'Ladestation', es: 'cargador' },
};

const CIRCUITS = {
  en: (n) => `${n} circuit(s)`,
  fr: (n) => `${n} circuit(s)`,
  de: (n) => `${n} Stromkreis(e)`,
  es: (n) => `${n} circuito(s)`,
};

const FOUND = {
  en: (n, list) => `${n} Emporia device(s): ${list}.`,
  fr: (n, list) => `${n} appareil(s) Emporia : ${list}.`,
  de: (n, list) => `${n} Emporia-Gerät(e): ${list}.`,
  es: (n, list) => `${n} dispositivo(s) Emporia: ${list}.`,
};

/**
 * Result of the "list devices" action, in the four languages.
 * @param {Array<{ name: string, kind: string, circuits: number }>} devices
 */
export function devicesMessage(devices) {
  if (devices.length === 0) {
    return TEXT.noDevice;
  }
  return Object.fromEntries(
    Object.keys(FOUND).map((lang) => {
      const list = devices
        .map((d) =>
          d.kind === 'monitor'
            ? `${d.name} (${KIND.monitor[lang]}, ${CIRCUITS[lang](d.circuits)})`
            : `${d.name} (${KIND[d.kind][lang]})`,
        )
        .join(', ');
      // The action message box holds 1000 characters.
      return [lang, FOUND[lang](devices.length, list).slice(0, 1000)];
    }),
  );
}
