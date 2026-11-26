"use client";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import { HomeCam } from "./home"

export default function Home() {
  return (
    <div className="the h-full w-full">
      <svg className="absolute w-0 h-0">
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
      <div className="desktop absolute hidden lg:flex bg-white z-99 flex-row w-[100vw] h-[100vh] justify-center items-top pt-10">
        <p className="font-bold text-xl text-black">
          We're sorry but desktop arent supported yet
        </p>
      </div>
      <div className="phone lg:hidden z-98 visible w-full h-full">
       <HomeCam/>

      </div>
      
    </div>
  )
}
