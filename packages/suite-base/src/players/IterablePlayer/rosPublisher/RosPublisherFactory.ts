import { RosPublisherInterface } from "./RosPublisher";
import { DesktopRosPublisher } from "./DesktopRosPublisher";
import { WebRosPublisher } from "./WebRosPublisher";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

export async function createRosPublisher(): Promise<RosPublisherInterface> {
  if (await isDesktopApp()) {
    return new DesktopRosPublisher();
  } else {
    return new WebRosPublisher();
  }
}
