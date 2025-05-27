// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Ruler20Filled, Ruler20Regular } from "@fluentui/react-icons";
import { Computer, LockReset } from "@mui/icons-material";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Tooltip,
  useTheme
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";
import { useTranslation } from "react-i18next";
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
import { StatusPanel } from "@lichtblick/suite-base/panels/ThreeDeeRender/components/statusPanel/StatusPanel";

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
  onClickVerticalLeftParkingOutButton: () => void;
  onClickVerticalRightParkingOutButton: () => void;
  onClickParallelLeftParkingOutButton: () => void;
  onClickParallelRightParkingOutButton: () => void;
  onClickRecordTraceStartButton: () => void;
  onClickRecordTraceStopButton: () => void;
  onClickParkingModeView: () => void;
  onClickSelectParkingSlot: () => void;
  cameraLocked?: boolean;
  perspective: boolean;
  publishActive: boolean;
  publishClickType: PublishClickType;
  timezone: string | undefined;
  receivedControlMessage?: unknown; // 新增接收消息属性
  receivedPlanMessage?: unknown; // 新增接收消息属性
  receivedControlCmdMessage?: unknown; // 收到 /control_cmd channel 下的消息
  parkingSlotSelectionActive?: boolean;
  statusPanelTopics?: string[];
  onStatusPanelTopicsChange?: (topics: string[]) => void;
  receivedMessages?: Record<string, unknown>;
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
  const selectedPublishClickIcon = PublishClickIcons[props.publishClickType];

  const theme = useTheme();

  // Publish control is only available if the canPublish prop is true and we have a fixed frame in the renderer
  const showPublishControl =
    props.interfaceMode === "3d" && props.canPublish && renderer?.fixedFrameId != undefined;
  const publishControls = showPublishControl && (
    <>
      <IconButton
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

  const [displayText2, setDisplayText2] = useState(true);

  const controlActivated = useMemo(() => {
    if (!props.receivedControlMessage) {
      return false;
    }
    try {
      const msg = (props.receivedControlMessage as any)?.message ?? props.receivedControlMessage;
      return Number(msg.control_active) === 1;
    } catch (error) {
      console.error("消息解析错误:", error);
      return false;
    }
  }, [props.receivedControlMessage]);

  const [isExpanded, setIsExpanded] = useState(false);
  const [statusPanelEditMode, setStatusPanelEditMode] = useState(false);

  return (
    <>
      {/* 控制状态面板 */}
      {props.interfaceMode === "3d" && (
        <div style={{ position: "absolute", bottom: 20, left: 20, zIndex: 1000 }}>
          {/* Fixed button container */}
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            sx={{
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              padding: "6px",
              color: "#ffffff",
              borderRadius: "6px",
              "&:hover": {
                backgroundColor: "rgba(255,255,255,0.1)",
                transform: "scale(1.1)",
              },
              transition: "all 0.2s ease",
            }}
          >
            <Computer style={{ width: 18, height: 18 }} />
          </IconButton>

          {/* Expandable panel to the right of button */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 38, // Position to the right of the button
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              color: "#ffffff",
              borderRadius: 6,
              fontFamily: "monospace",
              // More responsive width handling
              width: isExpanded
                ? (statusPanelEditMode
                    ? 600 : 300)
                : 0,
              height: isExpanded ? "auto" : 0,
              maxHeight: isExpanded ? "calc(100vh - 80px)" : 0,
              minHeight: isExpanded ? 38 : 0,
              opacity: isExpanded ? 1 : 0,
              overflow: isExpanded ? "visible" : "hidden", // Change from "hidden" to "visible"
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              visibility: isExpanded ? "visible" : "hidden",
              // Add padding to ensure content doesn't touch edges
              padding: isExpanded ? "0 0 0 0" : 0,
              boxSizing: "border-box",
              // Force scrollbar to appear when needed
              overflowY: "auto",
              // Add shadow to distinguish from background
              boxShadow: "0 0 15px rgba(0, 0, 0, 0.5)",
            }}
          >
            {/* Wrap StatusPanel in a container with proper overflow handling */}
            <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
              <StatusPanel
                statusPanelTopics={props.statusPanelTopics}
                onStatusPanelTopicsChange={props.onStatusPanelTopicsChange}
                receivedMessages={props.receivedMessages}
                onEditModeChange={(editMode) => setStatusPanelEditMode(editMode)}
              />
            </div>
          </div>
        </div>
      )}

      {props.interfaceMode === "3d" && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            right: 20,
            zIndex: 1000,
            display: "flex",
            flexDirection: "row",
            gap: "8px",
          }}
        >
          <div>
            <Button
              variant="outlined"
              onClick={(e) => {
                setAnchorEl1(e.currentTarget);
              }} // ✅ 点击事件存在
              sx={{
                minWidth: 72,
                width: "100%",
                height: 32,
                color: "inherit",
                border: "1px solid",
                borderColor: (theme) =>
                  theme.palette.mode === "dark" ? "rgba(255,255,255,0.23)" : "rgba(0,0,0,0.23)",
                boxShadow: (theme) => theme.shadows[1], // 添加与3D按钮相同的阴影
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.08)",
                  boxShadow: (theme) => theme.shadows[4], // 悬停时增强阴影
                  borderColor: "currentColor",
                },
              }}
            >
              {t("泊入" as any)}
            </Button>

            <Menu
              anchorEl={anchorEl1}
              open={open1}
              onClose={() => {
                setAnchorEl1(null);
              }}
              anchorOrigin={{ vertical: "top", horizontal: "left" }}
              transformOrigin={{ vertical: "bottom", horizontal: "left" }}
              sx={{
                "& .MuiPaper-root": {
                  minWidth: 60,
                  marginTop: "8px",
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  props.onClickFrontParkingButton();
                  setAnchorEl1(null); // 添加关闭菜单
                }}
                sx={{
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center", // 添加水平居中
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
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
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center", // 添加水平居中
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {t("车尾泊入" as any)}
              </MenuItem>
            </Menu>
          </div>

          <div>
            <Button
              variant="outlined"
              onClick={(e) => {
                setAnchorEl2(e.currentTarget);
              }}
              sx={{
                minWidth: 72,
                width: "100%",
                height: 32,
                color: "inherit",
                border: "1px solid",
                borderColor: (theme) =>
                  theme.palette.mode === "dark" ? "rgba(255,255,255,0.23)" : "rgba(0,0,0,0.23)",
                boxShadow: (theme) => theme.shadows[1], // 添加与3D按钮相同的阴影
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.08)",
                  boxShadow: (theme) => theme.shadows[4], // 悬停时增强阴影
                  borderColor: "currentColor",
                },
              }}
            >
              {t("泊出" as any)}
            </Button>

            <Menu
              anchorEl={anchorEl2}
              open={open2}
              onClose={() => {
                setAnchorEl2(null);
              }}
              anchorOrigin={{ vertical: "top", horizontal: "left" }}
              transformOrigin={{ vertical: "bottom", horizontal: "left" }}
              sx={{
                "& .MuiPaper-root": {
                  minWidth: 60,
                  marginTop: "8px",
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  props.onClickVerticalLeftParkingOutButton();
                  setAnchorEl2(null); // 添加关闭菜单
                }}
                sx={{
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center",
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {t("垂直左侧泊出" as any)}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  props.onClickVerticalRightParkingOutButton();
                  setAnchorEl2(null); // 添加关闭菜单
                }}
                sx={{
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center",
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {t("垂直右侧泊出" as any)}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  props.onClickParallelLeftParkingOutButton();
                  setAnchorEl2(null); // 添加关闭菜单
                }}
                sx={{
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center",
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {t("水平左侧泊出" as any)}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  props.onClickParallelRightParkingOutButton();
                  setAnchorEl2(null); // 添加关闭菜单
                }}
                sx={{
                  fontSize: "0.75rem",
                  padding: "6px 16px",
                  justifyContent: "center",
                  textAlign: "center", // 确保文字居中
                  // 新增点击反馈样式
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.9).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {t("水平右侧泊出" as any)}
              </MenuItem>
            </Menu>
          </div>
          {publishControls && (
            <div>
              <Button
                variant="outlined"
                onClick={props.onClickSelectParkingSlot}
                sx={{
                  minWidth: 100,
                  width: "100%",
                  height: 32,
                  color: props.parkingSlotSelectionActive ? "success.main" : "inherit", // Change color when active
                  border: "1px solid",
                  borderColor: (theme) =>
                    props.parkingSlotSelectionActive
                      ? theme.palette.success.main
                      : theme.palette.mode === "dark" ? "rgba(255,255,255,0.23)" : "rgba(0,0,0,0.23)",
                  boxShadow: (theme) => theme.shadows[1],
                  backgroundColor: (theme) =>
                    props.parkingSlotSelectionActive
                      ? tc(theme.palette.success.main).setAlpha(0.1).toString()
                      : "transparent",
                  "&:hover": {
                    backgroundColor: (theme) =>
                      props.parkingSlotSelectionActive
                        ? tc(theme.palette.success.main).setAlpha(0.2).toString()
                        : "rgba(255,255,255,0.08)",
                    boxShadow: (theme) => theme.shadows[4],
                    borderColor: "currentColor",
                  },
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.5).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                }}
              >
                {t(props.parkingSlotSelectionActive ? "定位中" as any : "自定义车位" as any)}
              </Button>
            </div>
          )}
          {publishControls && (
            <div>
              <Button
                variant="outlined"
                onClick={props.onClickPublish}
                sx={{
                  minWidth: 72,
                  width: "100%",
                  height: 32,
                  color: "inherit",
                  border: "1px solid",
                  borderColor: (theme) =>
                    theme.palette.mode === "dark" ? "rgba(255,255,255,0.23)" : "rgba(0,0,0,0.23)",
                  boxShadow: (theme) => theme.shadows[1], // 添加与3D按钮相同的阴影
                  "&:hover": {
                    backgroundColor: "rgba(255,255,255,0.08)",
                    boxShadow: (theme) => theme.shadows[4], // 悬停时增强阴影
                    borderColor: "currentColor",
                  },
                  "&:active": {
                    backgroundColor: (theme) =>
                      tc(theme.palette.secondary.dark).setAlpha(0.5).toString(),
                    transform: "scale(0.98)",
                    boxShadow: theme.shadows[2],
                  },
                }}
              >
                {t("选车位" as any)}
              </Button>
            </div>
          )}
          <Button
            variant="outlined"
            onClick={() => {
              !controlActivated ? props.onClickStartButton() : props.onClickStopButton();
            }}
            sx={{
              minWidth: 72,
              width: "100%",
              height: 32,
              // 动态颜色设置
              color: "inherit",
              backgroundColor: (theme) =>
                !controlActivated
                  ? tc(theme.palette.success.main).setAlpha(0.2).toString() // 绿色背景
                  : tc(theme.palette.error.main).setAlpha(0.2).toString(), // 红色背景
              border: "1px solid",
              borderColor: (theme) =>
                !controlActivated
                  ? theme.palette.success.main // 绿色边框
                  : theme.palette.error.main, // 红色边框
              boxShadow: (theme) => theme.shadows[1],
              "&:hover": {
                backgroundColor: (theme) =>
                  !controlActivated
                    ? tc(theme.palette.success.main).setAlpha(0.3).toString() // 悬停加深绿色
                    : tc(theme.palette.error.main).setAlpha(0.3).toString(), // 悬停加深红色
                boxShadow: (theme) => theme.shadows[4],
                borderColor: "currentColor",
              },
              // 新增点击状态样式
              "&:active": {
                backgroundColor: (theme) =>
                  !controlActivated
                    ? tc(theme.palette.success.dark).setAlpha(0.5).toString()
                    : tc(theme.palette.error.dark).setAlpha(0.5).toString(),
                transform: "scale(0.98)",
              },
              transition: "all 0.2s ease",
            }}
          >
            {t(!controlActivated ? "开始泊车" : ("终止泊车" as any))}
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setDisplayText2(!displayText2);
              displayText2
                ? props.onClickRecordTraceStartButton()
                : props.onClickRecordTraceStopButton();
            }}
            sx={{
              minWidth: 72,
              width: "100%",
              height: 32,
              // 动态颜色设置
              color: "inherit",
              backgroundColor: (theme) =>
                displayText2
                  ? tc(theme.palette.success.main).setAlpha(0.2).toString() // 绿色背景
                  : tc(theme.palette.error.main).setAlpha(0.2).toString(), // 红色背景
              border: "1px solid",
              borderColor: (theme) =>
                displayText2
                  ? theme.palette.success.main // 绿色边框
                  : theme.palette.error.main, // 红色边框
              boxShadow: (theme) => theme.shadows[1],
              "&:hover": {
                backgroundColor: (theme) =>
                  displayText2
                    ? tc(theme.palette.success.main).setAlpha(0.3).toString() // 悬停加深绿色
                    : tc(theme.palette.error.main).setAlpha(0.3).toString(), // 悬停加深红色
                boxShadow: (theme) => theme.shadows[4],
                borderColor: "currentColor",
              },
              // 新增点击状态样式
              "&:active": {
                backgroundColor: (theme) =>
                  !controlActivated
                    ? tc(theme.palette.success.dark).setAlpha(0.5).toString()
                    : tc(theme.palette.error.dark).setAlpha(0.5).toString(),
                transform: "scale(0.98)",
              },
              transition: "all 0.2s ease",
            }}
          >
            {t(displayText2 ? "开始录制" : ("停止录制" as any))}
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
            <Tooltip
              placement="left"
              title={
                <>
                  {`${props.cameraLocked ? "Unlock view" : "Switch to follow mode and lock view"}`}
                  <kbd className={classes.kbd}>P</kbd>
                </>
              }
            >
              <IconButton
                className={classes.iconButton}
                size="small"
                color={props.cameraLocked? "info" : "inherit"}
                onClick={props.onClickParkingModeView}
              >
                <LockReset fontSize="small" />
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
