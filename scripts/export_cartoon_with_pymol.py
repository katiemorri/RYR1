#!/usr/bin/env python3

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def build_pml(input_pdb: Path, out_obj: Path):
    return f"""
reinitialize
load {input_pdb.as_posix()}, prot
hide everything, prot
show cartoon, prot

set cartoon_fancy_helices, 1
set cartoon_flat_sheets, 1
set cartoon_smooth_loops, 1
set cartoon_side_chain_helper, off

color 0xFF78B4, prot and ss H
color 0xFFD60A, prot and ss S
color 0x9AA0A6, prot and not (ss H+S)

set specular, 0
set ambient, 0.55
set direct, 0.45
set ray_shadow, 0

save {out_obj.as_posix()}, prot
quit
""".strip()


def main():
    parser = argparse.ArgumentParser(
        description="Export a PyMOL cartoon mesh (OBJ/MTL) for VR loading."
    )
    parser.add_argument("--input", required=True, help="Input PDB path")
    parser.add_argument(
        "--output-dir", required=True, help="Output directory for OBJ/MTL"
    )
    parser.add_argument(
        "--name",
        required=True,
        help="Output base name (without extension), e.g. 8X48_cartoon",
    )
    parser.add_argument(
        "--pymol-bin",
        default="pymol",
        help="PyMOL executable name/path (default: pymol)",
    )

    args = parser.parse_args()

    pymol_bin = shutil.which(args.pymol_bin)
    if not pymol_bin:
        print(
            "PyMOL executable not found. Install PyMOL and retry, or pass --pymol-bin /path/to/pymol.",
            file=sys.stderr,
        )
        return 2

    input_pdb = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_pdb.exists():
        print(f"Input file does not exist: {input_pdb}", file=sys.stderr)
        return 2

    out_obj = output_dir / f"{args.name}.obj"

    with tempfile.NamedTemporaryFile("w", suffix=".pml", delete=False) as handle:
        pml_path = Path(handle.name)
        handle.write(build_pml(input_pdb, out_obj))

    try:
        cmd = [pymol_bin, "-cq", pml_path.as_posix()]
        print("Running:", " ".join(cmd))
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"PyMOL export failed: {exc}", file=sys.stderr)
        return exc.returncode or 1
    finally:
        if pml_path.exists():
            pml_path.unlink()

    out_mtl = out_obj.with_suffix(".mtl")
    if out_obj.exists():
        print(f"Exported OBJ: {out_obj}")
    if out_mtl.exists():
        print(f"Exported MTL: {out_mtl}")

    if not out_obj.exists():
        print("Expected OBJ not found after export.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
