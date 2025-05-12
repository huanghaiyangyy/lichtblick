import { Box, Paper, Typography, Slider, TextField, IconButton } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useState} from "react";
import Tree from "react-json-tree";

import { parseMessagePath } from "@lichtblick/message-path";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useMessageDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useMessageDataItem";
import { Topic } from "@lichtblick/suite-base/players/types";
import { PATH_NAME_AGGREGATOR } from "./constants";
import MaybeCollapsedValue from "./MaybeCollapsedValue";
import Metadata from "./Metadata";
import { TopicEntry } from "./TopicEntry";
import { NodeState } from "./types";
import { getSingleValue, dataWithoutWrappingArray, isSingleElemArray } from "./utils";

interface TopicEntryWithOutputProps {
  topicPath: string;
  onTopicPathChange: (path: string) => void;
  onRemove: () => void;
  isEditable: boolean;
  expansion: "all" | "none" | Record<string, NodeState>;
  onLabelClick: (keypath: (string | number)[]) => void;
  fontSize?: number;
  valueRenderer: (structureItem: any, data: unknown[], queriedData: any[], label: string, itemValue: unknown, ...keyPath: (number | string)[]) => JSX.Element;
  getItemString: any;
  rootStructureItem: any;
  jsonTreeTheme: any;
}

export function TopicEntryWithOutput({
  topicPath,
  onTopicPathChange,
  onRemove,
  isEditable,
  expansion,
  onLabelClick,
  fontSize,
  valueRenderer,
  getItemString,
  rootStructureItem,
  jsonTreeTheme
}: TopicEntryWithOutputProps) {
  const { topics } = useDataSourceInfo();

  const topicRosPath = useMemo(() => parseMessagePath(topicPath), [topicPath]);
  const topic: Topic | undefined = useMemo(
    () => topicRosPath && topics.find(({ name }) => name === topicRosPath.topicName),
    [topicRosPath, topics]
  );

  const [floatPrecision, setFloatPrecision] = useState(2);  // Default precision for float values
  const [showPrecisionControl, setShowPrecisionControl] = useState(false); // Flag to show/hide precision control

  // Get message data for this specific topic
  const matchedMessages = useMessageDataItem(topic ? topicPath : "", { historySize: 2 });
  const currTickObj = matchedMessages[matchedMessages.length - 1];

  const isFloat = useCallback((value: unknown): boolean => {
    return typeof value === 'number' && !Number.isInteger(value);
  }, []);

  const hasSingleFloatValue = useMemo(() => {
    if (!topicPath || !currTickObj) return false;

    const data = dataWithoutWrappingArray(currTickObj.queriedData.map(({ value }) => value));
    const shouldDisplaySingleVal =
      (data != undefined && typeof data !== "object") ||
      (isSingleElemArray(data) && data[0] != undefined && typeof data[0] !== "object");
    const singleVal = getSingleValue(data, currTickObj.queriedData);
    return shouldDisplaySingleVal && isFloat(singleVal);
  }, [currTickObj, topicPath, isFloat]);

  // Format value based on type and precision
  const formatValue = useCallback((value: unknown): string => {
    // Handle floating point numbers
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return value.toFixed(floatPrecision);
    }
    // Handle other types (strings, integers, etc.)
    return String(value);
  }, [floatPrecision]);

  useEffect(() => {
    if (!hasSingleFloatValue && showPrecisionControl) {
      setShowPrecisionControl(false);
    }
  }, [hasSingleFloatValue, showPrecisionControl]);

  const shouldExpandNode = useCallback((keypath: (string | number)[]) => {
    if (expansion === "all") {
      return true;
    }
    if (expansion === "none") {
      return false;
    }

    const joinedPath = keypath.join(PATH_NAME_AGGREGATOR);
    if (expansion && expansion[joinedPath] === NodeState.Collapsed) {
      return false;
    }
    if (expansion && expansion[joinedPath] === NodeState.Expanded) {
      return true;
    }

    return true;
  }, [expansion]);

  const renderOutput = useCallback(() => {
    if (!topicPath) {
      return null; // Don't render anything for empty topic entries
    }

    if (!currTickObj) {
      return <EmptyState>Waiting for next message…</EmptyState>;
    }

    const data = dataWithoutWrappingArray(currTickObj.queriedData.map(({ value }) => value));
    const hideWrappingArray =
      currTickObj.queriedData.length === 1 && typeof currTickObj.queriedData[0]?.value === "object";
    const shouldDisplaySingleVal =
      (data != undefined && typeof data !== "object") ||
      (isSingleElemArray(data) && data[0] != undefined && typeof data[0] !== "object");
    const singleVal = getSingleValue(data, currTickObj.queriedData);
    const formattedSingleVal = formatValue(singleVal);

    return (
      <>
        <Metadata
          data={data}
          message={currTickObj.messageEvent}
          {...(topic ? { datatype: topic.schemaName } : undefined)}
          diffData={undefined}
          diff={undefined}
        />
        {shouldDisplaySingleVal ? (
          <Typography
            variant="body1"
            fontSize={fontSize || 12}
            whiteSpace="pre-wrap"
            style={{ wordWrap: "break-word" }}
          >
            <MaybeCollapsedValue itemLabel={formattedSingleVal} />
          </Typography>
        ) : (
          <Tree
            labelRenderer={(raw) => (
              <>
                {_.first(raw)}
                <span style={{ fontSize: 0 }}>&nbsp;</span>
              </>
            )}
            shouldExpandNode={shouldExpandNode}
            onExpand={(_data, _level, keyPath) => {
              onLabelClick(keyPath);
            }}
            onCollapse={(_data, _level, keyPath) => {
              onLabelClick(keyPath);
            }}
            hideRoot
            invertTheme={false}
            getItemString={getItemString}
            valueRenderer={(valueAsString: string, value, ...keyPath) => {
              if (hideWrappingArray) {
                // When the wrapping array is hidden, put it back here.
                return valueRenderer(
                  rootStructureItem,
                  [data],
                  currTickObj.queriedData,
                  valueAsString,
                  value,
                  ...keyPath,
                  0,
                );
              }
              return valueRenderer(
                rootStructureItem,
                data as unknown[],
                currTickObj.queriedData,
                valueAsString,
                value,
                ...keyPath,
              );
            }}
            theme={{
              ...jsonTreeTheme,
              tree: { margin: 0 },
              nestedNode: ({ style }) => ({
                style: {
                  ...style,
                  fontSize,
                  paddingTop: 2,
                  paddingBottom: 2,
                  marginTop: 2,
                  textDecoration: "inherit",
                }
              }),
              value: ({ style }) => ({
                style: {
                  ...style,
                  fontSize,
                  textDecoration: "inherit",
                }
              }),
            }}
            data={data}
          />
        )}
      </>
    );
  }, [
    currTickObj,
    topicPath,
    fontSize,
    formatValue,
    getItemString,
    jsonTreeTheme,
    onLabelClick,
    rootStructureItem,
    shouldExpandNode,
    topic,
    valueRenderer,
    isFloat,
  ]);

  return (
    <Paper elevation={1} sx={{ mb: 2, p: 0.75, overflow: "hidden" }}>
      {/* Topic Entry */}
      <Box mb={1}>
        <TopicEntry
          topicPath={topicPath}
          onTopicPathChange={onTopicPathChange}
          onRemove={onRemove}
          isEditable={isEditable}
        />
      </Box>

      {/* Precision control */}
      {showPrecisionControl && (
        <Box
          sx={{
            mb: 1,
            p: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            bgcolor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <Typography variant="body2" sx={{ minWidth: '100px' }}>
            Float Precision:
          </Typography>
          <Slider
            value={floatPrecision}
            onChange={(_, newValue) => setFloatPrecision(newValue as number)}
            min={0}
            max={20}
            step={1}
            valueLabelDisplay="auto"
            sx={{ flexGrow: 1 }}
          />
          <TextField
            value={floatPrecision}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value >= 0 && value <= 20) {
                setFloatPrecision(value);
              }
            }}
            type="number"
            size="small"
            inputProps={{
              min: 0,
              max: 20,
              step: 1
            }}
            sx={{ width: '80px' }}
          />
        </Box>
      )}

      {/* Output and settings icon */}
      {topicPath && (
        <Box sx={{ position: 'relative' }}>
          {/* Settings icon only shown for single float values */}
          {hasSingleFloatValue && (
            <IconButton
              size="small"
              onClick={() => setShowPrecisionControl(prev => !prev)}
              sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                zIndex: 1,
                bgcolor: 'background.paper',
                '&:hover': { bgcolor: 'action.hover' }
              }}
              title="Float precision settings"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          )}

          {/* Output content */}
          <Box sx={{
            maxHeight: "300px",
            overflow: "auto",
            pl: 0.75,
            pr: hasSingleFloatValue ? 2.5 : 0.75 // Only add right padding if icon is present
          }}>
            {renderOutput()}
          </Box>
        </Box>
      )}
    </Paper>
  );
}
