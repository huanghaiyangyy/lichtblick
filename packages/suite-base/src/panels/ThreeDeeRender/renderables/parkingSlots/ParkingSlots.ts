import * as THREE from "three";

import { t } from "i18next";
import * as _ from "lodash-es";
import React from "react";

import Logger from "@lichtblick/log";
import { SettingsTreeAction, SettingsTreeFields } from "@lichtblick/suite";

import { SceneExtension } from "../../SceneExtension";
import { SettingsTreeEntry } from "../../SettingsManager";
import type { IRenderer } from "../../IRenderer";
import { BaseUserData, Renderable } from "../../Renderable";
import { DraggableParkingSlot } from "./DraggableParkingSlot";
import { CustomLayerSettings } from "../../settings";
import { makePose, xyzrpyToPose } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";
import ReactPortalService from "../../utils/ReactPortalService";
import { ParkingSlotConfirmation } from "../../components/ParkingSlotConfirmation";

const log = Logger.getLogger(__filename);

const LAYER_ID = "parking-slot";
const DEFAULT_PARKING_SLOT_LENGTH = 5.0;
const DEFAULT_PARKING_SLOT_WIDTH = 2.5;
const DEFAULT_PARKING_SLOT_COLOR = "rgba(0, 156, 230, 0.1)";

export type LayerSettingsParkingSlot = CustomLayerSettings & {
  layerId: "parking-slot";
  frameId: string | undefined;
  length: number;
  width: number;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

const DEFAULT_LAYER_SETTINGS: LayerSettingsParkingSlot = {
  visible: true,
  frameLocked: true,
  label: "Parking Slot",
  instanceId: "invalid",
  layerId: "parking-slot",
  frameId: undefined,
  length: DEFAULT_PARKING_SLOT_LENGTH,
  width: DEFAULT_PARKING_SLOT_WIDTH,
  color: DEFAULT_PARKING_SLOT_COLOR,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export type ParkingSlotUserData = BaseUserData & {
  settings: LayerSettingsParkingSlot;
};

export class ParkingSlotRenderable extends Renderable<ParkingSlotUserData> {
  public override dispose(): void {
    for (const child of this.children) {
      if (child instanceof DraggableParkingSlot) {
        child.dispose();
      }
    }
    super.dispose();
  }
}

export class ParkingSlots extends SceneExtension<ParkingSlotRenderable> {
  public static extensionId = "foxglove.ParkingSlots";
  public constructor(renderer: IRenderer, name: string = ParkingSlots.extensionId) {
    super(name, renderer);

    renderer.updateConfig((draft) => {
      // 删除所有停车位图层
      for (const [slotId, slotConfig] of Object.entries(draft.layers)) {
        if (slotConfig?.layerId === LAYER_ID) {
          delete draft.layers[slotId];
        }
      }
    });

    // Register our custom action
    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: t("threeDee:addParkingSlot"),
      icon: "Flag",
      handler: this.#handleAddParkingSlot,
    });

    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.on("publishFrameChanged", this.#handlePublishFrameChange);

    // Load existing parking slots from the config
    // for (const [slotId, slotConfig] of Object.entries(renderer.config.layers)) {
    //   if (slotConfig?.layerId === LAYER_ID) {
    //     this.#updateSlot(slotId, slotConfig as Partial<LayerSettingsParkingSlot>);
    //   }
    // }
  }

  public getSlotInstance(slotId: string): DraggableParkingSlot | undefined {
    const renderable = this.renderables.get(slotId);
    if (!renderable) return undefined;
    return this.#getDraggableSlot(renderable);
  }

  public override dispose(): void {
    this.#hideSlotConfirmationUI();
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    super.dispose();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];

    for (const [slotId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId !== LAYER_ID) {
        continue;
      }

      const config = layerConfig as Partial<LayerSettingsParkingSlot>;

      const fields: SettingsTreeFields = {
        visible: { label: "Visible", input: "boolean", value: config.visible ?? true },
        length: {
          label: "Length",
          input: "number",
          step: 0.1,
          precision: 2,
          value: config.length,
          placeholder: String(DEFAULT_PARKING_SLOT_LENGTH),
        },
        width: {
          label: "Width",
          input: "number",
          step: 0.1,
          precision: 2,
          value: config.width,
          placeholder: String(DEFAULT_PARKING_SLOT_WIDTH),
        },
        color: {
          label: "Color",
          input: "rgba",
          value: config.color,
          placeholder: DEFAULT_PARKING_SLOT_COLOR,
        },
      };

      entries.push({
        path: ["layers", slotId],
        node: {
          label: config.label ?? "Parking Slot",
          icon: "Cells",
          fields,
          visible: config.visible ?? DEFAULT_LAYER_SETTINGS.visible,
          handler: handler,
          actions: [{ id: "delete", type: "action", label: t("threeDee:delete") }],
        },
      });

      if (!this.renderables.has(slotId)) {
        this.#updateSlot(slotId, config);
      }
    }
    return entries;
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    for (const renderable of this.renderables.values()) {
      renderable.userData.frameId = renderable.userData.settings.frameId ?? renderFrameId;
    }
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Handle menu actions
    if (action.action === "perform-node-action") {
      if (path.length === 2 && action.payload.id === "delete") {
        const instanceId = path[1]!;

        // Remove this instance from the config
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });

        // Remove the renderable
        this.#updateSlot(instanceId, undefined);

        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
      return;
    }

    if (path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    const slotId = path[1]!;
    const settings = this.renderer.config.layers[slotId] as
      | Partial<LayerSettingsParkingSlot>
      | undefined;
    this.#updateSlot(slotId, settings);
  };

  #handleAddParkingSlot = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);

    const config: LayerSettingsParkingSlot = { ...DEFAULT_LAYER_SETTINGS, instanceId };

    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      const order = 1 + (maxOrderLayer?.order ?? 0);
      draft.layers[instanceId] = { ...config, order };
    });

    this.#updateSlot(instanceId, config);

    // Update the settings tree
    this.updateSettingsTree();
  };

  #getCameraTarget(): THREE.Vector3 {
    if (
      this.renderer.cameraHandler &&
      typeof this.renderer.cameraHandler.getOrbitControlsTarget === "function"
    ) {
      return this.renderer.cameraHandler.getOrbitControlsTarget();
    }

    if (this.renderer.cameraHandler && (this.renderer.cameraHandler as any).controls?.target) {
      return (this.renderer.cameraHandler as any).controls.target.clone();
    }

    return new THREE.Vector3(0, 0, 0);
  }

  #handleTransformTreeUpdated = (): void => {
    this.updateSettingsTree();
  };

  #handlePublishFrameChange = (frameId: string | undefined): void => {
    for (const renderable of this.renderables.values()) {
      renderable.userData.settings.frameId = frameId ?? renderable.userData.settings.frameId;
    }
  };

  #updateSlot(slotId: string, settings: Partial<LayerSettingsParkingSlot> | undefined): void {
    let renderable = this.renderables.get(slotId);

    // Handle deletes
    if (settings === undefined) {
      if (renderable != undefined) {
        renderable.dispose();
        this.remove(renderable);
        this.renderables.delete(slotId);
      }
      return;
    }

    const newSettings = {
      ...DEFAULT_LAYER_SETTINGS,
      ...settings,
      length: settings.length ?? (settings as any).initialLength ?? DEFAULT_PARKING_SLOT_LENGTH,
      width: settings.width ?? (settings as any).initialWidth ?? DEFAULT_PARKING_SLOT_WIDTH,
    };
    if (!renderable) {
      renderable = this.#createRenderable(slotId, newSettings);
      renderable.userData.pose = xyzrpyToPose(newSettings.position, newSettings.rotation);
      renderable.userData.settings.frameId = this.renderer.publishFrameId;
    } else {
      renderable.userData.settings = newSettings;
      renderable.userData.settings.frameId = this.renderer.publishFrameId;

      // Apply settings to the DraggableParkingSlot child
      // Find the DraggableParkingSlot child (it should be the first child)
      const draggableSlot = this.#getDraggableSlot(renderable);
      if (draggableSlot) {
        draggableSlot.setVisible(newSettings.visible);

        if (newSettings.color) {
          draggableSlot.setColor(newSettings.color);
        }

        if (newSettings.length !== undefined) {
          draggableSlot.setLength(newSettings.length);
        }
        if (newSettings.width !== undefined) {
          draggableSlot.setWidth(newSettings.width);
        }
      }
    }
  }

  #createRenderable(instanceId: string, settings: LayerSettingsParkingSlot): ParkingSlotRenderable {
    const isObstacle = settings.label?.includes("障碍物") ?? false;

    const position = new THREE.Vector3(
      settings.position[0],
      settings.position[1],
      settings.position[2],
    );

    const cameraTarget = this.#getCameraTarget();
    const cameraTargetPose = makePose();
    cameraTargetPose.position.x = cameraTarget.x;
    cameraTargetPose.position.y = cameraTarget.y;
    cameraTargetPose.position.z = cameraTarget.z;
    cameraTargetPose.orientation = new THREE.Quaternion();
    let cameraTargetPoseInPublishFrame = makePose();
    const currentTime = this.renderer.currentTime;

    this.renderer.transformTree.apply(
      cameraTargetPoseInPublishFrame,
      cameraTargetPose,
      this.renderer.publishFrameId || "",
      this.renderer.fixedFrameId,
      this.renderer.renderFrameId || "",
      currentTime,
      currentTime,
    );

    const initPosition = new THREE.Vector3(
      cameraTargetPoseInPublishFrame.position.x,
      cameraTargetPoseInPublishFrame.position.y,
      cameraTargetPoseInPublishFrame.position.z,
    );

    const draggableSlot = new DraggableParkingSlot(initPosition, {
      id: instanceId,
      renderer: this.renderer,
      length: settings.length,
      width: settings.width,
      color: settings.color,
      initialPosition: position,
      initialRotation: settings.rotation[2], // Use Z rotation
      isObstacle: settings.label?.includes("障碍物"),
    });

    const renderable = new ParkingSlotRenderable(instanceId, this.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: settings.frameId ?? "",
      pose: makePose(),
      settingsPath: ["layers", instanceId],
      settings: settings,
    });
    renderable.add(draggableSlot);

    this.add(renderable);
    this.renderables.set(instanceId, renderable);
    return renderable;
  }

  #getDraggableSlot(renderable: ParkingSlotRenderable): DraggableParkingSlot | undefined {
    for (const child of renderable.children) {
      if (child instanceof DraggableParkingSlot) {
        return child;
      }
    }
    return undefined;
  }

  #temporarySlotCallbacks = new Map<
    string,
    {
      onCancel: () => void;
      onConfirm: (position: THREE.Vector3, rotation: number) => void;
    }
  >();

  public createTemporarySlot(
    slotId: string,
    callbacks: {
      onCancel: () => void;
      onConfirm: (position: THREE.Vector3, rotation: number) => void;
    },
    options?: {
      initialLength?: number;
      initialWidth?: number;
      label?: string;
    },
  ): void {
    const cameraTarget = this.#getCameraTarget();
    const initPosition = new THREE.Vector3(cameraTarget.x, cameraTarget.y, cameraTarget.z);
    this.#temporarySlotCallbacks.set(slotId, callbacks);

    const config: LayerSettingsParkingSlot = {
      ...DEFAULT_LAYER_SETTINGS,
      instanceId: slotId,
      visible: true,
      label: options?.label ?? "Select Parking Slot Location",
      frameId: this.renderer.publishFrameId,
      length: options?.initialLength ?? DEFAULT_PARKING_SLOT_LENGTH,
      width: options?.initialWidth ?? DEFAULT_PARKING_SLOT_WIDTH,
    };

    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      const order = 1 + (maxOrderLayer?.order ?? 0);
      draft.layers[slotId] = { ...config, order };
    });

    this.#updateSlot(slotId, config);

    // Find the slot we just created and mark it as temporary
    const slot = this.renderables.get(slotId);
    if (slot) {
      const draggableSlot = this.#getDraggableSlot(slot);
      if (draggableSlot) {
        // Create and show the confirmation UI
        this.#showSlotConfirmationUI(slotId);
      }
    }

    this.updateSettingsTree();
    this.renderer.updateCustomLayersCount();
    const draggableSlot = new DraggableParkingSlot(initPosition, {
      id: slotId,
      renderer: this.renderer,
      length: options?.initialLength ?? DEFAULT_PARKING_SLOT_LENGTH,
      width: options?.initialWidth ?? DEFAULT_PARKING_SLOT_WIDTH,
      initialPosition: initPosition,
    });
  }

  /**
   * Removes a parking slot
   */
  public removeParkingSlot(slotId: string): void {
    this.#hideSlotConfirmationUI();

    this.#temporarySlotCallbacks.delete(slotId);

    this.renderer.updateConfig((draft) => {
      delete draft.layers[slotId];
    });

    this.#updateSlot(slotId, undefined);

    // Update UI
    this.updateSettingsTree();
    this.renderer.updateCustomLayersCount();
  }

  /**
   * Finalizes a slot, making it non-draggable
   */
  public finalizeSlot(slotId: string): void {
    this.#hideSlotConfirmationUI();

    this.#temporarySlotCallbacks.delete(slotId);

    // Make the slot non-draggable
    const slot = this.renderables.get(slotId);
    if (slot) {
      const draggableSlot = this.#getDraggableSlot(slot);
      if (draggableSlot) {
        draggableSlot.setDraggingEnable(false);

        // Update the config to reflect this is now a confirmed slot
        this.renderer.updateConfig((draft) => {
          if (draft.layers[slotId]) {
            draft.layers[slotId] = {
              ...draft.layers[slotId],
              label: "Selected Parking Slot",
            };
          }
        });
      }
    }

    this.updateSettingsTree();
  }

  /**
   * Shows the confirmation UI for the slot
   */
  #showSlotConfirmationUI(slotId: string): void {
    // Get the portal service
    const portalService = ReactPortalService.getInstance();

    const portalId = `parking-slot-confirmation-${slotId}`;
    portalService.createPortal(
      portalId,
      React.createElement(ParkingSlotConfirmation, {
        onCancel: () => {
          const callbacks = this.#temporarySlotCallbacks.get(slotId);
          if (callbacks) {
            callbacks.onCancel();
          }
        },
        onConfirm: () => {
          const slot = this.renderables.get(slotId);
          if (slot) {
            const draggableSlot = this.#getDraggableSlot(slot);
            if (draggableSlot) {
              const position = draggableSlot.getPosition();
              const rotation = draggableSlot.getRotation();

              const callbacks = this.#temporarySlotCallbacks.get(slotId);
              if (callbacks) {
                callbacks.onConfirm(position, rotation);
              }
            }
          }
        },
      }),
    );

    this.#confirmationUI = {
      portalId,
      cleanup: () => portalService.removePortal(portalId),
    };
  }

  /**
   * Hides the confirmation UI
   */
  #hideSlotConfirmationUI(): void {
    if (this.#confirmationUI && this.#confirmationUI.cleanup) {
      this.#confirmationUI.cleanup();
      this.#confirmationUI = null;
    }
  }

  // Update the type definition
  #confirmationUI: {
    portalId: string;
    cleanup: () => void;
  } | null = null;
}
