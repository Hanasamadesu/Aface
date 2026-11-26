"use client";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";

interface Data {
  data_exists: boolean;
}

export function HomeCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  async function startCamera() {
    if(cameraOn) {
      stopCamera();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 1340 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setCameraOn(true);
    } catch (error) {
      console.error("Camera error:", error);
      alert("Unable to access camera.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const [data, setData] = React.useState<Data | null>(null);
  const [status, setStatus] = React.useState("Connecting");
  const wsRef = React.useRef<WebSocket | null>(null);
  React.useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;

      const ws = new WebSocket("wss://api.nallyfac.cloud/");
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Connected");
        console.log("WebSocket connected");
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setData(data);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!stopped) {
          setStatus("Reconnecting");
          reconnectTimer = setTimeout(connect, 3000);
        }
        console.log("WebSocket disconnected");
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);
  return (
    <div className="flex min-h-screen flex-col justify-top items-center w-full h-[100%] bg-[#ECE6DC]">
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
      <div

        className="he z-999 absolute mt-2 flex w-[90vw] flex-row items-center justify-center sm:w-sm md:mt-0 md:w-md top-0"
        style={{ filter: "url(#goo)" }}
      >
        <div className={`relative mt-3 h-12 shrink-0 overflow-visible transition-[width] ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-500 md:mt-5 md:h-16 ${cameraOn ? "w-12 md:w-16" : "w-0"}`}>
          <div className={`circle absolute left-0 top-0 flex h-12 w-12 justify-center items-center rounded-full bg-[#050505] transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-500 md:h-16 md:w-16 ${cameraOn ? "-translate-x-3 opacity-100 md:-translate-x-5" : "translate-x-full opacity-0"}`}>
            <span className="relative flex size-6 shrink-0 items-center justify-center transition-all duration-300 md:size-8">
              <Image
                src="/cam.svg"
                alt=""
                width={32}
                height={32}
                aria-hidden="true"
                className={`relative inset-0 h-6 w-6 transition-all duration-300 ease-in-out md:h-8 md:w-8 ${cameraOn ? "icon-check-motion-blur" : "icon-error-motion-blur"}`}
              />
            </span>
          </div>
        </div>

        <div className={`server bg-[#050505] mt-3 h-12 min-w-0 flex-1 rounded-4xl px-4 py-3 shadow-md flex flex-row justify-between items-center transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-500 md:mt-5 md:h-16 md:px-6 md:py-4 ${cameraOn ? "max-w-[70%]" : "max-w-[100%]"}`}>

      

        <div className="icons flex flex-row gap-2 justify-center items-center transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-300">
        
          
       
        <span className="relative size-6 shrink-0 transition-all duration-300 md:size-8">
          
          <Image
            src="/check_circle.svg"
            alt=""
            width={32}
            height={32}
            aria-hidden="true"
            className={`absolute inset-0 h-6 w-6 transition-all duration-300 ease-in-out md:h-8 md:w-8 ${status === "Connected" ? "icon-check-motion-blur" : "icon-error-motion-blur"}`}
          />
          <Image
            src="/error.svg"
            alt=""
            width={32}
            height={32}
            aria-hidden="true"
            className={`absolute inset-0 h-6 w-6 transition-all duration-300 ease-in-out md:h-8 md:w-8 ${status !== "Connected" ? "icon-check-motion-blur" : "icon-error-motion-blur"} `}
          />
        </span>
        </div>
        
        <h1
          key={status}
          className={`status-motion-blur min-w-0 text-lg ease-[cubic-bezier(0.7, 0, 0.3, 1)] text-center font-bold transition-colors duration-200 text-white sm:text-xl md:text-2xl`}
        >
          {status}
        </h1>
      </div>
      </div>
      
      <div className={`camera-view ${cameraOn ? 'bg-[#ff383b]' : 'bg-[#ffffff]'} p-1 shadow-lg w-[100%] h-[100%] flex flex-col justify-start items-top transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-300`}>
        <div className="head inset-0 m-auto z-99 absolute bottom-0 flex flex-row justify-center items-center w-[90vw] h-[10%]  mb-4">
          <button className={`decor h-[60%] w-full ${cameraOn ? 'bg-[#ff383b]' : 'bg-[#0088ff]'} rounded-[28px] flex justify-center items-center backdrop-blur-xl shadow-md transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-300`} onClick={startCamera}>
            <p className="text-base text-center font-bold text-white transition-all duration-300 sm:text-lg md:text-xl">{cameraOn ? 'Stop' : 'Start'}</p>
          </button>
        </div>
        <div className="view w-full h-full overflow-hidden rounded-[28px] shadow-md flex flex-col justify-center items-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ transform: "scaleX(-1)" }}
            className="h-full w-full object-cover transition-all ease-[cubic-bezier(0.7, 0, 0.3, 1)] duration-300"
          />

        </div>
      </div>
    </div>
  );
}
