import * as THREE from "three";
import i18next from "i18next";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { v4 as uuidv4 } from "uuid";

import Logger from "@lichtblick/log";
import {
  SettingsTreeAction,
  SettingsTreeFields,
} from "@lichtblick/suite";
import { stringToRgba, makeRgba } from "@lichtblick/suite-base/panels/ThreeDeeRender/color";
import { missingTransformMessage, MISSING_TRANSFORM } from "./transforms";
import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { BaseSettings, CustomLayerSettings } from "../settings";
import { makePose } from "../transforms";
import { updatePose } from "../updatePose";

const log = Logger.getLogger(__filename);

const LAYER_ID = "foxglove.Gltf";
const VALID_SRC_ERR = "ValidSrc";
const FETCH_GLTF_ERR = "FetchGltf";
const LOAD_GLTF_ERR = "LoadGltf";

const DEFAULT_COLOR_STR = "#ffffff";

export type LayerSettingsGltf = BaseSettings & {
  instanceId: string;
  url?: string;
  fallbackColor?: string;
  scale?: number;
};

export type LayerSettingsCustomGltf = CustomLayerSettings & {
  layerId: "foxglove.Gltf";
  defaultModel: "none" | "id4";
  fallbackColor: string;
  scale: number;
  frameId: string;
  useCustomMaterial: boolean;
  materialColor: string;
};

const DEFAULT_CUSTOM_SETTINGS: LayerSettingsCustomGltf = {
  visible: true,
  instanceId: "invalid",
  layerId: LAYER_ID,
  defaultModel: "none",
  label: "GLTF",
  fallbackColor: DEFAULT_COLOR_STR,
  scale: 1.0,
  frameId: "map",
  useCustomMaterial: false,
  materialColor: DEFAULT_COLOR_STR,
};

export type GltfUserData = BaseUserData & {
  settings: LayerSettingsGltf | LayerSettingsCustomGltf;
  fetching?: { url: string; control: AbortController };
  model?: THREE.Group;
  originalMaterials?: Map<string, THREE.Material | THREE.Material[]>;
};

export class GltfRenderable extends Renderable<GltfUserData> {
  public override dispose(): void {
    // Clean up model resources
    if (this.userData.model) {
      this.userData.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          } else if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          }
        }
      });
      this.remove(this.userData.model);
      this.userData.model = undefined;
    }
    super.dispose();
  }
}

export class Gltfs extends SceneExtension<GltfRenderable> {
  public static extensionId = "foxglove.Gltfs";
  // Create a shared loader
  #gltfLoader: GLTFLoader;
  #dracoLoader?: DRACOLoader;
  #framesByInstanceId = new Map<string, string[]>();
  #transformsByInstanceId = new Map<string, {parent: string, child: string}[]>();

  public constructor(renderer: IRenderer, name: string = Gltfs.extensionId) {
    super(name, renderer);

    // Set up GLTF loader with DRACO support if needed
    this.#gltfLoader = new GLTFLoader();

    // Uncomment if using compressed models
    // this.#dracoLoader = new DRACOLoader();
    // this.#dracoLoader.setDecoderPath('/draco/');
    // this.#gltfLoader.setDRACOLoader(this.#dracoLoader);

    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: i18next.t("threeDee:addGLTF"),
      icon: "PrecisionManufacturing",
      handler: this.#handleAddGltf,
    });

    // Load existing glTF layers from the config
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this.#loadGltf({ instanceId });
      }
    }
  }

  public override dispose(): void {
    super.dispose();
    // Cleanup loader resources
    if (this.#dracoLoader) {
      this.#dracoLoader.dispose();
    }
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const entries: SettingsTreeEntry[] = [];

    // Custom layer entries
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId === LAYER_ID) {
        const config = layerConfig as Partial<LayerSettingsCustomGltf>;

        const fields: SettingsTreeFields = {
          defaultModel: {
            label: "Model",
            input: "select",
            value: config.defaultModel ?? DEFAULT_CUSTOM_SETTINGS.defaultModel,
            options: [
              { label: "None", value: "none" },
              { label: "ID.4", value: "id4" },
              // Add more models as needed
            ],
          },
          scale: {  // Add this scale control
            label: "Scale",
            input: "number",
            step: 0.01,
            min: 0.01,
            max: 100,
            precision: 2,
            value: config.scale ?? DEFAULT_CUSTOM_SETTINGS.scale,
          },
          label: {
            label: "Label",
            input: "string",
            value: config.label ?? DEFAULT_CUSTOM_SETTINGS.label,
            help: "Name of the layer, you can edit it.",
          },
          frameId: {
            label: "Frame ID",
            input: "select",
            value: config.frameId ?? DEFAULT_CUSTOM_SETTINGS.frameId,
            options: [
              { label: "ego_vehicle", value: "ego_vehicle" },
              { label: "map", value: "map" },
            ],
            help: "Coordinate frame to use for this layer",
          },
          useCustomMaterial: {
            label: "Use custom material",
            input: "boolean",
            value: config.useCustomMaterial ?? DEFAULT_CUSTOM_SETTINGS.useCustomMaterial,
          },
          materialColor: {
            label: "Color",
            input: "rgba",
            value: config.materialColor ?? DEFAULT_CUSTOM_SETTINGS.materialColor,
            disabled: !(config.useCustomMaterial ?? DEFAULT_CUSTOM_SETTINGS.useCustomMaterial),
          }
        };

        entries.push({
          path: ["layers", instanceId],
          node: {
            label: config.label ?? "GLTF",
            icon: "PrecisionManufacturing",
            fields,
            visible: config.visible ?? DEFAULT_CUSTOM_SETTINGS.visible,
            actions: [
              { type: "action", id: "duplicate", label: "Duplicate" },
              { type: "action", id: "delete", label: "Delete" },
            ],
            order: layerConfig.order,
            handler: this.#handleLayerSettingsAction,
          },
        });
      }
    }

    return entries;
  }

  #handleLayerSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Handle menu actions (duplicate / delete)
    if (action.action === "perform-node-action" && path.length === 2) {
      const instanceId = path[1]!;

      if (action.payload.id === "delete") {
        // Remove this instance from the config
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });

        // Remove the renderable
        const renderable = this.renderables.get(instanceId);
        if (renderable) {
          renderable.dispose();
          this.remove(renderable);
          this.renderables.delete(instanceId);
        }

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      } else if (action.payload.id === "duplicate") {
        const newInstanceId = uuidv4();
        const config = {
          ...this.renderer.config.layers[instanceId],
          instanceId: newInstanceId,
        };

        // Add the new instance to the config
        this.renderer.updateConfig((draft) => {
          draft.layers[newInstanceId] = config;
        });

        // Add the glTF renderable
        this.#loadGltf({ instanceId: newInstanceId });

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
    } else if (action.action === "update") {
      this.#handleSettingsUpdate(action);
    }
  };

  #handleSettingsUpdate = (action: { action: "update" } & SettingsTreeAction): void => {
    const path = action.payload.path;

    if (path.length === 3) {
      // ["layers", instanceId, field]
      this.saveSetting(path, action.payload.value);
      const [_layers, instanceId, field] = path as [string, string, string];

      if (field === "defaultModel") {
        const modelName = action.payload.value as string;
        if (modelName === "none" || modelName === undefined) {
          this.#clearGltfModel(instanceId);
        } else {
          this.#fetchDefaultModel(instanceId, modelName);
        }
        // No need to return early - let other settings be applied
      } else if (field === "scale") {
        const renderable = this.renderables.get(instanceId);
        if (renderable?.userData.model) {
          const scale = action.payload.value as number;
          renderable.userData.model.scale.set(scale, scale, scale);
          this.renderer.queueAnimationFrame();
        }
      } else if (field === "frameId") {
        const renderable = this.renderables.get(instanceId);
        if (renderable) {
          renderable.userData.frameId = action.payload.value as string;
          // Request a re-render to update position with new frame
          this.renderer.queueAnimationFrame();
        }
      } else if (field === "useCustomMaterial") {
        const useCustomMaterial = action.payload.value as boolean;
        if (useCustomMaterial) {
          this.#applyCustomMaterial(instanceId);
        } else {
          this.#restoreOriginalMaterials(instanceId);
        }
      } else if (field === "materialColor") {
        const colorValue = action.payload.value as string;
        this.#updateMaterialColor(instanceId, colorValue);
      }


      // Handle other settings updates
      this.#loadGltf({ instanceId });
    }
  };

  #handleAddGltf = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);

    const config: LayerSettingsCustomGltf = { ...DEFAULT_CUSTOM_SETTINGS, instanceId };

    // Add this instance to the config
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = Object.values(draft.layers).reduce(
        (max, layer) => Math.max(max, layer?.order ?? 0),
        0
      );
      draft.layers[instanceId] = { ...config, order: maxOrderLayer + 1 };
    });

    // Add the glTF renderable
    this.#loadGltf({ instanceId });

    // Update the settings tree
    this.updateSettingsTree();
  };

  #loadGltf(args: { instanceId: string; forceReload?: boolean }): void {
    const { instanceId, forceReload = false } = args;
    let renderable = this.renderables.get(instanceId);
    const settings = this.#getCurrentSettings(instanceId);

    // Clear any previous errors
    this.renderer.settings.errors.remove(["layers", instanceId], VALID_SRC_ERR);
    this.renderer.settings.errors.remove(["layers", instanceId], FETCH_GLTF_ERR);
    this.renderer.settings.errors.remove(["layers", instanceId], LOAD_GLTF_ERR);

    // Always use fixed frame if none specified
    const frameId = settings.frameId ?? this.renderer.fixedFrameId ?? "map";
    const settingsPath = ["layers", instanceId];

    // Create a GltfRenderable if it doesn't already exist
    if (!renderable) {
      renderable = new GltfRenderable(instanceId, this.renderer, {
        fetching: undefined,
        model: undefined,
        receiveTime: 0n,
        messageTime: 0n,
        frameId,
        pose: makePose(),
        settingsPath,
        settings,
      });
      this.add(renderable);
      this.renderables.set(instanceId, renderable);
    }

    renderable.userData.settings = settings;
    renderable.userData.frameId = frameId;

    this.#ensureFramesExist(instanceId, [frameId]);

    // If force reload is needed, clean up any existing model
    if (forceReload && renderable.userData.model) {
      renderable.dispose();
      renderable.userData.model = undefined;
    }

    // If model is already loaded and no reload needed, return
    if (renderable.userData.model && !forceReload) {
      return;
    }

    // Load the default model if specified
    if (settings.defaultModel && settings.defaultModel !== "none") {
      this.#fetchDefaultModel(instanceId, settings.defaultModel);
    } else {
      // No model specified
      this.#clearGltfModel(instanceId);
      this.renderer.settings.errors.add(
        settingsPath,
        VALID_SRC_ERR,
        "No model selected. Choose a model from the dropdown."
      );
    }
  }

  #loadFrames(instanceId: string, frames: string[]): void {
    this.#framesByInstanceId.set(instanceId, frames);

    // Import all coordinate frames into the scene
    for (const frameId of frames) {
      this.renderer.addCoordinateFrame(frameId);
    }
  }

  #loadTransforms(instanceId: string, transforms: {parent: string, child: string}[]): void {
    this.#transformsByInstanceId.set(instanceId, transforms);

    // Add the transforms to the renderer
    const settingsPath = ["layers", instanceId];
    for (const { parent, child } of transforms) {
      // Create identity transform
      const translation = { x: 0, y: 0, z: 0 };
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      this.renderer.addTransform(parent, child, 0n, translation, rotation, settingsPath);
    }
  }

  #ensureFramesExist(instanceId: string, requiredFrames: string[]): void {
    // Get or create list of frames for this instance
    const frames = this.#framesByInstanceId.get(instanceId) || [];
    const newFrames = requiredFrames.filter(frame => !frames.includes(frame));

    if (newFrames.length > 0) {
      // Add new frames
      this.#loadFrames(instanceId, [...frames, ...newFrames]);

      // Create transform from map to model frame if it doesn't exist
      if (requiredFrames.includes("map") && requiredFrames.includes("ego_vehicle")) {
        const transforms = this.#transformsByInstanceId.get(instanceId) || [];
        const hasWorldToEgo = transforms.some(
          t => (t.parent === "map" && t.child === "ego_vehicle")
        );

        if (!hasWorldToEgo) {
          this.#loadTransforms(instanceId, [
            ...transforms,
            { parent: "map", child: "ego_vehicle" }
          ]);
        }
      }
    }
  }

  /**
   * Loads a default GLTF model based on the model name
   * @param instanceId - The instance ID for the model
   * @param modelName - The name of the default model to load
   */
  #fetchDefaultModel(instanceId: string, modelName: string | undefined): void {
    if (!modelName) {
      return;
    }

    const baseUrl = window.location.origin;
    const modelPaths: Record<string, string> = {
      id4: `${baseUrl}/models/id4/id4.glb`,
    };

    const modelUrl = modelPaths[modelName];
    if (!modelUrl) {
      return;
    }

    // Get the renderable for this instance
    const renderable = this.renderables.get(instanceId);
    if (!renderable) {
      return;
    }

    // Clear any previous models
    if (renderable.userData.model) {
      renderable.remove(renderable.userData.model);
      renderable.userData.model = undefined;
    }

    // Load the model
    log.debug(`Loading default GLTF model: ${modelUrl}`);

    // Cancel any in-progress fetches
    if (renderable.userData.fetching) {
      renderable.userData.fetching.control.abort();
    }

    // Set up fetch controller
    const fetchController = new AbortController();
    renderable.userData.fetching = { url: modelUrl, control: fetchController };

    // Fetch and load the model
    this.renderer
      .fetchAsset(modelUrl, { signal: fetchController.signal })
      .then((asset) => {
        log.debug(`Fetched ${asset.data.length} byte GLTF model from ${modelUrl}`);

        // Set the resource path to help locate textures
        const resourcePath = `${baseUrl}/models/${modelName}/`;
        this.#gltfLoader.setResourcePath(resourcePath);

        // Load the model with GLTFLoader
        this.#gltfLoader.load(
          modelUrl,
          (gltf) => {
            // Add the model to the renderable
            const model = gltf.scene;
            const scale = renderable.userData.settings.scale ?? 1.0;
            model.scale.set(scale, scale, scale);
            if (modelName === "id4") {
              model.rotation.set(Math.PI/2, Math.PI/2, 0);
              model.position.set(1.55, 0.025, 0); // offset caused by the model's origin
            }
            renderable.add(model);
            renderable.userData.model = model;

            // Request re-render
            this.renderer.queueAnimationFrame();
          },
          undefined,
          (error) => {
            console.error(`Failed to load GLTF model: ${error}`);
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Failed to load GLTF model: ${errorMessage}`);
            this.renderer.settings.errors.add(
              renderable.userData.settingsPath,
              LOAD_GLTF_ERR,
              `Failed to load model: ${errorMessage}`
            );
          }
        );
      })
      .catch((e: unknown) => {
        // If this is an abort error (which is normal when switching models), handle it differently
        if (e instanceof DOMException && e.name === 'AbortError') {
          log.debug('Model fetch was cancelled - this is normal when switching models');
          return; // Don't show an error for intentional cancellations
        }

        // Handle other errors as before
        const err = e as Error;
        log.error(`Failed to fetch GLTF model: ${err.message}`);
        this.renderer.settings.errors.add(
          renderable.userData.settingsPath,
          FETCH_GLTF_ERR,
          `Failed to fetch model: ${err.message}`
        );
      });
  }

  /**
   * Clears the current GLTF model from the renderable
   * @param instanceId - The instance ID to clear
   * @returns true if model was cleared, false otherwise
   */
  #clearGltfModel(instanceId: string): boolean {
    const renderable = this.renderables.get(instanceId);
    if (!renderable) {
      return false;
    }

    if (renderable.userData.model) {
      renderable.remove(renderable.userData.model);
      renderable.userData.model = undefined;
      this.renderer.queueAnimationFrame();
      return true;
    }

    return false;
  }

  #getCurrentSettings(instanceId: string): LayerSettingsCustomGltf {
    const userSettings = this.renderer.config.layers[instanceId];
    return { ...DEFAULT_CUSTOM_SETTINGS, ...userSettings, instanceId, layerId: "foxglove.Gltf" };
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Check if transform tree is empty and add default frames if needed
    const availableFrames = Array.from(this.renderer.transformTree.frames().keys());
    if (availableFrames.length === 0) {
      // Add default frames and transforms for each renderable
      for (const [instanceId, renderable] of this.renderables.entries()) {
        const frameId = renderable.userData.frameId;
        if (frameId) {
          this.#ensureFramesExist(instanceId, ["map", frameId]);

          // Add transform from map to frameId if they're different
          if (frameId !== "map") {
            const transforms = this.#transformsByInstanceId.get(instanceId) || [];
            const hasTransform = transforms.some(
              t => (t.parent === "map" && t.child === frameId)
            );

            if (!hasTransform) {
              this.#loadTransforms(instanceId, [
                ...transforms,
                { parent: "map", child: frameId }
              ]);
            }
          }
        }
      }
    }

    for (const renderable of this.renderables.values()) {
      const path = renderable.userData.settingsPath;
      renderable.visible = renderable.userData.settings.visible;

      if (!renderable.visible) {
        this.renderer.settings.errors.clearPath(path);
        continue;
      }

      // Update the renderable's position based on transforms
      const frameId = renderable.userData.frameId;
      if (frameId) {
        this.#ensureFramesExist(renderable.userData.settings.instanceId, [frameId]);

        const updated = updatePose(
          renderable,
          this.renderer.transformTree,
          renderFrameId,
          fixedFrameId,
          frameId,
          currentTime,
          currentTime,
        );

        if (!updated) {
          const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
          this.renderer.settings.errors.add(path, MISSING_TRANSFORM, message);
        } else {
          this.renderer.settings.errors.remove(path, MISSING_TRANSFORM);
        }
      }
    }
  }

  /**
   * Applies a custom material to all meshes in the model
   */
  #applyCustomMaterial(instanceId: string): void {
    const renderable = this.renderables.get(instanceId);
    if (!renderable?.userData.model) return;

    const settings = this.#getCurrentSettings(instanceId);
    const rgba = stringToRgba(makeRgba(), settings.materialColor);

    // Store original materials for restoration later
    renderable.userData.originalMaterials = new Map();

    renderable.userData.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Store original material
        renderable.userData.originalMaterials!.set(child.uuid, child.material);

        // Create new material
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(rgba.r, rgba.g, rgba.b).convertSRGBToLinear(),
          metalness: 0,
          roughness: 1,
          dithering: true,
          opacity: rgba.a,
          transparent: rgba.a < 1,
          depthWrite: rgba.a === 1,
        });

        child.material = material;
      }
    });

    this.renderer.queueAnimationFrame();
  }

  /**
   * Updates the color of custom materials
   */
  #updateMaterialColor(instanceId: string, colorValue: string): void {
    const renderable = this.renderables.get(instanceId);
    if (!renderable?.userData.model || !('useCustomMaterial' in renderable.userData.settings) || !renderable.userData.settings.useCustomMaterial) return;

    const rgba = stringToRgba(makeRgba(), colorValue);
    const color = new THREE.Color(rgba.r, rgba.g, rgba.b).convertSRGBToLinear();

    renderable.userData.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const createNewMaterial = (baseMaterial: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
          const material = baseMaterial.clone();
          material.color = color;
          material.opacity = rgba.a;
          material.transparent = rgba.a < 1.0;
          material.depthWrite = rgba.a === 1.0;
          material.needsUpdate = true;
          return material;
        };

        if (Array.isArray(child.material)) {
          child.material = child.material.map(createNewMaterial);
        } else {
          child.material = createNewMaterial(child.material);
        }
      }
    });

    this.renderer.queueAnimationFrame();
  }

  /**
   * Restores original materials
   */
  #restoreOriginalMaterials(instanceId: string): void {
    const renderable = this.renderables.get(instanceId);
    if (!renderable?.userData.model || !renderable.userData.originalMaterials) return;

    renderable.userData.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const originalMaterial = renderable.userData.originalMaterials!.get(child.uuid);
        if (originalMaterial) {
          child.material = originalMaterial;
        }
      }
    });

    delete renderable.userData.originalMaterials;
    this.renderer.queueAnimationFrame();
  }

}
