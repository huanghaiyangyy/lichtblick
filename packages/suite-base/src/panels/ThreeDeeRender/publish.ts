// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { MessageDefinition } from "@lichtblick/message-definition";
import { ros1, ros2galactic } from "@lichtblick/rosmsg-msgs-common";
import { fromDate } from "@lichtblick/rostime";
import { Point, makeCovarianceArray } from "@lichtblick/suite-base/util/geometry";

import { Pose } from "./transforms/geometry";
import { makePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";
import { IRenderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/IRenderer";

export const PublishRos1Datatypes = new Map<string, MessageDefinition>(
  (
    [
      "geometry_msgs/Point",
      "geometry_msgs/PointStamped",
      "geometry_msgs/Pose",
      "geometry_msgs/PoseStamped",
      "geometry_msgs/PoseWithCovariance",
      "geometry_msgs/PoseWithCovarianceStamped",
      "geometry_msgs/Quaternion",
      "std_msgs/Int32",
      "std_msgs/Header",
    ] as Array<keyof typeof ros1>
  ).map((type) => [type, ros1[type]]),
);

export const PublishRos2Datatypes = new Map<string, MessageDefinition>(
  (
    [
      "geometry_msgs/Point",
      "geometry_msgs/PointStamped",
      "geometry_msgs/Pose",
      "geometry_msgs/PoseStamped",
      "geometry_msgs/PoseWithCovariance",
      "geometry_msgs/PoseWithCovarianceStamped",
      "geometry_msgs/Quaternion",
      "std_msgs/Int32",
      "std_msgs/Header",
    ] as Array<keyof typeof ros2galactic>
  ).map((type) => [type, ros2galactic[type]]),
);

export function makePointMessage(point: Point, frameId: string): unknown {
  const time = fromDate(new Date());
  return {
    // seq is omitted since it is not present in ros2
    header: { stamp: time, frame_id: frameId },
    point: { x: point.x, y: point.y, z: 0 },
  };
}

export function makePoseMessage(pose: Pose, frameId: string): unknown {
  const time = fromDate(new Date());
  return {
    // seq is omitted since it is not present in ros2
    header: { stamp: time, frame_id: frameId },
    pose,
  };
}

export function makePoseEstimateMessage(
  pose: Pose,
  frameId: string,
  xDev: number,
  yDev: number,
  thetaDev: number,
): unknown {
  const time = fromDate(new Date());
  return {
    // seq is omitted since it is not present in ros2
    header: { stamp: time, frame_id: frameId },
    pose: {
      covariance: makeCovarianceArray(xDev, yDev, thetaDev),
      pose,
    },
  };
}

export function pointTransform(point: Point, originalFrame: string, targetFrame: string, renderer: IRenderer | undefined): Point {
  let transformedPoint = point;
  if (targetFrame !== originalFrame) {
    // Create a pose with just the position
    const sourcePose = makePose();
    sourcePose.position.x = point.x;
    sourcePose.position.y = point.y;
    sourcePose.position.z = point.z;

    // Target pose for the transformation
    const targetPose = makePose();

    // Transform from follow frame to publish frame
    const transformed = renderer?.transformTree.apply(
      targetPose,
      sourcePose,
      targetFrame,
      originalFrame,
      originalFrame,
      renderer.currentTime ?? 0n,
      renderer.currentTime ?? 0n
    );

    if (transformed) {
      // Use the transformed point
      transformedPoint = {
        x: targetPose.position.x,
        y: targetPose.position.y,
        z: targetPose.position.z
      };
    } else {
      console.warn(`Could not transform from ${originalFrame} to ${targetFrame}`);
    }
  }
  return transformedPoint;
}

export function poseTransform(pose: Pose, originalFrame: string, targetFrame: string, renderer: IRenderer | undefined): Pose {
  let transformedPose = pose;

  if (targetFrame !== originalFrame) {
    // Create source pose
    const sourcePose = makePose();
    sourcePose.position.x = pose.position.x;
    sourcePose.position.y = pose.position.y;
    sourcePose.position.z = pose.position.z;
    sourcePose.orientation.x = pose.orientation.x;
    sourcePose.orientation.y = pose.orientation.y;
    sourcePose.orientation.z = pose.orientation.z;
    sourcePose.orientation.w = pose.orientation.w;

    // Target pose
    const targetPose = makePose();

    const transformed = renderer?.transformTree.apply(
      targetPose,
      sourcePose,
      targetFrame,
      originalFrame,
      originalFrame,
      renderer.currentTime ?? 0n,
      renderer.currentTime ?? 0n
    );

    if (transformed) {
      transformedPose = {
        position: {
          x: targetPose.position.x,
          y: targetPose.position.y,
          z: targetPose.position.z
        },
        orientation: {
          x: targetPose.orientation.x,
          y: targetPose.orientation.y,
          z: targetPose.orientation.z,
          w: targetPose.orientation.w
        }
      };
    } else {
      console.warn(`Could not transform from ${originalFrame} to ${targetFrame}`);
    }
  }
  return transformedPose;
}
