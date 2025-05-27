import React from "react";
import { IconButton, Stack, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import MessagePathInput_ from "@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput_";
import { useRenderContext } from "../../utils/RenderContext";

interface StatusPanelTopicEntryProps {
  topicPath: string;
  onTopicPathChange: (path: string) => void;
  onRemove: () => void;
  isEditable: boolean;
}

export function StatusPanelTopicEntry({
  topicPath,
  onTopicPathChange,
  onRemove,
  isEditable
}: StatusPanelTopicEntryProps): React.JSX.Element {
  const { globalVariables, setGlobalVariables, datatypes, topics_} = useRenderContext();

  const theme = {
    background: "rgb(255, 255, 255)",
    hoverBackground: "rgba(211, 211, 211, 0.8)",
    border: "1px solid rgba(100, 116, 139, 0.4)",
    inputBackground: "rgba(36, 56, 102, 0.6)",
    iconColor: "rgba(148, 163, 184, 0.9)",
    iconHoverColor: "#ffffff",
    activeIconColor: "rgba(56, 189, 248, 0.9)",
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        mb: 1,
        padding: "4px 8px",
        borderRadius: "4px",
        backgroundColor: theme.background,
        border: theme.border,
        '&:hover': {
          backgroundColor: theme.hoverBackground,
        }
      }}
    >
      <MessagePathInput_
        path={topicPath}
        onChange={onTopicPathChange}
        globalVariables={globalVariables}
        setGlobalVariables={setGlobalVariables}
        datatypes={datatypes}
        topics={topics_}
        inputStyle={{
          backgroundColor: theme.inputBackground,
          color: "#ffffff",
          borderRadius: "3px",
          padding: "3px 6px",
          fontSize: "0.9rem",
        }}
        variant="outlined"
      />
      {topicPath ? (
        <Tooltip title="Remove this topic" placement="top">
          <IconButton
            onClick={onRemove}
            size="small"
            aria-label="Remove topic"
            sx={{
              color: theme.iconColor,
              padding: "2px",
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.1)',
                color: theme.iconHoverColor,
              }
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="Add a new topic" placement="top">
          <span> {/* Wrapper needed for disabled buttons */}
            <IconButton
              size="small"
              aria-label="Add topic"
              disabled={!isEditable}
              sx={{
                color: isEditable ? theme.activeIconColor : theme.iconColor,
                padding: "2px",
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: theme.iconHoverColor
                }
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  );
}
