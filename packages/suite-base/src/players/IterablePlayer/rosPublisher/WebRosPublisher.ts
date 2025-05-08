import { MessageEvent } from "@lichtblick/suite";
import { RosPublisherInterface } from "./RosPublisher";
import Log from "@lichtblick/log";
import { Topic } from "@lichtblick/suite-base/players/types";

const log = Log.getLogger(__filename);

export class WebRosPublisher implements RosPublisherInterface {
  #ws: WebSocket | undefined;
  #publishers = new Map<string, boolean>(); // Track advertised topics
  #connected = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async initialize(rosMasterUri: string): Promise<void> {
    try {
      // Convert ROS master URI to WebSocket URI
      // Usually rosbridge runs on port 9090
      // const wsUri = rosMasterUri.replace(/^http:\/\//, 'ws://').replace(/:11311$/, ':9090');
      console.info(`ROS master URI: ${rosMasterUri}`);
      const wsUri = "ws://192.168.117.131:9090";

      this.#ws = new WebSocket(wsUri);

      return new Promise((resolve, reject) => {
        if (!this.#ws) return reject(new Error("Failed to create WebSocket"));

        this.#ws.onopen = () => {
          log.info(`Connected to rosbridge at ${wsUri}`);
          this.#connected = true;
          resolve();
        };

        this.#ws.onclose = () => {
          log.warn("Disconnected from rosbridge");
          this.#connected = false;
          this.#attemptReconnect(wsUri);
        };

        this.#ws.onerror = (error) => {
          log.error("WebSocket error:", error);
          reject(new Error("Failed to connect to rosbridge"));
        };

        // Set timeout for connection
        const timeout = setTimeout(() => {
          reject(new Error("Connection to rosbridge timed out"));
        }, 5000);

        this.#ws.onopen = () => {
          clearTimeout(timeout);
          this.#connected = true;
          log.info(`Connected to rosbridge at ${wsUri}`);
          resolve();
        };
      });
    } catch (error) {
      log.error("Failed to initialize web ROS publishing:", error);
      throw error;
    }
  }

  #attemptReconnect(wsUri: string): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
    }

    this.#reconnectTimer = setTimeout(() => {
      log.info("Attempting to reconnect to rosbridge...");
      this.#ws = new WebSocket(wsUri);

      this.#ws.onopen = () => {
        log.info("Reconnected to rosbridge");
        this.#connected = true;
        // Re-advertise topics
        this.#readvertiseTopics();
      };

      this.#ws.onclose = () => {
        this.#connected = false;
        this.#attemptReconnect(wsUri);
      };
    }, 3000);
  }

  async #readvertiseTopics(): Promise<void> {
    for (const topic of this.#publishers.keys()) {
      await this.#advertise(topic);
    }
  }

  async #advertise(topic: string, messageType?: string): Promise<void> {
    if (!this.#ws || !this.#connected) return;

    const advertiseMsg = {
      op: "advertise",
      topic,
      type: messageType || "std_msgs/String" // Default fallback
    };

    this.#ws.send(JSON.stringify(advertiseMsg)!);
    this.#publishers.set(topic, true);
  }

  async setupPublishers(topics: Topic[]): Promise<void> {
    for (const topic of topics) {
      if (!topic.schemaName || this.#publishers.has(topic.name)) continue;

      try {
        await this.#advertise(topic.name, this.#convertToRosbridgeType(topic.schemaName));
        log.info(`Advertised rosbridge topic: ${topic.name} (${topic.schemaName})`);
      } catch (error) {
        log.warn(`Failed to advertise topic ${topic.name}:`, error);
      }
    }
  }

  publishMessage(messageEvent: MessageEvent): void {
    if (!this.#ws || !this.#connected) return;

    const { topic, message } = messageEvent;

    if (!this.#publishers.has(topic)) {
      log.debug(`Topic ${topic} not advertised, skipping publish`);
      return;
    }

    try {
      // Convert Array to regular JavaScript array
      const processedMessage = this.#processTypedArrays(message);

      const publishMsg = {
        op: "publish",
        topic,
        msg: processedMessage
      };

      this.#ws.send(JSON.stringify(publishMsg)!);
    } catch (error) {
      log.warn(`Failed to publish message to ${topic}:`, error);
    }
  }

  #processTypedArrays(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Handle Float64Array and other typed arrays
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      return Array.from(obj as unknown as ArrayLike<unknown>);
    }

    // If it's an object or array, recurse into properties
    if (typeof obj === 'object') {
      const result: Record<string, any> = Array.isArray(obj) ? [] : {};

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.#processTypedArrays(obj[key]);
        }
      }

      return result;
    }

    // Return primitive values as is
    return obj;
  }

  async shutdown(): Promise<void> {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
    }

    if (!this.#ws) return;

    // Unadvertise all topics
    for (const topic of this.#publishers.keys()) {
      const unadvertiseMsg = {
        op: "unadvertise",
        topic
      };

      this.#ws.send(JSON.stringify(unadvertiseMsg)!);
    }

    this.#publishers.clear();
    this.#ws.close();
    this.#ws = undefined;
    this.#connected = false;
  }

  #convertToRosbridgeType(schemaName: string): string {
    // ROS messages in rosbridge typically use the format 'package/Type'
    // This is a simple conversion, might need more sophisticated logic
    return schemaName;
  }
}
