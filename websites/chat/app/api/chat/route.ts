import { agentManager } from "@/agents/agentInit";
import { NextResponse } from "next/server";
import { JSDOM } from 'jsdom';

if (typeof window === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true
  });
  const { window } = dom;

  interface CustomEventInit<T = any> {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
    detail?: T;
  }

  class CustomEventPolyfill<T = any> implements Event {
    static readonly NONE = 0 as const;
    static readonly CAPTURING_PHASE = 1 as const;
    static readonly AT_TARGET = 2 as const;
    static readonly BUBBLING_PHASE = 3 as const;

    readonly NONE = CustomEventPolyfill.NONE;
    readonly CAPTURING_PHASE = CustomEventPolyfill.CAPTURING_PHASE;
    readonly AT_TARGET = CustomEventPolyfill.AT_TARGET;
    readonly BUBBLING_PHASE = CustomEventPolyfill.BUBBLING_PHASE;

    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    currentTarget: EventTarget | null;
    defaultPrevented: boolean;
    eventPhase: number;
    isTrusted: boolean;
    returnValue: boolean;
    srcElement: EventTarget | null;
    target: EventTarget | null;
    timeStamp: number;
    type: string;
    detail: T;

    // Private fields to track state
    private _propagationStopped: boolean = false;
    private _immediatePropagatonStopped: boolean = false;
    private _path: EventTarget[] = [];
    
    constructor(type: string, eventInitDict: CustomEventInit<T> = {}) {
      const event = new window.Event(type, eventInitDict);
      
      this.bubbles = event.bubbles;
      this.cancelable = event.cancelable;
      this.composed = event.composed;
      this.currentTarget = event.currentTarget;
      this.defaultPrevented = event.defaultPrevented;
      this.eventPhase = event.eventPhase;
      this.isTrusted = event.isTrusted;
      this.returnValue = true;
      this.srcElement = event.target;
      this.target = event.target;
      this.timeStamp = event.timeStamp;
      this.type = event.type;
      
      this.detail = eventInitDict.detail as T;

      // Initialize the event path if target exists
      if (this.target) {
        let node: EventTarget | null = this.target;
        while (node) {
          this._path.push(node);
          // TypeScript doesn't know about parentNode on EventTarget
          node = (node as any).parentNode || null;
        }
      }
    }

    get cancelBubble(): boolean {
      return this._propagationStopped;
    }

    set cancelBubble(value: boolean) {
      this._propagationStopped = value;
    }

    composedPath(): EventTarget[] {
      return this._path.slice();
    }

    preventDefault(): void {
      if (this.cancelable) {
        this.defaultPrevented = true;
        this.returnValue = false;
      }
    }

    stopImmediatePropagation(): void {
      this._immediatePropagatonStopped = true;
      this.stopPropagation();
    }

    stopPropagation(): void {
      this._propagationStopped = true;
      this.cancelBubble = true;
    }

    initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void {
      Object.assign(this, {
        type,
        bubbles: bubbles ?? this.bubbles,
        cancelable: cancelable ?? this.cancelable,
        defaultPrevented: false,
      });
      
      this._propagationStopped = false;
      this._immediatePropagatonStopped = false;
    }
  }

  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

  const originalAddEventListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (typeof listener === 'function') {
      const wrappedListener = function(this: EventTarget, event: Event) {
        if (event instanceof CustomEventPolyfill) {
          return listener.call(this, event);
        }
        return listener.call(this, new CustomEventPolyfill(event.type, {
          detail: event
        }));
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  Object.assign(global, {
    window,
    document: window.document,
    Event: window.Event,
    CustomEvent: CustomEventPolyfill,
    EventTarget: window.EventTarget,
    MessageEvent: window.MessageEvent,
    TextEncoder: global.TextEncoder,
    TextDecoder: global.TextDecoder
  });
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