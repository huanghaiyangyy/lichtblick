// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Terse to save space in layout. c = collapsed, e = expanded.
export enum NodeState {
  Collapsed = "c",
  Expanded = "e",
}

export type NodeExpansion = "all" | "none" | Record<string, NodeState>;

export type TopicEntry = {
  id: string; // Unique ID for each entry
  topicPath: string;
}

export type RawMessagesPanelConfig = {
  diffEnabled: boolean;
  diffMethod: "custom" | "previous message";
  diffTopicPath: string;
  expansion?: NodeExpansion;
  showFullMessageForDiff: boolean;
  topicPath: string;
  topicPaths: string[];
  fontSize: number | undefined;
};
