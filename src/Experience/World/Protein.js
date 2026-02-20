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
    this.group.scale.set(0.0002, 0.0002, 0.0002);
    this.group.rotation.x -= Math.PI / 2;
    this.group.position.y += 1.2;

    // Visual defaults to match PyMOL-like cartoon
    this.scene.background = new THREE.Color(0xffffff);
    // lighting: directional top-left, ambient, weak fill from opposite side
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(-1, 1, 0.5);
    dir.position.multiplyScalar(10);
    this.scene.add(dir);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(1, -0.5, -0.5);
    fill.position.multiplyScalar(10);
    this.scene.add(fill);
  }

  loadProtein(filename) {
    const url = "./" + filename;

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} while loading ${url}`);
        }
        return response.text();
      })
      .then((pdbText) => {
        const pdb = this.loader.parse(pdbText);
        const residues = this.parseResiduesFromPDB(pdbText);
        const ssLabels = this.computeDSSP(residues);
        this.onProteinLoaded(pdb, { residues, ssLabels });
      })
      .catch((error) => {
        console.error("Error loading PDB file:", error);
      });
  }

  onProteinLoaded(pdb, secondaryStructure) {
    const geometryAtoms = pdb.geometryAtoms;

    // Center the protein
    geometryAtoms.computeBoundingBox();
    const offset = new THREE.Vector3();
    geometryAtoms.boundingBox.getCenter(offset).negate();

    geometryAtoms.translate(offset.x, offset.y, offset.z);

    const segmentCount = this.renderSecondaryStructure(secondaryStructure, offset);
    console.log(
      `Protein loaded: rendered ${segmentCount} secondary-structure segments`
    );
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
      arr.sort((a, b) => a.resSeq - b.resSeq || a.insertionCode.localeCompare(b.insertionCode));
      for (const r of arr) {
        // ensure CA exists
        if (!r.ca) continue;
        residues.push(r);
      }
    }
    return residues;
  }

  // Very small, approximate DSSP-like assignment using CA and O coordinates only.
  // Returns an array of labels 'H' (helix), 'E' (sheet), 'C' (coil) matching residues order.
  computeDSSP(residues) {
    const n = residues.length;
    if (n === 0) return [];

    // Reconstruct approximate N and C and H positions from CA positions
    const Npos = new Array(n);
    const Cpos = new Array(n);
    const Hpos = new Array(n);

    for (let i = 0; i < n; i++) {
      const ca = residues[i].ca;
      // tangent from neighbors
      let tangent = new THREE.Vector3();
      if (i > 0 && i < n - 1) {
        tangent.copy(residues[i + 1].ca).sub(residues[i - 1].ca).normalize();
      } else if (i < n - 1) {
        tangent.copy(residues[i + 1].ca).sub(ca).normalize();
      } else if (i > 0) {
        tangent.copy(ca).sub(residues[i - 1].ca).normalize();
      } else {
        tangent.set(1, 0, 0);
      }

      // approximate N and C along tangent
      Npos[i] = ca.clone().addScaledVector(tangent, -1.33); // approx bond distances
      Cpos[i] = ca.clone().addScaledVector(tangent, 1.33);

      // approximate H attached to N: move ~1.0A from N roughly toward CA
      Hpos[i] = ca.clone().sub(Npos[i]).normalize().multiplyScalar(1.0).add(Npos[i]);
    }

    // Hydrogen bond detection: H_j to O_i
    const hb = Array.from({ length: n }, () => new Array(n).fill(false));
    for (let i = 0; i < n; i++) {
      const Oi = residues[i].o;
      if (!Oi) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const Hj = Hpos[j];
        if (!Hj) continue;
        const r = Oi.distanceTo(Hj);
        if (r > 3.5) continue; // distance cutoff
        // angle criterion: N-H...O should be reasonably linear
        const Nj = Npos[j];
        const vNH = Hj.clone().sub(Nj).normalize();
        const vHO = Oi.clone().sub(Hj).normalize();
        const cosAngle = vNH.dot(vHO);
        if (cosAngle < 0.4) continue; // require approx directional
        hb[i][j] = true; // O_i accepted H from j
      }
    }

    // classify: helix if i <-> i+4 H-bonds exist (donor->acceptor either way)
    const label = new Array(n).fill("C");
    for (let i = 0; i < n; i++) {
      const j = i + 4;
      if (j < n) {
        if (hb[i][j] || hb[j][i]) {
          label[i] = "H";
          label[j] = "H";
        }
      }
    }

    // detect sheet-like mutual hydrogen bonds between strands (i,j) with |i-j|>2
    const sheetPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        // mutual or strong reciprocal pattern
        if ((hb[i][j] && hb[j][i]) || (hb[i][j] || hb[j][i]) ) {
          // exclude local turns already labeled helix
          if (label[i] !== "H" && label[j] !== "H") {
            sheetPairs.push([i, j]);
          }
        }
      }
    }

    // mark residues participating in sheets; require runs of at least 2
    const sheetSet = new Set();
    for (const [i, j] of sheetPairs) {
      sheetSet.add(i);
      sheetSet.add(j);
    }
    // Apply E for those in sheetSet (unless already H)
    for (const idx of sheetSet) {
      if (label[idx] !== "H") label[idx] = "E";
    }

    // Post-process: short isolated H/E -> C (remove singletons)
    for (let i = 0; i < n; i++) {
      const cur = label[i];
      if (cur === "C") continue;
      const prev = i > 0 ? label[i - 1] : "C";
      const next = i < n - 1 ? label[i + 1] : "C";
      if (prev === "C" && next === "C") label[i] = "C";
    }

    return label;
  }

  renderSecondaryStructure(ssData, offset) {
    // ssData: { residues: [...], ssLabels: [...] }
    if (!ssData || !ssData.residues || !ssData.ssLabels) return 0;
    const residues = ssData.residues;
    const labels = ssData.ssLabels;

    const worldScale = 75;
    // color everything magenta per request
    const colorMap = { H: 0xFF3399, E: 0xFF3399, C: 0xFF3399 };

    const makeMaterial = (label) => {
      const color = colorMap[label] || colorMap.C;
      return new THREE.MeshPhongMaterial({ color, specular: 0xffffff, shininess: 120, side: THREE.DoubleSide });
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
      if (lab !== curLabel) {
        segments.push({ label: curLabel, start: startIdx, end: i - 1 });
        curLabel = lab;
        startIdx = i;
      }
    }
    if (curLabel !== null) segments.push({ label: curLabel, start: startIdx, end: labels.length - 1 });

    let rendered = 0;
    for (const seg of segments) {
      const segLength = seg.end - seg.start + 1;
      if (segLength < 2) continue;

      // include 2-residue overlap on both sides to avoid seams
      const sIdx = Math.max(0, seg.start - 2);
      const eIdx = Math.min(residues.length - 1, seg.end + 2);
      const points = [];
      for (let k = sIdx; k <= eIdx; k++) points.push(residues[k].ca.clone().add(offset).multiplyScalar(worldScale));
      const segmentResidues = residues.slice(sIdx, eIdx + 1);
      const curve = new THREE.CatmullRomCurve3(points);
      const samplesPerRes = 6;
      const tubularSegments = Math.max( Math.floor(points.length * samplesPerRes), 12 );

      if (seg.label === "C") {
        // coils -> round thin tube (radius 0.3 Å scaled)
        const radius = 0.3 * worldScale;
        const radialSegments = 8;
        const tubeGeom = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
        const mat = makeMaterial('C');
        const mesh = new THREE.Mesh(tubeGeom, mat);
        this.root.add(mesh);
        rendered++;
        continue;
      }

      // For ribbons (H and E) build extruded rectangular cross-section oriented by O atom
      const geom = this.buildExtrudedRibbon(segmentResidues, seg.label, offset, worldScale, tubularSegments);
      const mat = makeMaterial(seg.label);
      this.root.add(new THREE.Mesh(geom, mat));
      rendered++;
    }

    return rendered;
  }

  // Build an extruded rectangular ribbon mesh for a segment.
  buildExtrudedRibbon(residuesSegment, segLabel, offset, worldScale, tubularSegments) {
    const centers = residuesSegment.map((r) => r.ca.clone().add(offset).multiplyScalar(worldScale));
    const curve = new THREE.CatmullRomCurve3(centers);
    const frames = curve.computeFrenetFrames(tubularSegments, false);

    const widthA = segLabel === "H" ? 6.0 : 2.5;
    const heightA = segLabel === "H" ? 0.2 : 0.4;
    const height = heightA * worldScale;
    const samples = tubularSegments;

    // For sheets we'll taper last 3 residues into an arrow
    const residuesCount = residuesSegment.length;
    const taperResidues = segLabel === "E" ? Math.min(3, residuesCount) : 0;
    const samplesPerResidue = Math.max(1, Math.floor(samples / Math.max(1, residuesCount - 1)));
    const taperSamples = taperResidues * samplesPerResidue;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // helper to push 4 corner verts for a cross-section
    const pushQuad = (p, normalVec, binormalVec, w) => {
      const halfW = w / 2;
      // order: left-top, left-bottom, right-bottom, right-top
      const lt = p.clone().addScaledVector(normalVec, halfW).addScaledVector(binormalVec, height / 2);
      const lb = p.clone().addScaledVector(normalVec, halfW).addScaledVector(binormalVec, -height / 2);
      const rb = p.clone().addScaledVector(normalVec, -halfW).addScaledVector(binormalVec, -height / 2);
      const rt = p.clone().addScaledVector(normalVec, -halfW).addScaledVector(binormalVec, height / 2);
      positions.push(lt.x, lt.y, lt.z, lb.x, lb.y, lb.z, rb.x, rb.y, rb.z, rt.x, rt.y, rt.z);
      // approximate normals per corner as combination
      const nlt = normalVec.clone().multiplyScalar(0.5).add(binormalVec.clone().multiplyScalar(0.5)).normalize();
      const nlb = normalVec.clone().multiplyScalar(0.5).add(binormalVec.clone().multiplyScalar(-0.5)).normalize();
      const nrb = normalVec.clone().multiplyScalar(-0.5).add(binormalVec.clone().multiplyScalar(-0.5)).normalize();
      const nrt = normalVec.clone().multiplyScalar(-0.5).add(binormalVec.clone().multiplyScalar(0.5)).normalize();
      normals.push(nlt.x, nlt.y, nlt.z, nlb.x, nlb.y, nlb.z, nrb.x, nrb.y, nrb.z, nrt.x, nrt.y, nrt.z);
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

      let binormalVec = new THREE.Vector3().crossVectors(tangent, normalVec).normalize();

      // helix curl: rotate normal around tangent and offset position so ribbon wraps
      if (segLabel === "H") {
        const turns = residuesSegment.length / 3.6; // approx helix turns
        const angle = t * turns * Math.PI * 2.0;
        normalVec.applyAxisAngle(tangent, angle);
        // recompute binormal after rotation
        binormalVec = new THREE.Vector3().crossVectors(tangent, normalVec).normalize();
        // intentionally no wrap offset: keep ribbon centered on CA path for clearer width
      }

      // compute width with taper for sheets
      let width = widthA * worldScale;
      if (segLabel === "E" && taperSamples > 0) {
        const samplesFromEnd = samples - i;
        if (samplesFromEnd <= taperSamples) {
          const f = Math.max(0, samplesFromEnd) / Math.max(1, taperSamples);
          width = width * f; // linear taper to 0
        }
      }

      // For helices make the cross-section flat: width along binormal, height along normal
      if (segLabel === "H") {
        pushQuad(p, binormalVec, normalVec, width);
      } else {
        pushQuad(p, normalVec, binormalVec, width);
      }
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
      const tanEnd = frames.tangents[frames.tangents.length - 1].clone().normalize();
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
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
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
