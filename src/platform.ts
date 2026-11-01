import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { MatrixClient } from './matrixClient';
import { MatrixOutputAccessory } from './televisionAccessory';
import { PLATFORM_NAME, PLUGIN_NAME, UUID_SEED, type MatrixPlatformConfig } from './settings';

/**
 * HomeKit allows only ONE Television service per accessory, and Homebridge's
 * bridge can only carry one TV, so each output is published as an EXTERNAL
 * accessory (api.publishExternalAccessories). External accessories are not
 * cached by Homebridge and are paired individually in the Home app.
 */
export class AVProMatrixPlatform implements DynamicPlatformPlugin {
  private readonly cfg: MatrixPlatformConfig;
  private client!: MatrixClient;

  constructor(private readonly log: Logging, config: PlatformConfig, private readonly api: API) {
    this.cfg = config as MatrixPlatformConfig;
    if (!this.cfg.host || !Array.isArray(this.cfg.outputs) || this.cfg.outputs.length === 0) {
      this.log.error('Config needs "host" and at least one entry in "outputs". Platform disabled.');
      return;
    }
    api.on('didFinishLaunching', () => this.launch());
    api.on('shutdown', () => this.client?.stop());
  }

  /** Called for cached accessories; we publish externally so there are none. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Ignoring cached accessory ${accessory.displayName} (external accessories are not cached)`);
  }

  private launch(): void {
    const port = this.cfg.port ?? 23;
    const pollMs = Math.max(5, this.cfg.pollInterval ?? 30) * 1000;
    const cmdTimeoutMs = Math.max(1, this.cfg.commandTimeout ?? 4) * 1000;
    const inputCount = this.cfg.inputCount ?? 4;
    const model = this.cfg.model ?? 'AC-MX Matrix';

    this.client = new MatrixClient(this.log, this.cfg.host, port, pollMs);

    const accessories: PlatformAccessory[] = [];
    for (const out of this.cfg.outputs) {
      const uuid = this.api.hap.uuid.generate(`${UUID_SEED}:${this.cfg.host}:OUT${out.output}`);
      const accessory = new this.api.platformAccessory(out.name, uuid, this.api.hap.Categories.TELEVISION);
      new MatrixOutputAccessory(this.log, this.api, accessory, this.client, out, inputCount, cmdTimeoutMs, model);
      accessories.push(accessory);
      this.log.info(`Publishing "${out.name}" for matrix OUT${out.output} with inputs ` +
        out.inputs.map((i) => `IN${i.input}="${i.name}"`).join(', '));
    }
    this.api.publishExternalAccessories(PLUGIN_NAME, accessories);
    this.client.start();
  }
}

export { PLATFORM_NAME };
