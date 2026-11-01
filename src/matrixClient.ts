import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import type { Logging } from 'homebridge';

/**
 * Minimal client for the AVPro Edge AC-MX family text protocol on TCP port 23
 * (official command list: SET OUTx VS INy, GET OUTx VS, x=0 means all outputs).
 *
 * Observed on an AC-MX-42X, firmware NET MCU V1.11 / MAIN MCU V0.97 (2026-10-31):
 *   - No banner, no login when "rs232telnetsecure" is false.
 *   - Commands are ASCII lines terminated by \r\n. Optional "A00 " address prefix.
 *   - "GET OUT0 VS"  -> "OUT1 VS IN2\r\nOUT2 VS IN2\r\n"   (all outputs)
 *   - "GET OUT1 VS"  -> "OUT1 VS IN2\r\n"
 *   - "SET OUTn VS INm" is what the web UI sends to route output n to input m.
 *   - Every response line is broadcast to ALL connected telnet sessions, so we
 *     never match replies by request order; we parse every "OUTn VS INm" line
 *     we see as authoritative state, regardless of who asked.
 */
export interface RouteState {
  [output: number]: number; // output -> input
}

interface MatrixEvents {
  route: [output: number, input: number];
  connected: [];
  disconnected: [];
}

export class MatrixClient extends EventEmitter<MatrixEvents> {
  private socket: Socket | null = null;
  private buffer = '';
  private reconnectDelayMs = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private _connected = false;
  public readonly state: RouteState = {};

  constructor(
    private readonly log: Logging,
    private readonly host: string,
    private readonly port: number,
    private readonly pollIntervalMs: number,
  ) {
    super();
  }

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.socket?.destroy();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.log.debug(`Connecting to matrix at ${this.host}:${this.port}`);
    const sock = new Socket();
    this.socket = sock;
    sock.setKeepAlive(true, 15000);
    sock.setNoDelay(true);
    sock.setTimeout(0);

    sock.once('connect', () => {
      this._connected = true;
      this.reconnectDelayMs = 1000;
      this.buffer = '';
      this.log.info(`Connected to matrix ${this.host}:${this.port}`);
      this.emit('connected');
      this.requestAllRoutes();
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.requestAllRoutes(), this.pollIntervalMs);
    });
    sock.on('data', (chunk: Buffer) => this.onData(chunk.toString('ascii')));
    sock.once('error', (err: Error) => {
      this.log.warn(`Matrix connection error: ${err.message}`);
    });
    sock.once('close', () => {
      const wasConnected = this._connected;
      this._connected = false;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
      if (wasConnected) this.log.warn('Matrix connection closed');
      this.emit('disconnected');
      this.scheduleReconnect();
    });
    sock.connect(this.port, this.host);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.log.debug(`Reconnecting in ${this.reconnectDelayMs} ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60000);
  }

  private onData(text: string): void {
    this.buffer += text;
    // Device terminates lines with \r\n; be tolerant of either.
    const parts = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.trim();
      if (!line) continue;
      this.log.debug(`matrix << ${line}`);
      // "OUT1 VS IN2" — video routing state. Ignore "AS" (audio) and other lines.
      const m = /^OUT(\d+)\s+VS\s+IN(\d+)$/i.exec(line);
      if (m) {
        const out = parseInt(m[1], 10);
        const inp = parseInt(m[2], 10);
        if (out === 0) continue;
        this.state[out] = inp;
        this.emit('route', out, inp);
      }
    }
  }

  private write(cmd: string): boolean {
    if (!this.socket || !this._connected) return false;
    this.log.debug(`matrix >> ${cmd}`);
    this.socket.write(`${cmd}\r\n`);
    return true;
  }

  requestAllRoutes(): void {
    this.write('GET OUT0 VS');
  }

  /**
   * Route `output` to `input` and resolve only once the device reports
   * "OUT<output> VS IN<input>". Rejects on timeout or if disconnected.
   */
  setRoute(output: number, input: number, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._connected) {
        reject(new Error('matrix not connected'));
        return;
      }
      const pending: { timer?: NodeJS.Timeout; onRoute?: (o: number, i: number) => void } = {};
      const cleanup = () => {
        if (pending.timer) clearTimeout(pending.timer);
        if (pending.onRoute) this.off('route', pending.onRoute);
      };
      pending.onRoute = (o: number, i: number) => {
        if (o === output && i === input) {
          cleanup();
          resolve();
        }
      };
      pending.timer = setTimeout(() => {
        cleanup();
        // Ask for truth so the accessory can resync to whatever actually happened.
        this.requestAllRoutes();
        reject(new Error(`no confirmation for OUT${output} VS IN${input} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.on('route', pending.onRoute);
      if (!this.write(`SET OUT${output} VS IN${input}`)) {
        cleanup();
        reject(new Error('write failed: not connected'));
        return;
      }
      // The device echoes the new route ~600 ms after a SET; an explicit GET confirms sooner.
      // Either reply arrives as "OUTn VS INm" and satisfies onRoute.
      setTimeout(() => this.write(`GET OUT${output} VS`), 300);
    });
  }
}
