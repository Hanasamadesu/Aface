import asyncio
import json
import websockets
import threading
from pathlib import Path
from ML import ModelL
CLIENTS = set()
async def handle_client(websocket):
    CLIENTS.add(websocket)
    print(f"Client connected from {websocket.remote_address}")
    try:
        async for message in websocket:
            print(f"Received message: {message}")
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected.")
    finally:
        CLIENTS.remove(websocket)
async def TICK_Send():
    tick = 0
    while True:
        if CLIENTS:
            data_payload = {
                        "data_exists": False
                    }
            if not Path("Data/data.csv").is_file():
                websockets.broadcast(CLIENTS, json.dumps(data_payload))
        tick += 1
        await asyncio.sleep(0.1)
async def socket():
    async with websockets.serve(
        handle_client,
        "localhost",
        2010,
        origins=["http://localhost:3000", "https://nallyfac.cloud"],
    ):
        print("WebSocket server listening on ws://localhost:2010...")
        await TICK_Send()
def start_socket_server():
    asyncio.run(socket())
def main():
    t1 = threading.Thread(target=start_socket_server)
    t2 = threading.Thread(target=ModelL)
    t1.start()
    t1.join()
    t2.start()
    t2.join()
if __name__ == "__main__":
    main()
