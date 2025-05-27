import React, { useState, useCallback } from "react";
import { StatusPanelTopicEntry } from "./StatusPanelTopicEntry";
import { formatMessage } from "./StatusPanelMessageFormatter";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditIcon from '@mui/icons-material/Edit';
import IconButton from '@mui/material/IconButton';

export interface StatusPanelProps {
  statusPanelTopics?: string[];
  onStatusPanelTopicsChange?: (topics: string[]) => void;
  receivedMessages?: Record<string, any>;
  onEditModeChange?: (isEditMode: boolean) => void;
};

export function StatusPanel(props: StatusPanelProps): React.JSX.Element {
  /** STATUS PANEL */
  const [isEditMode, setIsEditMode] = useState(false);

  const [statusTopics, setStatusTopics] = useState<string[]>(
    [...(props.statusPanelTopics ?? ["control_debug", "planning_debug", "control_cmd"]), ""]
  );

  // Handle topic changes
  const handleTopicPathChange = useCallback((index: number, newPath: string) => {
    const newTopics = [...statusTopics];
    newTopics[index] = newPath;

    // If we're updating the last (empty) entry, add a new empty entry
    if (index === statusTopics.length - 1 && newPath !== "") {
      newTopics.push("");
    }

    setStatusTopics(newTopics);
    props.onStatusPanelTopicsChange?.(newTopics.filter(topic => topic !== ""));
  }, [statusTopics, props.onStatusPanelTopicsChange]);

  // Handle topic removal
  const handleRemoveTopic = useCallback((index: number) => {
    const newTopics = statusTopics.filter((_, i) => i !== index);
    if (newTopics[newTopics.length - 1] !== "") {
      newTopics.push("");
    }
    setStatusTopics(newTopics);
    props.onStatusPanelTopicsChange?.(newTopics.filter(topic => topic !== ""));
  }, [statusTopics, props.onStatusPanelTopicsChange]);

  // Handle drag and drop
  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) {
      return;
    }

    const newTopics = [...statusTopics];
    const [removed] = newTopics.splice(result.source.index, 1);
    newTopics.splice(result.destination.index, 0, removed ?? "");

    setStatusTopics(newTopics);
    props.onStatusPanelTopicsChange?.(newTopics.filter(topic => topic !== ""));
  }, [statusTopics, props.onStatusPanelTopicsChange]);

  const toggleEditMode = useCallback((mode: boolean) => {
    setIsEditMode(mode);
    props.onEditModeChange?.(mode);
  }, [props.onEditModeChange]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        minHeight: "200px", // Ensure minimum height
        maxHeight: "400px", // Limit maximum height
        overflow: "hidden",
      }}
    >
      {/* Main panel */}
      <div
        style={{
          flex: "1 1 auto",
          minWidth: "300px", // Ensure main panel has minimum width
          padding: "8px 12px",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Edit button in the top-right corner */}
        <div style={{
          position: "absolute",
          top: "8px",
          right: "12px",
          zIndex: 10
        }}>
          <IconButton
            onClick={() => toggleEditMode(!isEditMode)}
            size="small"
            style={{
              backgroundColor: isEditMode ? "rgba(66, 133, 244, 0.3)" : "rgba(255, 255, 255, 0.1)",
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </div>

        {/* Message displays */}
        <div
          style={{
            textAlign: "left",
            whiteSpace: "pre",
            height: "100%", // Take full height of parent
            maxHeight: "calc(100% - 30px)", // Give space for the edit button
            overflowY: "auto", // Enable vertical scrolling
            marginTop: "30px", // Give space for the edit button
            padding: "0 4px 4px 0", // Add padding for scrollbar
            wordBreak: "break-word",
          }}
        >
          {statusTopics
            .filter(topic => topic !== "") // Filter out empty topics
            .map(topic => {
              let baseTopic = topic.includes(".") ? topic.substring(0, topic.indexOf(".")) : topic;
              if (baseTopic === "control_debug" ||
                  baseTopic === "planning_debug" ||
                  baseTopic === "control_cmd"
              ) {
                baseTopic = `/${baseTopic}`;
              }
              const message = props.receivedMessages?.[baseTopic];
              return (
                <div key={topic} style={{ marginBottom: 12 }}>
                  {formatMessage(topic, message)}
                </div>
              );
            })}
        </div>
      </div>

      {/* Topic management panel */}
      {isEditMode && (
        <div
          style={{
            minWidth: "300px",
            padding: "12px",
            backgroundColor: "rgba(30, 30, 30, 0.95)",
            borderLeft: "1px solid rgba(255, 255, 255, 0.2)",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-2px 0px 5px rgba(0, 0, 0, 0.3)",
            zIndex: 100,
            overflowY: "hidden",
          }}
        >
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px"
          }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Manage Topics</h3>
          </div>

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="status-panel-topics">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{
                    height: "100%",
                    maxHeight: "calc(100% - 50px)", // Subtract header height
                    overflowY: "auto",
                    paddingRight: "4px", // Add space for scrollbar
                    scrollbarWidth: "thin",
                    scrollbarColor: "rgba(66, 133, 244, 0.7) rgba(30, 30, 30, 0.5)",
                  }}
                >
                  {statusTopics.map((topic, index) => (
                    <Draggable
                      key={`topic-${index}`}
                      draggableId={`topic-${index}`}
                      index={index}
                      isDragDisabled={index === statusTopics.length - 1 && topic === ""}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          style={{
                            ...provided.draggableProps.style,
                            opacity: snapshot.isDragging ? 0.8 : 1,
                            marginBottom: 4,
                          }}
                        >
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            backgroundColor: snapshot.isDragging ? "rgba(255,255,255,0.1)" : undefined,
                            borderRadius: 4,
                            padding: "2px 0",
                          }}>
                            {/* Drag handle */}
                            <div
                              {...provided.dragHandleProps}
                              style={{
                                cursor: 'grab',
                                display: 'flex',
                                alignItems: 'center',
                                visibility: (index === statusTopics.length - 1 && topic === "") ? 'hidden' : 'visible',
                              }}
                            >
                              <DragIndicatorIcon
                                sx={{
                                  color: "rgba(255,255,255,0.5)",
                                  fontSize: 16,
                                  marginRight: 0.5,
                                }}
                              />
                            </div>

                            {/* Topic input */}
                            <div style={{ flexGrow: 1 }}>
                              <StatusPanelTopicEntry
                                topicPath={topic}
                                onTopicPathChange={(path) => handleTopicPathChange(index, path)}
                                onRemove={() => handleRemoveTopic(index)}
                                isEditable={true}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}
    </div>
  );
}
