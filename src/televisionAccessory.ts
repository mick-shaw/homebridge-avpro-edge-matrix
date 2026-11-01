import type { API, Logging, PlatformAccessory, Service, CharacteristicValue } from 'homebridge';
import type { MatrixClient } from './matrixClient';
import type { OutputConfig } from './settings';

/**
 * One HomeKit Television accessory per matrix output.
 * ActiveIdentifier == physical matrix input number (1..N), so no mapping table
 * is needed between HomeKit and the device.
 */
export class MatrixOutputAccessory {
  private readonly tvService: Service;
  private readonly inputServices = new Map<number, Service>();
  private currentInput = 0;

  constructor(
    private readonly log: Logging,
    private readonly api: API,
    public readonly accessory: PlatformAccessory,
    private readonly client: MatrixClient,
    private readonly cfg: OutputConfig,
    private readonly inputCount: number,
    private readonly commandTimeoutMs: number,
    model: string,
  ) {
    const { Service, Characteristic } = api.hap;

    accessory.category = api.hap.Categories.TELEVISION;

    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'AVPro Edge')
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, `OUT${cfg.output}`)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.1');

    this.tvService = accessory.getService(Service.Television)
      ?? accessory.addService(Service.Television, cfg.name, 'tv');
    this.tvService
      .setCharacteristic(Characteristic.ConfiguredName, cfg.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Routing only: the accessory is always "on". We accept power writes without
    // acting on them so Home/Siri never error, and report ACTIVE on the next read.
    this.tvService.getCharacteristic(Characteristic.Active)
      .onGet(() => Characteristic.Active.ACTIVE)
      .onSet(async () => {
        setTimeout(() => this.tvService.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE), 500);
      });

    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.getActiveIdentifier())
      .onSet((v) => this.setActiveIdentifier(v));

    // RemoteKey is mandatory on the Television service; we have nothing to do with it.
    this.tvService.getCharacteristic(Characteristic.RemoteKey).onSet(() => { /* no-op */ });

    // Create one InputSource per physical input so any device state is representable.
    const byInput = new Map(cfg.inputs.map((i) => [i.input, i]));
    for (let n = 1; n <= inputCount; n++) {
      const mapped = byInput.get(n);
      const name = mapped?.name ?? `Input ${n}`;
      const visible = mapped ? mapped.visible !== false : false;
      const subtype = `input${n}`;
      const svc = accessory.getServiceById(Service.InputSource, subtype)
        ?? accessory.addService(Service.InputSource, name, subtype);
      svc
        .setCharacteristic(Characteristic.Identifier, n)
        .setCharacteristic(Characteristic.ConfiguredName, name)
        .setCharacteristic(Characteristic.Name, name)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.HDMI)
        .setCharacteristic(Characteristic.CurrentVisibilityState,
          visible ? Characteristic.CurrentVisibilityState.SHOWN : Characteristic.CurrentVisibilityState.HIDDEN)
        .setCharacteristic(Characteristic.TargetVisibilityState,
          visible ? Characteristic.TargetVisibilityState.SHOWN : Characteristic.TargetVisibilityState.HIDDEN);
      // Keep user renames in the Home app from drifting the device-side name silently.
      svc.getCharacteristic(Characteristic.ConfiguredName).onSet((val) => {
        this.log.info(`[${cfg.name}] Home app renamed input ${n} to "${val}" (config.json still says "${name}")`);
      });
      svc.getCharacteristic(Characteristic.TargetVisibilityState).onSet((val) => {
        svc.updateCharacteristic(Characteristic.CurrentVisibilityState, val as number);
      });
      this.tvService.addLinkedService(svc);
      this.inputServices.set(n, svc);
    }

    // Remove stale InputSource services if inputCount shrank.
    for (const s of accessory.services.filter((s) => s.UUID === Service.InputSource.UUID)) {
      const id = s.getCharacteristic(Characteristic.Identifier).value as number;
      if (!this.inputServices.has(id)) accessory.removeService(s);
    }

    client.on('route', (out, inp) => {
      if (out !== cfg.output) return;
      if (inp !== this.currentInput) {
        this.log.info(`[${cfg.name}] OUT${out} is now IN${inp} (${this.inputName(inp)})`);
      }
      this.currentInput = inp;
      this.tvService.updateCharacteristic(Characteristic.ActiveIdentifier, inp);
    });
    const known = client.state[cfg.output];
    if (known) this.currentInput = known;
  }

  private inputName(n: number): string {
    return this.cfg.inputs.find((i) => i.input === n)?.name ?? `Input ${n}`;
  }

  private getActiveIdentifier(): CharacteristicValue {
    if (!this.client.connected) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    // 0 is not a valid identifier; before first poll, fall back to input 1.
    return this.currentInput || 1;
  }

  private async setActiveIdentifier(value: CharacteristicValue): Promise<void> {
    const input = value as number;
    const { HapStatusError, HAPStatus, Characteristic } = this.api.hap;
    if (!this.inputServices.has(input)) {
      throw new HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    this.log.info(`[${this.cfg.name}] request OUT${this.cfg.output} -> IN${input} (${this.inputName(input)})`);
    try {
      await this.client.setRoute(this.cfg.output, input, this.commandTimeoutMs);
      this.log.info(`[${this.cfg.name}] confirmed OUT${this.cfg.output} VS IN${input}`);
    } catch (e) {
      this.log.error(`[${this.cfg.name}] switch failed: ${(e as Error).message}`);
      // Revert HomeKit to the last device-confirmed input so the Home app doesn't lie.
      setTimeout(() => {
        if (this.currentInput) this.tvService.updateCharacteristic(Characteristic.ActiveIdentifier, this.currentInput);
      }, 100);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
