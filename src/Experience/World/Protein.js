import * as THREE from "three";
import { PDBLoader } from "three/addons/loaders/PDBLoader.js";
import Experience from "../Experience.js";

export default class Protein {
  constructor(filename, title, description, metadata) {
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.debug = this.experience.debug;

    this.filename = filename;
    this.title = title;
    this.description = description;
    this.metadata = metadata;

    // Main group for the protein
    this.root = new THREE.Group();
    this.group = new THREE.Group();
    this.root.position.set(0, 1.2, -0.5);
    this.group.add(this.root);
    this.scene.add(this.group);

    // Initialize loader and load the protein
    this.loader = new PDBLoader();
    this.loadProtein(filename);
    this.group.scale.set(0.00008, 0.00008, 0.00008);
    this.group.rotation.x -= Math.PI / 2;
    this.group.position.y += 0.6;
  }

  loadProtein(filename) {
    const url = "./" + filename;

    this.loader.load(
      url,
      (pdb) => {
        this.onProteinLoaded(pdb);
      },
      (xhr) => {
        console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
      },
      (error) => {
        console.error("Error loading PDB file:", error);
      }
    );
  }

  onProteinLoaded(pdb) {
    const geometryAtoms = pdb.geometryAtoms;
    const geometryBonds = pdb.geometryBonds;
    const json = pdb.json;

    // Center the protein
    geometryAtoms.computeBoundingBox();
    const offset = new THREE.Vector3();
    geometryAtoms.boundingBox.getCenter(offset).negate();

    geometryAtoms.translate(offset.x, offset.y, offset.z);
    geometryBonds.translate(offset.x, offset.y, offset.z);

    // Render atoms using instanced geometry
    this.renderAtomsInstanced(geometryAtoms);

    // Render bonds using instanced geometry
    // this.renderBondsInstanced(geometryBonds);

    console.log(`Protein loaded: ${json.atoms.length} atoms`);
  }

  renderAtomsInstanced(geometryAtoms) {
    const positions = geometryAtoms.getAttribute("position");
    const colors = geometryAtoms.getAttribute("color");
    const atomCount = positions.count;

    // Create instanced mesh for all atoms
    const sphereGeometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshPhongMaterial();
    const atomsMesh = new THREE.InstancedMesh(
      sphereGeometry,
      material,
      atomCount
    );

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(25, 25, 25);
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    for (let i = 0; i < atomCount; i++) {
      position.set(
        positions.getX(i) * 75,
        positions.getY(i) * 75,
        positions.getZ(i) * 75
      );

      matrix.compose(position, quaternion, scale);
      atomsMesh.setMatrixAt(i, matrix);

      color.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
      atomsMesh.setColorAt(i, color);
    }

    atomsMesh.instanceMatrix.needsUpdate = true;
    atomsMesh.instanceColor.needsUpdate = true;

    this.root.add(atomsMesh);
  }

  renderBondsInstanced(geometryBonds) {
    const positions = geometryBonds.getAttribute("position");
    const bondCount = positions.count / 2;

    // Create instanced mesh for all bonds
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bondsMesh = new THREE.InstancedMesh(boxGeometry, material, bondCount);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();

    for (let i = 0; i < bondCount; i++) {
      const idx = i * 2;

      start.set(
        positions.getX(idx) * 75,
        positions.getY(idx) * 75,
        positions.getZ(idx) * 75
      );

      end.set(
        positions.getX(idx + 1) * 75,
        positions.getY(idx + 1) * 75,
        positions.getZ(idx + 1) * 75
      );

      // Position at midpoint
      position.copy(start).lerp(end, 0.5);

      // Calculate rotation to point from start to end
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();

      // Orient along Z axis
      const up = new THREE.Vector3(0, 0, 1);
      quaternion.setFromUnitVectors(up, direction.normalize());

      // Scale
      scale.set(5, 5, length);

      matrix.compose(position, quaternion, scale);
      bondsMesh.setMatrixAt(i, matrix);
    }

    bondsMesh.instanceMatrix.needsUpdate = true;

    this.root.add(bondsMesh);
  }

  update() {
    // Optional: Add rotation or other animations
    // this.root.rotation.y += 0.001;
  }
}
