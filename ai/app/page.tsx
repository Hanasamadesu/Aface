"use client";
import React from "react";
import { HomeCam } from "./home";

export default function Home() {
  return (
    <div className="the min-h-screen h-full w-full">
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 20 -9
              "
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <HomeCam />
    </div>
  );
}
