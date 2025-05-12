// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactHoverObserver from "react-hover-observer";
import { makeStyles } from "tss-react/mui";

import { parseMessagePath, MessagePathStructureItem, MessagePath } from "@lichtblick/message-path";
import { Immutable, SettingsTreeAction } from "@lichtblick/suite";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import useGetItemStringWithTimezone from "@lichtblick/suite-base/components/JsonTree/useGetItemStringWithTimezone";
import {
  messagePathStructures,
  traverseStructure,
} from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { useMessageDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useMessageDataItem";
import Panel from "@lichtblick/suite-base/components/Panel";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import Stack from "@lichtblick/suite-base/components/Stack";
import { Toolbar } from "@lichtblick/suite-base/panels/RawMessageList/Toolbar";
import {
  DiffObject,
} from "@lichtblick/suite-base/panels/RawMessageList/getDiff";
import { Topic } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";
import { useJsonTreeTheme } from "@lichtblick/suite-base/util/globalConstants";

import DiffStats from "./DiffStats";
import Value from "./Value";
import {
  PREV_MSG_METHOD,
  CUSTOM_METHOD,
  FONT_SIZE_OPTIONS,
  PATH_NAME_AGGREGATOR,
} from "./constants";
import {
  ValueAction,
  getStructureItemForPath,
  getValueActionForValue,
} from "./getValueActionForValue";
import { NodeState, RawMessagesPanelConfig } from "./types";
import { DATA_ARRAY_PREVIEW_LIMIT, generateDeepKeyPaths, toggleExpansion } from "./utils";
import { TopicEntryWithOutput } from "@lichtblick/suite-base/panels/RawMessageList/TopicEntryWithOutput";
import { Box } from "@mui/material"
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

type Props = {
  config: Immutable<RawMessagesPanelConfig>;
  saveConfig: SaveConfig<RawMessagesPanelConfig>;
};

const isSingleElemArray = (obj: unknown): obj is unknown[] => {
  if (!Array.isArray(obj)) {
    return false;
  }
  return obj.filter((a) => a != undefined).length === 1;
};

const dataWithoutWrappingArray = (data: unknown) => {
  return isSingleElemArray(data) && typeof data[0] === "object" ? data[0] : data;
};

export const getSingleValue = (data: unknown, queriedData: MessagePathDataItem[]): unknown => {
  if (!isSingleElemArray(data)) {
    return data;
  }

  if (queriedData[0]?.constantName == undefined) {
    return data[0];
  }

  return `${data[0]} (${queriedData[0]?.constantName})`;
};

const useStyles = makeStyles()((theme) => ({
  topic: {
    fontFamily: theme.typography.body1.fontFamily,
    fontFeatureSettings: `${theme.typography.fontFeatureSettings}, "zero"`,
  },
  hoverObserver: {
    display: "inline-flex",
    alignItems: "center",
  },
  topicEntry: {
    marginBottom: theme.spacing(1),
    "&:last-child": {
      marginBottom: 0,
    }
  },
  topicEntriesContainer: {
    minHeight: "200px",
  },
  draggableItem: {
    marginBottom: theme.spacing(0.1),
    borderRadius: theme.shape.borderRadius,
    transition: 'background-color 0.2s ease',
  },
  dragging: {
    backgroundColor: theme.palette.action.hover,
  },
}));

function RawMessageList(props: Props) {
  const { classes, cx } = useStyles();
  const jsonTreeTheme = useJsonTreeTheme();
  const { config, saveConfig } = props;
  const { openSiblingPanel } = usePanelContext();
  const { topicPath, diffMethod, diffTopicPath, diffEnabled, fontSize } =
    config;
  const { topics, datatypes } = useDataSourceInfo();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { setMessagePathDropConfig } = usePanelContext();

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.length !== 1) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "replace" };
      },
      handleDrop(paths) {
        const path = paths[0];
        if (path) {
          saveConfig({ topicPath: path.path });
          setExpansion("none");
        }
      },
    });
  }, [setMessagePathDropConfig, saveConfig]);

  const defaultGetItemString = useGetItemStringWithTimezone();
  const getItemString = useMemo(
    () =>
      diffEnabled
        ? (_type: string, data: DiffObject, itemType: React.ReactNode) => (
            <DiffStats data={data} itemType={itemType} />
          )
        : defaultGetItemString,
    [defaultGetItemString, diffEnabled],
  );

  const topicRosPath: MessagePath | undefined = useMemo(
    () => parseMessagePath(topicPath),
    [topicPath],
  );
  const topic: Topic | undefined = useMemo(
    () => topicRosPath && topics.find(({ name }) => name === topicRosPath.topicName),
    [topicRosPath, topics],
  );

  const structures = useMemo(() => messagePathStructures(datatypes), [datatypes]);

  const rootStructureItem: MessagePathStructureItem | undefined = useMemo(() => {
    if (!topic || !topicRosPath || topic.schemaName == undefined) {
      return;
    }
    return traverseStructure(structures[topic.schemaName], topicRosPath.messagePath).structureItem;
  }, [structures, topic, topicRosPath]);

  const [expansion, setExpansion] = useState(config.expansion);

  // Pass an empty path to useMessageDataItem if our path doesn't resolve to a valid topic to avoid
  // spamming the message pipeline with useless subscription requests.
  const matchedMessages = useMessageDataItem(topic ? topicPath : "", { historySize: 2 });

  const currTickObj = matchedMessages[matchedMessages.length - 1];
  const prevTickObj = matchedMessages[matchedMessages.length - 2];

  const inTimetickDiffMode = diffEnabled && diffMethod === PREV_MSG_METHOD;
  const baseItem = inTimetickDiffMode ? prevTickObj : currTickObj;

  const nodes = useMemo(() => {
    if (baseItem) {
      const data = dataWithoutWrappingArray(baseItem.queriedData.map(({ value }) => value));
      return generateDeepKeyPaths(data);
    } else {
      return new Set<string>();
    }
  }, [baseItem]);

  const canExpandAll = useMemo(() => {
    if (expansion === "none") {
      return true;
    }
    if (expansion === "all") {
      return false;
    }
    if (
      typeof expansion === "object" &&
      Object.values(expansion).some((v) => v === NodeState.Collapsed)
    ) {
      return true;
    } else {
      return false;
    }
  }, [expansion]);

  const onTopicPathChange = useCallback(
    (newTopicPath: string) => {
      setExpansion("none");
      saveConfig({ topicPath: newTopicPath });
    },
    [saveConfig],
  );

  const onDiffTopicPathChange = useCallback(
    (newDiffTopicPath: string) => {
      saveConfig({ diffTopicPath: newDiffTopicPath });
    },
    [saveConfig],
  );

  const onToggleDiff = useCallback(() => {
    saveConfig({ diffEnabled: !diffEnabled });
  }, [diffEnabled, saveConfig]);

  const onToggleExpandAll = useCallback(() => {
    setExpansion(canExpandAll ? "all" : "none");
  }, [canExpandAll]);

  const onLabelClick = useCallback(
    (keypath: (string | number)[]) => {
      setExpansion((old) =>
        toggleExpansion(old ?? "none", nodes, keypath.join(PATH_NAME_AGGREGATOR)),
      );
    },
    [nodes],
  );

  useEffect(() => {
    saveConfig({ expansion });
  }, [expansion, saveConfig]);

  const getValueLabels = useCallback(
    ({
      constantName,
      label,
      itemValue,
      keyPath,
    }: {
      constantName: string | undefined;
      label: string;
      itemValue: unknown;
      keyPath: ReadonlyArray<number | string>;
    }): { arrLabel: string; itemLabel: string } => {
      let itemLabel = label;
      if (typeof itemValue === "bigint") {
        itemLabel = itemValue.toString();
      }
      // output preview for the first x items if the data is in binary format
      // sample output: Int8Array(331776) [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, ...]
      let arrLabel = "";
      if (ArrayBuffer.isView(itemValue)) {
        const array = itemValue as Uint8Array;
        const itemPart = array.slice(0, DATA_ARRAY_PREVIEW_LIMIT).join(", ");
        const length = array.length;
        arrLabel = `(${length}) [${itemPart}${length >= DATA_ARRAY_PREVIEW_LIMIT ? ", …" : ""}] `;
        itemLabel = itemValue.constructor.name;
      }
      if (constantName != undefined) {
        itemLabel = `${itemLabel} (${constantName})`;
      }

      // When we encounter a nsec field (nanosecond) that is a number, we ensure the label displays 9 digits.
      // This helps when visually scanning time values from `sec` and `nsec` fields.
      // A nanosecond label of 099999999 makes it easier to realize this is 0.09 seconds compared to
      // 99999999 which requires some counting to reamize this is also 0.09
      if (keyPath[0] === "nsec" && typeof itemValue === "number") {
        itemLabel = _.padStart(itemLabel, 9, "0");
      }

      return { arrLabel, itemLabel };
    },
    [],
  );

  const enumMapping = useMemo(() => enumValuesByDatatypeAndField(datatypes), [datatypes]);

  const valueRenderer = useCallback(
    (
      structureItem: MessagePathStructureItem | undefined,
      data: unknown[],
      queriedData: MessagePathDataItem[],
      label: string,
      itemValue: unknown,
      ...keyPath: (number | string)[]
    ) => (
      <ReactHoverObserver className={classes.hoverObserver}>
        {({ isHovering }: { isHovering: boolean }) => {
          const lastKeyPath = _.last(keyPath) as number;
          let valueAction: ValueAction | undefined;
          if (isHovering) {
            valueAction = getValueActionForValue(
              data[lastKeyPath],
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
          }

          let constantName: string | undefined;
          if (structureItem) {
            const childStructureItem = getStructureItemForPath(
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
            if (childStructureItem) {
              // if it's an array index (typeof number) then we want the nearest named array which will be typeof string

              const keyPathIndex = keyPath.findIndex((key) => typeof key === "string");
              const field = keyPath[keyPathIndex];
              if (typeof field === "string") {
                const datatype = childStructureItem.datatype;
                constantName = enumMapping[datatype]?.[field]?.[String(itemValue)];
              }
            }
          }
          const basePath = queriedData[lastKeyPath]?.path ?? "";
          const { arrLabel, itemLabel } = getValueLabels({
            constantName,
            label,
            itemValue,
            keyPath,
          });

          return (
            <Value
              arrLabel={arrLabel}
              basePath={basePath}
              itemLabel={itemLabel}
              itemValue={itemValue}
              valueAction={valueAction}
              onTopicPathChange={onTopicPathChange}
              openSiblingPanel={openSiblingPanel}
            />
          );
        }}
      </ReactHoverObserver>
    ),
    [classes.hoverObserver, enumMapping, getValueLabels, onTopicPathChange, openSiblingPanel],
  );

  const [topicEntries, setTopicEntries] = useState<string[]>(() => {
    if (config.topicPaths && config.topicPaths.length > 0) {
      return [...config.topicPaths, ""];  // Add empty entry at the end
    } else if (config.topicPath) {
      return [config.topicPath, ""];  // Migrate from old format + empty entry
    } else {
      return [""];
    }
  });

  // Handle changing a path at a specific index
  const handleTopicPathChange = useCallback((index: number, newPath: string) => {
    setTopicEntries(prev => {
      const updated = [...prev];
      updated[index] = newPath;

      // If we're updating the last (empty) entry, add a new empty entry
      if (index === prev.length - 1 && newPath !== "") {
        updated.push("");
      }
      return updated;
    });
    setExpansion("none");
  }, []);

  // Handle removing a path at a specific index
  const handleRemoveTopic = useCallback((index: number) => {
    setTopicEntries(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated[updated.length - 1] !== "") {
        updated.push("");
      }
      return updated;
    });
  }, []);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update") {
        if (action.payload.path[0] === "general") {
          if (action.payload.path[1] === "fontSize") {
            saveConfig({
              fontSize:
                action.payload.value != undefined ? (action.payload.value as number) : undefined,
            });
          }
        }
      }
    },
    [saveConfig],
  );

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) {
      return;
    }

    if (result.destination.index === result.source.index) {
      return;
    }

    setTopicEntries(prevEntries => {
      const entries = [...prevEntries];
      const [removed] = entries.splice(result.source.index, 1);
      entries.splice(result.destination!.index, 0, removed!);
      return entries;
    });
  }, [])

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: {
        general: {
          label: "General",
          fields: {
            fontSize: {
              label: "Font size",
              input: "select",
              options: [
                { label: "auto", value: undefined },
                ...FONT_SIZE_OPTIONS.map((value) => ({
                  label: `${value} px`,
                  value,
                })),
              ],
              value: fontSize,
            },
          },
        },
      },
    });
  }, [actionHandler, fontSize, updatePanelSettingsTree]);

  return (
    <Stack flex="auto" overflow="hidden" position="relative" style={{ padding: 0 }}>
      <Toolbar
        canExpandAll={canExpandAll}
        diffEnabled={diffEnabled}
        diffMethod={diffMethod}
        diffTopicPath={diffTopicPath}
        onDiffTopicPathChange={onDiffTopicPathChange}
        onToggleDiff={onToggleDiff}
        onToggleExpandAll={onToggleExpandAll}
        onTopicPathChange={(path) => handleTopicPathChange(0, path)}
        saveConfig={saveConfig}
      />
      {/* Topic entries list with drag-and-drop */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="topic-entries">
          {(provided) => (
            <Box
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                overflowY: "auto",
                flex: "auto",
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {topicEntries.map((path, index) => (
                <Draggable
                  key={`topic-entry-${index}`}
                  draggableId={`topic-entry-${index}`}
                  index={index}
                  // Disable dragging for the last empty entry
                  isDragDisabled={index === topicEntries.length - 1 && path === ""}
                >
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      style={{
                        ...provided.draggableProps.style,
                        opacity: snapshot.isDragging ? 0.8 : 1,
                      }}
                    >
                      <Stack
                        gap={0.1}
                        direction="row"
                        alignItems="flex-start"
                        className={cx(
                          classes.draggableItem,
                          snapshot.isDragging && classes.dragging,
                        )}
                      >
                        {/* Drag handle */}
                        <div
                          {...provided.dragHandleProps}
                          style={{
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            // Hide drag handle for the last empty entry
                            visibility: (index === topicEntries.length - 1 && path === "") ? 'hidden' : 'visible',
                            padding: 0,
                            margin: 0,
                          }}
                        >
                          <DragIndicatorIcon
                            color="action"
                            fontSize="small"
                            style={{
                              fontSize: 16,
                              marginRight: 0,
                            }}
                          />
                        </div>

                        <Box flexGrow={1}>
                          <TopicEntryWithOutput
                            topicPath={path}
                            onTopicPathChange={(newPath) => handleTopicPathChange(index, newPath)}
                            onRemove={() => handleRemoveTopic(index)}
                            isEditable={index === topicEntries.length - 1}
                            expansion={expansion ?? "none"}
                            onLabelClick={onLabelClick}
                            fontSize={fontSize}
                            valueRenderer={valueRenderer}
                            getItemString={getItemString}
                            rootStructureItem={rootStructureItem}
                            jsonTreeTheme={jsonTreeTheme}
                          />
                        </Box>
                      </Stack>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </Box>
          )}
        </Droppable>
      </DragDropContext>
    </Stack>
  );
}

const defaultConfig: RawMessagesPanelConfig = {
  diffEnabled: false,
  diffMethod: CUSTOM_METHOD,
  diffTopicPath: "",
  showFullMessageForDiff: false,
  topicPath: "",
  topicPaths: [],
  fontSize: undefined,
};

export default Panel(
  Object.assign(RawMessageList, {
    panelType: "RawMessageList",
    defaultConfig,
  }),
);
