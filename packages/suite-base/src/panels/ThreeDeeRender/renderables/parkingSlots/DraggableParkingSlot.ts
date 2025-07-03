import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { DragControls } from "three/examples/jsm/controls/DragControls";

import { stringToRgba } from "../../color";
import { Renderable } from "../../Renderable";
import type { IRenderer } from "../../IRenderer";

const HANDLE_SIZE = 0.3;
const HANDLE_DISTANCE = 0.5; // Distance from rectangle edge
const DEFAULT_RECTANGLE_COLOR = "rgba(0, 156, 230, 0.1)";
const HANDLE_OPACITY = 0.9;
const OUTLINE_OPACITY = 0.9;

const WHEEL_BASE_ID4 = 2.9231; // Wheelbase of the car in meters

export type DraggableParkingSlotOptions = {
  id: string;
  renderer: IRenderer;
  length: number;
  width: number;
  color?: string;
  initialPosition: THREE.Vector3;
  initialRotation?: number;
  isObstacle?: boolean;
};

export class DraggableParkingSlot extends Renderable {
  #length: number;
  #width: number;
  #rectangle: THREE.Mesh;
  #carLayer?: THREE.Mesh;
  #outline: LineSegments2;
  #color: string;
  #rotationHandle: THREE.Mesh;
  #switchButton: THREE.Mesh;
  #mouseMoveHandler: (event: MouseEvent) => void = () => {};
  #mouseUpHandler: () => void = () => {};
  #raycaster = new THREE.Raycaster();
  #dragControls = new DragControls(
    [],
    new THREE.PerspectiveCamera(),
    document.createElement("canvas"),
  );
  #draggableObjects: THREE.Object3D[] = [];
  #startRotation = 0;
  #startAngle = 0;
  #rotationControls = new DragControls(
    [],
    new THREE.PerspectiveCamera(),
    document.createElement("canvas"),
  );
  #slotCenter = new THREE.Vector3();
  #enableDragging = true;

  public constructor(initPosition: THREE.Vector3, options: DraggableParkingSlotOptions) {
    super(options.id, options.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "",
      pose: {
        position: options.initialPosition,
        orientation: new THREE.Quaternion(),
      },
      settingsPath: ["layers", options.id],
      settings: {
        visible: true,
      },
    });

    this.#length = options.length;
    this.#width = options.width;
    this.#color = options.color ?? DEFAULT_RECTANGLE_COLOR;

    // Create the rectangle mesh
    const rectangleGeometry = new THREE.PlaneGeometry(this.#length, this.#width);
    const rectangleMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.#color),
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });
    this.#rectangle = new THREE.Mesh(rectangleGeometry, rectangleMaterial);
    this.#rectangle.rotation.x = 0; // Lay flat on the XY plane
    this.#rectangle.position.copy(initPosition);
    this.#slotCenter.copy(this.#rectangle.position);

    if (!options.isObstacle) {
      // Create the car layer mesh (optional, can be used for visualizing the car)
      const carGeometry = new THREE.PlaneGeometry(4.6, 2.174); // Dimensions of ID.4 in meters
      const carTexture = new THREE.TextureLoader().load("./texture/topview.png");
      const carMaterial = new THREE.MeshBasicMaterial({
        map: carTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.#carLayer = new THREE.Mesh(carGeometry, carMaterial);
      this.#carLayer.position.copy(this.#rectangle.position);
      this.#carLayer.position.z = 0.01; // Position slightly above the rectangle
      this.#carLayer.rotation.x = 0;
      this.#carLayer.rotation.z = this.#rectangle.rotation.z + Math.PI; // Rotate to face the rectangle
    } else {
      this.#carLayer = undefined; // 明确设置为undefined
    }
    // Create the outline
    const edgesGeometry = new THREE.EdgesGeometry(rectangleGeometry);
    const outlineGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeometry);
    const outlineMaterial = new LineMaterial({
      color: 0x009ce6,
      linewidth: 5,
      opacity: OUTLINE_OPACITY,
    });
    // Set resolution for proper line width rendering
    outlineMaterial.resolution.set(window.innerWidth, window.innerHeight);
    this.#outline = new LineSegments2(outlineGeometry, outlineMaterial);
    this.#outline.rotation.x = 0;
    this.#outline.position.copy(initPosition);

    // Create the rotation handle
    const handleGeometry = new THREE.CircleGeometry(HANDLE_SIZE, 16, 16);
    const handleTexture = new THREE.TextureLoader().load("./texture/rotation1.png");
    const handleMaterial = new THREE.MeshBasicMaterial({
      map: handleTexture,
      transparent: true,
      opacity: HANDLE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.#rotationHandle = new THREE.Mesh(handleGeometry, handleMaterial);
    this.updateHandlePosition();

    // Create the switch button (optional, can be used for toggling slot state)
    // if (!options.isObstacle) {
    const switchGeometry = new THREE.CircleGeometry(HANDLE_SIZE, 16, 16);
    const switchTexture = new THREE.TextureLoader().load("./texture/switch.webp");
    const switchMaterial = new THREE.MeshBasicMaterial({
      map: switchTexture,
      transparent: true,
      opacity: HANDLE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.#switchButton = new THREE.Mesh(switchGeometry, switchMaterial);
    this.updateSwitchPosition();
    // }

    if (options.initialRotation) {
      this.#rectangle.rotation.z = options.initialRotation;
      this.#outline.rotation.z = options.initialRotation;
      this.updateHandlePosition();
      this.updateSwitchPosition();
    }

    this.add(this.#rectangle);
    this.#carLayer && this.add(this.#carLayer);
    this.add(this.#outline);
    this.add(this.#rotationHandle);
    this.add(this.#switchButton);

    this.#rectangle.userData.pickable = true;
    this.#rotationHandle.userData.pickable = true;
    this.#switchButton.userData.pickable = true;

    // Set up the draggable objects for DragControls
    this.#draggableObjects = [this.#rectangle];

    this.#setupDragControls();
    this.#setupRotationControls();
    this.#setupClickHandlers();

    this.renderer.on("cameraMove", this.#handleCameraMove);
  }

  public override dispose(): void {
    this.renderer.off("cameraMove", this.#handleCameraMove);
    this.#cleanupInteractivity();

    this.#rectangle.geometry.dispose();
    (this.#rectangle.material as THREE.Material).dispose();
    if (this.#carLayer) {
      this.#carLayer?.geometry.dispose();
      (this.#carLayer?.material as THREE.Material).dispose();
    }

    this.#outline.geometry.dispose();
    (this.#outline.material as THREE.Material).dispose();

    this.#rotationHandle.geometry.dispose();
    (this.#rotationHandle.material as THREE.Material).dispose();

    this.#switchButton.geometry.dispose();
    (this.#switchButton.material as THREE.Material).dispose();

    super.dispose();
  }

  public setDraggingEnable(enable: boolean): void {
    this.#enableDragging = enable;
    this.#dragControls.enabled = enable;
    this.#rotationControls.enabled = enable;

    // parking slot is locked when it is confirmed
    if (!enable) {
      const handleTexture = new THREE.TextureLoader().load("./texture/lock1.webp");
      this.#rotationHandle.material = new THREE.MeshBasicMaterial({
        map: handleTexture,
        transparent: true,
        opacity: HANDLE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      if (this.#carLayer) {
        this.#carLayer.visible = false;
      }
      this.#switchButton.visible = false;
    } else {
      const handleTexture = new THREE.TextureLoader().load("./texture/rotation1.png");
      this.#rotationHandle.material = new THREE.MeshBasicMaterial({
        map: handleTexture,
        transparent: true,
        opacity: HANDLE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      if (this.#carLayer) {
        this.#carLayer.visible = true;
      }
      this.#switchButton.visible = true;
    }
  }

  public getLength(): number {
    return this.#length;
  }

  public getWidth(): number {
    return this.#width;
  }

  public setLength(length: number): void {
    this.#length = length;
    this.#updateGeometry();
  }

  public setWidth(width: number): void {
    this.#width = width;
    this.#updateGeometry();
  }

  public setColor(colorStr: string): void {
    const rgba = stringToRgba({ r: 0, g: 0, b: 0, a: 1 }, colorStr);
    (this.#rectangle.material as THREE.MeshBasicMaterial).color.setRGB(rgba.r, rgba.g, rgba.b);
    (this.#rectangle.material as THREE.MeshBasicMaterial).opacity = rgba.a;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
  }

  #updateGeometry(): void {
    // Update rectangle geometry
    this.#rectangle.geometry.dispose();
    this.#rectangle.geometry = new THREE.PlaneGeometry(this.#length, this.#width);

    // Update outline geometry
    this.#outline.geometry.dispose();
    const edgesGeometry = new THREE.EdgesGeometry(this.#rectangle.geometry);
    this.#outline.geometry = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeometry);

    // Update handle position
    this.updateHandlePosition();

    // Update switch button position
    this.updateSwitchPosition();
  }

  private updateHandlePosition(): void {
    // Position the handle at the front edge of the rectangle
    const handleOffset = this.#length / 2 + HANDLE_DISTANCE;
    this.#rotationHandle.position.set(
      this.#slotCenter.x + handleOffset * Math.cos(this.#rectangle.rotation.z),
      this.#slotCenter.y + handleOffset * Math.sin(this.#rectangle.rotation.z),
      this.#rectangle.position.z,
    );

    this.#rotationHandle.rotation.z = this.#rectangle.rotation.z - Math.PI / 2; // Handle points outward
  }

  private updateSwitchPosition(): void {
    // Position the switch button at the center of the rectangle
    this.#switchButton.position.set(
      this.#slotCenter.x,
      this.#slotCenter.y,
      this.#rectangle.position.z + 0.02, // Slightly above the rectangle
    );

    // Keep the switch button's orientation consistent
    this.#switchButton.rotation.z = this.#rectangle.rotation.z;
  }

  #setupClickHandlers(): void {
    this.renderer.gl.domElement.addEventListener("click", this.#handleClick);
    this.renderer.gl.domElement.addEventListener("touchend", this.#handleTouch);
  }

  #handleClick = (event: MouseEvent): void => {
    const camera = this.renderer.cameraHandler.getActiveCamera();
    const canvas = this.renderer.gl.domElement;
    const rect = canvas.getBoundingClientRect();

    const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.#raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
    const intersects = this.#raycaster.intersectObject(this.#switchButton, false);

    if (intersects.length > 0 && this.#enableDragging) {
      // Rotate by Math.PI (180 degrees)
      this.#rectangle.rotation.z += Math.PI;
      this.#outline.rotation.z += Math.PI;
      if (this.#carLayer) {
        this.#carLayer.rotation.z = this.#rectangle.rotation.z + Math.PI; // Maintain car orientation
      }
      // Update positions of handles
      this.updateHandlePosition();
      this.updateSwitchPosition();

      this.renderer.queueAnimationFrame();
    }
  };

  #handleTouch = (event: TouchEvent): void => {
    // Prevent default to avoid any unwanted behavior
    event.preventDefault();

    if (event.changedTouches.length === 0) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return; // No touch available
    }
    const camera = this.renderer.cameraHandler.getActiveCamera();
    const canvas = this.renderer.gl.domElement;
    const rect = canvas.getBoundingClientRect();

    const touchX = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    const touchY = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

    this.#raycaster.setFromCamera(new THREE.Vector2(touchX, touchY), camera);
    const intersects = this.#raycaster.intersectObject(this.#switchButton, false);

    if (intersects.length > 0 && this.#enableDragging) {
      // Rotate by Math.PI (180 degrees)
      this.#rectangle.rotation.z += Math.PI;
      this.#outline.rotation.z += Math.PI;
      if (this.#carLayer) {
        this.#carLayer.rotation.z = this.#rectangle.rotation.z + Math.PI; // Maintain car orientation
      }
      // Update positions of handles
      this.updateHandlePosition();
      this.updateSwitchPosition();

      this.renderer.queueAnimationFrame();
    }
  };

  #setupDragControls(): void {
    this.#dragControls.dispose(); // Clean up any previous controls
    this.#dragControls = new DragControls(
      this.#draggableObjects,
      this.renderer.cameraHandler.getActiveCamera(),
      this.renderer.gl.domElement,
    );

    if (!this.#enableDragging) {
      this.#dragControls.enabled = false;
    }

    // Constrain movement to XY plane (Z=0)
    this.#dragControls.transformGroup = false;

    // DragControls events
    this.#dragControls.addEventListener("dragstart", () => {
      // Disable orbit controls through the renderer
      if (
        this.renderer.cameraHandler &&
        typeof this.renderer.cameraHandler.setOrbitControlsEnabled === "function"
      ) {
        this.renderer.cameraHandler.setOrbitControlsEnabled(false);
      }
      // Check if we're trying to drag the handle - if so, don't use DragControls
      const camera = this.renderer.cameraHandler.getActiveCamera();
      const canvas = this.renderer.gl.domElement;
      const rect = canvas.getBoundingClientRect();
      // Get current mouse position from DOM
      const mouseEvent = window.event as MouseEvent;
      if (!mouseEvent) {
        return; // No mouse event available
      }

      const mouseX = ((mouseEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((mouseEvent.clientY - rect.top) / rect.height) * 2 + 1;

      this.#raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
      const intersects = this.#raycaster.intersectObject(this.#rotationHandle, false);

      if (intersects.length > 0) {
        // We're dragging the rotation handle, so cancel the DragControls drag
        this.#dragControls.enabled = false;
      }
    });

    this.#dragControls.addEventListener("drag", (event) => {
      this.#outline.position.copy(this.#rectangle.position);
      this.#slotCenter.copy(this.#rectangle.position);
      if (this.#carLayer) {
        this.#carLayer.position.copy(this.#rectangle.position);
        this.#carLayer.position.z = 0.01;
      }

      event.object.position.z = 0;
      this.#outline.position.z = 0;

      this.updateHandlePosition();
      this.updateSwitchPosition();

      this.renderer.queueAnimationFrame();
    });

    this.#dragControls.addEventListener("dragend", () => {
      if (
        this.renderer.cameraHandler &&
        typeof this.renderer.cameraHandler.setOrbitControlsEnabled === "function"
      ) {
        this.renderer.cameraHandler.setOrbitControlsEnabled(true);
      }
      // Re-enable the controls (might have been disabled in dragstart)
      this.#dragControls.enabled = true;

      this.renderer.queueAnimationFrame();
    });
  }

  #setupRotationControls(): void {
    this.#rotationControls.dispose(); // Clean up any previous controls
    this.#rotationControls = new DragControls(
      [this.#rotationHandle],
      this.renderer.cameraHandler.getActiveCamera(),
      this.renderer.gl.domElement,
    );

    if (!this.#enableDragging) {
      this.#rotationControls.enabled = false;
    }

    // Disable regular dragging for the handle
    this.#rotationControls.addEventListener("dragstart", () => {
      if (
        this.renderer.cameraHandler &&
        typeof this.renderer.cameraHandler.setOrbitControlsEnabled === "function"
      ) {
        this.renderer.cameraHandler.setOrbitControlsEnabled(false);
      }
      this.#startRotation = this.#rectangle.rotation.z;

      const centerToHandle = new THREE.Vector2(
        this.#rotationHandle.position.x - this.#slotCenter.x,
        this.#rotationHandle.position.y - this.#slotCenter.y,
      );
      this.#startAngle = Math.atan2(centerToHandle.y, centerToHandle.x);
    });

    this.#rotationControls.addEventListener("drag", (event) => {
      const centerToHandle = new THREE.Vector2(
        event.object.position.x - this.#slotCenter.x,
        event.object.position.y - this.#slotCenter.y,
      );

      const currentAngle = Math.atan2(centerToHandle.y, centerToHandle.x);

      const angleDelta = currentAngle - this.#startAngle;

      const newRotation = this.#startRotation + angleDelta;
      this.#rectangle.rotation.z = newRotation;
      this.#outline.rotation.z = newRotation;
      if (this.#carLayer) {
        this.#carLayer.rotation.z = newRotation + Math.PI;
      } // Rotate to face the rectangle
      this.#switchButton.rotation.z = newRotation;

      // Keep the handle at fixed distance from center
      const handleDistance = this.#length / 2 + HANDLE_DISTANCE;
      event.object.position.x = this.#slotCenter.x + handleDistance * Math.cos(newRotation);
      event.object.position.y = this.#slotCenter.y + handleDistance * Math.sin(newRotation);

      event.object.position.z = this.#rectangle.position.z;

      // Keep the handle's rotation aligned with the rectangle
      event.object.rotation.z = newRotation - Math.PI / 2; // Handle points outward

      this.renderer.queueAnimationFrame();
    });

    this.#rotationControls.addEventListener("dragend", () => {
      if (
        this.renderer.cameraHandler &&
        typeof this.renderer.cameraHandler.setOrbitControlsEnabled === "function"
      ) {
        this.renderer.cameraHandler.setOrbitControlsEnabled(true);
      }
      this.renderer.queueAnimationFrame();
    });
  }

  #cleanupInteractivity(): void {
    // Remove interactivity listeners
    document.removeEventListener("mousemove", this.#mouseMoveHandler);
    document.removeEventListener("mouseup", this.#mouseUpHandler);
    this.renderer.gl.domElement.removeEventListener("click", this.#handleClick);
    this.renderer.gl.domElement.removeEventListener("touchend", this.#handleTouch);
    this.#dragControls.dispose();
    this.#rotationControls.dispose();
  }

  #handleCameraMove = (): void => {
    this.updateCameras();
  };

  public updateCameras(): void {
    this.#setupDragControls();
    this.#setupRotationControls();
  }

  public getPosition(): THREE.Vector3 {
    const wheelBase = WHEEL_BASE_ID4; // Use the constant for ID.4
    const offset = new THREE.Vector3(wheelBase / 2, 0, 0);
    const offsetWithRotation = offset
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), this.#rectangle.rotation.z);
    const rearCenter = this.#rectangle.position.clone().sub(offsetWithRotation);
    return rearCenter;
  }

  public getRotation(): number {
    return this.#rectangle.rotation.z;
  }

  public getCornerPoints(): THREE.Vector3[] {
    const matrix = new THREE.Matrix4();
    this.#rectangle.updateWorldMatrix(true, false);
    matrix.copy(this.#rectangle.matrixWorld);

    const corners: THREE.Vector3[] = [];
    // 添加非空断言确保position属性存在
    const vertices = this.#rectangle.geometry.attributes.position!.array;

    // 遍历平面几何体的四个顶点（PlaneGeometry默认有4个顶点）
    for (let i = 0; i < vertices.length; i += 3) {
      const vec = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(
        matrix,
      );
      corners.push(vec);
    }

    // 返回去重后的四个角点（平面几何体可能有重复顶点）
    return [...new Set(corners.map((v) => v.toArray().join(",")))].map((s) => {
      const [x, y, z] = s.split(",").map(Number);
      return new THREE.Vector3(x, y, z);
    });
  }
}
