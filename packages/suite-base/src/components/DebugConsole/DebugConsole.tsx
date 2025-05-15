import { useCallback, useEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  Stack,
  Divider,
  IconButton,
  Tooltip
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { DebugLogger, LogLevel, LogEntry } from "./DebugLogger";

const useStyles = makeStyles()((theme) => ({
  logContainer: {
    height: "100%",
    overflow: "auto",
    fontFamily: "monospace",
    whiteSpace: "pre-wrap",
    padding: theme.spacing(1),
  },
  logEntry: {
    marginBottom: theme.spacing(0.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    paddingBottom: theme.spacing(0.5),
    fontSize: "0.75rem",
    fontFamily: "monospace",
  },
  debug: {
    color: theme.palette.text.secondary,
  },
  info: {
    color: theme.palette.info.main,
  },
  warn: {
    color: theme.palette.warning.main,
  },
  error: {
    color: theme.palette.error.main,
    fontWeight: "bold",
  },
  controls: {
    padding: theme.spacing(0.5, 1),
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: -theme.spacing(1),
  },
  compactTitle: {
    fontSize: "0.9rem",
    fontWeight: "bold",
  },
  filterContainer: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  noHeaderPadding: {
    '& .MuiPaper-root': {
      paddingTop: 0,
    },
    '& .MuiBox-root': {
      paddingTop: 0,
    },
    '& > div': {
      paddingTop: 0,
    }
  },
  compactSidebar: {
    marginTop: -theme.spacing(2),
    height: `calc(100% + ${theme.spacing(2)})`,
  }
}));

export default function DebugConsole(): JSX.Element {
  const { classes } = useStyles();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to global debug logs
  useEffect(() => {
    const unsubscribe = DebugLogger.subscribe((entry) => {
      setLogs((prevLogs) => [...prevLogs, entry]);

      setTimeout(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }, 0);
    });

    return unsubscribe;
  }, []);

  const handleClear = useCallback(() => {
    setLogs([]);
    DebugLogger.clear();
  }, []);

  const filteredLogs = filter === "all"
    ? logs
    : logs.filter(log => log.level === filter);

  return (
    <Stack
      direction="column"
      height="100%"
      spacing={0}
    >
      <Box className={classes.controls}>
        <Typography className={classes.compactTitle}>Debug Console</Typography>
        <div className={classes.filterContainer}>
          <FormControl size="small" variant="standard" style={{ minWidth: 80 }}>
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogLevel | "all")}
              displayEmpty
              inputProps={{ 'aria-label': 'Filter log level' }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="debug">Debug</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="warn">Warn</MenuItem>
              <MenuItem value="error">Error</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="Clear console">
            <IconButton size="small" onClick={handleClear} edge="end">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      </Box>

      <Divider />

      <Box className={classes.logContainer} ref={logContainerRef}>
        {filteredLogs.map((entry, idx) => (
          <Typography
            key={`${entry.timestamp}-${idx}`}
            className={`${classes.logEntry} ${classes[entry.level]}`}
            variant="body2"
          >
            [{entry.level.toUpperCase()}] {entry.message}
            {entry.args && entry.args.length > 0 && (
              <>
                <br />
                {entry.args.map((arg, i) => (
                  <Box component="span" key={i} style={{ paddingLeft: 16 }}>
                    {typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)}
                  </Box>
                ))}
              </>
            )}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}
