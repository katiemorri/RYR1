import * as THREE from "three";
import { Environment, Floor, Stars } from "../brahma/Brahma.js";
import Experience from "../Experience.js";
import Sky from "./Sky.js";
import Protein from "./Protein.js";
import Callout from "./Callout.js";
export default class World {
  constructor() {
    this.experience = new Experience();
    this.sizes = this.experience.sizes;
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.floor = new Floor();
    // this.depthMarker = new DepthMarker();
    // Wait for resources

    // lighting: directional top-left, ambient, weak fill from opposite side
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(-1, 1, 0.5);
    dir.position.multiplyScalar(10);
    this.scene.add(dir);

    this.resources.on("ready", () => {
      this.stars = new Stars();
      this.environment = new Environment();
      this.callout = new Callout();
      this.protein = new Protein(
        "8X48.pdb",
        "Protein Title",
        "Protein Description",
        "Protein Metadata",
      );
    });
  }
  update() {}
}
