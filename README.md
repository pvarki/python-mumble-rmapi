# python-mumble-rmapi

Voice for the OpenDefence platform: Murmur (Mumble server) with certificate-only authentication, managed
from the Deploy App. Users come only from Deploy App enrolment; nobody logs in to anything else.
opendefence-platform deploys it as `k8s/app-mumble`.

One image, three parts:

- **`murmur-agent`** runs as a sidecar next to Murmur and talks to it over Ice on localhost. It:
  - authenticates every connection by its TAK client certificate. The chain must lead to the platform CA,
    the certificate must not be revoked (rmapi OCSP), and the callsign in the Mumble username must equal
    the certificate CN.
  - refuses and disconnects callsigns that are revoked or have voice turned off in mumblermapi
  - keeps the channel tree in place:
    - `Units/` from mumblermapi. Each net is open, invite-only (its members and those of invite-only nets
      above it), or as the net above.
    - `Missions/` from TAK, for each mission's subscribers, plus `Guard`, the emergency net open to everyone
    - `Teams/` and `Roles/` for the ATAK team colours and roles
  - moves people out of nets they lost access to, and stops their listeners
  - reports who is connected where back to mumblermapi
- **`mumblermapi`** is the registered rmapi product, in its own pod. It:
  - receives rmapi's user events
  - keeps the `Units/` nets and their members in SQLite
  - reads TAK missions and their subscribers with a plain TAK user identity, obtained through rmapi's
    product interop
  - serves the agent's desired state, the admin API and the UI remote
- **The UI remote** (`ui/`) is a module-federation remote that rmui loads from `/ui/mumble/remoteEntry.js`.
  - Everyone sees their nets, and can join one and talk from the browser (below).
  - Admins manage unit nets and members, see mission nets, see who is online, turn voice off per callsign,
    and import and export the channel plan.
  - It is in Finnish, Swedish and English.

The design is in `VOICE-PLAN.md` in `markdown-opendefence-pm`.

## Talking from the browser

Browsers join the same nets through the voice gateway (`pvarki/golang-mumble-voice-gateway`, VOICE-PLAN §4.10),
with no extra login. The gateway reads the ticket's username and certificate (`tickets.py`), so the two share
that format:

1. The talk panel POSTs `{"slot": n}` to `/ui/mumble/api/v1/voice/token`. mumblermapi takes the client
   certificate Traefik verified, checks it against the platform CA and its own user record (known, not
   revoked, voice on), and signs a 60-second Ed25519 ticket for `<callsign>---web-<n>` that carries that
   certificate. The signing key lives in memory only; murmur-agent gets the public key with its state.
2. The panel opens `wss://mtls.<domain>/ui/mumble/ws` and sends the ticket. The gateway checks it carries
   the connection's own certificate, then logs in to Murmur with its own certificate and the ticket as the
   password.
3. murmur-agent admits the gateway's certificate (from `AGENT_GATEWAY_CA`, a CA that signs nothing else)
   only into `web-` slots, only with a valid ticket for exactly that name, and then checks the certificate
   from the ticket like a phone's. Phones can never take `web-` slots. The sweep re-checks the stored
   certificate and disconnects browser sessions it has no ticket for, such as after a restart.

The browser speaks Mumble 1.4's protocol through the gateway: Opus from WebCodecs, played with Web Audio.
Push-to-talk is the on-screen button or a key or extra mouse button each browser picks, Tab (sarkain) by default;
Bluetooth PTT buttons that act as keyboards work too. It works only while the tab has focus.

## Health

mumblermapi's `/api/v1/healthcheck` is voice's health for rmapi, which rmui shows. It always answers 200, as the
kubelet probes it too and a restart mends none of what it finds. `healthy` and `extra` come from a check that runs
every 15 s and logs each change:

- `no ready Linkerd proxy in mumblermapi's pod (<cause>)`: rmapi, murmur-agent and browser tickets are refused
- `murmur-agent has not reported for <n> s` (or since mumblermapi started): Murmur or the agent is away or refused
- `the voice gateway is not ready (<cause>)`: browsers cannot talk

`<cause>` is the HTTP status that came back, or why none did: `name resolution failed`, `connection refused` or
`timed out` (after 2 s). A failed lookup points at the cluster, such as in-cluster DNS or the node, not at voice.

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `MURMUR_ICE_SECRET` | agent | Murmur's Ice write secret (required) |
| `AGENT_STATE_URL` | agent | mumblermapi's `/api/v1/agent/state`; unset runs on `AGENT_CHANNELS_FILE` alone |
| `AGENT_PRESENCE_URL` | agent | mumblermapi's `/api/v1/agent/presence`; unset reports nothing |
| `AGENT_CA_BUNDLE`, `AGENT_DATA_DIR`, `AGENT_OCSP_URL`, `AGENT_POLL_SECONDS`, `AGENT_SWEEP_SECONDS` | agent | see `config.py` |
| `MUMBLERMAPI_DATABASE`, `MUMBLERMAPI_TEMPLATES_DIR`, `MUMBLERMAPI_UI_DIR` | mumblermapi | SQLite file, channel plan templates admins may apply (`*.yaml`: `name`, `description`, `channels`, each channel with an optional `access` of `open`, `invite` or `inherit`; none is applied by default), built UI |
| `MUMBLERMAPI_RMAPI_IDENTITY`, `MUMBLERMAPI_AGENT_IDENTITY` | mumblermapi | Linkerd identities allowed to send user events and read agent state |
| `MUMBLERMAPI_TRAEFIK_IDENTITY`, `MUMBLERMAPI_CA_BUNDLE` | mumblermapi | The edge whose forwarded certificate voice tickets are minted for, and the CAs it must chain to |
| `AGENT_GATEWAY_CA` | agent | The voice gateway's CA; unset lets no browser in |
| `MUMBLERMAPI_PROXY_READY_URL`, `MUMBLERMAPI_GATEWAY_READY_URL` | mumblermapi | What the health check asks: this pod's Linkerd proxy, default `http://127.0.0.1:4191/ready`, and the voice gateway's `/readyz`; empty skips that check |
| `MUMBLERMAPI_TAK_URL`, `MUMBLERMAPI_TAK_SERVER_NAME`, `MUMBLERMAPI_TAK_CN` | mumblermapi | TAK's API, the name on TAK's certificate, our TAK identity's CN; unset leaves `Missions/` empty |

Mission nets need takrmapi's `/api/v1/interop/add` and rmapi calling it without a double slash. Both are
upstream changes that `VOICE-PLAN.md` tracks.

## Development

```bash
uv sync
uv run pytest
uv run mypy src tests

pnpm -C ui install
pnpm -C ui build
```

The Ice bindings come from the container image (Ubuntu's `python3-zeroc-ice`, Ice 3.7, the same Ice that
Murmur links). The agent's Ice glue is unit tested against an in-memory Murmur (`tests/fake_murmur.py`).
Only loading Ice and the run loop need the real one.

## Licence

GPL-2.0-only: `murmur-agent` uses ZeroC Ice, which is GPL-2.0-only. `MumbleServer.ice` is the Mumble
server's interface definition, under Mumble's BSD licence.
