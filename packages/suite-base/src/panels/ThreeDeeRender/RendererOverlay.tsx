// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Ruler20Filled, Ruler20Regular } from "@fluentui/react-icons";
import {
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Tooltip,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLongPress } from "react-use";
import tc from "tinycolor2";
import { makeStyles } from "tss-react/mui";

import { LayoutActions } from "@lichtblick/suite";
import {
  PanelContextMenu,
  PanelContextMenuItem,
} from "@lichtblick/suite-base/components/PanelContextMenu";
import PublishGoalIcon from "@lichtblick/suite-base/components/PublishGoalIcon";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";
import PublishPoseEstimateIcon from "@lichtblick/suite-base/components/PublishPoseEstimateIcon";
import { usePanelMousePresence } from "@lichtblick/suite-base/hooks/usePanelMousePresence";
import { HUD } from "@lichtblick/suite-base/panels/ThreeDeeRender/HUD";

import { InteractionContextMenu, Interactions, SelectionObject, TabType } from "./Interactions";
import type { PickedRenderable } from "./Picker";
import { Renderable } from "./Renderable";
import { useRenderer, useRendererEvent } from "./RendererContext";
import { Stats } from "./Stats";
import { MouseEventObject } from "./camera";
import { PublishClickType } from "./renderables/PublishClickTool";
import { InterfaceMode } from "./types";

const PublishClickIcons: Record<PublishClickType, React.ReactNode> = {
  pose: <PublishGoalIcon fontSize="small" />,
  point: <PublishPointIcon fontSize="small" />,
  pose_estimate: <PublishPoseEstimateIcon fontSize="small" />,
};

// 在样式定义部分新增startButton样式
const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    top: 10,
    right: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    pointerEvents: "none",
  },
  iconButton: {
    position: "relative",
    pointerEvents: "auto",
    aspectRatio: "1/1",
  },
  rulerIcon: {
    transform: "rotate(45deg)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  threeDeeButton: {
    fontFamily: theme.typography.fontMonospace,
    fontFeatureSettings: theme.typography.caption.fontFeatureSettings,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    lineHeight: "1em",
  },
  resetViewButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    marginBottom: theme.spacing(1),
    marginRight: theme.spacing(1),
  },
  kbd: {
    fontFamily: theme.typography.fontMonospace,
    background: tc(theme.palette.common.white).darken(45).toString(),
    padding: theme.spacing(0, 0.5),
    aspectRatio: 1,
    borderRadius: theme.shape.borderRadius,
    marginLeft: theme.spacing(1),
  },
  startButton: {
    position: "absolute",
    top: 10, // 与root容器的top对齐
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1000, // 确保在最上层
    minWidth: 120, // 自定义宽度
    height: 32, // 自定义高度
    backgroundColor: tc(theme.palette.primary.main).setAlpha(0.8).toString(), // 添加透明度
    "&:hover": {
      backgroundColor: tc(theme.palette.primary.dark).setAlpha(0.8).toString(), // 悬停状态也保持透明度
    },
  },
}));

type Props = {
  addPanel: LayoutActions["addPanel"];
  canPublish: boolean;
  canvas: HTMLCanvasElement | ReactNull;
  enableStats: boolean;
  interfaceMode: InterfaceMode;
  measureActive: boolean;
  onChangePublishClickType: (_: PublishClickType) => void;
  onClickMeasure: () => void;
  onClickPublish: () => void;
  onShowTopicSettings: (topic: string) => void;
  onTogglePerspective: () => void;
  onClickStartButton: () => void;
  onClickStopButton: () => void;
  onClickFrontParkingButton: () => void;
  onClickRearParkingButton: () => void;
  onClickLeftParkingOutButton: () => void;
  onClickRightParkingOutButton: () => void;
  perspective: boolean;
  publishActive: boolean;
  publishClickType: PublishClickType;
  timezone: string | undefined;
};

/**
 * Provides DOM overlay elements on top of the 3D scene (e.g. stats, debug GUI).
 */
export function RendererOverlay(props: Props): React.JSX.Element {
  const { t } = useTranslation("threeDee");
  const { classes } = useStyles();
  const [clickedPosition, setClickedPosition] = useState<{ clientX: number; clientY: number }>({
    clientX: 0,
    clientY: 0,
  });
  const [selectedRenderables, setSelectedRenderables] = useState<PickedRenderable[]>([]);
  const [selectedRenderable, setSelectedRenderable] = useState<PickedRenderable | undefined>(
    undefined,
  );
  const [interactionsTabType, setInteractionsTabType] = useState<TabType | undefined>(undefined);
  const renderer = useRenderer();

  // Toggle object selection mode on/off in the renderer
  useEffect(() => {
    if (renderer) {
      renderer.setPickingEnabled(interactionsTabType != undefined);
    }
  }, [interactionsTabType, renderer]);

  useRendererEvent("renderablesClicked", (selections, cursorCoords) => {
    const rect = props.canvas!.getBoundingClientRect();
    setClickedPosition({ clientX: rect.left + cursorCoords.x, clientY: rect.top + cursorCoords.y });
    setSelectedRenderables(selections);
    setSelectedRenderable(selections.length === 1 ? selections[0] : undefined);
  });

  const [showResetViewButton, setShowResetViewButton] = useState(renderer?.canResetView() ?? false);
  useRendererEvent(
    "resetViewChanged",
    useCallback(() => {
      setShowResetViewButton(renderer?.canResetView() ?? false);
    }, [renderer]),
  );
  const onResetView = useCallback(() => {
    renderer?.resetView();
  }, [renderer]);

  const stats = props.enableStats ? (
    <div id="stats" style={{ position: "absolute", top: "10px", left: "10px" }}>
      <Stats />
    </div>
  ) : undefined;

  // Convert the list of selected renderables (if any) into MouseEventObjects
  // that can be passed to <InteractionContextMenu>, which shows a context menu
  // of candidate objects to select
  const clickedObjects = useMemo<MouseEventObject[]>(
    () =>
      selectedRenderables.map((selection) => ({
        object: {
          pose: selection.renderable.pose,
          scale: selection.renderable.scale,
          color: undefined,
          interactionData: {
            topic: selection.renderable.name,
            highlighted: undefined,
            renderable: selection.renderable,
          },
        },
        instanceIndex: selection.instanceIndex,
      })),
    [selectedRenderables],
  );

  // Once a single renderable is selected, convert it to the SelectionObject
  // format to populate the object inspection dialog (<Interactions>)
  const selectedObject = useMemo<SelectionObject | undefined>(
    () =>
      selectedRenderable
        ? {
            object: {
              pose: selectedRenderable.renderable.pose,
              interactionData: {
                topic: selectedRenderable.renderable.topic,
                highlighted: true,
                originalMessage: selectedRenderable.renderable.details(),
                instanceDetails:
                  selectedRenderable.instanceIndex != undefined
                    ? selectedRenderable.renderable.instanceDetails(
                        selectedRenderable.instanceIndex,
                      )
                    : undefined,
              },
            },
            instanceIndex: selectedRenderable.instanceIndex,
          }
        : undefined,
    [selectedRenderable],
  );

  // Inform the Renderer when a renderable is selected
  useEffect(() => {
    renderer?.setSelectedRenderable(selectedRenderable);
  }, [renderer, selectedRenderable]);

  const publickClickButtonRef = useRef<HTMLButtonElement>(ReactNull);
  const [publishMenuExpanded, setPublishMenuExpanded] = useState(false);
  const selectedPublishClickIcon = PublishClickIcons[props.publishClickType];

  const onLongPressPublish = useCallback(() => {
    setPublishMenuExpanded(true);
  }, []);
  const longPressPublishEvent = useLongPress(onLongPressPublish);

  const theme = useTheme();

  // Publish control is only available if the canPublish prop is true and we have a fixed frame in the renderer
  const showPublishControl =
    props.interfaceMode === "3d" && props.canPublish && renderer?.fixedFrameId != undefined;
  const publishControls = showPublishControl && (
    <>
      <Tooltip
        placement="left"
        title={props.publishActive ? "Click to cancel" : "Click to publish"}
      >
        <IconButton
          {...longPressPublishEvent}
          className={classes.iconButton}
          size="small"
          color={props.publishActive ? "info" : "inherit"}
          ref={publickClickButtonRef}
          onClick={props.onClickPublish}
          data-testid="publish-button"
        >
          {selectedPublishClickIcon}
          <div
            style={{
              borderBottom: "6px solid currentColor",
              borderRight: "6px solid transparent",
              bottom: 0,
              left: 0,
              height: 0,
              width: 0,
              margin: theme.spacing(0.25),
              position: "absolute",
            }}
          />
        </IconButton>
      </Tooltip>
      <Menu
        id="publish-menu"
        anchorEl={publickClickButtonRef.current}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        open={publishMenuExpanded}
        onClose={() => {
          setPublishMenuExpanded(false);
        }}
        MenuListProps={{ dense: true }}
      >
        <MenuItem
          selected={props.publishClickType === "pose_estimate"}
          onClick={() => {
            props.onChangePublishClickType("pose_estimate");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.pose_estimate}</ListItemIcon>
          <ListItemText disableTypography>Publish pose estimate</ListItemText>
        </MenuItem>
        <MenuItem
          selected={props.publishClickType === "pose"}
          onClick={() => {
            props.onChangePublishClickType("pose");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.pose}</ListItemIcon>
          <ListItemText disableTypography>Publish pose</ListItemText>
        </MenuItem>
        <MenuItem
          selected={props.publishClickType === "point"}
          onClick={() => {
            props.onChangePublishClickType("point");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.point}</ListItemIcon>
          <ListItemText disableTypography>Publish point</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );

  const resetViewButton = showResetViewButton && (
    <Button
      className={classes.resetViewButton}
      variant="contained"
      color="secondary"
      onClick={onResetView}
      data-testid="reset-view"
    >
      {t("resetView")}
    </Button>
  );

  const getContextMenuItems = useCallback((): PanelContextMenuItem[] => {
    return renderer?.getContextMenuItems() ?? [];
  }, [renderer]);

  const mousePresenceRef = useRef<HTMLDivElement>(ReactNull);
  const mousePresent = usePanelMousePresence(mousePresenceRef);

  // const [expanded, setExpanded] = useState(false);


  const [anchorEl1, setAnchorEl1] = useState<null | HTMLElement>(null);
  const [anchorEl2, setAnchorEl2] = useState<null | HTMLElement>(null);
  const open1 = Boolean(anchorEl1);
  const open2 = Boolean(anchorEl2);

  const [displayText, setDisplayText] = useState(true);

  return (
    <>


{props.interfaceMode === "3d" && (
  <div style={{
    position: "absolute",
    top: 160,
    right: 10,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: 60 // 新增固定容器宽度
  }}>

  <div>
    <Button
      variant="contained"
      onClick={(e) => setAnchorEl1(e.currentTarget)}
      sx={{
        minWidth: 60, // 从120调整为80
        width: '100%', // 新增宽度100%
        backgroundColor: theme => tc(theme.palette.secondary.main).setAlpha(0.8).toString(),
        "&:hover": {
          backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.8).toString()
        }
      }}
    >
      {t("泊入" as any)}
    </Button>

<Menu
  anchorEl={anchorEl1}
  open={open1}
  onClose={() => setAnchorEl1(null)}
  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
  sx={{
    '& .MuiPaper-root': {
      minWidth: 60,
      marginTop: '8px'
    }
  }}
>
  <MenuItem
      onClick={() => {
        props.onClickFrontParkingButton();
        setAnchorEl1(null); // 添加关闭菜单
      }}
    sx={{
      fontSize: '0.875rem',
      padding: '6px 16px',
      justifyContent: 'center', // 添加水平居中
      textAlign: 'center' ,// 确保文字居中
                  // 新增点击反馈样式
    "&:active": {
      backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
      transform: "scale(0.98)",
      boxShadow: theme.shadows[2]
    },
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
    }}
  >
    {t("车头泊入" as any)}
  </MenuItem>
  <MenuItem
      onClick={() => {
        props.onClickRearParkingButton();
        setAnchorEl1(null); // 添加关闭菜单
      }}
    sx={{
      fontSize: '0.875rem',
      padding: '6px 16px',
      justifyContent: 'center', // 添加水平居中
      textAlign: 'center', // 确保文字居中
                  // 新增点击反馈样式
    "&:active": {
      backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
      transform: "scale(0.98)",
      boxShadow: theme.shadows[2]
    },
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
    }}
  >
    {t("车尾泊入" as any)}
  </MenuItem>

</Menu>
  </div>

  <div>
      <Button
        variant="contained"
        onClick={(e) => setAnchorEl2(e.currentTarget)}
        sx={{
          minWidth: 60, // 从120调整为80
          width: '100%', // 新增宽度100%
          backgroundColor: theme => tc(theme.palette.secondary.main).setAlpha(0.8).toString(),
          "&:hover": {
            backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.8).toString()
          }
        }}
      >
        {t("泊出" as any)}
      </Button>

    <Menu
      anchorEl={anchorEl2}
      open={open2}
      onClose={() => setAnchorEl2(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{
        '& .MuiPaper-root': {
          minWidth: 60,
          marginTop: '8px'
        }
      }}
    >
      <MenuItem
          onClick={() => {
            props.onClickLeftParkingOutButton();
            setAnchorEl2(null); // 添加关闭菜单
          }}
        sx={{
          fontSize: '0.875rem',
          padding: '6px 16px',
          justifyContent: 'center',
          textAlign: 'center',// 确保文字居中
          // 新增点击反馈样式
          "&:active": {
          backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
          transform: "scale(0.98)",
          boxShadow: theme.shadows[2]
          },
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      >
        {t("左侧泊出" as any)}
      </MenuItem>
      <MenuItem
          onClick={() => {
            props.onClickRightParkingOutButton();
            setAnchorEl2(null); // 添加关闭菜单
          }}
        sx={{
          fontSize: '0.875rem',
          padding: '6px 16px',
          justifyContent: 'center',
          textAlign: 'center',// 确保文字居中
          // 新增点击反馈样式
          "&:active": {
          backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
          transform: "scale(0.98)",
          boxShadow: theme.shadows[2]
          },
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      >
        {t("右侧泊出" as any)}
      </MenuItem>
    </Menu>
  </div>
  <Button
  variant="contained"
  onClick={() => {
    const newDisplay = !displayText;
    setDisplayText(newDisplay);
    newDisplay ? props.onClickStartButton ?.() : props.onClickStopButton?.();
  }}
  sx={{
    minWidth: 60,
    width: '100%',
    backgroundColor: theme => tc(theme.palette.secondary.main).setAlpha(0.8).toString(),
    "&:hover": {
      backgroundColor: theme => tc(theme.palette.secondary.dark).setAlpha(0.8).toString()
    }
  }}
>
  {t(displayText ? "开始" : "停止" as any)}
</Button>
  </div>

)}
      {props.interfaceMode === "image" && <PanelContextMenu getItems={getContextMenuItems} />}
      <div ref={mousePresenceRef} className={classes.root}>
        {
          // Only show on hover for image panel
          (props.interfaceMode === "3d" || mousePresent) && (
            <Interactions
              addPanel={props.addPanel}
              interactionsTabType={interactionsTabType}
              onShowTopicSettings={props.onShowTopicSettings}
              selectedObject={selectedObject}
              setInteractionsTabType={setInteractionsTabType}
              timezone={props.timezone}
            />
          )
        }
        {props.interfaceMode === "3d" && (
          <Paper square={false} elevation={4} style={{ display: "flex", flexDirection: "column" }}>
            <Tooltip
              placement="left"
              title={
                <>
                  {`Switch to ${props.perspective ? "2" : "3"}D camera `}
                  <kbd className={classes.kbd}>3</kbd>
                </>
              }
            >
              <IconButton
                className={classes.iconButton}
                size="small"
                color={props.perspective ? "info" : "inherit"}
                onClick={props.onTogglePerspective}
              >
                <span className={classes.threeDeeButton}>3D</span>
              </IconButton>
            </Tooltip>
            <Tooltip
              placement="left"
              title={props.measureActive ? "Cancel measuring" : "Measure distance"}
            >
              <IconButton
                data-testid="measure-button"
                className={classes.iconButton}
                size="small"
                color={props.measureActive ? "info" : "inherit"}
                onClick={props.onClickMeasure}
              >
                <div className={classes.rulerIcon}>
                  {props.measureActive ? <Ruler20Filled /> : <Ruler20Regular />}
                </div>
              </IconButton>
            </Tooltip>

            {publishControls}
          </Paper>
        )}
      </div>
      {clickedObjects.length > 1 && !selectedObject && (
        <InteractionContextMenu
          onClose={() => {
            setSelectedRenderables([]);
          }}
          clickedPosition={clickedPosition}
          clickedObjects={clickedObjects}
          selectObject={(selection) => {
            if (selection) {
              const renderable = (
                selection.object as unknown as { interactionData: { renderable: Renderable } }
              ).interactionData.renderable;
              const instanceIndex = selection.instanceIndex;
              setSelectedRenderables([]);
              setSelectedRenderable({ renderable, instanceIndex });
            }
          }}
        />
      )}
      <HUD renderer={renderer} />
      {stats}
      {resetViewButton}
    </>
  );
}
