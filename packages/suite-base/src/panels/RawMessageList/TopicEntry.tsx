import { IconButton, Stack, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import MessagePathInput from "@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput";
import { useContext } from "react";
import CurrentLayoutContext from "@lichtblick/suite-base/context/CurrentLayoutContext";

interface TopicEntryProps {
  topicPath: string;
  onTopicPathChange: (path: string) => void;
  onRemove: () => void;
  isEditable: boolean;
}

function SafeMessagePathInput({ path, onChange }: { path: string; onChange: (path: string) => void }) {
  // Check if CurrentLayoutContext is available
  const currentLayout = useContext(CurrentLayoutContext);

  // If context isn't available, render nothing
  if (!currentLayout) {
    console.warn("[Raw Message] CurrentLayoutContext is not available. MessagePathInput cannot be used.");
    return null;
  }

  console.debug("[Raw Message] CurrentLayoutContext is available:", currentLayout);

  // Context is available, so we can use MessagePathInput
  return <MessagePathInput path={path} onChange={onChange} />;
}

export function TopicEntry({ topicPath, onTopicPathChange, onRemove, isEditable }: TopicEntryProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
      <SafeMessagePathInput path={topicPath} onChange={onTopicPathChange} />
      {topicPath ? (
        <Tooltip title="Remove this topic" placement="top">
          <IconButton onClick={onRemove} size="small" aria-label="Remove topic">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="Add a new topic" placement="top">
          <span> {/* Wrapper needed for disabled buttons */}
            <IconButton size="small" aria-label="Add topic" disabled={!isEditable}>
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  );
}
