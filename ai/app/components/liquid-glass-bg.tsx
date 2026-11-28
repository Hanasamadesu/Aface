"use client";

import React, { useEffect, useRef } from "react";

interface LiquidGlassBgProps {
  active?: boolean;
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform vec2 u_pointer;
uniform float u_active;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 aspect = vec2(u_res.x / max(1.0, u_res.y), 1.0);
  vec2 p = (v_uv - 0.5) * aspect;
  vec2 ptr = (u_pointer - 0.5) * aspect;

  float t = u_time * 0.22;
  float distPtr = length(p - ptr);
  float ripple = sin(distPtr * 18.0 - u_time * 3.0) * exp(-distPtr * 4.5) * 0.04;

  vec2 warp = vec2(
    fbm(p * 2.4 + vec2(t, -t * 0.6)),
    fbm(p * 2.4 + vec2(-t * 0.7, t * 0.9) + 3.1)
  );

  float caustic = fbm(p * 3.2 + warp * 1.4 + ripple);
  float sheen = smoothstep(0.45, 0.85, caustic);

  // iOS / macOS warm porcelain + cool sky + subtle crimson aura when recording
  vec3 baseLight = vec3(0.925, 0.905, 0.875);
  vec3 skyTint = vec3(0.76, 0.87, 0.99);
  vec3 mintTint = vec3(0.84, 0.95, 0.93);
  vec3 activeTint = vec3(0.99, 0.78, 0.78);

  vec3 col = mix(baseLight, skyTint, smoothstep(0.25, 0.85, warp.x));
  col = mix(col, mintTint, smoothstep(0.35, 0.9, warp.y) * 0.55);
  col = mix(col, activeTint, u_active * smoothstep(0.35, 0.85, caustic) * 0.35);

  // Liquid glass specular highlight bands
  float spec = pow(max(0.0, sin((p.x + p.y + warp.x * 0.8 + ripple) * 5.0)), 6.0);
  col += vec3(0.95, 0.98, 1.0) * (sheen * 0.12 + spec * 0.08);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function LiquidGlassBg({ active = false }: LiquidGlassBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current = {
        x: e.clientX / Math.max(1, window.innerWidth),
        y: 1.0 - e.clientY / Math.max(1, window.innerHeight),
      };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(prog, "a_pos");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uPointer = gl.getUniformLocation(prog, "u_pointer");
    const uActive = gl.getUniformLocation(prog, "u_active");

    let rafId = 0;
    let currentActive = activeRef.current ? 1 : 0;
    const startTime = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = (now: number) => {
      currentActive += ((activeRef.current ? 1 : 0) - currentActive) * 0.06;

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(uTime, (now - startTime) * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uPointer, pointerRef.current.x, pointerRef.current.y);
      gl.uniform1f(uActive, currentActive);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full bg-[radial-gradient(circle_at_20%_20%,#dbeafe_0%,#ece6dc_55%,#f5d0fe_100%)]"
    />
  );
}
