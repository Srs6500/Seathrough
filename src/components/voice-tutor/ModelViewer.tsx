"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { cn } from "@/lib/utils";

const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/** Orbitable GLB viewer: drag to spin, scroll to zoom, auto-rotates when idle. */
export function ModelViewer({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    setState("loading");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(0, 0.4, 3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.minDistance = 0.6;
    controls.maxDistance = 8;
    // Stop auto-rotating once the student grabs the model.
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
    const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    let model: THREE.Object3D | null = null;
    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        // Center and scale to a ~2-unit box so any model frames the same way.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = 2 / Math.max(size.x, size.y, size.z, 1e-6);
        model.position.sub(center).multiplyScalar(scale);
        model.scale.setScalar(scale);
        scene.add(model);
        setState("ready");
      },
      undefined,
      () => {
        if (!disposed) setState("error");
      },
    );

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      draco.dispose();
      model?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose());
      });
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src]);

  return (
    <div ref={hostRef} className={cn("relative touch-none", className)}>
      {state !== "ready" ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-[#71717a]">
          {state === "error" ? null : (
            <Loader2 className="size-4 animate-spin text-[#5b4fd4]" aria-hidden />
          )}
          {state === "error" ? "Couldn't load the 3D model." : "Loading 3D model…"}
        </p>
      ) : null}
    </div>
  );
}
