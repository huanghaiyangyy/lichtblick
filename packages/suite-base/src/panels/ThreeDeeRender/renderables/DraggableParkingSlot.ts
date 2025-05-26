import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls";

import { stringToRgba } from "../color";
import { Renderable } from "../Renderable";
import type { IRenderer } from "../IRenderer";

const HANDLE_SIZE = 0.3;
const HANDLE_DISTANCE = 0.5; // Distance from rectangle edge
const DEFAULT_RECTANGLE_COLOR = "rgba(255, 255, 255, 0.75)";
const HANDLE_COLOR = 0x2c6ef6;
const HANDLE_OPACITY = 0.7;

const WHEEL_BASE_ID4 = 2.9231; // Wheelbase of the car in meters

export type DraggableParkingSlotOptions = {
  id: string;
  renderer: IRenderer;
  length: number;
  width: number;
  color?: string;
  initialPosition: THREE.Vector3;
  initialRotation?: number;
};

export class DraggableParkingSlot extends Renderable {
  #length: number;
  #width: number;
  #rectangle: THREE.Mesh;
  #outline: THREE.LineSegments;
  #color: string;
  #rotationHandle: THREE.Mesh;
  #mouseMoveHandler: (event: MouseEvent) => void = () => {};
  #mouseUpHandler: () => void = () => {};
  #raycaster = new THREE.Raycaster();
  #dragControls = new DragControls([], new THREE.PerspectiveCamera(), document.createElement("canvas"));
  #draggableObjects: THREE.Object3D[] = [];
  #startRotation = 0;
  #startAngle = 0;
  #rotationControls = new DragControls([], new THREE.PerspectiveCamera(), document.createElement("canvas"));
  #slotCenter = new THREE.Vector3();
  #enableDragging = true;

  public constructor(options: DraggableParkingSlotOptions) {
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
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    this.#rectangle = new THREE.Mesh(rectangleGeometry, rectangleMaterial);
    this.#rectangle.rotation.x = 0; // Lay flat on the XY plane
    this.#rectangle.position.copy(options.initialPosition);

    // Create the outline
    const outlineGeometry = new THREE.EdgesGeometry(rectangleGeometry);
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
    this.#outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.#outline.rotation.x = 0;
    this.#outline.position.copy(options.initialPosition);

    // Create the rotation handle
    const handleGeometry = new THREE.SphereGeometry(HANDLE_SIZE, 16, 16);
    const handleMaterial = new THREE.MeshBasicMaterial({
      color: HANDLE_COLOR,
      transparent: true,
      opacity: HANDLE_OPACITY,
    });
    this.#rotationHandle = new THREE.Mesh(handleGeometry, handleMaterial);
    this.updateHandlePosition();

    if (options.initialRotation) {
      this.#rectangle.rotation.z = options.initialRotation;
      this.#outline.rotation.z = options.initialRotation;
      this.updateHandlePosition();
    }

    this.add(this.#rectangle);
    this.add(this.#outline);
    this.add(this.#rotationHandle);

    this.#rectangle.userData.pickable = true;
    this.#rotationHandle.userData.pickable = true;

    // Set up the draggable objects for DragControls
    this.#draggableObjects = [this.#rectangle];

    this.#setupDragControls();

    this.#slotCenter.copy(this.#rectangle.position);
    this.#setupRotationControls();

    this.renderer.on("cameraMove", this.#handleCameraMove);
  }

  public override dispose(): void {
    this.renderer.off("cameraMove", this.#handleCameraMove);
    this.#cleanupInteractivity();
    this.#dragControls.dispose();
    this.#rotationControls.dispose();

    this.#rectangle.geometry.dispose();
    (this.#rectangle.material as THREE.Material).dispose();

    this.#outline.geometry.dispose();
    (this.#outline.material as THREE.Material).dispose();

    this.#rotationHandle.geometry.dispose();
    (this.#rotationHandle.material as THREE.Material).dispose();

    super.dispose();
  }

  public setDraggingEnable(enable: boolean): void {
    this.#enableDragging = enable;
    this.#dragControls.enabled = enable;
    this.#rotationControls.enabled = enable;

    if (!enable) {
      this.#rotationHandle.material = new THREE.MeshBasicMaterial({
        color: HANDLE_COLOR,
        transparent: true,
        opacity: 0.3,
      });
    } else {
      this.#rotationHandle.material = new THREE.MeshBasicMaterial({
        color: HANDLE_COLOR,
        transparent: true,
        opacity: HANDLE_OPACITY,
      });
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
    const rgba = stringToRgba({r: 0, g: 0, b:0, a:1}, colorStr);
    (this.#rectangle.material as THREE.MeshBasicMaterial).color.setRGB(
      rgba.r,
      rgba.g,
      rgba.b
    );
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
    this.#outline.geometry = new THREE.EdgesGeometry(this.#rectangle.geometry);

    // Update handle position
    this.updateHandlePosition();
  }

  private updateHandlePosition(): void {
    // Position the handle at the front edge of the rectangle
    const handleOffset = (this.#length / 2) + HANDLE_DISTANCE;
    this.#rotationHandle.position.set(
      this.#slotCenter.x + handleOffset * Math.cos(this.#rectangle.rotation.z),
      this.#slotCenter.y + handleOffset * Math.sin(this.#rectangle.rotation.z),
      this.#rectangle.position.z
    );
  }

  #setupDragControls(): void {
    this.#dragControls = new DragControls(
      this.#draggableObjects,
      this.renderer.cameraHandler.getActiveCamera(),
      this.renderer.gl.domElement
    );

    if (!this.#enableDragging) {
      this.#dragControls.enabled = false;
    }

    // Constrain movement to XY plane (Z=0)
    this.#dragControls.transformGroup = false;

    // DragControls events
    this.#dragControls.addEventListener('dragstart', () => {
      // Disable orbit controls through the renderer
      if (this.renderer.cameraHandler &&
          typeof this.renderer.cameraHandler.setOrbitControlsEnabled === 'function') {
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

    this.#dragControls.addEventListener('drag', (event) => {
      this.#outline.position.copy(this.#rectangle.position);
      this.#slotCenter.copy(this.#rectangle.position);

      event.object.position.z = 0;
      this.#outline.position.z = 0;

      this.updateHandlePosition();

      this.renderer.queueAnimationFrame();
    });

    this.#dragControls.addEventListener('dragend', () => {
      if (this.renderer.cameraHandler &&
          typeof this.renderer.cameraHandler.setOrbitControlsEnabled === 'function') {
        this.renderer.cameraHandler.setOrbitControlsEnabled(true);
      }
      // Re-enable the controls (might have been disabled in dragstart)
      this.#dragControls.enabled = true;

      this.renderer.queueAnimationFrame();
    });
  }

  #setupRotationControls(): void {
    this.#rotationControls = new DragControls(
      [this.#rotationHandle],
      this.renderer.cameraHandler.getActiveCamera(),
      this.renderer.gl.domElement
    );

    if (!this.#enableDragging) {
      this.#rotationControls.enabled = false;
    }

    // Disable regular dragging for the handle
    this.#rotationControls.addEventListener('dragstart', () => {
      if (this.renderer.cameraHandler &&
          typeof this.renderer.cameraHandler.setOrbitControlsEnabled === 'function') {
        this.renderer.cameraHandler.setOrbitControlsEnabled(false);
      }
      this.#startRotation = this.#rectangle.rotation.z;

      const centerToHandle = new THREE.Vector2(
        this.#rotationHandle.position.x - this.#slotCenter.x,
        this.#rotationHandle.position.y - this.#slotCenter.y
      );
      this.#startAngle = Math.atan2(centerToHandle.y, centerToHandle.x);
    });

    this.#rotationControls.addEventListener('drag', (event) => {
      const centerToHandle = new THREE.Vector2(
        event.object.position.x - this.#slotCenter.x,
        event.object.position.y - this.#slotCenter.y
      );

      const currentAngle = Math.atan2(centerToHandle.y, centerToHandle.x);

      const angleDelta = currentAngle - this.#startAngle;

      const newRotation = this.#startRotation + angleDelta;
      this.#rectangle.rotation.z = newRotation;
      this.#outline.rotation.z = newRotation;

      // Keep the handle at fixed distance from center
      const handleDistance = (this.#length / 2) + HANDLE_DISTANCE;
      event.object.position.x = this.#slotCenter.x + handleDistance * Math.cos(newRotation);
      event.object.position.y = this.#slotCenter.y + handleDistance * Math.sin(newRotation);

      event.object.position.z = this.#rectangle.position.z;

      this.renderer.queueAnimationFrame();
    });

    this.#rotationControls.addEventListener('dragend', () => {
      if (this.renderer.cameraHandler &&
          typeof this.renderer.cameraHandler.setOrbitControlsEnabled === 'function') {
        this.renderer.cameraHandler.setOrbitControlsEnabled(true);
      }
      this.renderer.queueAnimationFrame();
    });
  }

  #cleanupInteractivity(): void {
    // Remove event listeners
    document.removeEventListener("mousemove", this.#mouseMoveHandler);
    document.removeEventListener("mouseup", this.#mouseUpHandler);
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
    const offsetWithRotation = offset.clone().applyAxisAngle(
      new THREE.Vector3(0, 0, 1),
      this.#rectangle.rotation.z
    );
    const rearCenter = this.#rectangle.position.clone().sub(offsetWithRotation);
    return rearCenter;
  }

  public getRotation(): number {
    return this.#rectangle.rotation.z;
  }
}
