/**
 * Generic provider code.
 */

import { ChildHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import { defaultWindowTimeout, emitStorageEvent, listenForStorageEvent, monitorOtherListener, ProviderMetadata, SkappInfo } from "skynet-interface-utils";

/**
 * Base provider class that handles communication with the bridge.
 *
 * Note that implementers should implement required abstract methods in addition to a connector at the location specified by metadata.relativeConnectorPath.
 */
export abstract class BaseProvider<T> {
  isProviderConnected: boolean;
  methods: {
    [index: string]: Function;
  };

  protected parentConnection: Promise<Connection>;

  constructor(public metadata: ProviderMetadata) {
    if (typeof Storage == "undefined") {
      throw new Error("Browser does not support web storage");
    }

    // Set the provider info.

    this.isProviderConnected = false;
    this.methods = {};

    // Enable communication with parent skapp.

    const methods = {
      callInterface: async (method: string) => this.callInterface(method),
      connectPopup: async (skappInfo: SkappInfo) => this.connectPopup(skappInfo),
      connectSilent: async (skappInfo: SkappInfo) => this.connectSilent(skappInfo),
      disconnect: async () => this.disconnect(),
      getProviderMetadata: async () => this.getProviderMetadata(),
    };
    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: window.parent,
      remoteOrigin: "*",
    });
    this.parentConnection = ChildHandshake(messenger, methods);
  }

  // ===================
  // Public Provider API
  // ===================

  protected async callInterface(method: string): Promise<unknown> {
    if (!this.isProviderConnected) {
      throw new Error("Provider not connected, cannot access interface");
    }

    if (!this.methods[method]) {
      throw new Error(`Unimplemented interface method. Method: '${method}'`);
    }
    return this.methods[method]();
  }

  /**
   * Connects by waiting for connection info from the connector
   *
   * 1. The router has already launched the connector and the bridge is now calling connectPopup() on the provider.
   *
   * 2. The provider waits for the connection info from the connector.
   *
   * 3. The provider sets the skapp as connected and successfully resolves the promise.
   */
  protected async connectPopup(_skappInfo: SkappInfo): Promise<void> {
    // Event listener that waits for connection info from the connector.
    const { promise: promiseConnectionInfo, controller: controllerConnectionInfo } = listenForStorageEvent(
      "connector-connection-info"
    );
    // Kick off another event listener along with the first one as the connector window may still be closed or an error may occur, and we need to handle that.
    const { promise: promiseLong, controller: controllerLong } = listenForStorageEvent("connector");
    // Start the connector pinger.
    const { promise: promisePing, controller: controllerPing } = monitorOtherListener(
      "provider",
      "connector",
      defaultWindowTimeout
    );

    const promise: Promise<void> = new Promise(async (resolve, reject) => {
      // Make this promise run in the background and reject on window close or any errors.
      promiseLong.catch((err: string) => {
        // Don't emit an error to the connector, it should close on its own on error.
        reject(err);
      });
      promisePing.catch(() => {
        reject("Connector timed out");
      });

      // Wait for connection info from the connector.

      let connectionInfo;
      try {
        const receivedConnectionInfo = await promiseConnectionInfo;
        connectionInfo = JSON.parse(receivedConnectionInfo);
        // TODO: Validate the connectionInfo using required abstract function and send an error if invalid.
      } catch (err) {
        // Send an error to the connector before throwing.
        emitStorageEvent("provider", "error", err);
        reject(err);
        return;
      }

      // Set the skapp as connected.

      await this.saveConnectionInfo(connectionInfo);
      this.isProviderConnected = true;
      resolve();
    });

    return promise
      .catch((err) => {
        throw err;
      })
      .finally(() => {
        // Clean up the event listeners and promises.
        controllerConnectionInfo.cleanup();
        controllerLong.cleanup();
        controllerPing.cleanup();
      });
  }

  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider in this browser and if the skapp is permissioned.
   */
  protected async connectSilent(skappInfo: SkappInfo): Promise<void> {
    // Check if user is connected already.

    const connectionInfo = await this.fetchConnectionInfo();
    if (!connectionInfo) {
      throw new Error("Saved connection info not found");
    }

    // Check if skapp is permissioned.

    const permission = await this.fetchSkappPermissions(connectionInfo, skappInfo);
    if (!permission) {
      throw new Error("Skapp not permissioned");
    }

    this.isProviderConnected = true;
  }

  /**
   * Disconnects the provider by clearing any saved connection info.
   */
  protected async disconnect(): Promise<void> {
    await this.clearConnectionInfo();
    this.isProviderConnected = false;
  }

  protected async getProviderMetadata(): Promise<ProviderMetadata> {
    return this.metadata;
  }

  //=================
  // Internal Methods
  // ================

  // =========================
  // Required Provider Methods
  // =========================

  protected abstract clearConnectionInfo(): Promise<void>;

  protected abstract fetchConnectionInfo(): Promise<T | null>;

  protected abstract fetchSkappPermissions(connectionInfo: T, skappInfo: SkappInfo): Promise<boolean | null>;

  protected abstract saveConnectionInfo(connectionInfo: T): Promise<T>;
}
