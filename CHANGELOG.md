# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Emporia Vue energy monitors (Vue 2, Vue 3): total power and power of every
  circuit (up to 16), named as in the Emporia app, refreshed every minute with
  a single request for the whole account.
- Cumulative energy indexes (kWh), total and per circuit, for the energy
  tracking of Gladys (30-minute consumption and cost). They are built from the
  daily totals of Emporia, close each day at its end and catch up a stop of up
  to 31 days.
- Solar installations: signed grid power (negative while exporting), grid
  import and export indexes, solar circuits as positive production.
- Emporia smart outlets: on/off, power, energy index.
- Emporia EV chargers: connector status, charging state, power, energy index,
  and the charger switch and target current, read-only unless "Allow
  controlling the EV chargers" is turned on.
- Sign-in with the email and password of the Emporia account (AWS Cognito
  SRP: the password never leaves the container); the session is kept in
  `/data` and renewed on its own. A refused password is not retried until the
  configuration changes.
- Dashboard widget "Emporia power": total power, solar production and the five
  circuits drawing the most.
- Scene trigger "Emporia device offline or back" and scene action "Emporia
  energy of the day" (energy from the grid, solar production, biggest circuit,
  current power).
- "List my Emporia devices" button in the configuration.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-emporia/commits/main
