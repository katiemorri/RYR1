import * as THREE from "three";
import { Environment, Floor, Stars } from "../brahma/Brahma.js";
import Experience from "../Experience.js";
import Sky from "./Sky.js";
import Protein from "./Protein.js";
export default class World {
  constructor() {
    this.experience = new Experience();
    this.sizes = this.experience.sizes;
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.floor = new Floor();
    // this.depthMarker = new DepthMarker();
    // Wait for resources

    this.resources.on("ready", () => {
      this.stars = new Stars();
      this.environment = new Environment();
      this.protein = new Protein(
        "8X48.pdb",
        "Protein Title",
        "Protein Description",
        "Protein Metadata",
        0.2
      );
    });
  }
  update() {}
}
