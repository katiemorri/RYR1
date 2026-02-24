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

    // Store protein meshes for interaction
    this.meshes = [];

    // Initialize loader and load the protein
    this.loader = new PDBLoader();
    this.loadProtein(filename);
    this.group.scale.set(0.0002, 0.0002, 0.0002);
    this.group.rotation.x -= Math.PI / 2;
    this.group.position.y += 1.2;

    // Visual defaults to match PyMOL-like cartoon
    this.scene.background = new THREE.Color(0xffffff);

    // const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    // this.scene.add(ambient);

    // const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    // fill.position.set(1, -0.5, -0.5);
    // fill.position.multiplyScalar(10);
    // this.scene.add(fill);
  }

  loadProtein(filename) {
    const pdbUrl = "./" + filename;
    // Derive SS JSON path: "8X48.pdb" → "8X48.ss.json"
    const ssUrl = "./" + filename.replace(/\.pdb$/i, ".ss.json");

    Promise.all([
      fetch(pdbUrl).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading ${pdbUrl}`);
        return r.text();
      }),
      fetch(ssUrl)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([pdbText, ssJson]) => {
        const pdb = this.loader.parse(pdbText);
        const residues = this.parseResiduesFromPDB(pdbText);
        const missingResidues = this.parseMissingResiduesFromPDB(pdbText);

        let ssLabels;
        if (ssJson && ssJson.assignments) {
          // Use pre-computed Molstar DSSP assignments (gold standard)
          ssLabels = residues.map((r) => {
            const key = `${r.chain}:${r.resSeq}:${r.insertionCode}`;
            const ss = ssJson.assignments[key];
            if (ss === "helix") return "H";
            if (ss === "sheet") return "E";
            return "C";
          });
          console.log(
            "Secondary structure loaded from pre-computed JSON",
            `(${ssLabels.filter((l) => l === "H").length} helix,`,
            `${ssLabels.filter((l) => l === "E").length} sheet,`,
            `${ssLabels.filter((l) => l === "C").length} coil)`,
          );
        } else {
          // Fallback: runtime CA-distance method (Zhang & Skolnick)
          ssLabels = this.computeDSSP(residues);
        }

        this.onProteinLoaded(pdb, { residues, ssLabels, missingResidues });
      })
      .catch((error) => {
        console.error("Error loading protein:", error);
      });
  }

  onProteinLoaded(pdb, secondaryStructure) {
    const geometryAtoms = pdb.geometryAtoms;

    // Center the protein
    geometryAtoms.computeBoundingBox();
    const offset = new THREE.Vector3();
    geometryAtoms.boundingBox.getCenter(offset).negate();

    geometryAtoms.translate(offset.x, offset.y, offset.z);

    const segmentCount = this.renderSecondaryStructure(
      secondaryStructure,
      offset,
    );
    const traceStats = this.renderBackboneTrace(secondaryStructure, offset);
    console.log(
      `Protein loaded: rendered ${segmentCount} secondary-structure segments`,
    );
    console.log(
      `Backbone trace: ${traceStats.solidSegments} solid segments, ` +
        `${traceStats.dashedSegments} dashed missing-residue segments`,
    );
  }

  // Parse missing residues from PDB REMARK 465 records.
  // Returns array of { chain, resSeq, insertionCode }.
  parseMissingResiduesFromPDB(pdbText) {
    const lines = pdbText.split("\n");
    const missing = [];
    const seen = new Set();

    for (const line of lines) {
      if (!line.startsWith("REMARK 465")) continue;

      // PDB fixed columns first (most reliable)
      let chain = line.slice(19, 20).trim();
      let resSeq = parseInt(line.slice(21, 26).trim(), 10);
      let insertionCode = line.slice(26, 27).trim() || "";

      // Fallback for slightly shifted records
      if (Number.isNaN(resSeq)) {
        const match = line.match(
          /^REMARK 465\s+(?:\d+\s+)?[A-Z0-9]{3}\s+([A-Za-z0-9_])\s*(-?\d+)([A-Za-z]?)\s*$/,
        );
        if (!match) continue;
        chain = match[1].trim();
        resSeq = parseInt(match[2], 10);
        insertionCode = match[3] || "";
      }

      if (Number.isNaN(resSeq)) continue;
      if (!chain) chain = "_";

      const key = `${chain}:${resSeq}:${insertionCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push({ chain, resSeq, insertionCode });
    }

    return missing;
  }

  buildMissingResiduesByChain(missingResidues) {
    const missingByChain = new Map();
    for (const m of missingResidues || []) {
      if (!missingByChain.has(m.chain)) missingByChain.set(m.chain, []);
      missingByChain.get(m.chain).push(m);
    }

    for (const arr of missingByChain.values()) {
      arr.sort(
        (a, b) =>
          a.resSeq - b.resSeq ||
          a.insertionCode.localeCompare(b.insertionCode),
      );
    }

    return missingByChain;
  }

  hasMissingBetweenResidues(currentResidue, nextResidue, missingByChain) {
    if (currentResidue.chain !== nextResidue.chain) return false;
    const chainMissing = missingByChain.get(currentResidue.chain);
    if (!chainMissing || chainMissing.length === 0) return false;

    if (nextResidue.resSeq - currentResidue.resSeq > 1) return true;

    for (const m of chainMissing) {
      if (m.resSeq > currentResidue.resSeq && m.resSeq < nextResidue.resSeq) {
        return true;
      }
    }

    return false;
  }

  buildContiguousResidueBlocks(residues, missingByChain) {
    const blocks = [];
    if (!residues || residues.length === 0) return blocks;

    let start = 0;
    for (let i = 1; i < residues.length; i++) {
      const prev = residues[i - 1];
      const cur = residues[i];
      const chainBreak = prev.chain !== cur.chain;
      const missingBreak = this.hasMissingBetweenResidues(
        prev,
        cur,
        missingByChain,
      );

      if (chainBreak || missingBreak) {
        blocks.push({ start, end: i - 1 });
        start = i;
      }
    }
    blocks.push({ start, end: residues.length - 1 });
    return blocks;
  }

  renderBackboneTrace(ssData, offset) {
    if (!ssData || !ssData.residues) {
      return { solidSegments: 0, dashedSegments: 0 };
    }

    const residues = ssData.residues;
    const missingResidues = ssData.missingResidues || [];
    const worldScale = 75;
    const missingByChain = this.buildMissingResiduesByChain(missingResidues);
    const backboneColor = 0x7c8cc4;
    const backboneOpacity = 0.8;
    const dashSize = 75;
    const gapSize = 35;
    const backboneRadius = 0.1 * worldScale;

    const solidPositions = [];
    const dashedPositions = [];

    for (let i = 0; i < residues.length - 1; i++) {
      const currentResidue = residues[i];
      const nextResidue = residues[i + 1];
      if (currentResidue.chain !== nextResidue.chain) continue;

      const p1 = currentResidue.ca
        .clone()
        .add(offset)
        .multiplyScalar(worldScale);
      const p2 = nextResidue.ca.clone().add(offset).multiplyScalar(worldScale);

      const hasMissingGap = this.hasMissingBetweenResidues(
        currentResidue,
        nextResidue,
        missingByChain,
      );
      const target = hasMissingGap ? dashedPositions : solidPositions;
      target.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    if (solidPositions.length > 0) {
      this.renderSolidBackboneTubes(solidPositions, {
        color: backboneColor,
        opacity: backboneOpacity,
        radius: backboneRadius,
      });
    }

    if (dashedPositions.length > 0) {
      this.renderDashedBackboneTubes(dashedPositions, {
        color: backboneColor,
        opacity: backboneOpacity,
        dashSize,
        gapSize,
        radius: backboneRadius,
      });
    }

    return {
      solidSegments: solidPositions.length / 6,
      dashedSegments: dashedPositions.length / 6,
    };
  }

  renderDashedBackboneTubes(dashedPositions, options) {
    const {
      color = 0x7c8cc4,
      opacity = 0.8,
      dashSize = 75,
      gapSize = 35,
      radius = 1,
    } = options || {};

    const material = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });
    const unitCylinder = new THREE.CylinderGeometry(radius, radius, 1, 10, 1);

    let dashInstanceCount = 0;
    for (let i = 0; i < dashedPositions.length; i += 6) {
      const startX = dashedPositions[i];
      const startY = dashedPositions[i + 1];
      const startZ = dashedPositions[i + 2];
      const endX = dashedPositions[i + 3];
      const endY = dashedPositions[i + 4];
      const endZ = dashedPositions[i + 5];

      const segmentLength = Math.sqrt(
        (endX - startX) * (endX - startX) +
          (endY - startY) * (endY - startY) +
          (endZ - startZ) * (endZ - startZ),
      );
      if (segmentLength < 1e-6) continue;

      let traveled = 0;
      while (traveled < segmentLength) {
        const currentDashLength = Math.min(dashSize, segmentLength - traveled);
        if (currentDashLength <= 0) break;
        dashInstanceCount++;
        traveled += currentDashLength + gapSize;
      }
    }

    if (dashInstanceCount === 0) {
      unitCylinder.dispose();
      material.dispose();
      return;
    }

    const dashedInstances = new THREE.InstancedMesh(
      unitCylinder,
      material,
      dashInstanceCount,
    );

    const yAxis = new THREE.Vector3(0, 1, 0);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const dashStart = new THREE.Vector3();
    const dashEnd = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();

    let instanceIndex = 0;
    for (let i = 0; i < dashedPositions.length; i += 6) {
      start.set(dashedPositions[i], dashedPositions[i + 1], dashedPositions[i + 2]);
      end.set(
        dashedPositions[i + 3],
        dashedPositions[i + 4],
        dashedPositions[i + 5],
      );

      direction.copy(end).sub(start);
      const segmentLength = direction.length();
      if (segmentLength < 1e-6) continue;
      direction.normalize();

      quaternion.setFromUnitVectors(yAxis, direction);

      let traveled = 0;
      while (traveled < segmentLength) {
        const currentDashLength = Math.min(dashSize, segmentLength - traveled);
        if (currentDashLength <= 0) break;

        dashStart.copy(start).addScaledVector(direction, traveled);
        dashEnd
          .copy(start)
          .addScaledVector(direction, traveled + currentDashLength);
        mid.copy(dashStart).add(dashEnd).multiplyScalar(0.5);

        scale.set(1, currentDashLength, 1);
        matrix.compose(mid, quaternion, scale);
        dashedInstances.setMatrixAt(instanceIndex, matrix);
        instanceIndex++;

        traveled += currentDashLength + gapSize;
      }
    }

    dashedInstances.instanceMatrix.needsUpdate = true;
    dashedInstances.computeBoundingSphere();
    this.root.add(dashedInstances);
  }

  renderSolidBackboneTubes(solidPositions, options) {
    const { color = 0x7c8cc4, opacity = 0.8, radius = 1 } = options || {};

    const material = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });
    const unitCylinder = new THREE.CylinderGeometry(radius, radius, 1, 10, 1);

    const segmentCount = Math.floor(solidPositions.length / 6);
    if (segmentCount === 0) {
      unitCylinder.dispose();
      material.dispose();
      return;
    }

    const solidInstances = new THREE.InstancedMesh(
      unitCylinder,
      material,
      segmentCount,
    );

    const yAxis = new THREE.Vector3(0, 1, 0);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();

    let instanceIndex = 0;
    for (let i = 0; i < solidPositions.length; i += 6) {
      start.set(solidPositions[i], solidPositions[i + 1], solidPositions[i + 2]);
      end.set(solidPositions[i + 3], solidPositions[i + 4], solidPositions[i + 5]);

      direction.copy(end).sub(start);
      const segmentLength = direction.length();
      if (segmentLength < 1e-6) continue;
      direction.normalize();

      mid.copy(start).add(end).multiplyScalar(0.5);
      quaternion.setFromUnitVectors(yAxis, direction);
      scale.set(1, segmentLength, 1);
      matrix.compose(mid, quaternion, scale);
      solidInstances.setMatrixAt(instanceIndex, matrix);
      instanceIndex++;
    }

    solidInstances.count = instanceIndex;
    solidInstances.instanceMatrix.needsUpdate = true;
    solidInstances.computeBoundingSphere();
    this.root.add(solidInstances);
  }

  // Parse residues from PDB text collecting CA and O coordinates per residue
  parseResiduesFromPDB(pdbText) {
    const lines = pdbText.split("\n");
    const residueMap = new Map();

    for (const line of lines) {
      if (!line.startsWith("ATOM")) continue;
      const atomName = line.slice(12, 16).trim();
      const chain = line.slice(21, 22).trim() || "_";
      const resSeq = parseInt(line.slice(22, 26).trim(), 10);
      if (Number.isNaN(resSeq)) continue;
      const insertionCode = line.slice(26, 27).trim() || "";
      const key = `${chain}:${resSeq}:${insertionCode}`;

      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

      if (!residueMap.has(key)) {
        residueMap.set(key, {
          chain,
          resSeq,
          insertionCode,
          ca: null,
          o: null,
        });
      }

      const res = residueMap.get(key);
      if (atomName === "CA") res.ca = new THREE.Vector3(x, y, z);
      if (atomName === "O") res.o = new THREE.Vector3(x, y, z);
    }

    // Group by chain and sort
    const chains = new Map();
    for (const res of residueMap.values()) {
      if (!chains.has(res.chain)) chains.set(res.chain, []);
      chains.get(res.chain).push(res);
    }
    const residues = [];
    for (const [chain, arr] of chains) {
      arr.sort(
        (a, b) =>
          a.resSeq - b.resSeq || a.insertionCode.localeCompare(b.insertionCode),
      );
      for (const r of arr) {
        // ensure CA exists
        if (!r.ca) continue;
        residues.push(r);
      }
    }
    return residues;
  }

  // Fallback SS assignment using CA-CA distance patterns (Zhang & Skolnick method,
  // as used by NGL Viewer). Needs only CA positions — no backbone reconstruction.
  // Reference: https://github.com/nglviewer/ngl/blob/master/src/structure/structure-utils.ts
  computeDSSP(residues) {
    const n = residues.length;
    if (n === 0) return [];

    // Ideal CA-CA distances for consecutive residues i→i+2, i→i+3, i→i+4
    const helixDist = [5.45, 5.18, 6.37]; // Å, typical α-helix
    const sheetDist = [6.1, 10.4, 13.0]; // Å, typical β-sheet
    const helixDelta = 2.1; // tolerance
    const sheetDelta = 1.42;

    const labels = new Array(n).fill("C");

    // Check whether residue i is part of a local pattern starting at j
    const matchPattern = (j, dists, delta) => {
      for (let k = 0; k < 3; k++) {
        const m = j + k + 2; // j+2, j+3, j+4
        if (m >= n) return false;
        // Don't match across chain boundaries
        if (residues[j].chain !== residues[m].chain) return false;
        const d = residues[j].ca.distanceTo(residues[m].ca);
        if (Math.abs(d - dists[k]) > delta) return false;
      }
      return true;
    };

    // For each residue, check if any window covering it matches helix or sheet
    for (let i = 0; i < n; i++) {
      // A window j..j+4 covers residue i when j <= i <= j+4, so j ∈ [i-4, i]
      let isHelix = false;
      let isSheet = false;
      for (let j = Math.max(0, i - 4); j <= i; j++) {
        if (j + 4 >= n) continue;
        if (residues[j].chain !== residues[i].chain) continue;
        if (!isHelix && matchPattern(j, helixDist, helixDelta)) isHelix = true;
        if (!isSheet && matchPattern(j, sheetDist, sheetDelta)) isSheet = true;
        if (isHelix) break; // helix takes priority
      }
      if (isHelix) labels[i] = "H";
      else if (isSheet) labels[i] = "E";
    }

    // Post-process: remove isolated SS assignments (no same-type neighbor)
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (labels[i] === "C") continue;
        const sameChainPrev =
          i > 0 && residues[i - 1].chain === residues[i].chain;
        const sameChainNext =
          i < n - 1 && residues[i + 1].chain === residues[i].chain;
        const prev = sameChainPrev ? labels[i - 1] : "C";
        const next = sameChainNext ? labels[i + 1] : "C";
        if (prev !== labels[i] && next !== labels[i]) {
          labels[i] = "C";
          changed = true;
        }
      }
    }

    return labels;
  }

  renderSecondaryStructure(ssData, offset) {
    // ssData: { residues: [...], ssLabels: [...] }
    if (!ssData || !ssData.residues || !ssData.ssLabels) return 0;
    const residues = ssData.residues;
    const labels = ssData.ssLabels;
    const missingByChain = this.buildMissingResiduesByChain(
      ssData.missingResidues || [],
    );
    const contiguousBlocks = this.buildContiguousResidueBlocks(
      residues,
      missingByChain,
    );
    const blockStartByIndex = new Array(residues.length);
    const blockEndByIndex = new Array(residues.length);
    for (const block of contiguousBlocks) {
      for (let i = block.start; i <= block.end; i++) {
        blockStartByIndex[i] = block.start;
        blockEndByIndex[i] = block.end;
      }
    }

    const worldScale = 75;
    // H = helix (magenta), E = sheet (yellow), C = coil (grey)
    const colorMap = { H: 0x61428c, E: 0xebcc46, C: 0x7c8cc4 };

    const makeMaterial = (label) => {
      const color = colorMap[label] || colorMap.C;
      return new THREE.MeshPhongMaterial({
        color,
        specular: 0xffffff,
        shininess: 120,
        side: THREE.DoubleSide,
      });
    };

    // Group contiguous segments by label (store start/end indices)
    const segments = [];
    let curLabel = null;
    let startIdx = 0;
    for (let i = 0; i < labels.length; i++) {
      const lab = labels[i] || "C";
      if (curLabel === null) {
        curLabel = lab;
        startIdx = i;
        continue;
      }
      const prevResidue = residues[i - 1];
      const currentResidue = residues[i];
      const hasGap = this.hasMissingBetweenResidues(
        prevResidue,
        currentResidue,
        missingByChain,
      );

      if (lab !== curLabel || hasGap) {
        segments.push({ label: curLabel, start: startIdx, end: i - 1 });
        curLabel = lab;
        startIdx = i;
      }
    }
    if (curLabel !== null)
      segments.push({
        label: curLabel,
        start: startIdx,
        end: labels.length - 1,
      });

    let rendered = 0;
    for (const seg of segments) {
      const segLength = seg.end - seg.start + 1;
      if (segLength < 2) continue;

      // Keep overlap for smooth transitions, but clamp within same contiguous block.
      const sIdx = Math.max(blockStartByIndex[seg.start], seg.start - 2);
      const eIdx = Math.min(blockEndByIndex[seg.end], seg.end + 2);
      const points = [];
      for (let k = sIdx; k <= eIdx; k++)
        points.push(
          residues[k].ca.clone().add(offset).multiplyScalar(worldScale),
        );
      const segmentResidues = residues.slice(sIdx, eIdx + 1);
      const curve = new THREE.CatmullRomCurve3(points);
      const samplesPerRes = 6;
      const tubularSegments = Math.max(
        Math.floor(points.length * samplesPerRes),
        12,
      );

      if (seg.label === "C") {
        // coils -> round thin tube (radius 0.3 Å scaled)
        const radius = 0.3 * worldScale;
        const radialSegments = 8;
        const tubeGeom = new THREE.TubeGeometry(
          curve,
          tubularSegments,
          radius,
          radialSegments,
          false,
        );
        const mat = makeMaterial("C");
        const mesh = new THREE.Mesh(tubeGeom, mat);
        this.setupMeshInteraction(mesh);
        this.root.add(mesh);
        rendered++;
        continue;
      }

      // For ribbons (H and E) build extruded rectangular cross-section oriented by O atom
      const geom = this.buildExtrudedRibbon(
        segmentResidues,
        seg.label,
        offset,
        worldScale,
        tubularSegments,
      );
      const mat = makeMaterial(seg.label);
      const mesh = new THREE.Mesh(geom, mat);
      this.setupMeshInteraction(mesh);
      this.root.add(mesh);
      rendered++;
    }

    return rendered;
  }

  // Setup click interaction for protein meshes
  setupMeshInteraction(mesh) {
    // Make mesh selectable
    mesh.selectable = true;
    this.meshes.push(mesh);
    this.experience.selectableObjects.push(mesh);

    // Add click handler that spawns a cube at intersection point
    mesh.onSelect = () => {
      // Get the current intersection point from the pointer
      const intersect = this.experience.pointer.currentIntersect;
      if (intersect && intersect.point) {
        this.spawnTemporaryCube(intersect.point);
      }
    };
  }

  // Spawn a temporary cube at the given world position
  spawnTemporaryCube(position) {
    // Create a small cube (0.1 world units)
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshPhongMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 1.0,
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.copy(position);
    this.scene.add(cube);

    // Animate fade out over 2 seconds
    const startTime = performance.now();
    const duration = 2000; // 2 seconds

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Fade out opacity
      material.opacity = 1.0 - progress;

      // Optional: scale up slightly while fading
      const scale = 1.0 + progress * 0.5;
      cube.scale.set(scale, scale, scale);

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        // Remove cube when animation completes
        this.scene.remove(cube);
        geometry.dispose();
        material.dispose();
      }
    };

    animate();
  }

  // Build an extruded rectangular ribbon mesh for a segment.
  buildExtrudedRibbon(
    residuesSegment,
    segLabel,
    offset,
    worldScale,
    tubularSegments,
  ) {
    const centers = residuesSegment.map((r) =>
      r.ca.clone().add(offset).multiplyScalar(worldScale),
    );
    const curve = new THREE.CatmullRomCurve3(centers);
    const frames = curve.computeFrenetFrames(tubularSegments, false);

    const widthA = segLabel === "H" ? 2.0 : 2.5;
    const heightA = segLabel === "H" ? 0.2 : 0.4;
    const height = heightA * worldScale;
    const samples = tubularSegments;

    // For sheets we'll taper last 3 residues into an arrow
    const residuesCount = residuesSegment.length;
    const taperResidues = segLabel === "E" ? Math.min(3, residuesCount) : 0;
    const samplesPerResidue = Math.max(
      1,
      Math.floor(samples / Math.max(1, residuesCount - 1)),
    );
    const taperSamples = taperResidues * samplesPerResidue;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // helper to push 4 corner verts for a cross-section
    const pushQuad = (p, normalVec, binormalVec, w) => {
      const halfW = w / 2;
      // order: left-top, left-bottom, right-bottom, right-top
      const lt = p
        .clone()
        .addScaledVector(normalVec, halfW)
        .addScaledVector(binormalVec, height / 2);
      const lb = p
        .clone()
        .addScaledVector(normalVec, halfW)
        .addScaledVector(binormalVec, -height / 2);
      const rb = p
        .clone()
        .addScaledVector(normalVec, -halfW)
        .addScaledVector(binormalVec, -height / 2);
      const rt = p
        .clone()
        .addScaledVector(normalVec, -halfW)
        .addScaledVector(binormalVec, height / 2);
      positions.push(
        lt.x,
        lt.y,
        lt.z,
        lb.x,
        lb.y,
        lb.z,
        rb.x,
        rb.y,
        rb.z,
        rt.x,
        rt.y,
        rt.z,
      );
      // approximate normals per corner as combination
      const nlt = normalVec
        .clone()
        .multiplyScalar(0.5)
        .add(binormalVec.clone().multiplyScalar(0.5))
        .normalize();
      const nlb = normalVec
        .clone()
        .multiplyScalar(0.5)
        .add(binormalVec.clone().multiplyScalar(-0.5))
        .normalize();
      const nrb = normalVec
        .clone()
        .multiplyScalar(-0.5)
        .add(binormalVec.clone().multiplyScalar(-0.5))
        .normalize();
      const nrt = normalVec
        .clone()
        .multiplyScalar(-0.5)
        .add(binormalVec.clone().multiplyScalar(0.5))
        .normalize();
      normals.push(
        nlt.x,
        nlt.y,
        nlt.z,
        nlb.x,
        nlb.y,
        nlb.z,
        nrb.x,
        nrb.y,
        nrb.z,
        nrt.x,
        nrt.y,
        nrt.z,
      );
      uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    };

    // generate cross-sections
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = curve.getPointAt(t);
      const tangent = frames.tangents[i].clone().normalize();

      // choose O-based normal if possible (closest residue)
      const resIndex = Math.floor(t * (residuesSegment.length - 1));
      const res = residuesSegment[resIndex];
      let normalVec = new THREE.Vector3();
      if (res && res.o) {
        const CA = res.ca.clone().add(offset).multiplyScalar(worldScale);
        normalVec.copy(res.o.clone().multiplyScalar(worldScale).sub(CA));
        // remove tangent component
        normalVec.addScaledVector(tangent, -normalVec.dot(tangent));
        if (normalVec.lengthSq() < 1e-6) {
          normalVec = frames.normals[i].clone();
        } else {
          normalVec.normalize();
        }
      } else {
        normalVec = frames.normals[i].clone();
      }

      let binormalVec = new THREE.Vector3()
        .crossVectors(tangent, normalVec)
        .normalize();

      // compute width with taper for sheets
      let width = widthA * worldScale;
      if (segLabel === "E" && taperSamples > 0) {
        const samplesFromEnd = samples - i;
        if (samplesFromEnd <= taperSamples) {
          const f = Math.max(0, samplesFromEnd) / Math.max(1, taperSamples);
          width = width * f; // linear taper to 0
        }
      }

      // Width along normal (CA→O), height along binormal — flat face toward helix center
      pushQuad(p, normalVec, binormalVec, width);
    }

    // build indices between quads
    const quadCount = samples + 1;
    for (let i = 0; i < quadCount - 1; i++) {
      const base = i * 4;
      const next = base + 4;
      for (let k = 0; k < 4; k++) {
        const a = base + k;
        const b = next + k;
        const c = base + ((k + 1) % 4);
        const d = next + ((k + 1) % 4);
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    // caps: start cap
    const startBase = 0;
    indices.push(startBase, startBase + 2, startBase + 1);
    indices.push(startBase, startBase + 3, startBase + 2);

    // end cap or tip for tapered sheet
    if (segLabel === "E" && taperSamples > 0) {
      // add tip vertex
      const end = curve.getPointAt(1);
      const tanEnd = frames.tangents[frames.tangents.length - 1]
        .clone()
        .normalize();
      const tip = end.clone().addScaledVector(tanEnd, 0.6 * worldScale);
      const tipIndex = positions.length / 3;
      positions.push(tip.x, tip.y, tip.z);
      normals.push(tanEnd.x, tanEnd.y, tanEnd.z);
      uvs.push(1, 0.5);

      // connect last quad to tip: use centerline between left-top and left-bottom? we'll connect triangles from last quad edges to tip
      const lastBase = (quadCount - 1) * 4;
      // connect two triangles for each side (left and right)
      indices.push(lastBase + 0, lastBase + 1, tipIndex);
      indices.push(lastBase + 1, lastBase + 2, tipIndex);
      indices.push(lastBase + 2, lastBase + 3, tipIndex);
      indices.push(lastBase + 3, lastBase + 0, tipIndex);
    } else {
      const lastBase = (quadCount - 1) * 4;
      indices.push(lastBase, lastBase + 2, lastBase + 1);
      indices.push(lastBase, lastBase + 3, lastBase + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  update() {
    // Optional: Add rotation or other animations
    // this.root.rotation.y += 0.001;
  }
}
