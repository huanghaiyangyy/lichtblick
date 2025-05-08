import { MessageEvent } from "@lichtblick/suite";
import { Topic } from "@lichtblick/suite-base/players/types";

export interface RosPublisherInterface {
  initialize(rosMasterUri: string): Promise<void>;
  setupPublishers(topics: Topic[]): Promise<void>;
  publishMessage(messageEvent: MessageEvent): void;
  shutdown(): Promise<void>;
}
