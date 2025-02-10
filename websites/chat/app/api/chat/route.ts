import { agentManager } from "@/agents/agentInit";
import { NextResponse } from "next/server";

class ServerEventEmitter {
  private handlers: Map<string, Function[]> = new Map();

  addEventListener(type: string, handler: Function) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)?.push(handler);
  }

  removeEventListener(type: string, handler: Function) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  dispatchEvent(type: string, detail: any) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const event = { type, detail };
      handlers.forEach(handler => handler(event));
    }
  }
}

// Modify libp2p setup to use the server event emitter
if (!(globalThis as any).libp2pEventEmitter) {
  (globalThis as any).libp2pEventEmitter = new ServerEventEmitter();
}

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }
    if (!agentManager.initialized) {
      await agentManager.initialize();
    }
    const response = await agentManager.handleMessage(message);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}