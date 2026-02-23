import * as THREE from "three";
import Experience from "../Experience";

export default class Callout extends THREE.Group {
  constructor() {
    super();
    this.experience = new Experience();
    this.scene = this.experience.scene;

    // Parameterized dimensions
    this.stemHeight = 0.18;
    this.displayWidth = 0.28; // Compact 3-column layout
    this.displayHeight = 0.12; // Compact height

    // Enhanced glass stem with taper (thinner at top, slightly thicker at bottom)
    const stemGeometry = new THREE.CylinderGeometry(
      0.0015, // Top radius - thinner
      0.003, // Bottom radius - slightly thicker
      this.stemHeight,
      8, // Optimized segment count
    );

    // VR-optimized glass material (MeshBasicMaterial instead of MeshPhysicalMaterial)
    const stemMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });

    this.stem = new THREE.Mesh(stemGeometry, stemMaterial);
    this.stem.position.y = this.stemHeight / 2;
    this.add(this.stem);

    // Create canvas once and reuse it (performance optimization)
    this.canvas = document.createElement("canvas");
    this.canvas.width = 800;
    this.canvas.height = 180;
    this.ctx = this.canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });

    const texture = new THREE.CanvasTexture(this.canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false, // Prevent clipping through geometry
      depthWrite: false, // Don't write to depth buffer
    });

    this.informationDisplay = new THREE.Mesh(
      new THREE.PlaneGeometry(this.displayWidth, this.displayHeight),
      material,
    );

    // Set high render order to ensure it renders on top
    this.informationDisplay.renderOrder = 999;

    // Position bottom edge of display at top of stem
    this.informationDisplay.position.y =
      this.stemHeight + this.displayHeight / 2;
    this.add(this.informationDisplay);

    this.scene.add(this);
  }
}
