import { MessageEvent } from "@lichtblick/suite";
import { RosPublisherInterface } from "./RosPublisher";
import Log from "@lichtblick/log";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import rosDatatypesToMessageDefinition from "@lichtblick/suite-base/util/rosDatatypesToMessageDefinition";
import { Topic } from "@lichtblick/suite-base/players/types";

const log = Log.getLogger(__filename);

export class DesktopRosPublisher implements RosPublisherInterface {
  #rosNode: any;
  #rosPublishers = new Map<string, any>();
  #rosDatatypes: RosDatatypes = new Map();

  async initialize(rosMasterUri: string): Promise<void> {
    try {
      // Import necessary modules
      const { RosNode } = await import("@lichtblick/ros1");
      const { Sockets } = await import("@lichtblick/electron-socket/renderer");
      const OsContextSingleton = await import("@lichtblick/suite-base/OsContextSingleton").then(m => m.default);

      if (!OsContextSingleton) {
        throw new Error("OsContext not available");
      }

      const hostname = RosNode.GetRosHostname(
        OsContextSingleton.getEnvVar,
        OsContextSingleton.getHostname,
        OsContextSingleton.getNetworkInterfaces
      );

      const net = await Sockets.Create();
      const httpServer = await net.createHttpServer();
      const tcpSocketCreate = async (options: { host: string; port: number }) => {
        return await net.createSocket(options.host, options.port);
      };
      const tcpServer = await net.createServer();

      // Configure server
      let listenHostname = "0.0.0.0";
      if (hostname === "localhost") {
        listenHostname = "localhost";
      }
      await tcpServer.listen(undefined, listenHostname, 10);

      // Create ROS node
      this.#rosNode = new RosNode({
        name: `/foxglove_bag_publisher_${OsContextSingleton.pid}`,
        hostname,
        pid: OsContextSingleton.pid,
        rosMasterUri,
        httpServer: httpServer as unknown as any,
        tcpSocketCreate,
        tcpServer,
        log: Log.getLogger("ROS1"),
      });

      // Start the ROS node
      await this.#rosNode.start();
      log.info(`ROS publisher initialized. Connected to ${rosMasterUri}`);
    } catch (error) {
      log.error("Failed to initialize desktop ROS publishing:", error);
      throw error;
    }
  }

  async setupPublishers(topics: Topic[]): Promise<void> {
    if (!this.#rosNode) {
      throw new Error("ROS node not initialized");
    }

    for (const topic of topics) {
      if (this.#rosPublishers.has(topic.name) || !topic.schemaName) {
        continue;
      }

      try {
        // Get message definition
        const msgdef = rosDatatypesToMessageDefinition(this.#rosDatatypes, topic.schemaName);

        // Advertise topic
        const publisher = await this.#rosNode.advertise({
          topic: topic.name,
          dataType: topic.schemaName,
          messageDefinition: msgdef,
        });

        this.#rosPublishers.set(topic.name, publisher);
        log.info(`Advertised ROS topic: ${topic.name} (${topic.schemaName})`);
      } catch (error) {
        log.warn(`Failed to advertise topic ${topic.name}:`, error);
      }
    }
  }

  publishMessage(messageEvent: MessageEvent): void {
    if (!this.#rosNode) return;

    const { topic, message } = messageEvent;
    const publisher = this.#rosPublishers.get(topic);

    if (publisher) {
      try {
        void this.#rosNode.publish(topic, message);
      } catch (error) {
        log.warn(`Failed to publish message to ${topic}:`, error);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (!this.#rosNode) return;

    // Unadvertise all topics
    for (const topic of this.#rosPublishers.keys()) {
      this.#rosNode.unadvertise(topic);
    }
    this.#rosPublishers.clear();

    // Shut down the ROS node
    this.#rosNode.shutdown();
    this.#rosNode = undefined;
  }

  setDatatypes(datatypes: RosDatatypes): void {
    this.#rosDatatypes = datatypes;
  }
}
