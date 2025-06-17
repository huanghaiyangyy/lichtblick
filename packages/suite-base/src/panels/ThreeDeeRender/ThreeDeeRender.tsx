// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useLatest } from "react-use";
import { DeepPartial } from "ts-essentials";
import { useDebouncedCallback } from "use-debounce";

import Logger from "@lichtblick/log";
import { Time, toNanoSec } from "@lichtblick/rostime";
import {
  Immutable,
  LayoutActions,
  MessageEvent,
  ParameterValue,
  RenderState,
  SettingsTreeAction,
  SettingsTreeNodes,
  Subscription,
  Topic,
} from "@lichtblick/suite";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  DEFAULT_SCENE_EXTENSION_CONFIG,
  SceneExtensionConfig,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import type {
  FollowMode,
  IRenderer,
  ImageModeConfig,
  RendererConfig,
  RendererSubscription,
  TestOptions,
} from "./IRenderer";
import type { PickedRenderable } from "./Picker";
import { SELECTED_ID_VARIABLE } from "./Renderable";
import { Renderer } from "./Renderer";
import { RendererContext, useRendererEvent, useRendererProperty } from "./RendererContext";
import { RendererOverlay } from "./RendererOverlay";
import { CameraState, DEFAULT_CAMERA_STATE, PARKING_MODE_VIEW_3D, PARKING_MODE_VIEW_2D } from "./camera";
import {
  PublishRos1Datatypes,
  PublishRos2Datatypes,
  PublishProtoDatatypes,
  makePointMessage,
  makePoseEstimateMessage,
  makePoseMessage,
  makeFoxglovePoseMessage,
  pointTransform,
  poseTransform,
} from "./publish";
import type { LayerSettingsTransform } from "./renderables/FrameAxes";
import { PublishClickEventMap } from "./renderables/PublishClickTool";
import { DEFAULT_PUBLISH_SETTINGS } from "./renderables/PublishSettings";
import { InterfaceMode } from "./types";
import { TopicAdvertisementManager } from "@lichtblick/suite-base/panels/ThreeDeeRender/TopicAdvertisementManager";
import { ParkingSlots } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/parkingSlots/ParkingSlots";
import { makePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";

const log = Logger.getLogger(__filename);

const SCHEMA_MAP = {
  ros1:{
    "clicked_point": "geometry_msgs/PointStamped",
    "clicked_pose": "geometry_msgs/PoseStamped",
    "clicked_pose_estimate": "geometry_msgs/PoseWithCovarianceStamped",
    "/control_switch": "std_msgs/Int32",
    "/park_out_type": "std_msgs/String",
    "/parking_head_in": "std_msgs/Int32",
    "/record_trace": "std_msgs/Int32",
    "/selected_parking_slot": "geometry_msgs/PoseStamped",
  },
  ros2:{
    "clicked_point": "geometry_msgs/msg/PointStamped",
    "clicked_pose": "geometry_msgs/msg/PoseStamped",
    "clicked_pose_estimate": "geometry_msgs/msg/PoseWithCovarianceStamped",
    "/control_switch": "std_msgs/msg/Int32",
    "/park_out_type": "std_msgs/msg/String",
    "/parking_head_in": "std_msgs/msg/Int32",
    "/record_trace": "std_msgs/msg/Int32",
    "/selected_parking_slot": "geometry_msgs/msg/PoseStamped",
  },
  protobuf:{
    "clicked_point": "foxglove.PoseInFrame",
    "clicked_pose": "foxglove.PoseInFrame",
    "clicked_pose_estimate": "foxglove.PoseInFrame",
    "/control_switch": "apa.std_msgs.Int32",
    "/park_out_type": "apa.std_msgs.String",
    "/parking_head_in": "apa.std_msgs.Int32",
    "/record_trace": "apa.std_msgs.Int32",
    "/selected_parking_slot": "foxglove.PoseInFrame",
  },
  default: {
    "clicked_point": "geometry_msgs/PointStamped",
    "clicked_pose": "geometry_msgs/PoseStamped",
    "clicked_pose_estimate": "geometry_msgs/PoseWithCovarianceStamped",
    "/control_switch": "std_msgs/Int32",
    "/park_out_type": "std_msgs/String",
    "/parking_head_in": "std_msgs/Int32",
    "/record_trace": "std_msgs/Int32",
    "/selected_parking_slot": "geometry_msgs/PoseStamped",
  },
};

type Shared3DPanelState = {
  cameraState: CameraState;
  followMode: FollowMode;
  followTf: undefined | string;
};

const PANEL_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  position: "relative",
};

/**
 * A panel that renders a 3D scene. This is a thin wrapper around a `Renderer` instance.
 */
export function ThreeDeeRender(props: {
  context: BuiltinPanelExtensionContext;  // 提供面板与宿主环境的交互能力：状态保存/加载，数据订阅，布局操作，资源加载
  interfaceMode: InterfaceMode;
  testOptions: TestOptions;
  /** Allow for injection or overriding of default extensions by custom extensions */
  customSceneExtensions?: DeepPartial<SceneExtensionConfig>;
}): React.JSX.Element {
  const { context, interfaceMode, testOptions, customSceneExtensions } = props;
  const {
    initialState,
    saveState,
    unstable_fetchAsset: fetchAsset,  // 将 context 中的 unstable_fetchAsset 拿出来并重命名为 fetchAsset
    unstable_setMessagePathDropConfig: setMessagePathDropConfig,
  } = context;
  const analytics = useAnalytics(); // 一个使用 React Context 机制获取预先注入的分析工具

  // Load and save the persisted panel configuration
  const [config, setConfig] = useState<Immutable<RendererConfig>>(() => { // 这里定义了一个设置 config 的 Hook
    const partialConfig = initialState as DeepPartial<RendererConfig> | undefined;

    // Initialize the camera from default settings overlaid with persisted settings
    const cameraState: CameraState = _.merge(
      _.cloneDeep(DEFAULT_CAMERA_STATE),
      partialConfig?.cameraState,
    );
    const publish = _.merge(_.cloneDeep(DEFAULT_PUBLISH_SETTINGS), partialConfig?.publish);

    const transforms = (partialConfig?.transforms ?? {}) as Record<
      string,
      Partial<LayerSettingsTransform>
    >;

    return {
      cameraState,
      followMode: partialConfig?.followMode ?? "follow-pose",
      renderTf: partialConfig?.renderTf,
      followTf: partialConfig?.followTf,
      scene: partialConfig?.scene ?? {},
      transforms,
      topics: partialConfig?.topics ?? {},
      layers: partialConfig?.layers ?? {},
      publish,
      // deep partial on config, makes gradient tuple type [string | undefined, string | undefined]
      // which is incompatible with `Partial<ColorModeSettings>`
      imageMode: (partialConfig?.imageMode ?? {}) as Partial<ImageModeConfig>,
    };
  });
  const configRef = useLatest(config);
  const { cameraState } = config;
  const backgroundColor = config.scene.backgroundColor;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | ReactNull>(ReactNull);
  const [renderer, setRenderer] = useState<IRenderer | undefined>(undefined);
  const rendererRef = useRef<IRenderer | undefined>(undefined);

  const { enqueueSnackbar } = useSnackbar();  // snackbar 是一个用来显示 notification 的组件

  const displayTemporaryError = useCallback(
    (errorString: string) => {
      enqueueSnackbar(errorString, { variant: "error" });
    },
    [enqueueSnackbar],
  );

  useEffect(() => {
    const newRenderer = canvas  // 副作用逻辑：在组件挂载，或者更新时执行
      ? new Renderer({
          canvas,
          config: configRef.current,
          interfaceMode,
          fetchAsset,
          sceneExtensionConfig: _.merge(
            {},
            DEFAULT_SCENE_EXTENSION_CONFIG,
            customSceneExtensions ?? {},
          ),
          displayTemporaryError,
          testOptions,
        })
      : undefined;
    setRenderer(newRenderer);
    rendererRef.current = newRenderer;
    return () => {  // 清理逻辑：在组件卸载，或者下次 effect 执行前执行
      rendererRef.current?.dispose();
      rendererRef.current = undefined;
    };
  }, [  // 依赖数组，依赖数组中的变量发生变化时，useEffect 会重新执行
    canvas,
    configRef,
    config.scene.transforms?.enablePreloading,
    customSceneExtensions,
    interfaceMode,
    fetchAsset,
    testOptions,
    displayTemporaryError,
  ]);

  useEffect(() => {
    if (renderer) {
      renderer.setAnalytics(analytics);
    }
  }, [renderer, analytics]);

  useEffect(() => {
    setMessagePathDropConfig(
      renderer
        ? {
            getDropStatus: renderer.getDropStatus,
            handleDrop: renderer.handleDrop,
          }
        : undefined,
    );
  }, [setMessagePathDropConfig, renderer]);

  const [colorScheme, setColorScheme] = useState<"dark" | "light" | undefined>();
  const [timezone, setTimezone] = useState<string | undefined>();
  const [topics, setTopics] = useState<ReadonlyArray<Topic> | undefined>();
  const [parameters, setParameters] = useState<
    Immutable<Map<string, ParameterValue>> | undefined
  >();
  const [currentFrameMessages, setCurrentFrameMessages] = useState<
    ReadonlyArray<MessageEvent> | undefined
  >();
  const [currentTime, setCurrentTime] = useState<Time | undefined>();
  const [didSeek, setDidSeek] = useState<boolean>(false);
  const [sharedPanelState, setSharedPanelState] = useState<undefined | Shared3DPanelState>();
  const [allFrames, setAllFrames] = useState<readonly MessageEvent[] | undefined>(undefined);

  const renderRef = useRef({ needsRender: false });
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  const schemaSubscriptions = useRendererProperty(
    "schemaSubscriptions",
    "schemaSubscriptionsChanged",
    () => new Map(),
    renderer,
  );
  const topicSubscriptions = useRendererProperty(
    "topicSubscriptions",
    "topicSubscriptionsChanged",
    () => new Map(),
    renderer,
  );

  // Config cameraState
  useEffect(() => {
    const listener = () => {
      if (renderer) {
        const newCameraState = renderer.getCameraState();
        if (!newCameraState) {
          return;
        }
        // This needs to be before `setConfig` otherwise flickering will occur during
        // non-follow mode playback
        renderer.setCameraState(newCameraState);
        setConfig((prevConfig) => ({ ...prevConfig, cameraState: newCameraState }));

        if (config.scene.syncCamera === true) {
          context.setSharedPanelState({
            cameraState: newCameraState,
            followMode: config.followMode,
            followTf: renderer.renderFrameId,
          });
        }
      }
    };
    renderer?.addListener("cameraMove", listener);
    return () => void renderer?.removeListener("cameraMove", listener);
  }, [config.scene.syncCamera, config.followMode, context, renderer?.renderFrameId, renderer]);

  // Handle user changes in the settings sidebar
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      // Wrapping in unstable_batchedUpdates causes React to run effects _after_ the handleAction
      // function has finished executing. This allows scene extensions that call
      // renderer.updateConfig to read out the new config value and configure their renderables
      // before the render occurs.
      ReactDOM.unstable_batchedUpdates(() => {
        if (renderer) {
          const initialCameraState = renderer.getCameraState();
          renderer.settings.handleAction(action);
          const updatedCameraState = renderer.getCameraState();
          // Communicate camera changes from settings to the global state if syncing.
          if (updatedCameraState !== initialCameraState && config.scene.syncCamera === true) {
            context.setSharedPanelState({
              cameraState: updatedCameraState,
              followMode: config.followMode,
              followTf: renderer.renderFrameId,
            });
          }
        }
      });
    },
    [config.followMode, config.scene.syncCamera, context, renderer],
  );

  // Maintain the settings tree
  const [settingsTree, setSettingsTree] = useState<SettingsTreeNodes | undefined>(undefined);
  const updateSettingsTree = useCallback((curRenderer: IRenderer) => {
    setSettingsTree(curRenderer.settings.tree());
  }, []);
  useRendererEvent("settingsTreeChange", updateSettingsTree, renderer);

  // Save the panel configuration when it changes
  const updateConfig = useCallback((curRenderer: IRenderer) => {
    setConfig(curRenderer.config);
  }, []);
  useRendererEvent("configChange", updateConfig, renderer);

  // Write to a global variable when the current selection changes
  const updateSelectedRenderable = useCallback(
    (selection: PickedRenderable | undefined) => {
      const id = selection?.renderable.idFromMessage();
      const customVariable = selection?.renderable.selectedIdVariable();
      if (customVariable) {
        context.setVariable(customVariable, id);
      }
      context.setVariable(SELECTED_ID_VARIABLE, id);
    },
    [context],
  );
  useRendererEvent("selectedRenderable", updateSelectedRenderable, renderer);

  const [focusedSettingsPath, setFocusedSettingsPath] = useState<undefined | readonly string[]>();

  const onShowTopicSettings = useCallback((topic: string) => {
    setFocusedSettingsPath(["topics", topic]);
  }, []);

  // Rebuild the settings sidebar tree as needed
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler,
      enableFilter: true,
      focusedPath: focusedSettingsPath,
      nodes: settingsTree ?? {},
    });
  }, [actionHandler, context, focusedSettingsPath, settingsTree]);

  // Update the renderer's reference to `config` when it changes. Note that this does *not*
  // automatically update the settings tree.
  useEffect(() => {
    if (renderer) {
      renderer.config = config;
      renderRef.current.needsRender = true;
    }
  }, [config, renderer]);

  // Update the renderer's reference to `topics` when it changes
  useEffect(() => {
    if (renderer) {
      renderer.setTopics(topics);
      renderRef.current.needsRender = true;
    }
  }, [topics, renderer]);

  // Tell the renderer if we are connected to a ROS data source
  useEffect(() => {
    if (renderer) {
      renderer.ros = context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2";
    }
  }, [context.dataSourceProfile, renderer]);

  // Save panel settings whenever they change
  const throttledSave = useDebouncedCallback(
    (newConfig: Immutable<RendererConfig>) => {
      saveState(newConfig);
    },
    1000,
    { leading: false, trailing: true, maxWait: 1000 },
  );
  useEffect(() => throttledSave(config), [config, throttledSave]);

  // Keep default panel title up to date with selected image topic in image mode
  useEffect(() => {
    if (interfaceMode === "image") {
      context.setDefaultPanelTitle(config.imageMode.imageTopic);
    }
  }, [interfaceMode, context, config.imageMode.imageTopic]);

  // Establish a connection to the message pipeline with context.watch and context.onRender
  useLayoutEffect(() => {
    context.onRender = (renderState: Immutable<RenderState>, done) => {
      ReactDOM.unstable_batchedUpdates(() => {
        if (renderState.currentTime) {
          setCurrentTime(renderState.currentTime);
        }

        // Check if didSeek is set to true to reset the preloadedMessageTime and
        // trigger a state flush in Renderer
        if (renderState.didSeek === true) {
          setDidSeek(true);
        }

        // Set the done callback into a state variable to trigger a re-render
        setRenderDone(() => done);

        // Keep UI elements and the renderer aware of the current color scheme
        setColorScheme(renderState.colorScheme);
        if (renderState.appSettings) {
          const tz = renderState.appSettings.get(AppSetting.TIMEZONE);
          setTimezone(typeof tz === "string" ? tz : undefined);
        }

        // We may have new topics - since we are also watching for messages in
        // the current frame, topics may not have changed
        setTopics(renderState.topics);

        setSharedPanelState(renderState.sharedPanelState as Shared3DPanelState);

        // Watch for any changes in the map of observed parameters
        setParameters(renderState.parameters);

        // currentFrame has messages on subscribed topics since the last render call
        setCurrentFrameMessages(renderState.currentFrame);

        // allFrames has messages on preloaded topics across all frames (as they are loaded)
        setAllFrames(renderState.allFrames);
      });
    };

    context.watch("allFrames");
    context.watch("colorScheme");
    context.watch("currentFrame");
    context.watch("currentTime");
    context.watch("didSeek");
    context.watch("parameters");
    context.watch("sharedPanelState");
    context.watch("topics");
    context.watch("appSettings");
    context.subscribeAppSettings([AppSetting.TIMEZONE]);
  }, [context, renderer]);

  // Build a list of topics to subscribe to
  const [topicsToSubscribe, setTopicsToSubscribe] = useState<Subscription[] | undefined>(undefined);
  useEffect(() => {
    if (!topics) {
      setTopicsToSubscribe(undefined);
      return;
    }

    const newSubscriptions: Subscription[] = [];

    const addSubscription = (
      topic: Topic,
      rendererSubscription: RendererSubscription,
      convertTo?: string,
    ) => {
      let shouldSubscribe = rendererSubscription.shouldSubscribe?.(topic.name);
      if (shouldSubscribe == undefined) {
        if (config.topics[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else if (config.imageMode.annotations?.[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else {
          shouldSubscribe = false;
        }
      }
      if (shouldSubscribe) {
        newSubscriptions.push({
          topic: topic.name,
          preload: rendererSubscription.preload,
          convertTo,
        });
      }
    };

    for (const topic of topics) {
      for (const rendererSubscription of topicSubscriptions.get(topic.name) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const rendererSubscription of schemaSubscriptions.get(topic.schemaName) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const schemaName of topic.convertibleTo ?? []) {
        for (const rendererSubscription of schemaSubscriptions.get(schemaName) ?? []) {
          addSubscription(topic, rendererSubscription, schemaName);
        }
      }
    }
    // control_debug订阅配置
    if (topics.some((t) => t.name === "/control_debug")) {
      newSubscriptions.push({
        topic: "/control_debug",
        preload: false,
        // 使用原始消息类型（不进行convertTo）
        convertTo: undefined,
      });
    }

    // 新增planning_debug订阅
    if (topics.some((t) => t.name === "/planning_debug")) {
      newSubscriptions.push({
        topic: "/planning_debug",
        preload: false,
        convertTo: undefined,
      });
    }

    // control_cmd订阅配置
    if (topics.some((t) => t.name === "/control_cmd")) {
      newSubscriptions.push({
        topic: "/control_cmd",
        preload: false,
        convertTo: undefined,
      });
    }

    // 新增 /parking_slots 订阅
    if (topics.some((t) => t.name === "/parking_slots")) {
      newSubscriptions.push({
        topic: "/parking_slots",
        preload: false,
        convertTo: undefined,
      });
    }

    // 新增 /vis_grid_map 订阅
    if (topics.some((t) => t.name === "/vis_grid_map")) {
      newSubscriptions.push({
        topic: "/vis_grid_map",
        preload: false,
        convertTo: undefined,
      });
    }

    // 新增 /vehicle_odom 订阅
    if (topics.some((t) => t.name === "/vehicle_odom")) {
      newSubscriptions.push({
        topic: "/vehicle_odom",
        preload: false,
        convertTo: undefined,
      });
    }

    // console.log('[调试] 生成新订阅列表:', newSubscriptions); // 新增调试日志
    // Sort the list to make comparisons stable
    newSubscriptions.sort((a, b) => a.topic.localeCompare(b.topic));
    setTopicsToSubscribe((prev) => (_.isEqual(prev, newSubscriptions) ? prev : newSubscriptions));
  }, [
    topics,
    config.topics,
    // Need to update subscriptions when imagemode topics change
    // shouldSubscribe values will be re-evaluated
    config.imageMode.calibrationTopic,
    config.imageMode.imageTopic,
    schemaSubscriptions,
    topicSubscriptions,
    config.imageMode.annotations,
    // Need to update subscriptions when layers change as URDF layers might subscribe to topics
    // shouldSubscribe values will be re-evaluated
    config.layers,
  ]);

  // Notify the extension context when our subscription list changes
  useEffect(() => {
    if (!topicsToSubscribe) {
      return;
    }
    log.debug(`Subscribing to [${topicsToSubscribe.map((t) => JSON.stringify(t)).join(", ")}]`);
    context.subscribe(topicsToSubscribe);
  }, [context, topicsToSubscribe]);

  // Keep the renderer parameters up to date
  useEffect(() => {
    if (renderer) {
      renderer.setParameters(parameters);
    }
  }, [parameters, renderer]);

  // Keep the renderer currentTime up to date and handle seeking
  useEffect(() => {
    const newTimeNs = currentTime ? toNanoSec(currentTime) : undefined;

    /*
     * NOTE AROUND SEEK HANDLING
     * Seeking MUST be handled even if there is no change in current time.  When there is a subscription
     * change while paused, the player goes into `seek-backfill` which sets didSeek to true.
     *
     * We cannot early return here when there is no change in current time due to that, otherwise it would
     * handle seek next time the current time changes and clear the backfilled messages and transforms.
     */
    if (!renderer || newTimeNs == undefined) {
      return;
    }
    const oldTimeNs = renderer.currentTime;

    renderer.setCurrentTime(newTimeNs);
    if (didSeek) {
      renderer.handleSeek(oldTimeNs);
      setDidSeek(false);
    }
  }, [currentTime, renderer, didSeek]);

  // Keep the renderer colorScheme and backgroundColor up to date
  useEffect(() => {
    if (colorScheme && renderer) {
      renderer.setColorScheme(colorScheme, backgroundColor);
      renderRef.current.needsRender = true;
    }
  }, [backgroundColor, colorScheme, renderer]);

  // Handle preloaded messages and render a frame if new messages are available
  // Should be called before `messages` is handled
  useEffect(() => {
    // we want didseek to be handled by the renderer first so that transforms aren't cleared after the cursor has been brought up
    if (!renderer || !currentTime) {
      return;
    }
    const newMessagesHandled = renderer.handleAllFramesMessages(allFrames);
    if (newMessagesHandled) {
      renderRef.current.needsRender = true;
    }
  }, [renderer, currentTime, allFrames]);

  // 添加消息接收状态
  const [receivedControlMessage, setreceivedControlMessage] = useState<unknown>();
  const [receivedPlanMessage, setReceivedPlanMessage] = useState<unknown>();
  const [receivedControlCmdMessage, setreceivedControlCmdMessage] = useState<unknown>();
  const [receivedParkingSlotsMessage, setReceivedParkingSlotsMessage] = useState<unknown>();
  const [receivedVisGridMapMessage, setReceivedVisGridMapMessage] = useState<unknown>();
  const [receivedVehicleOdomMessage, setReceivedVehicleOdomMessage] = useState<unknown>();
  // Handle messages and render a frame if new messages are available
  useEffect(() => {
    if (!renderer || !currentFrameMessages) return;

    let hasControlMsg = false;
    let hasControlCmdMsg = false;
    let hasPlanMsg = false;
    let hasParkingSlotsMsg = false;
    let hasVisGridMapMsg = false;
    let hasVehicleOdomMsg = false;

    currentFrameMessages.forEach((message) => {
      if (message.topic === "/control_debug") {
        setreceivedControlMessage(message);
        hasControlMsg = true;
      } else if (message.topic === "/control_cmd") {
        setreceivedControlCmdMessage(message);
        hasControlCmdMsg = true;
      } else if (message.topic === "/planning_debug") {
        setReceivedPlanMessage(message);
        hasPlanMsg = true;
      } else if (message.topic === "/parking_slots") {
        setReceivedParkingSlotsMessage(message);
        hasParkingSlotsMsg = true;
      } else if (message.topic === "/vis_grid_map") {
        setReceivedVisGridMapMessage(message);
        hasVisGridMapMsg = true;
      } else if (message.topic === "/vehicle_odom") {
        setReceivedVehicleOdomMessage(message);
        hasVehicleOdomMsg = true;
      }
      renderer.addMessageEvent(message);
    });

    let statusMessage = "当前帧状态: ";
    const missingMessage: string[] = [];
    if (!hasControlMsg) missingMessage.push("/control_debug");
    if (!hasControlCmdMsg) missingMessage.push("/control_cmd");
    if (!hasPlanMsg) missingMessage.push("/planning_debug");
    if (!hasParkingSlotsMsg) missingMessage.push("/parking_slots");
    if (!hasVisGridMapMsg) missingMessage.push("/vis_grid_map");
    if (!hasVehicleOdomMsg) missingMessage.push("/vehicle_odom");
    if (missingMessage.length > 0) {
      statusMessage += "缺少消息: " + missingMessage.join(", ");
    } else {
      statusMessage += "消息完整";
    }
    console.log(statusMessage);


    renderRef.current.needsRender = true;
  }, [currentFrameMessages, renderer]);

  // Update the renderer when the camera moves
  useEffect(() => {
    if (!_.isEqual(cameraState, renderer?.getCameraState())) {
      renderer?.setCameraState(cameraState);
      renderRef.current.needsRender = true;
    }
  }, [cameraState, renderer]);

  // Sync camera with shared state, if enabled.
  useEffect(() => {
    if (!renderer || sharedPanelState == undefined || config.scene.syncCamera !== true) {
      return;
    }

    if (sharedPanelState.followMode !== config.followMode) {
      renderer.setCameraSyncError(
        `Follow mode must be ${sharedPanelState.followMode} to sync camera.`,
      );
    } else if (sharedPanelState.followTf !== renderer.renderFrameId) {
      renderer.setCameraSyncError(
        `Display frame must be ${sharedPanelState.followTf} to sync camera.`,
      );
    } else {
      const newCameraState = sharedPanelState.cameraState;
      renderer.setCameraState(newCameraState);
      renderRef.current.needsRender = true;
      setConfig((prevConfig) => ({
        ...prevConfig,
        cameraState: newCameraState,
      }));
      renderer.setCameraSyncError(undefined);
    }
  }, [
    config.scene.syncCamera,
    config.followMode,
    renderer,
    renderer?.renderFrameId,
    sharedPanelState,
  ]);

  // Render a new frame if requested
  useEffect(() => {
    if (renderer && renderRef.current.needsRender) {
      renderer.animationFrame();
      renderRef.current.needsRender = false;
    }
  });

  // Invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  // Create a useCallback wrapper for adding a new panel to the layout, used to open the
  // "Raw Messages" panel from the object inspector
  const addPanel = useCallback(
    (params: Parameters<LayoutActions["addPanel"]>[0]) => {
      context.layout.addPanel(params);
    },
    [context.layout],
  );

  const [measureActive, setMeasureActive] = useState(false);
  useEffect(() => {
    const onStart = () => {
      setMeasureActive(true);
    };
    const onEnd = () => {
      setMeasureActive(false);
    };
    renderer?.measurementTool.addEventListener("foxglove.measure-start", onStart);
    renderer?.measurementTool.addEventListener("foxglove.measure-end", onEnd);
    return () => {
      renderer?.measurementTool.removeEventListener("foxglove.measure-start", onStart);
      renderer?.measurementTool.removeEventListener("foxglove.measure-end", onEnd);
    };
  }, [renderer?.measurementTool]);

  const onClickMeasure = useCallback(() => {
    if (measureActive) {
      renderer?.measurementTool.stopMeasuring();
    } else {
      renderer?.measurementTool.startMeasuring();
      renderer?.publishClickTool.stop();
    }
  }, [measureActive, renderer]);

  const [publishActive, setPublishActive] = useState(false);
  useEffect(() => {
    if (renderer?.publishClickTool.publishClickType !== config.publish.type) {
      renderer?.publishClickTool.setPublishClickType(config.publish.type);
      // stop if we changed types while a publish action was already in progress
      renderer?.publishClickTool.stop();
    }
  }, [config.publish.type, renderer]);

  const publishTopics = useMemo(() => {
    return {
      goal: config.publish.poseTopic,
      point: config.publish.pointTopic,
      pose: config.publish.poseEstimateTopic,
    };
  }, [config.publish.poseTopic, config.publish.pointTopic, config.publish.poseEstimateTopic]);

  const topicManager = useMemo(() => TopicAdvertisementManager.getInstance(), []);
  useEffect(() => {
    const datatypes =
      context.dataSourceProfile === "ros2" ? PublishRos2Datatypes :
      context.dataSourceProfile === "ros1" ? PublishRos1Datatypes :
      context.dataSourceProfile === "protobuf" ? PublishProtoDatatypes :
      undefined;

    const schemaKey = (context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2" || context.dataSourceProfile === "protobuf")
      ? context.dataSourceProfile
      : "default";

    topicManager.advertise(context, publishTopics.goal, SCHEMA_MAP[schemaKey]["/selected_parking_slot"], { datatypes });
    topicManager.advertise(context, publishTopics.point, SCHEMA_MAP[schemaKey]["clicked_point"], { datatypes });
    topicManager.advertise(context, publishTopics.pose, SCHEMA_MAP[schemaKey]["clicked_pose_estimate"], { datatypes });
    topicManager.advertise(context, "/control_switch", SCHEMA_MAP[schemaKey]["/control_switch"], { datatypes });
    topicManager.advertise(context, "/park_out_type", SCHEMA_MAP[schemaKey]["/park_out_type"], { datatypes });
    topicManager.advertise(context, "/parking_head_in", SCHEMA_MAP[schemaKey]["/parking_head_in"], { datatypes });
    topicManager.advertise(context, "/record_trace", SCHEMA_MAP[schemaKey]["/record_trace"], { datatypes });
    return () => {
      topicManager.unadvertise(context, publishTopics.goal);
      topicManager.unadvertise(context, publishTopics.point);
      topicManager.unadvertise(context, publishTopics.pose);
      topicManager.unadvertise(context, "/control_switch");
      topicManager.unadvertise(context, "/park_out_type");
      topicManager.unadvertise(context, "/parking_head_in");
      topicManager.unadvertise(context, "/record_trace");
    };
  }, [publishTopics, context, context.dataSourceProfile]);

  const latestPublishConfig = useLatest(config.publish);

  useEffect(() => {
    const onStart = () => {
      setPublishActive(true);
    };
    const onSubmit = (event: PublishClickEventMap["foxglove.publish-submit"]) => {
      const renderFrameId = renderer?.renderFrameId;
      const publishFrameId = latestPublishConfig.current.publishFrame ?? renderFrameId;
      if (renderFrameId == undefined) {
        log.warn("Unable to publish, renderFrameId is not set");
        return;
      }
      if (publishFrameId == undefined) {
        log.warn("Unable to publish, publishFrameId is not set");
        return;
      }
      if (!context.publish) {
        log.error("Data source does not support publishing");
        return;
      }
      if (context.dataSourceProfile !== "ros1" &&
          context.dataSourceProfile !== "ros2" &&
          context.dataSourceProfile !== "protobuf") {
        log.warn("Publishing is only supported in ros1 and ros2");
        return;
      }

      try {
        switch (event.publishClickType) {
          case "point": {
            if (context.dataSourceProfile === "protobuf"){
              let point = pointTransform(event.point, renderFrameId, publishFrameId, renderer);
              // convert point to pose
              const pose = {
                position: {
                  x: point.x,
                  y: point.y,
                  z: point.z,
                },
                orientation: {
                  x: 0,
                  y: 0,
                  z: 0,
                  w: 1,
                },
              };
              const message = makeFoxglovePoseMessage(pose, publishFrameId);
              context.publish(publishTopics.point, message);
            } else {
              let point = pointTransform(event.point, renderFrameId, publishFrameId, renderer);
              const message = makePointMessage(point, publishFrameId);
              context.publish(publishTopics.point, message);
            }
            break;
          }
          case "pose": {
            let pose = poseTransform(event.pose, renderFrameId, publishFrameId, renderer);
            const message =
              context.dataSourceProfile === "protobuf"?
                makeFoxglovePoseMessage(pose, publishFrameId) :
                makePoseMessage(pose, publishFrameId);
            console.debug("[Publish] pose message:", message);
            context.publish(publishTopics.goal, message);
            break;
          }
          case "pose_estimate": {
            if (context.dataSourceProfile === "protobuf"){
              let pose = poseTransform(event.pose, renderFrameId, publishFrameId, renderer);
              const message = makeFoxglovePoseMessage(pose, publishFrameId);
              context.publish(publishTopics.pose, message);
            } else {
              let pose = poseTransform(event.pose, renderFrameId, publishFrameId, renderer);
              const message = makePoseEstimateMessage(
                pose,
                publishFrameId,
                latestPublishConfig.current.poseEstimateXDeviation,
                latestPublishConfig.current.poseEstimateYDeviation,
                latestPublishConfig.current.poseEstimateThetaDeviation,
              );
              context.publish(publishTopics.pose, message);
            }
            break;
          }
        }
      } catch (error) {
        log.info(error);
      }
    };
    const onEnd = () => {
      setPublishActive(false);
    };
    renderer?.publishClickTool.addEventListener("foxglove.publish-start", onStart);
    renderer?.publishClickTool.addEventListener("foxglove.publish-submit", onSubmit);
    renderer?.publishClickTool.addEventListener("foxglove.publish-end", onEnd);
    return () => {
      renderer?.publishClickTool.removeEventListener("foxglove.publish-start", onStart);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-submit", onSubmit);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-end", onEnd);
    };
  }, [
    context,
    latestPublishConfig,
    publishTopics,
    renderer?.renderFrameId,
    renderer?.publishClickTool,
  ]);

  const onClickPublish = useCallback(() => {
    if (publishActive) {
      renderer?.publishClickTool.stop();
    } else {
      renderer?.publishClickTool.start();
      renderer?.measurementTool.stopMeasuring();
    }
  }, [publishActive, renderer]);

  const onClickStartButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    // Control_switch定义，0退控制，2进入控制，4进入四维的原车控制
    // Start 先发0，然后1s后发2；
    const message = {
      data: 0,
    };
    try{
      context.publish("/control_switch", message);
    } catch (error) {
      console.error("[Publish] Error publishing message:", error);
    }
    // sleep 0.15s
    setTimeout(() => {
      const message = {
        data: 2,
      };
      try{
        context.publish!("/control_switch", message);
      } catch (error) {
        console.error("[Publish] Error publishing message:", error);
      }
    }, 150);
  }, [context]);

  const onClickStopButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: 0,
    };
    context.publish("/control_switch", message);

    // Control_switch定义，0退控制，2进入控制，4进入四维的原车控制
    // Stop 先发0，2s后发4
    // sleep 2s
    setTimeout(() => {
      const message = {
        data: 4,
      };
      try{
        context.publish!("/control_switch", message);
      } catch (error) {
        console.error("[Publish] Error publishing message:", error);
      }
    }, 2000);
  }, [context]);

  const onClickFrontParkingButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: 1,
    };
    context.publish("/parking_head_in", message);
  }, [context]);

  const onClickRearParkingButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: 0,
    };
    context.publish("/parking_head_in", message);
  }, [context]);

  const onClickVerticalLeftParkingOutButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "VerticalLeft",
    };
    context.publish("/park_out_type", message);
  }, [context]);

  const onClickVerticalRightParkingOutButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "VerticalRight",
    };
    context.publish("/park_out_type", message);
  }, [context]);

  const onClickParallelLeftParkingOutButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "ParallelLeft",
    };
    context.publish("/park_out_type", message);
  }, [context]);

  const onClickParallelRightParkingOutButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "ParallelRight",
    };
    context.publish("/park_out_type", message);
  }, [context]);

  const onClickRecordTraceStartButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "1",
    };
    context.publish("/record_trace", message);
  }, [context]);

  const onClickRecordTraceStopButton = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }
    const message = {
      data: "0",
    };
    context.publish("/record_trace", message);
  }, [context]);

  const [parkingSlotSelectionActive, setParkingSlotSelectionActive] = useState(false);

  const onClickSelectParkingSlot = useCallback(() => {
    if (!context.publish) {
      log.error("Data source does not support publishing");
      return;
    }
    if (context.dataSourceProfile !== "ros1" &&
        context.dataSourceProfile !== "ros2" &&
        context.dataSourceProfile !== "protobuf") {
      log.warn("Publishing is only supported in ros1, ros2 and protobuf");
      return;
    }

    setParkingSlotSelectionActive(true);
    // Create unique ID for temporary parking slot
    const tempSlotId = `parking-slot-temp-${Date.now()}`;

    // Create a temporary parking slot
    const parkingExtension = Array.from(renderer?.sceneExtensions.values() || [])
      .find(ext => ext.extensionId === "foxglove.ParkingSlots") as ParkingSlots | undefined;

    if (!parkingExtension) {
      log.error("ParkingSlots extension not found");
      return;
    }

    // Create a temporary draggable parking slot
    parkingExtension.createTemporarySlot(tempSlotId, {
      onCancel: () => {
        // Remove the temporary slot when canceled
        parkingExtension.removeParkingSlot(tempSlotId);
        setParkingSlotSelectionActive(false);
      },
      onConfirm: (position, rotation) => {
        // Publish the parking slot position and orientation
        try {
          const renderFrameId = renderer?.renderFrameId;
          const publishFrameId = renderer?.publishFrameId ?? renderFrameId;

          if (!publishFrameId) {
            log.error("No publish frame ID available");
            setParkingSlotSelectionActive(false);
            return;
          }

          // from euler angles to quaternion
          const orientation = {
            x: 0,
            y: 0,
            z: Math.sin(rotation / 2),
            w: Math.cos(rotation / 2),
          };

          // Create the message - similar structure to clicked_pose
          let pose = makePose();
          pose.position.x = position.x;
          pose.position.y = position.y;
          pose.position.z = position.z;
          pose.orientation = orientation;

          const message =
            context.dataSourceProfile === "protobuf"?
              makeFoxglovePoseMessage(pose, publishFrameId) :
              makePoseMessage(pose, publishFrameId);

          console.debug("[ParkingSlot] Publishing parking slot position:", message);
          // Publish to a new topic specifically for parking slots
          if (context.publish) {
            context.publish(publishTopics.goal, message);
          }

          // Make the slot non-draggable
          parkingExtension.finalizeSlot(tempSlotId);

          log.info("Published parking slot position");
          setParkingSlotSelectionActive(false);
          // 等待1s后删除临时车位
          setTimeout(() => {
            parkingExtension.removeParkingSlot(tempSlotId);
          }, 1000);
        } catch (error) {
          log.error("Failed to publish parking slot position:", error);
          setParkingSlotSelectionActive(false);
          parkingExtension.removeParkingSlot(tempSlotId);
        }
      }
    });
  }, [context, renderer]);

  const [cameraLocked, setCameraLocked] = useState(false);

  const onClickParkingModeView = useCallback(() => {
    if (!renderer) {
      return;
    }

    // Toggle the lock state
    const newLockState = !cameraLocked;
    setCameraLocked(newLockState);

    // Get current renderFrameId as the frame we'll use for following
    const currentExpectFollowFrameId = renderer.followFrameId;

    if (newLockState) {
      // Lock mode: Set camera to parking view and follow the current render frame
      const currentState = renderer.getCameraState();
      const parkingModeView = currentState?.perspective === true
        ? PARKING_MODE_VIEW_3D
        : PARKING_MODE_VIEW_2D;

      // Set camera state first
      renderer.setCameraState(parkingModeView);

      // Update config to follow the current frame
      setConfig((prevConfig) => ({
        ...prevConfig,
        cameraState: parkingModeView,
        followMode: "follow-pose", // Use follow-pose mode
        renderTf: currentExpectFollowFrameId, // Render the current frame
      }));
      renderer.setRenderFrameId(currentExpectFollowFrameId);
    } else {
      // Unlock mode: Keep current camera state but stop following
      // Update config to stop following
      setConfig((prevConfig) => ({
        ...prevConfig,
        followMode: "follow-none", // Don't follow any frame
        renderTf: undefined // Clear the follow frame
      }));
    }

    renderRef.current.needsRender = true;
    renderer.animationFrame();
  }, [renderer, cameraLocked]);

  useEffect(() => {
    if (!renderer || !cameraLocked) {
      return;
    }

    const handleCameraMove = () => {
      // Get the current camera state
      const currentState = renderer.getCameraState();
      const parkingModeView = currentState?.perspective === true
        ? PARKING_MODE_VIEW_3D
        : PARKING_MODE_VIEW_2D;
      if (!_.isEqual(currentState, parkingModeView)) {
        // Reset to parking view
        renderer.setCameraState(parkingModeView);
        setConfig((prevConfig) => ({ ...prevConfig, cameraState: parkingModeView }));
      }
    };

    renderer.addListener("cameraMove", handleCameraMove);
    return () => {
      renderer.removeListener("cameraMove", handleCameraMove);
    };
  }, [renderer, cameraLocked]);

  const onTogglePerspective = useCallback(() => {
    const currentState = renderer?.getCameraState()?.perspective ?? false;
    actionHandler({
      action: "update",
      payload: {
        input: "boolean",
        path: ["cameraState", "perspective"],
        value: !currentState,
      },
    });
  }, [actionHandler, renderer]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "3" && !(event.metaKey || event.ctrlKey)) {
        onTogglePerspective();
        event.stopPropagation();
        event.preventDefault();
      }
    },
    [onTogglePerspective],
  );

  // The 3d panel only supports publishing to ros1 and ros2 data sources
  const isRosDataSource =
    context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2" || context.dataSourceProfile === "protobuf";
  const canPublish = context.publish != undefined && isRosDataSource;

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <div style={PANEL_STYLE} onKeyDown={onKeyDown}>
        <canvas
          ref={setCanvas}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            ...((measureActive || publishActive) && { cursor: "crosshair" }),
          }}
        />
        <RendererContext.Provider value={renderer}>
          <RendererOverlay
            interfaceMode={interfaceMode}
            canvas={canvas}
            addPanel={addPanel}
            enableStats={config.scene.enableStats ?? false}
            perspective={config.cameraState.perspective}
            onTogglePerspective={onTogglePerspective}
            measureActive={measureActive}
            onClickMeasure={onClickMeasure}
            canPublish={canPublish}
            publishActive={publishActive}
            onClickPublish={onClickPublish}
            onShowTopicSettings={onShowTopicSettings}
            onClickStartButton={onClickStartButton}
            onClickStopButton={onClickStopButton}
            onClickFrontParkingButton={onClickFrontParkingButton}
            onClickRearParkingButton={onClickRearParkingButton}
            onClickVerticalLeftParkingOutButton={onClickVerticalLeftParkingOutButton}
            onClickVerticalRightParkingOutButton={onClickVerticalRightParkingOutButton}
            onClickParallelLeftParkingOutButton={onClickParallelLeftParkingOutButton}
            onClickParallelRightParkingOutButton={onClickParallelRightParkingOutButton}
            onClickRecordTraceStartButton={onClickRecordTraceStartButton}
            onClickRecordTraceStopButton={onClickRecordTraceStopButton}
            onClickParkingModeView={onClickParkingModeView}
            onClickSelectParkingSlot={onClickSelectParkingSlot}
            cameraLocked={cameraLocked}
            publishClickType={renderer?.publishClickTool.publishClickType ?? "point"}
            onChangePublishClickType={(type) => {
              renderer?.publishClickTool.setPublishClickType(type);
              renderer?.publishClickTool.start();
            }}
            timezone={timezone}
            // 添加新的属性，用于显示消息
            receivedControlMessage={receivedControlMessage}
            receivedPlanMessage={receivedPlanMessage}
            receivedControlCmdMessage={receivedControlCmdMessage}
            receivedParkingSlotsMessage={receivedParkingSlotsMessage}
            receivedVisGridMapMessage={receivedVisGridMapMessage}
            receivedVehicleOdomMessage={receivedVehicleOdomMessage}
            parkingSlotSelectionActive={parkingSlotSelectionActive}
          />
        </RendererContext.Provider>
      </div>
    </ThemeProvider>
  );
}
