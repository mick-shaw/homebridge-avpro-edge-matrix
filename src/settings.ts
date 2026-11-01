/** Name used in config.json "platform" field. */
export const PLATFORM_NAME = 'AVProMatrix';
/** Must match package.json "name". */
export const PLUGIN_NAME = 'homebridge-avpro-edge-matrix';
/**
 * Seed used for accessory UUIDs. Kept at the original (pre-rename) package name on purpose:
 * changing it would change every accessory's HomeKit identity and force users to re-pair.
 */
export const UUID_SEED = 'homebridge-avpro-mx42x';

export interface InputConfig {
  /** Name shown in Home app / spoken to Siri, e.g. "xbox" */
  name: string;
  /** Physical matrix input number (1-4) */
  input: number;
  /** Show in Home app input list (default true). Hidden inputs still track state. */
  visible?: boolean;
}

export interface OutputConfig {
  /** Accessory name, e.g. "Kitchen Video" */
  name: string;
  /** Physical matrix output number (1-2) */
  output: number;
  inputs: InputConfig[];
}

export interface MatrixPlatformConfig {
  platform: string;
  name?: string;
  host: string;
  port?: number;
  /** Seconds between GET OUT0 VS polls (default 30). */
  pollInterval?: number;
  /** Seconds to wait for the device to confirm a SET (default 4). */
  commandTimeout?: number;
  /** Total matrix input count (default 4). Unmapped inputs are created hidden so state stays accurate. */
  inputCount?: number;
  /** Model string shown in the Home app accessory details (default "AC-MX Matrix"). */
  model?: string;
  outputs: OutputConfig[];
}
