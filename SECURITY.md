# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Emporia password is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys, keeps it in memory and
  never sends it anywhere: the sign-in uses the SRP protocol of AWS Cognito,
  which only sends a proof of the password. It never writes it to `/data` nor
  to the logs, and the logs never show the account email nor any token.
- **Stored in `/data`** (readable by the container user only):
  `session.json`, the Cognito tokens of the account (ID, access and refresh
  tokens, with a hash of the email to tell accounts apart); `energy.json`, the
  energy indexes of the channels (daily totals). Nothing else.
- **Network**: HTTPS only, to `cognito-idp.us-east-2.amazonaws.com` (sign-in)
  and `api.emporiaenergy.com` (readings and commands). The integration opens
  no port. Charger commands are refused unless the user allowed them.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Emporia cloud and devices (report to Emporia Energy), and the other
services of your network.
