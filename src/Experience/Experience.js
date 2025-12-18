import * as THREE from "three";
import {
  Debug,
  Sizes,
  Time,
  Resources,
  Camera,
  Renderer,
  Networking,
  User,
  Controller,
} from "./brahma/Brahma.js";
import EventEmitter from "./brahma/utilities/EventEmitter.js";
import Pointer from "./Utils/Pointer.js";
import World from "./World/World.js";
import sources from "./sources.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

let instance = null;

export default class Experience extends EventEmitter {
  constructor(canvas) {
    super();

    // Singleton pattern
    if (instance) {
      return instance;
    }
    instance = this;
    window.experience = this;

    this.canvas = canvas;
    this.debug = new Debug();
    this.user = new User();
    /* Selectable Objects */
    this.selectableObjects = [];

    /*
      Pointer Section
    */
    this.pointer = new Pointer();

    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    window.addEventListener("mousemove", (event) => {
      if (!this.camera) return; // Wait for camera to be initialized
      const mouse = new THREE.Vector2();
      mouse.x = (event.clientX / sizes.width) * 2 - 1;
      mouse.y = -(event.clientY / sizes.height) * 2 + 1;
      this.pointer.setSource("camera", { camera: this.camera.instance, mouse });
    });

    window.addEventListener("click", () => {
      this.pointer.select();
    });

    if (this.debug.active) {
      // this.debugFolder = this.debug.ui.addFolder("experience");
      // this.debug.ui
      //   .add(
      //     {
      //       initNetworking: () => {
      //         window.experience.networking = new Networking();
      //         // hides Join Session after it's clicked
      //         this.debug.ui.domElement.style.display = "none";
      //       },
      //     },
      //     "initNetworking"
      //   )
      //   .name("Join Session");
      // add a button that does     this.networking = new Networking();
    }
    // hide debug UI
    this.debug.ui.domElement.style.display = "none";

    this.sizes = new Sizes();
    this.time = new Time();
    this.scene = new THREE.Scene();
    // console.log("sources", sources);
    this.resources = new Resources(sources);
    this.world = new World();
    this.cameraGroup = new THREE.Group();

    this.camera = new Camera();
    this.renderer = new Renderer();

    // Initialize pointer with camera source now that camera exists
    const initialMouse = new THREE.Vector2(0, 0);
    this.pointer.setSource("camera", {
      camera: this.camera.instance,
      mouse: initialMouse,
    });
    console.log("Pointer initialized with camera source");

    /** XR/Immersive Code */
    this.scene.add(this.cameraGroup);
    this.controller = new Controller();
    this.renderer.instance.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer.instance));
    // samir believes this gets hit when we're in XR
    this.renderer.instance.setAnimationLoop(() => {
      this.controller.update();
      if (this.networking?.canSendEmbodiment) {
        this.networking.sendEmbodiment(
          this.camera.instance.matrixWorld,
          this.controller.controller1.matrixWorld,
          this.controller.controller2.matrixWorld
        );
      }

      this.renderer.instance.render(this.scene, this.camera.instance);
    });

    this.sizes.on("resize", () => {
      this.resize();
      this.camera.resize();
      this.renderer.resize();
    });
    this.time.on("tick", () => {
      this.update();
    });

    // this.setupLoginPanel();
  }

  resize() {
    console.log("resized occured");
    this.camera.resize();
  }

  update() {
    this.camera.update();
    if (!this.isXRActive()) {
      // this is executed when out of XR i.e. desktop
      this.cameraGroup.updateMatrixWorld();
      this.camera.instance.updateMatrixWorld();
      this.pointer.hover();
    } else {
      console.log("im in headset");
    }
    this.world.update();
  }
  isXRActive() {
    return this.renderer.instance.xr.isPresenting;
  }
  destroy() {
    this.sizes.off("resize");
    this.time.off("tick");

    this.scene.traverse((child) => {
      // Test if it's a mesh
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Loop through the material properties
        for (const key in child.material) {
          const value = child.material[key];

          // Test if there is a dispose function
          if (value && typeof value.dispose === "function") {
            value.dispose();
          }
        }
      }
    });
    this.camera.controls.dispose();
    this.renderer.instance.dispose();
    if (this.debug.active) {
      this.debug.ui.destroy();
    }
  }
}
