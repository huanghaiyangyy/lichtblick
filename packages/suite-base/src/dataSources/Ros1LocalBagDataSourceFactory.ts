// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerIterableSource,
} from "@lichtblick/suite-base/players/IterablePlayer";
import { Player } from "@lichtblick/suite-base/players/types";
import { RosNode } from "@lichtblick/ros1";
import OsContextSingleton from "@lichtblick/suite-base/OsContextSingleton";

class Ros1LocalBagDataSourceFactory implements IDataSourceFactory {
  public id = "ros1-local-bagfile";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "ROS 1 Bag";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [".bag"];

  public formConfig = {
    fields: [
      {
        id: "enableRosPublishing",
        label: "Publish to ROS network",
        defaultValue: "true",
      },
      {
        id: "rosMasterUri",
        label: "ROS_MASTER_URI",
        defaultValue: OsContextSingleton?.getEnvVar("ROS_MASTER_URI") ?? "http://localhost:11311",
        description: "Tells ROS nodes where they can locate the master",
      },
      {
        id: "rosHostname",
        label: "ROS_HOSTNAME",
        defaultValue: OsContextSingleton
          ? RosNode.GetRosHostname(
              OsContextSingleton.getEnvVar,
              OsContextSingleton.getHostname,
              OsContextSingleton.getNetworkInterfaces,
            )
          : "localhost",
        description: "Acts as the declared network address of a ROS node or tool",
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const file = args.file;
    if (!file) {
      return;
    }

    const source = new WorkerIterableSource({
      initWorker: () => {
        return new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/BagIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { file },
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      name: file.name,
      sourceId: this.id,
      enableRosPublishing: true, //args.params?.enableRosPublishing === "true",
      rosMasterUri: args.params?.rosMasterUri as string | undefined,
      rosHostname: args.params?.rosHostname as string | undefined,
    });
  }
}

export default Ros1LocalBagDataSourceFactory;
