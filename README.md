# Emporia Vue for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that brings the
**Emporia Vue** energy monitors (Vue 2, Vue 3 and their circuit sensors), the **Emporia smart
outlets** and the **Emporia EV chargers** into Gladys, through the Emporia cloud.

> **Developed without the hardware: feedback welcome.** The code is tested against the published
> behaviour of the Emporia API (PyEmVue, its simulator and the Home Assistant integration), not
> against real devices.
>
> Not affiliated with Emporia Energy. "Emporia" and "Vue" are trademarks of their owner.

## What it does

| Emporia device | In Gladys                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vue**        | Total power and index; power and index of every circuit (up to 16), named as in the Emporia app; unmonitored power; on a solar Vue, signed grid power, grid import/export indexes, solar production |
| **Outlet**     | On/off, power, energy index                                                                                                                                                                         |
| **EV charger** | Connector status, charging state, power, energy index; on/off and target current (read-only unless allowed)                                                                                         |

- **Energy tracking**: the indexes are cumulative kWh meters (`energy-sensor/index`,
  `switch/energy`, `energy-production-sensor/index`), from which Gladys derives the 30-minute
  consumption and its cost. Emporia has no meter index: the integration builds one from the
  daily totals, closed at the end of each day and kept in `/data`.
- **Refresh**: once a minute, one `getDeviceListUsages` request reads every channel of every
  device; the container polls by itself (the core's `onPoll` is only a fallback, see
  [Gladys#3198](https://github.com/GladysAssistant/Gladys/issues/3198)).
- **Widget** _Emporia power_: total power, solar production and the five circuits drawing the
  most.
- **Scene trigger** _Emporia device offline or back_, **scene action** _Emporia energy of the
  day_ (today's energy, biggest circuit, current power as outputs).
- Feature names and every message in English, French, German and Spanish.

The user documentation (configuration, each feature, sign conventions, scene examples,
troubleshooting) is in [`docs/en.md`](docs/en.md), [`docs/fr.md`](docs/fr.md),
[`docs/de.md`](docs/de.md) and [`docs/es.md`](docs/es.md); Gladys shows it from the
**Documentation** link of the configuration screen.

## Requirements

- Gladys Assistant **5.1.0** or later.
- An Emporia account signed in with an **email and password** (Google, Apple and MFA sign-ins
  are not supported), with its devices set up in the Emporia Energy app.
- Internet access: everything goes through the Emporia cloud.

## Installation

In Gladys: **Integrations → Install from GitHub**, then `https://github.com/guim31/gladys-emporia`
(or pick **Emporia Vue** in the store). Fill in the email and password of the Emporia account,
then add the devices from the **Discovery** tab.

## Limitations

- Cloud only, at the pace of the Emporia API (1-minute averages).
- The energy indexes move every 5 minutes; they are not read during the first 30 minutes after
  local midnight (the API may still answer the previous day), and a stop of more than 31 days
  loses the days before.
- Chargers are read-only by default (configuration _Allow controlling the EV chargers_).
- Emporia batteries, thermostats and vehicles are not supported.

## How it talks to Emporia

- **Sign-in**: AWS Cognito (user pool `us-east-2_ghlOXVLi1`, public app client of the Emporia
  app), `USER_SRP_AUTH` flow: the password never leaves the container, only an SRP proof.
  [`src/emporia/srp.js`](src/emporia/srp.js) is a dependency-free port of the reference
  implementation, checked against a vector computed by pycognito. The tokens (not the password)
  are stored in `/data/session.json` and renewed with the refresh token.
- **API**: `https://api.emporiaenergy.com`, ID token in an `authtoken` header:
  `customers/devices`, `AppAPI?apiMethod=getDeviceListUsages` (scales `1MIN` and `1D`),
  `customers/devices/status`, `devices/outlet`, `devices/evcharger`.
- [`scripts/probe.mjs`](scripts/probe.mjs) checks the real services from a machine with network
  access, read-only, printing nothing sensitive:

  ```bash
  node scripts/probe.mjs                      # a fake account: Cognito must refuse it cleanly
  EMPORIA_EMAIL=… EMPORIA_PASSWORD=… node scripts/probe.mjs   # a real account: counts only
  ```

## Project structure

```
index.js                 SDK wiring only
src/app.js               handlers, polling cycle, logs, connection status
src/poller.js            the container's own timer (onPoll is a fallback)
src/emporia/srp.js       SRP-6a, Cognito flavour (BigInt + node:crypto)
src/emporia/cognito.js   sign-in and token refresh
src/emporia/api.js       Emporia REST client, session in /data
src/emporia/model.js     payloads → plain objects (devices, usage tree, status)
src/energy.js            cumulative indexes from the daily totals
src/devices/             one file per device type (monitor, outlet, charger) + registry
src/widgets.js           dashboard widget content
src/scenes.js            scene trigger key and scene action
src/i18n.js              feature names and messages, four languages
test/                    node --test, against the SDK's fake Gladys and a fake Emporia cloud
```

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests never touch the network: [`test/helpers/fakeEmporia.js`](test/helpers/fakeEmporia.js)
plays the Emporia API and the Cognito user pool (it really verifies the SRP proof), and the SDK's
`createFakeGladys()` plays Gladys. [`test/gladys-rules.test.js`](test/gladys-rules.test.js) checks
every discovered device against the category/type table of the Gladys core.

Releases go through **Actions → Release** (it bumps `package.json`, the manifest `version` and
`docker_image`, and moves the `## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md)). On
the hand-pushed tag path (`git tag vX.Y.Z && git push --tags`), bump those three by hand and
commit them before tagging.

## Credits

- [PyEmVue](https://github.com/magico13/PyEmVue) by Michael Marvin (MIT): the API documentation,
  the Cognito parameters, the payload shapes and its simulator, which the fixtures follow.
- [ha-emporia-vue](https://github.com/magico13/ha-emporia-vue) (MIT), the Home Assistant
  integration: the sign conventions (solar, bidirectional circuits), the charger states and the
  reset lag of the daily totals.
- [pycognito](https://github.com/pvizeli/pycognito) (Apache-2.0): the reference SRP vector of
  the tests.
- Started from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js),
  with the [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## License

[Apache-2.0](LICENSE)
