import React from "react";
import { TextField } from "@mui/material";

interface SimpleTopicInputProps {
  path: string;
  onChange: (path: string) => void;
  inputStyle?: React.CSSProperties;
}

/**
 * A simplified topic input component that doesn't rely on MessagePathInput and its context dependencies
 */
export function SimpleTopicInput({
  path,
  onChange,
  inputStyle,
}: SimpleTopicInputProps): React.JSX.Element {
  return (
    <TextField
      value={path}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      fullWidth
      variant="outlined"
      placeholder="Enter topic name"
      sx={{
        ...(inputStyle && {
          '& .MuiOutlinedInput-root': {
            ...inputStyle,
          },
          '& .MuiInputBase-input': {
            padding: inputStyle.padding,
            height: 'auto',
            fontSize: inputStyle.fontSize,
          }
        }),
      }}
    />
  );
}
