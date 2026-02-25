import * as THREE from "three";
import Experience from "../Experience";

export default class Callout extends THREE.Group {
  constructor() {
    super();
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;

    // Get sample frame textures from resources
    this.sampleImages = [
      this.resources.items.frame1,
      this.resources.items.frame2,
      this.resources.items.frame3,
      this.resources.items.frame4,
      this.resources.items.frame5,
      this.resources.items.frame6,
      this.resources.items.frame7,
      this.resources.items.frame8,
    ];

    // Start with first frame
    this.currentFrameIndex = 0;

    // Parameterized dimensions
    this.stemHeight = 0.036;
    this.displayWidth = 0.28; // Match PNG aspect ratio (618x386 = 1.6:1)
    this.displayHeight = 0.175; // 0.28 / 1.6 = 0.175

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

    // Use sample frame texture instead of canvas
    const texture = this.sampleImages[this.currentFrameIndex];
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

  // Method to cycle through frames
  setFrame(index) {
    if (index >= 0 && index < this.sampleImages.length) {
      this.currentFrameIndex = index;
      this.informationDisplay.material.map = this.sampleImages[index];
      this.informationDisplay.material.needsUpdate = true;
    }
  }

  // Method to advance to next frame
  nextFrame() {
    this.currentFrameIndex =
      (this.currentFrameIndex + 1) % this.sampleImages.length;
    this.setFrame(this.currentFrameIndex);
  }

  // Method to set a random frame
  setRandomFrame() {
    const randomIndex = Math.floor(Math.random() * this.sampleImages.length);
    this.setFrame(randomIndex);
  }
}
