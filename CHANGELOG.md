# Changelog

## 1.0.0 (2026-11-01)

Initial release.

* One HomeKit Television accessory per matrix output, published as an external accessory.
* One Input Source per physical input; unnamed inputs are created hidden so the device state is always representable.
* Persistent telnet (port 23) connection with automatic reconnect and exponential back-off.
* Every `OUTn VS INm` line from the matrix is treated as authoritative, so changes made from the front panel, web UI or another controller appear in HomeKit without polling; a periodic `GET OUT0 VS` poll is kept as a safety net.
* A switch is reported to HomeKit as successful only after the matrix confirms the new route.
* Tested on an AC-MX-42X (NET MCU 1.11 / MAIN MCU 0.97). The routing commands are shared across the AC-MX family.
