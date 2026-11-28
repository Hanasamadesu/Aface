import asyncio
import json
import threading

import websockets

import Global
import ML

CLIENTS: set[websockets.ServerConnection] = set()


async def handle_client(websocket: websockets.ServerConnection) -> None:
    CLIENTS.add(websocket)
    print(f"Client connected from {websocket.remote_address}")
    try:
        await websocket.send(
            json.dumps({
                "type": "status",
                "data_exists": Global.Model is not None,
                "model_ready": Global.Model is not None,
            })
        )
        async for message in websocket:
            if not isinstance(message, str):
                continue
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            if not isinstance(payload, dict):
                continue

            if payload.get("type") == "frame" and isinstance(payload.get("image"), str):
                result = await asyncio.to_thread(ML.predict_frame, payload["image"])
                if "seq" in payload:
                    result["seq"] = payload["seq"]
                await websocket.send(json.dumps(result))
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected.")
    finally:
        CLIENTS.discard(websocket)


async def TICK_Send() -> None:
    while True:
        if CLIENTS:
            status_payload = {
                "type": "status",
                "data_exists": Global.Model is not None,
                "model_ready": Global.Model is not None,
            }
            websockets.broadcast(CLIENTS, json.dumps(status_payload))
        await asyncio.sleep(1.0)


async def socket() -> None:
    async with websockets.serve(
        handle_client,
        "localhost",
        2010,
        origins=["http://localhost:3000", "https://nallyfac.cloud"],
        max_size=2 * 1024 * 1024,
    ):
        print("WebSocket server listening on ws://localhost:2010...")
        await TICK_Send()


def start_socket_server() -> None:
    asyncio.run(socket())


def main() -> None:
    t1 = threading.Thread(target=start_socket_server, daemon=True)
    t1.start()
    ML.ModelL()
    t1.join()


if __name__ == "__main__":
    main()
