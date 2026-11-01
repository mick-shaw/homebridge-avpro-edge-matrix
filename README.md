<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# homebridge-avpro-edge-matrix

[Homebridge](https://homebridge.io) plugin for **AVPro Edge AC-MX HDMI matrix switchers**.

Each matrix **output** becomes a HomeKit **Television** accessory and each matrix **input** becomes
one of its **Input Sources**. Pick a source on the tile, in a scene, or with Siri, and the matrix
routes that input to that room. Outputs are independent: changing the kitchen never touches the
living room.

Tested on the **AC-MX-42X** (4×2, firmware NET 1.11 / MAIN 0.97). The routing commands used
(`SET OUTx VS INy`, `GET OUTx VS`) are the same in AVPro's published command lists for the
AC-MX-42, AC-MX-44, AC-MX-88 and AC-MX-1616 families, so those should work too. Reports welcome.

## What it does

* Routing only. The plugin never sends power, volume or playback commands to the matrix.
* A persistent connection to the matrix control port (telnet, TCP 23). No cloud, no polling storms.
* **Live state.** Any route change made from the front panel, the matrix web UI, RS-232 or another
  controller is pushed to HomeKit within a second. A `GET OUT0 VS` poll (default every 30 s) is kept
  as a safety net.
* **Honest confirmation.** A source change is reported as successful only after the matrix echoes
  the new route. If the matrix is unreachable or does not confirm, HomeKit shows an error and the
  tile reverts to the last confirmed state.
* Automatic reconnect with exponential back-off after a network drop or matrix power-cycle.
* Inputs you do not name are still created, hidden, so the tile always shows the true state even
  when someone selects an unnamed input on the front panel.

## Requirements

* Homebridge 1.8 or 2.x, Node.js 22 or 24.
* The matrix must have **IP control enabled** (web UI → System → IP Control, on by default, port 23)
  and be in **Matrix** switch mode (not DA mode) for independent outputs.
* A fixed IP address or DHCP reservation for the matrix.

## Installation

Install from the Homebridge UI (search for `homebridge-avpro-edge-matrix`) or:

```bash
npm install -g homebridge-avpro-edge-matrix
```

## Configuration

Use the settings form in the Homebridge UI, or add a platform block to `config.json`:

```json
{
  "platform": "AVProMatrix",
  "name": "AVPro Matrix",
  "host": "192.168.1.239",
  "port": 23,
  "pollInterval": 30,
  "commandTimeout": 4,
  "inputCount": 4,
  "model": "AC-MX-42X",
  "outputs": [
    {
      "name": "Kitchen Video",
      "output": 2,
      "inputs": [
        { "name": "xbox", "input": 1 },
        { "name": "appleTV", "input": 2 }
      ]
    },
    {
      "name": "Living Room Video",
      "output": 1,
      "inputs": [
        { "name": "xbox", "input": 1 },
        { "name": "appleTV", "input": 2 }
      ]
    }
  ]
}
```

| Key | Default | Meaning |
|---|---|---|
| `host` | required | IP address or hostname of the matrix |
| `port` | `23` | Telnet control port (matrix web UI → System → IP Control) |
| `pollInterval` | `30` | Seconds between `GET OUT0 VS` polls (minimum 5) |
| `commandTimeout` | `4` | Seconds to wait for the matrix to confirm a switch before reporting failure |
| `inputCount` | `4` | Number of physical inputs on your matrix (2, 4, 8, 16) |
| `model` | `AC-MX Matrix` | Model string shown in the Home app accessory details |
| `outputs[].name` | required | Accessory name shown in the Home app |
| `outputs[].output` | required | Physical output number on the matrix |
| `outputs[].inputs[].name` | required | Input source name shown in the Home app |
| `outputs[].inputs[].input` | required | Physical input number on the matrix |
| `outputs[].inputs[].visible` | `true` | Show this input in the Home app input list |

Only list the outputs you want in HomeKit. Only list the inputs you want selectable; the rest are
created hidden.

## Pairing

HomeKit allows one Television per bridge, so every output is published as an **external accessory**.
They are **not** added when you pair the Homebridge bridge. In the Home app:

1. Tap **+** → **Add Accessory** → **More options…**
2. Pick the accessory (for example `Kitchen Video 1574`), enter the bridge PIN shown in the Homebridge log.
3. Repeat for each output.

## Siri

Siri cannot change a TV input directly; Apple only supports power and playback phrases for TV
accessories. Use a **HomeKit scene** per room and source (Home app → **+** → **Add Scene**, add the
output accessory, set its input). With scenes named like `Kitchen Video to xbox` you can say:

> "Hey Siri, set Kitchen Video to xbox"

Scenes live in HomeKit, so they work from HomePod, Apple TV and every family member's device.
If Siri on an iPhone hands the word "xbox" to the Xbox app, turn off *Siri & Search → Learn from
this App* for that app, or pick a different input name.

## How it talks to the matrix

The plugin speaks AVPro's published ASCII protocol over TCP port 23:

```
SET OUT2 VS IN1     route input 1 to output 2
GET OUT0 VS         ask for every output's route
OUT2 VS IN1         the matrix's reply / unsolicited notification
```

On the AC-MX-42X every reply is broadcast to all connected control sessions, which is what makes
live state possible. The plugin treats every `OUTn VS INm` line it sees as the truth, regardless of
who asked.

Official documents: [AC-MX-42X product page](https://www.avproglobal.com/products/ac-mx-42x),
[user manual](https://avproglobal.egnyte.com/dd/Nu02ZhtwAI),
[command list](https://avproglobal.egnyte.com/dd/ZTM7dvWzJW).

## Troubleshooting

* **"Matrix connection error" in the log**: check the IP, that IP Control is enabled on the matrix,
  and that nothing on the LAN blocks port 23. `telnet <ip> 23` then `GET OUT0 VS` should print the routes.
* **"no confirmation for OUTn VS INm"**: the matrix accepted the connection but did not switch.
  Confirm Switch Mode is *Matrix* and the input/output numbers exist on your model.
* **Tile shows "No Response"**: the plugin reports a communication failure on purpose while the
  matrix is unreachable, rather than guessing a state.
* **Renamed the plugin or moved Homebridge to a new host?** Accessory identities are derived from
  `host` and output number and are stable across upgrades; keep the `persist` folder when migrating.

## Development

```bash
npm install
npm run lint
npm run build
node test/fake-matrix-test.js   # offline protocol test against a fake matrix
```

## License

MIT © Mick Shaw
