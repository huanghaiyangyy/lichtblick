import React from "react";
import { Box, Slider } from "@mui/material";
import tc from "tinycolor2";

const FieldNameColor = "rgb(255, 255, 255)";

interface StatusIndicatorProps {
  status: boolean;
  size?: number;
}

export function StatusIndicator({ status, size = 8 }: StatusIndicatorProps): React.JSX.Element {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: status ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 0, 0, 0.8)',
        marginRight: 1,
        verticalAlign: 'middle'
      }}
    />
  );
}

interface CustomSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  color?: string;
}

export function CustomSlider({
  value,
  min,
  max,
  step = 0.01,
  color = "rgba(178, 75, 226, 0.8)",
}: CustomSliderProps): React.JSX.Element {
  const baseColor = tc(color);
  return (
    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      valueLabelDisplay="auto"
      valueLabelFormat={(v) => `${v.toFixed(2)}`}
      scale={(x) => x * 100}
      disabled
      sx={{
        width: 80,
        display: 'inline-block',
        verticalAlign: 'middle',
        ml: 1,
        '& .MuiSlider-thumb': {
          transition: 'none',
          width: 10,
          height: 10,
          backgroundColor: baseColor.toString(),
        },
        '& .MuiSlider-rail': {
          backgroundColor: baseColor.darken(15).setAlpha(0.8).toString(),
        },
        '& .MuiSlider-track': {
          backgroundColor: baseColor.lighten(15).setAlpha(0.8).toString(),
        },
      }}
    />
  );
}

export function safeNumberFormat(value: unknown, decimals: number): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(Math.min(Math.max(decimals, 0), 20)) : "--";
}

function extractValueFromPath(message: any, path: string): any {
  if (!path.includes(".")) {
    // Just a topic name, no field selection
    return message;
  }

  try {
    console.debug("[MsgFormatter] Extracting value from path:", path);
    // Extract the topic part and the field part
    const topicEndIndex = path.indexOf(".");
    const fieldPath = topicEndIndex >= 0 ? path.substring(topicEndIndex + 1) : "";
    console.debug("[MsgFormatter] fieldPath:", fieldPath);
    if (!fieldPath) {
      return message;
    }

    // Handle nested paths like "field1.field2.field3" or "field1[0].field2"
    return fieldPath.split(/\.|\[|\]/)
      .filter(segment => segment !== "")
      .reduce((obj, segment) => {
        // Handle array indices
        if (/^\d+$/.test(segment)) {
          return obj?.[parseInt(segment, 10)];
        }
        return obj?.[segment];
      }, message);
  } catch (error) {
    console.warn(`Error extracting value from path ${path}:`, error);
    return undefined;
  }
}

function formatPrimitiveValue(value: any): React.ReactNode {
  if (value === undefined || value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return <><StatusIndicator status={value} /> {value.toString()}</>;
  }

  if (typeof value === "number") {
    const isInteger = Number.isInteger(value);
    return isInteger ? value.toString() : value.toFixed(3);
  }

  return String(value);
}

interface CollapsibleArrayProps {
  arrayName: string;
  array: any[];
  initiallyExpanded?: boolean;
  level?: number;
  isRootLevel?: boolean;
}

function CollapsibleArray({
  arrayName,
  array,
  initiallyExpanded = false,
  level = 0,
  isRootLevel = false
}: CollapsibleArrayProps): React.ReactNode {
  const [isExpanded, setIsExpanded] = React.useState(isRootLevel ? true : initiallyExpanded);
  const maxLevel = 3; // Maximum nesting level to prevent infinite recursion
  const maxInlineItems = 5;

  if (array.length === 0) {
    return "[]";
  }

  // If it's a simple flat array with primitive values and short enough, just show inline
  const isSimpleArray = array.length <= maxInlineItems &&
    array.every(item => typeof item !== "object" || item === null);

  if (isSimpleArray) {
    return `[${array.map(item => formatPrimitiveValue(item)).join(", ")}]`;
  }

  // For nested arrays or larger arrays
  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div style={{ paddingLeft: 0 }}>
      <div
        onClick={toggleExpand}
        style={{
          cursor: 'pointer',
          color: 'rgba(255, 255, 255, 0.8)',
          userSelect: 'none'
        }}
      >
        <span style={{ marginRight: 5 }}>
          {isExpanded ? '▼' : '►'}
        </span>
        <span style={{
          color: FieldNameColor,
          fontWeight: 'bold',
          marginRight: 4
        }}>
          {arrayName} [{array.length}]
        </span>
      </div>

      {isExpanded && (
        <div style={{
          marginLeft: 12,
          borderLeft: '1px solid rgba(255, 255, 255, 0.3)',
          paddingLeft: 8
        }}>
          {array.map((item, index) => (
            <div key={index} style={{ margin: '4px 0' }}>
              <span style={{
                color: FieldNameColor,
                fontWeight: 'bold',
                marginRight: 4
              }}>
                {index}:
              </span>
              {typeof item === "object" && item !== null ? (
                Array.isArray(item) && level < maxLevel ? (
                  <CollapsibleArray arrayName="" array={item} level={level + 1} isRootLevel={false} />
                ) : (
                  <CollapsibleObject object={item} level={level + 1} isRootLevel={false} />
                )
              ) : (
                formatPrimitiveValue(item)
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CollapsibleObjectProps {
  objectName?: string;
  object: Record<string, any>;
  initiallyExpanded?: boolean;
  level?: number;
  isRootLevel?: boolean;
}

function CollapsibleObject({
  objectName,
  object,
  initiallyExpanded = false,
  level = 0,
  isRootLevel = false
}: CollapsibleObjectProps): React.ReactNode {
  const [isExpanded, setIsExpanded] = React.useState(isRootLevel ? true : initiallyExpanded);
  const maxLevel = 5; // Maximum nesting level
  const keys = Object.keys(object);

  if (keys.length === 0) {
    return "{}";
  }

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div style={{
      paddingLeft: 0,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span
          onClick={toggleExpand}
          style={{
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.8)',
            marginRight: 5,
            userSelect: 'none'
          }}
        >
          {isExpanded ? '▼' : '►'}
        </span>
        <span style={{
          color: FieldNameColor,
          fontWeight: 'bold',
          marginRight: '4px'
        }}>
          {objectName}
        </span>
      </div>

      {isExpanded && (
        <div style={{
          marginLeft: 12,
          borderLeft: '1px solid rgba(255, 255, 255, 0.3)',
          paddingLeft: 8
        }}>
          {keys.map((key) => (
            <div key={key} style={{ margin: '4px 0' }}>
              {typeof object[key] === "object" && object[key] !== null ? (
                Array.isArray(object[key]) && level < maxLevel ? (
                  <CollapsibleArray arrayName={key} array={object[key]} level={level + 1} isRootLevel={false} />
                ) : (
                  <CollapsibleObject objectName={key} object={object[key]} level={level + 1} isRootLevel={false} />
                )
              ) : (
                <div>
                  <span style={{
                    color: FieldNameColor,
                    fontWeight: 'bold',
                    marginRight: '4px'
                  }}>
                    {key}:
                  </span>
                  {formatPrimitiveValue(object[key])}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatMessage(topic: string, message: any): React.ReactNode {
  if (!message) {
    return `Waiting for data on ${topic}...`;
  }

  try {
    const msg = message.message ?? message;

    if (topic === "control_debug") {
      return formatControlDebugMessage(msg);
    } else if (topic === "planning_debug") {
      return formatPlanningDebugMessage(msg);
    } else if (topic === "control_cmd") {
      return formatControlCmdMessage(msg);
    } else {
      const extractedValue = extractValueFromPath(msg, topic);

      if (extractedValue === undefined) {
        return `Path "${topic}" not found in message`;
      } else if (Array.isArray(extractedValue)) {
        // For arrays
        return (
          <div>
            <div style={{
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '1.0em',
              marginBottom: 4,
              fontWeight: 'bold',
              fontFamily: 'monospace'
            }}>
              {topic}
            </div>
            <div style={{
              borderBottom: '1px solid rgba(255,255,255,0.3)',
              marginBottom: 4
            }}/>
            <CollapsibleArray arrayName="" array={extractedValue} isRootLevel={true} />
          </div>
        );
      } else if (typeof extractedValue === 'object' && extractedValue !== null) {
        // For objects
        return (
          <div>
            <div style={{
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '1.0em',
              marginBottom: 4,
              fontWeight: 'bold',
              fontFamily: 'monospace'
            }}>
              {topic}
            </div>
            <div style={{
              borderBottom: '1px solid rgba(255,255,255,0.3)',
              marginBottom: 4
            }}/>
            <CollapsibleObject object={extractedValue} isRootLevel={true} />
          </div>
        );
      } else {
        // For primitive values
        return (
          <div>
            <div style={{
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '1.0em',
              marginBottom: 4,
              fontWeight: 'bold',
              fontFamily: 'monospace'
            }}>
              {topic}
            </div>
            <div style={{
              borderBottom: '1px solid rgba(255,255,255,0.3)',
              marginBottom: 4
            }}/>
            <div style={{ fontSize: '0.9rem' }}>
              {formatPrimitiveValue(extractedValue)}
            </div>
          </div>
        );
      }
    }
  } catch (error) {
    console.error(`Error formatting message for ${topic}:`, error);
    return `Error parsing data for ${topic}`;
  }
}

function formatControlDebugMessage(msg: any): React.ReactNode {
  return (
    <div style={{ position: 'relative', marginBottom: 6 }}>
      <div style={{
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: '1.0em',
        marginBottom: 4,
        fontWeight: 'bold',
        fontFamily: 'monospace'
      }}>
        控制信息
      </div>
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.3)',
        marginBottom: 4
      }}/>
      {`control active:   `}<StatusIndicator status={Number(msg.control_active) === 1} />{`${Number(msg.control_active) === 1 ? "True" : "False"}\n`}
      {`xbw lat status:   `}<StatusIndicator status={Number(msg.xbw_lat_status) <= 2} />{`${safeNumberFormat(msg.xbw_lat_status, 0)}\n`}
      {`xbw lon status:   `}<StatusIndicator status={Number(msg.xbw_lon_status) <= 2} />{`${safeNumberFormat(msg.xbw_lon_status, 0)}\n`}
      {`control status:   ${msg.control_status}\n`}
      {`lat_err:          ${safeNumberFormat(msg.lat_err, 3)} m\n`}
      {`yaw_err:          ${safeNumberFormat(msg.yaw_err, 3)} deg\n`}
      {`speed:            ${safeNumberFormat(msg.current_speed_kph, 1)} m/s\n`}
      {`gear:             ${gearMapping(msg.current_gear)}\n`}
      {`target_kappa:     ${safeNumberFormat(msg.target_kappa, 3)}\n`}
      {`current kappa:    ${safeNumberFormat(msg.current_steer_kappa, 3)}\n`}
      {"steer:            "}<CustomSlider value={msg.current_steer_kappa} min={-0.3} max={0.3} step={0.01} color="rgba(163, 142, 255, 0.8)" /> {"\n"}
    </div>
  );
}

function formatPlanningDebugMessage(msg: any): React.ReactNode {
  return (
    <div style={{ position: 'relative', marginBottom: 6 }}>
      <div style={{
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: '1.0em',
        marginBottom: 4,
        fontWeight: 'bold',
        fontFamily: 'monospace'
      }}>
        规划信息
      </div>
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.3)',
        marginBottom: 4
      }}/>
      {`planning_status:  `}<StatusIndicator status={msg.planning_status === 0} />{`${planningStatusMapping(msg.planning_status)}\n`}
      {`hybrid A* status: ${msg.hybrid_a_star_status_str}\n`}
      {`replan_reason:    ${replanReasonMapping(msg.replan_reason)}\n`}
      {`computation_time: ${safeNumberFormat(msg.computation_time, 2)} s\n`}
    </div>
  );
}

function formatControlCmdMessage(msg: any): React.ReactNode {
  return (
    <div>
      {`acceleration:     ${safeNumberFormat(msg.acceleration, 2)} m/s^2\n`}
      {`acceleration:     `}<CustomSlider value={msg.acceleration} min={-3.0} max={3.0} color="rgba(163, 142, 255, 0.8)" />{"\n"}
    </div>
  );
}

function gearMapping(gear?: number): string {
  const map: Record<number, string> = {
    5: "P",
    6: "R",
    7: "N",
    8: "D",
  };
  return gear != null ? map[gear] ?? "未知" : "未知";
}

function planningStatusMapping(planning_status?: number): string {
  const map: Record<number, string> = {
    0: "Success",
    1: "Input error",
    2: "Envelope error",
    3: "XY bounds error",
    4: "Hybrid A* start plan failed",
    5: "Path partition failed",
    6: "Speed plan failed",
    7: "Park in over success",
    8: "Path switch waiting 3 seconds",
    9: "Traj combiner failed",
    10: "Parking finished",
  };
  return planning_status != null ? map[planning_status] ?? "未知" : "未知";
}

function replanReasonMapping(replan_reason?: number): string {
  const map: Record<number, string> = {
    0: "no replan",
    1: "replan pre traj invalid",
    2: "replan tracking error",
    3: "replan target slot deviation",
  };
  return replan_reason != null ? map[replan_reason] ?? "未知" : "未知";
}
