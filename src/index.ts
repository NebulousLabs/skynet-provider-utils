/**
 * Generic provider code.
 */

import { ChildHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import type { ProviderMetadata, SkappInfo } from "skynet-interface-utils";

export abstract class Provider<T> {
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

  protected async connectPopup(skappInfo: SkappInfo): Promise<void> {
    // Wait for connection info from the connector.

    const receivedConnectionInfo: string = await new Promise((resolve, reject) => {
      const handleEvent = ({ key, newValue }: StorageEvent) => {
        window.removeEventListener("storage", handleEvent);

        if (!key || !newValue) {
          reject("Storage event data not found");
          return;
        }
        window.localStorage.removeItem(key);

        if (key === "success") {
          resolve(newValue);
        } else if (key === "closed") {
          reject("Window was closed");
        } else {
          // Key should be 'error'.
          if (key !== "error") {
            reject("Unknown key received");
          }
          reject(newValue);
        }
      };

      window.addEventListener("storage", handleEvent);
    });
    const connectionInfo = JSON.parse(receivedConnectionInfo);
    // TODO: Validate the connectionInfo using required abstract function and send an error if invalid.

    // Set the skapp as connected.

    await this.saveConnectionInfo(connectionInfo);
    this.isProviderConnected = true;
  }

  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider.
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
